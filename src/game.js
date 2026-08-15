// game.js — game state machine, rules, waves, scoring, transitions.
// No DOM access. `update(dt, input)` advances the simulation.

import {
  wrap, torusDelta, torusDistance, circleCollision,
  sweptCircleCollisionTime, rayCircleHitDistanceTorus,
} from './math.js';
import {
  createShip, updateShip, createBullet, steerHomingBullet, updateBullet,
  createDataNode, updateDataNode,
  createAsteroid, updateAsteroid, childSize, asteroidPoints,
  createIceCloud, updateIceCloud,
  createGravityAnomaly, updateGravityAnomaly,
  createRadiationField, updateRadiationField,
  createUfo, updateUfo, createEnemyBullet, createMine, updateMine,
  resetShipShield,
} from './entities.js';

export const STATUS = {
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'gameOver',
};

// Squads use explicit compositions instead of taking a consecutive slice from
// the archetype list.  In particular, the first three-craft formation is a
// bomber protected by two scouts, which makes the pincer tactic reachable.
const DEFAULT_SQUAD_TEMPLATES = Object.freeze({
  1: Object.freeze([
    Object.freeze({ id: 'lone-hunter', members: Object.freeze(['hunter']) }),
    Object.freeze({ id: 'lone-base', members: Object.freeze(['base']) }),
    Object.freeze({ id: 'lone-scout', members: Object.freeze(['scout']) }),
    Object.freeze({ id: 'lone-fighter', members: Object.freeze(['fighter']) }),
    Object.freeze({ id: 'lone-bomber', members: Object.freeze(['bomber']) }),
  ]),
  2: Object.freeze([
    Object.freeze({ id: 'fighter-wing', members: Object.freeze(['fighter', 'hunter']) }),
    Object.freeze({ id: 'scout-pair', members: Object.freeze(['scout', 'scout']) }),
    Object.freeze({ id: 'bomber-escort', members: Object.freeze(['bomber', 'scout']) }),
  ]),
  3: Object.freeze([
    Object.freeze({ id: 'bomber-pincer', members: Object.freeze(['bomber', 'scout', 'scout']) }),
    Object.freeze({ id: 'hunter-screen', members: Object.freeze(['hunter', 'fighter', 'scout']) }),
    Object.freeze({ id: 'base-guard', members: Object.freeze(['base', 'bomber', 'scout']) }),
  ]),
  4: Object.freeze([
    Object.freeze({ id: 'bomber-pincer-screen', members: Object.freeze(['bomber', 'scout', 'scout', 'fighter']) }),
    Object.freeze({ id: 'assault-screen', members: Object.freeze(['base', 'hunter', 'scout', 'fighter']) }),
  ]),
});

function finiteNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value, fallback) {
  const normalized = Number.isFinite(value) ? Math.floor(value) : 0;
  return normalized > 0 ? normalized : fallback;
}

function finiteUnitMultiplier(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(number));
}

/**
 * Create a new game instance. `cfg` is the config object, `rng` is an injectable
 * random function () => [0,1).
 *
 * World dimensions are read from `cfg.world` at spawn/update time so that
 * `resize(w, h)` keeps the simulation consistent with the viewport.
 */
export function createGame(cfg, rng = Math.random, options = {}) {
  let worldW = cfg.world.width;
  let worldH = cfg.world.height;

  const multiplierCfg = cfg.scoring?.multiplier ?? {};
  const initialMultiplier = finiteNonNegative(
    multiplierCfg.initial, 1
  );
  const multiplierIncrement = finiteNonNegative(
    multiplierCfg.increment, 0
  );
  const maxMultiplier = Math.max(
    initialMultiplier,
    finiteNonNegative(multiplierCfg.max, initialMultiplier)
  );
  const accuracyEnabled = multiplierIncrement > 0
    && maxMultiplier > initialMultiplier;
  const initialHighScore = normalizeScore(
    typeof options === 'number' ? options : options?.highScore
  );

  const state = {
    status: STATUS.READY,
    ship: createShip(cfg, worldW, worldH),
    bullets: [],
    asteroids: [],
    score: 0,
    highScore: initialHighScore,
    scoring: {
      combo: 0,
      bestCombo: 0,
      multiplier: initialMultiplier,
      chainReactions: 0,
      newHighScore: false,
    },
    lives: cfg.game.lives,
    wave: 1,
    bulletCooldown: 0,
    waveSpeedMult: 1,
    respawnPending: false,
    nextExtraLifeScore: positiveInteger(cfg.game.extraLifeEvery, 10000),
    extraLivesAwarded: 0,
    abilities: {
      dashCooldown: 0,
      shieldEnergy: cfg.abilities.shieldBurst.maxEnergy,
      hyperspaceCooldown: 0,
    },
    bombs: [],
    effects: [],
    dataNodes: [],
    iceClouds: [],
    radiationFields: [],
    anomalies: [],
    ufos: [],
    enemyBullets: [],
    mines: [],
    powerUps: {
      weapon: null,
      weaponTime: 0,
      dronesTime: 0,
      empStored: false,
      beamCooldown: 0,
      dronePhase: 0,
    },
    drones: [],
    beam: {
      active: false,
      x: 0,
      y: 0,
      angle: 0,
      length: 0,
    },
  };

  // Identity is owned by a game run, not by entity construction.  It is reset
  // on a fresh start/restart so deterministic runs remain reproducible.
  let nextUfoId = 1;
  let nextSquadId = 1;

  // Accuracy attempts live outside public state because they are bookkeeping
  // for active projectiles, not presentation data. Spread pellets share one
  // entry and therefore resolve as one logical trigger pull.
  const pendingAccuracyShots = new Map();
  let nextAccuracyShotId = 1;

  // Tracks which asteroid each UFO is currently in contact with, so a
  // continuous overlap does not deal damage every step. The WeakMap lets
  // removed UFOs be garbage-collected without manual cleanup.
  const activeUfoAsteroidContacts = new WeakMap();

  // A hostile craft may remain visually overlapped with the ship for more than
  // one fixed step. It is one impact until the two bodies separate, rather
  // than a rapid stream of shield damage every frame.
  let activeShipUfoContacts = new Set();

  // Regeneration is evaluated after contacts. A hit in this simulation step
  // always restarts the full delay before any regeneration can resume.
  let shieldDamagedThisStep = false;

  // --- Internal helpers ---

  function multiplierForCombo(combo) {
    return Math.min(
      maxMultiplier,
      initialMultiplier + Math.max(0, combo) * multiplierIncrement
    );
  }

  function resetAccuracyCombo() {
    state.scoring.combo = 0;
    state.scoring.multiplier = initialMultiplier;
  }

  function resetScoringRun() {
    pendingAccuracyShots.clear();
    nextAccuracyShotId = 1;
    state.scoring.combo = 0;
    state.scoring.bestCombo = 0;
    state.scoring.multiplier = initialMultiplier;
    state.scoring.chainReactions = 0;
    state.scoring.newHighScore = false;
  }

  function beginAccuracyShot(projectileCount) {
    if (!accuracyEnabled || projectileCount <= 0) return null;
    const shotId = nextAccuracyShotId++;
    pendingAccuracyShots.set(shotId, {
      remaining: Math.max(1, Math.floor(projectileCount)),
    });
    return shotId;
  }

  function resolveAccuracyHit(bullet) {
    const shotId = bullet?.accuracyShotId;
    if (shotId === null || !pendingAccuracyShots.has(shotId)) return false;
    pendingAccuracyShots.delete(shotId);
    state.scoring.combo++;
    state.scoring.bestCombo = Math.max(
      state.scoring.bestCombo, state.scoring.combo
    );
    state.scoring.multiplier = multiplierForCombo(state.scoring.combo);
    return true;
  }

  function resolveAccuracyExpiry(bullet) {
    const shotId = bullet?.accuracyShotId;
    const shot = pendingAccuracyShots.get(shotId);
    if (!shot) return false;
    shot.remaining--;
    if (shot.remaining > 0) return false;
    pendingAccuracyShots.delete(shotId);
    resetAccuracyCombo();
    return true;
  }

  function promoteHighScore() {
    if (state.score <= state.highScore) return false;
    state.highScore = normalizeScore(state.score);
    state.scoring.newHighScore = true;
    return true;
  }

  function awardPoints(basePoints) {
    const base = normalizeScore(basePoints);
    if (base === 0) return 0;
    const awarded = normalizeScore(base * state.scoring.multiplier);
    const previousScore = state.score;
    state.score = normalizeScore(state.score + awarded);
    promoteHighScore();
    checkExtraLife(previousScore);
    return awarded;
  }

  function checkExtraLife(previousScore) {
    if (state.nextExtraLifeScore === Number.POSITIVE_INFINITY) return;
    const spacing = positiveInteger(cfg.game.extraLifeEvery, 10000);
    let threshold = positiveInteger(state.nextExtraLifeScore, spacing);
    const maxLives = Math.max(
      cfg.game.lives,
      finiteNonNegative(cfg.game.maxLives, cfg.game.lives)
    );

    // Awards remain anchored to fixed score milestones (10k, 20k, 30k, ...),
    // even if one score event jumps across more than one of them.
    while (previousScore < threshold && state.score >= threshold) {
      if (state.lives < maxLives) {
        state.lives = Math.min(maxLives, state.lives + 1);
        state.extraLivesAwarded = (state.extraLivesAwarded ?? 0) + 1;
        addEffect(
          'extraLife', state.ship.x, state.ship.y,
          1.2, state.ship.radius * 4,
          { label: '+1 VIDA' }
        );
      }
      threshold = threshold <= Number.MAX_SAFE_INTEGER - spacing
        ? threshold + spacing
        : Number.POSITIVE_INFINITY;
    }
    state.nextExtraLifeScore = threshold;
  }

  function clearShipManeuver() {
    state.ship.dashing = false;
    state.ship.dashTime = 0;
    state.ship.dashVx = 0;
    state.ship.dashVy = 0;
  }

  function nukeEverything() {
    // Debug power: wipes all threats on screen, clears projectiles and hazards,
    // and forces the next wave to spawn immediately.
    // Do not go through the regular destruction path: it splits rocks and can
    // create elemental hazards, which would leave the field non-empty after a
    // supposed full-screen wipe.
    for (const asteroid of state.asteroids) {
      if (!asteroid.alive) continue;
      asteroid.alive = false;
      awardPoints(asteroidPoints(asteroid.size, cfg));
    }
    state.asteroids = [];
    // This is likewise a simultaneous wipe, not a sequence of normal kills:
    // the final member of a squad must not receive a last-survivor bonus.
    for (const ufo of state.ufos) {
      if (!ufo.alive) continue;
      ufo.alive = false;
      awardPoints(ufo.points ?? 0);
      addEffect('ufoDestroy', ufo.x, ufo.y, 0.48, ufo.radius * 3.2);
    }
    state.ufos = [];
    state.enemyBullets = [];
    state.mines = [];
    state.iceClouds = [];
    state.radiationFields = [];
    state.anomalies = [];
    activeShipUfoContacts.clear();
    addEffect('emp', state.ship.x, state.ship.y, 0.7, Math.hypot(worldW, worldH));
  }

  function resetPilotSystems() {
    state.abilities.dashCooldown = 0;
    state.abilities.shieldEnergy = cfg.abilities.shieldBurst.maxEnergy;
    state.abilities.hyperspaceCooldown = 0;
    state.bombs = [];
    state.effects = [];
    state.ship.cryoSlowTime = 0;
    clearShipManeuver();
  }

  function resetThreatSystems() {
    state.iceClouds = [];
    state.radiationFields = [];
    state.anomalies = [];
    state.ufos = [];
    state.enemyBullets = [];
    state.mines = [];
    activeShipUfoContacts.clear();
    nextUfoId = 1;
    nextSquadId = 1;
  }

  function resetWeaponSystems() {
    state.dataNodes = [];
    state.powerUps.weapon = null;
    state.powerUps.weaponTime = 0;
    state.powerUps.dronesTime = 0;
    state.powerUps.empStored = false;
    state.powerUps.beamCooldown = 0;
    state.powerUps.dronePhase = 0;
    state.drones = [];
    state.beam.active = false;
    state.beam.x = 0;
    state.beam.y = 0;
    state.beam.angle = 0;
    state.beam.length = 0;
  }

  /**
   * Guaranteed-safe spawn position: toroidal distance from the ship is always
   * >= safeRadius. Tries random positions first; if every random attempt lands
   * too close, falls back to deterministic candidates on a ring at exactly
   * safeRadius, revalidated with torusDistance so wrap never shortens it.
   */
  function safeSpawnPosition(safeRadius) {
    const sx = state.ship.x, sy = state.ship.y;
    let best = null;

    function consider(x, y) {
      const wrappedX = wrap(x, worldW);
      const wrappedY = wrap(y, worldH);
      const dist = torusDistance(wrappedX, wrappedY, sx, sy, worldW, worldH);
      if (best === null || dist > best.dist) {
        best = { x: wrappedX, y: wrappedY, dist };
      }
      return dist >= safeRadius ? { x: wrappedX, y: wrappedY } : null;
    }

    let tries = 0;
    while (tries < 100) {
      const candidate = consider(rng() * worldW, rng() * worldH);
      if (candidate) return candidate;
      tries++;
    }

    // Deterministic fallback: scan a ring at exactly safeRadius.
    // The phase is sampled once so the directions always remain evenly spaced,
    // even for an adversarial but valid RNG sequence.
    const n = 16;
    const phase = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const angle = phase + (i / n) * Math.PI * 2;
      const candidate = consider(
        sx + Math.cos(angle) * safeRadius,
        sy + Math.sin(angle) * safeRadius
      );
      if (candidate) return candidate;
    }

    // The antipode is globally farthest from the ship on a rectangular torus.
    // It guarantees the requested radius whenever the world can contain it.
    const antipode = consider(sx + worldW / 2, sy + worldH / 2);
    if (antipode) return antipode;

    // Degenerate world: the requested radius is geometrically impossible.
    return { x: best.x, y: best.y };
  }

  function spawnWave(n) {
    // Environmental threats are scoped to a wave. Ice clouds are allowed to
    // finish dissipating across the boundary because they are short-lived and
    // may have been created by the final asteroid.
    state.anomalies = [];
    // Do not discard UFOs here: checkWaveClear is responsible for waiting for
    // every squad member to be destroyed or flee before this function runs.
    state.enemyBullets = [];
    state.mines = [];

    const count = Math.min(
      cfg.asteroid.initialCount + (n - 1),
      cfg.asteroid.maxInitial
    );
    const speedMult = Math.min(
      1 + (n - 1) * cfg.asteroid.waveSpeedMult,
      cfg.asteroid.maxSpeedMult
    );
    state.waveSpeedMult = speedMult;

    const waveAsteroids = [];
    for (let i = 0; i < count; i++) {
      const pos = safeSpawnPosition(cfg.asteroid.safeSpawnRadius);
      const kind = asteroidKindForWave(n, i);
      const asteroid = createAsteroid(
        'large', pos.x, pos.y, cfg, rng, speedMult, kind
      );
      waveAsteroids.push(asteroid);
      state.asteroids.push(asteroid);
    }

    const available = waveAsteroids.map((_, index) => index);
    let carriers = 0;
    const guaranteed = Math.min(
      cfg.powerUps.guaranteedCarriersPerWave,
      cfg.powerUps.maxCarriersPerWave,
      available.length
    );
    while (carriers < guaranteed) {
      // Carrier selection deliberately does not consume the physics RNG stream.
      // This keeps asteroid shapes, fragment velocities and safe spawns stable.
      const pick = (n + carriers - 1) % available.length;
      waveAsteroids[available.splice(pick, 1)[0]].dataCarrier = true;
      carriers++;
    }
    for (const index of available) {
      if (carriers >= cfg.powerUps.maxCarriersPerWave) break;
      const asteroid = waveAsteroids[index];
      const hash = Math.sin(
        (asteroid.x + 1) * 12.9898
        + (asteroid.y + 1) * 78.233
        + (n + index) * 37.719
      ) * 43758.5453;
      const roll = hash - Math.floor(hash);
      if (roll < cfg.powerUps.extraCarrierChance) {
        waveAsteroids[index].dataCarrier = true;
        carriers++;
      }
    }

    spawnWaveThreats(n);
  }

  function waveHash(wave, index, salt = 0) {
    const value = Math.sin(
      (wave + 1) * 12.9898 + (index + 1) * 78.233 + (salt + 1) * 37.719
    ) * 43758.5453;
    return value - Math.floor(value);
  }

  function unlockedAsteroidKinds(wave) {
    const unlocks = cfg.asteroid.typeUnlockWave;
    const types = cfg.asteroid.types;
    if (!unlocks || !types) return [];
    return ['magma', 'cryo', 'crystal', 'radioactive'].filter(kind =>
      types[kind] && wave >= (unlocks[kind] ?? Infinity)
    );
  }

  function asteroidKindForWave(wave, index) {
    const kinds = unlockedAsteroidKinds(wave);
    if (kinds.length === 0) return 'normal';

    const guaranteed = Math.max(0, Math.floor(
      cfg.asteroid.guaranteedSpecialsPerWave ?? 0
    ));
    if (index < guaranteed) {
      // Each newly unlocked material is introduced immediately: magma on wave
      // 2, cryo on 3 and crystal on 4 with the default balance.
      return kinds[(wave - 2 + index) % kinds.length];
    }

    const chance = Math.min(
      cfg.asteroid.maxSpecialChance ?? 0,
      Math.max(0, (wave - 1) * (cfg.asteroid.specialChancePerWave ?? 0))
    );
    if (waveHash(wave, index, 11) >= chance) return 'normal';
    return kinds[Math.floor(waveHash(wave, index, 29) * kinds.length) % kinds.length];
  }

  function deterministicThreatPosition(wave, salt, safeRadius) {
    let x = waveHash(wave, salt, 41) * worldW;
    let y = waveHash(wave, salt, 73) * worldH;
    if (torusDistance(x, y, state.ship.x, state.ship.y, worldW, worldH) < safeRadius) {
      x = wrap(x + worldW / 2, worldW);
      y = wrap(y + worldH / 2, worldH);
    }
    return { x, y };
  }

  function deterministicUfoPosition(wave, salt, playerSafeRadius, ufoRadius) {
    const collisionCfg = cfg.ufo?.asteroidCollision;
    const spawnClearance = collisionCfg?.spawnClearance ?? 16;
    const spawnAttempts = collisionCfg?.spawnAttempts ?? 24;
    const liveAsteroids = state.asteroids.filter(a => a.alive);

    let bestPlayerSafe = null;
    let bestAsteroidMargin = -Infinity;
    let bestMinMargin = -Infinity;
    let bestCandidate = null;

    for (let attempt = 0; attempt < spawnAttempts; attempt++) {
      const x = waveHash(wave, attempt, salt) * worldW;
      const y = waveHash(wave, attempt, salt + 1) * worldH;
      const distanceToShip = torusDistance(x, y, state.ship.x, state.ship.y, worldW, worldH);
      const shipMargin = distanceToShip - playerSafeRadius;

      let asteroidMargin;
      if (liveAsteroids.length === 0) {
        asteroidMargin = Number.POSITIVE_INFINITY;
      } else {
        asteroidMargin = Math.min(...liveAsteroids.map(a =>
          torusDistance(x, y, a.x, a.y, worldW, worldH)
          - (ufoRadius + a.radius + spawnClearance)
        ));
      }

      const overlapsAsteroid = liveAsteroids.some(a =>
        circleCollision(x, y, ufoRadius, a.x, a.y, a.radius, worldW, worldH)
      );

      const minimumMargin = Math.min(shipMargin, asteroidMargin);

      // Fully valid candidate — both margins non-negative.
      if (shipMargin >= 0 && asteroidMargin >= 0) {
        return { x, y, playerSafe: true, overlapsAsteroid };
      }

      // Track best player-safe candidate (shipMargin >= 0, asteroidMargin < 0).
      if (shipMargin >= 0 && asteroidMargin > bestAsteroidMargin) {
        bestAsteroidMargin = asteroidMargin;
        bestPlayerSafe = { x, y, playerSafe: true, overlapsAsteroid };
      }

      // Track best by minimumMargin (defensive fallback).
      if (minimumMargin > bestMinMargin) {
        bestMinMargin = minimumMargin;
        bestCandidate = { x, y, playerSafe: shipMargin >= 0, overlapsAsteroid };
      }
    }

    // Prefer the best player-safe sample even if it overlaps a rock.
    if (bestPlayerSafe) return bestPlayerSafe;

    // Last resort: the candidate with the largest minimum margin.
    if (bestCandidate) return bestCandidate;

    // Geometrically impossible — centre.
    const defaultX = worldW / 2;
    const defaultY = worldH / 2;
    const defaultOverlaps = liveAsteroids.some(a =>
      circleCollision(defaultX, defaultY, ufoRadius, a.x, a.y, a.radius, worldW, worldH)
    );
    return { x: defaultX, y: defaultY, playerSafe: false, overlapsAsteroid: defaultOverlaps };
  }

  function squadCountForWave(wave, ufoCfg) {
    const squadCfg = ufoCfg.squadSize;
    if (!squadCfg) return 1;

    const waveDelta = Math.max(0, wave - ufoCfg.unlockWave);
    const maxSquad = wave >= (squadCfg.lateGameWave ?? Infinity)
      ? (squadCfg.lateGameMax ?? squadCfg.max ?? 1)
      : (squadCfg.max ?? 1);
    const growingSize = (squadCfg.base ?? 1)
      + Math.floor(waveDelta * (squadCfg.growthPerWave ?? 0));
    return Math.max(1, Math.min(Math.max(1, maxSquad), growingSize));
  }

  function firstWaveForSquadSize(size, ufoCfg) {
    const unlockWave = ufoCfg.unlockWave ?? 1;
    // The configuration is intentionally allowed to delay the fourth slot
    // until late game, so derive the first eligible wave instead of assuming a
    // fixed growth rate.
    for (let wave = unlockWave; wave < unlockWave + 256; wave++) {
      if (squadCountForWave(wave, ufoCfg) >= size) return wave;
    }
    return unlockWave;
  }

  function squadTemplateForWave(wave, squadCount, ufoCfg) {
    const size = Math.max(1, Math.floor(squadCount));
    const templates = DEFAULT_SQUAD_TEMPLATES[size];
    if (!templates || templates.length === 0) {
      const kinds = ['hunter', 'base', 'scout', 'fighter', 'bomber'];
      return {
        id: `fallback-${size}`,
        members: Array.from({ length: size }, (_, index) => kinds[index % kinds.length]),
      };
    }

    const firstWave = firstWaveForSquadSize(size, ufoCfg);
    const index = Math.max(0, wave - firstWave) % templates.length;
    const template = templates[index];
    return { id: template.id, members: [...template.members] };
  }

  function ufoAppearanceIndex(wave, kind, ufoCfg) {
    let appearances = 0;
    const unlockWave = ufoCfg.unlockWave ?? 1;
    for (let priorWave = unlockWave; priorWave < wave; priorWave++) {
      const priorCount = squadCountForWave(priorWave, ufoCfg);
      const priorTemplate = squadTemplateForWave(priorWave, priorCount, ufoCfg);
      // A squad is one appearance for an archetype even when it deliberately
      // contains a matched pair (such as the two Scouts in the pincer).
      if (priorTemplate.members.includes(kind)) appearances++;
    }
    return appearances;
  }

  function squadFormationOffsets(size, spacing) {
    const layouts = {
      1: [{ forward: 0, lateral: 0 }],
      2: [
        { forward: 0, lateral: -0.5 * spacing },
        { forward: 0, lateral: 0.5 * spacing },
      ],
      3: [
        { forward: 0.34 * spacing, lateral: 0 },
        { forward: -0.30 * spacing, lateral: 0.52 * spacing },
        { forward: -0.30 * spacing, lateral: -0.52 * spacing },
      ],
      4: [
        { forward: 0.42 * spacing, lateral: 0 },
        { forward: -0.08 * spacing, lateral: 0.56 * spacing },
        { forward: -0.08 * spacing, lateral: -0.56 * spacing },
        { forward: -0.62 * spacing, lateral: 0 },
      ],
    };
    if (layouts[size]) return layouts[size];

    // Keep a sensible circular fallback if a custom balance raises the cap
    // beyond the built-in four-craft formations.
    const radius = Math.max(spacing, size * spacing / (Math.PI * 2));
    return Array.from({ length: size }, (_, index) => {
      const angle = index * Math.PI * 2 / size;
      return { forward: Math.cos(angle) * radius, lateral: Math.sin(angle) * radius };
    });
  }

  function placeSquadFormationSlot(anchor, formationAngle, offset) {
    const cos = Math.cos(formationAngle);
    const sin = Math.sin(formationAngle);
    return {
      x: wrap(anchor.x + offset.forward * cos - offset.lateral * sin, worldW),
      y: wrap(anchor.y + offset.forward * sin + offset.lateral * cos, worldH),
    };
  }

  function spawnWaveThreats(wave) {
    const gravity = cfg.hazards?.gravity;
    if (gravity && wave >= gravity.unlockWave) {
      const shouldSpawn = wave === gravity.unlockWave
        || waveHash(wave, 0, 97) < gravity.chance;
      if (shouldSpawn) {
        const pos = deterministicThreatPosition(
          wave, 101, gravity.safeSpawnRadius ?? state.ship.radius * 8
        );
        state.anomalies.push(createGravityAnomaly(pos.x, pos.y, cfg));
      }
    }

    const ufoCfg = cfg.ufo;
    if (ufoCfg && wave >= ufoCfg.unlockWave) {
      const waveDelta = wave - ufoCfg.unlockWave;
      const squadCount = squadCountForWave(wave, ufoCfg);
      const template = squadTemplateForWave(wave, squadCount, ufoCfg);
      const squadCfg = ufoCfg.squad ?? {};
      const squadId = nextSquadId++;
      const formationSpacing = Math.max(
        64,
        finiteNonNegative(squadCfg.formationSpacing, 68),
      );
      const formationOffsets = squadFormationOffsets(
        template.members.length, formationSpacing,
      );
      const formationRadius = Math.max(
        0,
        ...formationOffsets.map(offset => Math.hypot(offset.forward, offset.lateral)),
      );
      const maxMemberRadius = Math.max(
        ...template.members.map(kind => (ufoCfg[kind] ?? ufoCfg.hunter).radius),
      );
      // Spawn a single, enlarged formation envelope.  Every individual slot
      // is then safe from the ship and rocks rather than being scattered by
      // separate calls to the generic spawn sampler.
      const anchor = deterministicUfoPosition(
        wave,
        149,
        (ufoCfg.safeSpawnRadius ?? state.ship.radius * 10) + formationRadius,
        maxMemberRadius + formationRadius,
      );
      const anchorToShipX = torusDelta(anchor.x, state.ship.x, worldW);
      const anchorToShipY = torusDelta(anchor.y, state.ship.y, worldH);
      const formationAngle = anchorToShipX === 0 && anchorToShipY === 0
        ? waveHash(wave, squadId, 131) * Math.PI * 2
        : Math.atan2(anchorToShipY, anchorToShipX);

      const hpCfg = ufoCfg.hpScaling;
      const hpBonus = (hpCfg && wave >= (hpCfg.startWave ?? 8))
        ? Math.min(
            hpCfg.maxBonusHp ?? 3,
            Math.floor((wave - hpCfg.startWave) * (hpCfg.bonusPerWave ?? 0.5))
          )
        : 0;
      const appearanceIndexes = new Map(
        [...new Set(template.members)].map(kind => [
          kind,
          ufoAppearanceIndex(wave, kind, ufoCfg),
        ])
      );

      const squadUfos = [];
      for (let i = 0; i < template.members.length; i++) {
        const requestedKind = template.members[i];
        const kind = ufoCfg[requestedKind] ? requestedKind : 'hunter';
        const appearanceIndex = appearanceIndexes.get(kind) ?? 0;
        const speedMultiplier = Math.min(
          Math.max(1, ufoCfg.maxSpeedMultiplier ?? 1),
          1 + appearanceIndex * Math.max(0, ufoCfg.speedGrowthPerAppearance ?? 0)
        );
        const formationOffset = formationOffsets[i];
        const pos = placeSquadFormationSlot(
          anchor, formationAngle, formationOffset,
        );
        const ufoId = nextUfoId++;
        const ufo = createUfo(
          kind, pos.x, pos.y, cfg, rng, speedMultiplier, ufoId,
        );
        // Keep the game-layer identity assignment compatible with old entity
        // factories while the entity constructor also receives the ID.
        ufo.id ??= ufoId;
        ufo.squadId = squadId;
        ufo.initialSquadSize = template.members.length;
        ufo.hadSquad = template.members.length > 1;
        ufo.squadTemplate = template.id;
        ufo.formationSlot = i;
        ufo.formationOffset = {
          forward: formationOffset.forward,
          lateral: formationOffset.lateral,
        };
        ufo.appearanceIndex = appearanceIndex;
        ufo.spawnCollisionProtected = state.asteroids.some(asteroid =>
          asteroid.alive && circleCollision(
            pos.x, pos.y, ufo.radius,
            asteroid.x, asteroid.y, asteroid.radius,
            worldW, worldH,
          )
        );
        ufo.warpInTimer = squadCfg.warpInDuration ?? 0.6;
        if (ufo.kind === 'fighter') {
          // A burst starts only after the normal fire cooldown expires.
          ufo.burstRemaining = 0;
          ufo.burstTimer = 0;
        }
        if (hpBonus > 0) {
          ufo.hp += hpBonus;
          ufo.maxHp += hpBonus;
        }
        squadUfos.push(ufo);
        state.ufos.push(ufo);
      }

      // Squad tactics assignments
      const bomber = squadUfos.find(u => u.kind === 'bomber');
      const scouts = squadUfos.filter(u => u.kind === 'scout');
      if (bomber && scouts.length > 0) {
        for (const scout of scouts) {
          scout.squadRole = 'escort';
          scout.squadTarget = bomber;
        }
      }
      if (scouts.length >= 2) {
        scouts.forEach((scout, idx) => {
          scout.orbitDirection = idx % 2 === 0 ? 1 : -1;
        });
      }

      if (template.members.length >= 2) {
        addEffect(
          'squadWarning', anchor.x, anchor.y,
          squadCfg.warningDuration ?? 1.5
        );
      }
    }
  }

  /**
   * Find a safe respawn position for the ship. Starts at the world centre; if
   * any asteroid is within safeRadius (toroidally), scans expanding rings of
   * candidate points until a clear one is found. If all deterministic candidates
   * are occupied, performs a random best-effort scan and returns the safest
   * position (never the centre blindly).
   */
  function findSafeRespawn(safeRadius) {
    const cx = worldW / 2, cy = worldH / 2;

    function minAsteroidDistance(x, y) {
      let min = Infinity;
      for (const a of state.asteroids) {
        const d = torusDistance(x, y, a.x, a.y, worldW, worldH) - a.radius;
        if (d < min) min = d;
      }
      return min;
    }

    let best = null;

    function consider(x, y) {
      const wrappedX = wrap(x, worldW);
      const wrappedY = wrap(y, worldH);
      const margin = minAsteroidDistance(wrappedX, wrappedY);
      if (best === null || margin > best.margin) {
        best = { x: wrappedX, y: wrappedY, margin };
      }
      return margin >= safeRadius && margin > state.ship.radius
        ? { x: wrappedX, y: wrappedY }
        : null;
    }

    if (state.asteroids.length === 0) return { x: cx, y: cy };

    const centre = consider(cx, cy);
    if (centre) return centre;

    // Expanding ring search: 16 directions, many rings.
    for (let ring = 1; ring <= 24; ring++) {
      const r = safeRadius * ring;
      for (let i = 0; i < 16; i++) {
        const theta = (i / 16) * Math.PI * 2;
        const candidate = consider(
          cx + Math.cos(theta) * r,
          cy + Math.sin(theta) * r
        );
        if (candidate) return candidate;
      }
    }

    // Random samples also compete with every centre/ring candidate already
    // examined instead of resetting the fallback to the centre.
    for (let i = 0; i < 100; i++) {
      const candidate = consider(rng() * worldW, rng() * worldH);
      if (candidate) return candidate;
    }

    // A reduced safety margin is acceptable only when the circles are
    // physically separated. Touching still counts as a collision.
    if (best && best.margin > state.ship.radius) {
      return { x: best.x, y: best.y };
    }
    return null;
  }

  function resetShip() {
    const pos = findSafeRespawn(cfg.asteroid.safeSpawnRadius);
    state.ship.vx = 0;
    state.ship.vy = 0;
    state.ship.angle = -Math.PI / 2;
    state.ship.thrusting = false;
    state.ship.cryoSlowTime = 0;
    state.beam.active = false;
    clearShipManeuver();
    resetShipShield(state.ship, cfg);

    if (pos === null) {
      state.ship.invuln = 0;
      state.respawnPending = true;
      return false;
    }

    state.ship.x = pos.x;
    state.ship.y = pos.y;
    state.ship.invuln = cfg.ship.respawnInvuln;
    state.respawnPending = false;
    if (state.powerUps.dronesTime > 0) positionDrones();
    return true;
  }

  function shieldDamageFor(sourceType) {
    const damageBySource = cfg.ship.shield?.damageBySource ?? {};
    return finiteNonNegative(damageBySource[sourceType], 34);
  }

  function damageShip(sourceType = 'asteroid') {
    if (
      state.status !== STATUS.PLAYING
      || state.respawnPending
      || state.ship.invuln > 0
    ) return false;

    const bypassShield = sourceType === 'asteroid';
    if (!bypassShield) {
      const damage = shieldDamageFor(sourceType);
      state.ship.shield = Math.max(0, state.ship.shield - damage);
      state.ship.shieldRegenDelay = cfg.ship.shield?.regenDelay ?? 2.0;
      shieldDamagedThisStep = true;
      addEffect('shieldHit', state.ship.x, state.ship.y, 0.25, state.ship.radius * 2.2);
      // If shield still has any integrity, the ship survives this hit.
      if (state.ship.shield > 0) return false; // absorbed
    }

    state.lives--;
    if (state.lives <= 0) {
      state.status = STATUS.GAME_OVER;
      promoteHighScore();
    } else {
      state.respawnPending = true;
      resetShip();
    }
    return true;
  }

  function fireBullet() {
    if (state.respawnPending) return;
    if (state.bulletCooldown > 0) return;
    const playerProjectiles = state.bullets.filter(b => b.source === 'player');

    if (state.powerUps.weapon === 'spread') {
      const spread = cfg.powerUps.spread;
      const count = Math.max(1, Math.floor(spread.count));
      const spreadCap = Math.min(spread.maxProjectiles, cfg.bullet.poweredMax);
      if (playerProjectiles.length + count > spreadCap) return;
      const accuracyShotId = beginAccuracyShot(count);
      for (let i = 0; i < count; i++) {
        const offset = i - (count - 1) / 2;
        state.bullets.push(createBullet(state.ship, cfg, {
          angle: state.ship.angle + offset * spread.angle,
          kind: 'spread',
          accuracyShotId,
        }));
      }
      state.bulletCooldown = spread.cooldown;
      return;
    }

    if (state.powerUps.weapon === 'homing') {
      const homing = cfg.powerUps.homing;
      const missiles = playerProjectiles.filter(b => b.kind === 'missile').length;
      if (
        missiles >= homing.maxMissiles
        || playerProjectiles.length >= cfg.bullet.poweredMax
      ) return;
      const accuracyShotId = beginAccuracyShot(1);
      state.bullets.push(createBullet(state.ship, cfg, {
        kind: 'missile',
        speed: homing.speed,
        life: homing.life,
        radius: homing.radius,
        turnRate: homing.turnRate,
        inheritVelocity: false,
        accuracyShotId,
      }));
      state.bulletCooldown = homing.cooldown;
      return;
    }

    if (playerProjectiles.length >= cfg.bullet.max) return;
    state.bullets.push(createBullet(state.ship, cfg, {
      accuracyShotId: beginAccuracyShot(1),
    }));
    state.bulletCooldown = cfg.bullet.cooldown;
  }

  function beginWeaponStep(dt) {
    const powerUps = state.powerUps;
    powerUps.beamCooldown = Math.max(0, powerUps.beamCooldown - dt);
    state.beam.active = false;
  }

  function updateShieldRegen(dt) {
    if (
      state.status !== STATUS.PLAYING
      || state.respawnPending
      || shieldDamagedThisStep
    ) return;

    let remaining = Math.max(0, dt);
    const delay = finiteNonNegative(state.ship.shieldRegenDelay, 0);
    if (delay > 0) {
      const spentWaiting = Math.min(delay, remaining);
      state.ship.shieldRegenDelay = delay - spentWaiting;
      remaining -= spentWaiting;
    }
    if (remaining <= 0) return;

    const shieldCfg = cfg.ship.shield;
    const maxShield = shieldCfg?.max ?? state.ship.shieldMax ?? 100;
    const regen = shieldCfg?.regenPerSecond ?? 0;
    if (regen > 0 && state.ship.shield < maxShield) {
      state.ship.shield = Math.min(
        maxShield,
        state.ship.shield + regen * remaining
      );
    }
  }

  function ageTemporaryPowerUps(dt) {
    const powerUps = state.powerUps;
    if (powerUps.weaponTime > 0) {
      powerUps.weaponTime = Math.max(0, powerUps.weaponTime - dt);
      if (powerUps.weaponTime === 0) {
        if (powerUps.weapon === 'beam') state.beam.active = false;
        powerUps.weapon = null;
        powerUps.beamCooldown = 0;
      }
    }

    if (powerUps.dronesTime > 0) {
      powerUps.dronesTime = Math.max(0, powerUps.dronesTime - dt);
      if (powerUps.dronesTime === 0) state.drones = [];
    }
  }

  function choosePowerUpType() {
    const options = [];
    let totalWeight = 0;
    for (let i = 0; i < cfg.powerUps.types.length; i++) {
      const type = cfg.powerUps.types[i];
      if (type === 'emp' && state.powerUps.empStored) continue;
      const weight = cfg.powerUps.weights[i];
      options.push({ type, weight });
      totalWeight += weight;
    }

    let roll = rng() * totalWeight;
    for (const option of options) {
      if (roll < option.weight) return option.type;
      roll -= option.weight;
    }
    return options.at(-1).type;
  }

  function collectDataNode(node) {
    const type = choosePowerUpType();
    node.alive = false;
    addEffect(
      'pickup', node.x, node.y,
      cfg.powerUps.pickupEffectDuration, node.radius * 3.2
    );

    if (type === 'emp') {
      state.powerUps.empStored = true;
      return type;
    }
    if (type === 'drones') {
      state.powerUps.dronesTime = cfg.powerUps.drones.duration;
      ensureDrones();
      return type;
    }

    state.powerUps.weapon = type;
    state.powerUps.weaponTime = cfg.powerUps[type].duration;
    state.powerUps.beamCooldown = 0;
    state.bulletCooldown = 0;
    state.beam.active = false;
    return type;
  }

  function ensureDrones() {
    if (state.drones.length === cfg.powerUps.drones.count) return;
    state.drones = [];
    for (let i = 0; i < cfg.powerUps.drones.count; i++) {
      state.drones.push({
        x: state.ship.x,
        y: state.ship.y,
        radius: 7,
        visualRadius: 13,
        phaseOffset: (i / cfg.powerUps.drones.count) * Math.PI * 2,
        cooldown: (i / cfg.powerUps.drones.count) * cfg.powerUps.drones.fireCooldown,
        angle: 0,
      });
    }
    positionDrones();
  }

  function positionDrones() {
    const drones = cfg.powerUps.drones;
    for (const drone of state.drones) {
      const phase = state.powerUps.dronePhase + drone.phaseOffset;
      drone.x = wrap(state.ship.x + Math.cos(phase) * drones.orbitRadius, worldW);
      drone.y = wrap(state.ship.y + Math.sin(phase) * drones.orbitRadius, worldH);
      drone.angle = phase + Math.PI / 2;
    }
  }

  function nearestTarget(x, y, maxRange = Infinity) {
    let target = null;
    let bestDistance = maxRange;
    for (const candidate of [...state.asteroids, ...state.ufos]) {
      if (!candidate.alive) continue;
      const distance = torusDistance(x, y, candidate.x, candidate.y, worldW, worldH);
      if (distance <= bestDistance) {
        if (target !== null && distance === bestDistance) continue;
        target = candidate;
        bestDistance = distance;
      }
    }
    return target;
  }

  function updateDrones(dt) {
    if (state.powerUps.dronesTime <= 0) return;
    ensureDrones();
    state.powerUps.dronePhase += cfg.powerUps.drones.orbitSpeed * dt;
    positionDrones();

    const droneProjectiles = () => state.bullets.filter(b => b.source === 'drone').length;
    for (const drone of state.drones) {
      drone.cooldown = Math.max(0, drone.cooldown - dt);
      if (state.respawnPending || drone.cooldown > 0) continue;
      if (droneProjectiles() >= cfg.powerUps.drones.maxProjectiles) break;

      const target = nearestTarget(drone.x, drone.y, cfg.powerUps.drones.range);
      if (!target) continue;
      const angle = Math.atan2(
        torusDelta(drone.y, target.y, worldH),
        torusDelta(drone.x, target.x, worldW)
      );
      state.bullets.push(createBullet({
        x: drone.x,
        y: drone.y,
        vx: 0,
        vy: 0,
        angle,
        radius: 0,
      }, cfg, {
        kind: 'drone',
        source: 'drone',
        speed: cfg.powerUps.drones.bulletSpeed,
        life: cfg.powerUps.drones.bulletLife,
        inheritVelocity: false,
        originRadius: 0,
      }));
      drone.angle = angle;
      drone.cooldown = cfg.powerUps.drones.fireCooldown;
    }
  }

  function updateBeam(firing) {
    if (
      !firing || state.respawnPending || state.powerUps.weapon !== 'beam'
    ) return;

    const beamCfg = cfg.powerUps.beam;
    const beam = state.beam;
    beam.active = true;
    beam.angle = state.ship.angle;
    beam.x = wrap(state.ship.x + Math.cos(beam.angle) * state.ship.radius, worldW);
    beam.y = wrap(state.ship.y + Math.sin(beam.angle) * state.ship.radius, worldH);
    beam.length = beamCfg.range;

    let target = null;
    let nearestHit = null;
    for (const candidate of [...state.asteroids, ...state.ufos]) {
      if (!candidate.alive) continue;
      const hit = rayCircleHitDistanceTorus(
        beam.x, beam.y, beam.angle, beamCfg.range,
        candidate.x, candidate.y, candidate.radius + beamCfg.radius,
        worldW, worldH
      );
      if (hit !== null && (nearestHit === null || hit < nearestHit)) {
        target = candidate;
        nearestHit = hit;
      }
    }

    if (nearestHit !== null) beam.length = nearestHit;
    if (target && state.powerUps.beamCooldown <= 0) {
      if (state.asteroids.includes(target)) damageAsteroid(target, 1);
      else damageUfo(target, 1);
      state.powerUps.beamCooldown = beamCfg.tickCooldown;
    }
  }

  function activateEMP() {
    if (state.respawnPending || !state.powerUps.empStored) return false;
    state.powerUps.empStored = false;
    const small = [];
    for (const asteroid of state.asteroids) {
      if (asteroid.size === 'small') small.push(asteroid);
      else asteroid.stun = Math.max(asteroid.stun ?? 0, cfg.powerUps.emp.stunDuration);
    }
    destroyAsteroids(small);
    addEffect(
      'emp', state.ship.x, state.ship.y,
      cfg.powerUps.emp.effectDuration, Math.hypot(worldW, worldH)
    );
    return true;
  }

  function addEffect(kind, x, y, duration, maxRadius, details = {}) {
    const effect = {
      ...details,
      kind,
      x: wrap(x, worldW),
      y: wrap(y, worldH),
      age: 0,
      duration,
      maxRadius,
      visualRadius: maxRadius + 8,
    };
    state.effects.push(effect);
    return effect;
  }

  function activateDash() {
    if (state.respawnPending || state.abilities.dashCooldown > 0) return false;
    const dash = cfg.abilities.dash;
    state.ship.dashing = true;
    state.ship.dashTime = dash.duration;
    state.ship.dashVx = Math.cos(state.ship.angle) * dash.speed;
    state.ship.dashVy = Math.sin(state.ship.angle) * dash.speed;
    state.ship.vx = state.ship.dashVx;
    state.ship.vy = state.ship.dashVy;
    state.ship.invuln = Math.max(state.ship.invuln, dash.invuln);
    state.abilities.dashCooldown = dash.cooldown;
    return true;
  }

  function activateShieldBurst() {
    const burst = cfg.abilities.shieldBurst;
    if (state.respawnPending || state.abilities.shieldEnergy < burst.cost) return false;

    state.abilities.shieldEnergy = Math.max(0, state.abilities.shieldEnergy - burst.cost);
    state.ship.invuln = Math.max(state.ship.invuln, burst.grace);
    addEffect('shield', state.ship.x, state.ship.y, burst.effectDuration, burst.radius);

    for (const asteroid of state.asteroids) {
      const dx = torusDelta(state.ship.x, asteroid.x, worldW);
      const dy = torusDelta(state.ship.y, asteroid.y, worldH);
      const distance = Math.hypot(dx, dy);
      if (distance > burst.radius + asteroid.radius) continue;

      // A perfectly centred asteroid gets a deterministic push in the ship's
      // facing direction, avoiding division by zero and RNG-only behaviour.
      const nx = distance > 1e-9 ? dx / distance : Math.cos(state.ship.angle);
      const ny = distance > 1e-9 ? dy / distance : Math.sin(state.ship.angle);
      const falloff = 1 - 0.65 * Math.min(distance / burst.radius, 1);
      const targetOutwardSpeed = burst.impulse * falloff;
      const currentOutwardSpeed = asteroid.vx * nx + asteroid.vy * ny;
      const tangentialX = asteroid.vx - nx * currentOutwardSpeed;
      const tangentialY = asteroid.vy - ny * currentOutwardSpeed;
      const outwardSpeed = Math.min(
        burst.maxAsteroidSpeed,
        Math.max(currentOutwardSpeed, targetOutwardSpeed)
      );
      const maxTangentialSpeed = Math.sqrt(Math.max(
        0,
        burst.maxAsteroidSpeed ** 2 - outwardSpeed ** 2
      ));
      const tangentialSpeed = Math.hypot(tangentialX, tangentialY);
      const tangentScale = tangentialSpeed > maxTangentialSpeed && tangentialSpeed > 0
        ? maxTangentialSpeed / tangentialSpeed
        : 1;
      asteroid.vx = nx * outwardSpeed + tangentialX * tangentScale;
      asteroid.vy = ny * outwardSpeed + tangentialY * tangentScale;
    }
    return true;
  }

  function activateHyperspace() {
    if (state.respawnPending || state.abilities.hyperspaceCooldown > 0) return false;
    const hyperspace = cfg.abilities.hyperspace;
    const originX = state.ship.x;
    const originY = state.ship.y;

    state.bombs.push({
      x: originX,
      y: originY,
      radius: 7,
      visualRadius: 18,
      fuse: hyperspace.bombFuse,
      fuseTotal: hyperspace.bombFuse,
      blastRadius: hyperspace.bombRadius,
      alive: true,
    });

    const destination = blindHyperspaceDestination(originX, originY, hyperspace);
    state.ship.x = destination.x;
    state.ship.y = destination.y;
    state.ship.vx = 0;
    state.ship.vy = 0;
    state.ship.thrusting = false;
    clearShipManeuver();
    state.ship.invuln = Math.max(state.ship.invuln, hyperspace.arrivalInvuln);
    state.abilities.hyperspaceCooldown = hyperspace.cooldown;
    addEffect(
      'teleport', state.ship.x, state.ship.y,
      hyperspace.arrivalEffectDuration, state.ship.radius * 4
    );
    return true;
  }

  function blindHyperspaceDestination(originX, originY, hyperspace) {
    // "Blind" means no asteroid-safety check. A minimum displacement only
    // prevents a costly no-op while preserving the dangerous random arrival.
    const minDistance = Math.min(
      hyperspace.minDistance,
      Math.min(worldW, worldH) * 0.35
    );

    for (let attempt = 0; attempt < hyperspace.maxDestinationAttempts; attempt++) {
      const x = wrap(rng() * worldW, worldW);
      const y = wrap(rng() * worldH, worldH);
      if (torusDistance(originX, originY, x, y, worldW, worldH) >= minDistance) {
        return { x, y };
      }
    }

    // The antipode is the farthest deterministic point on the torus and keeps
    // the ability useful even under an adversarial or constant RNG.
    return {
      x: wrap(originX + worldW / 2, worldW),
      y: wrap(originY + worldH / 2, worldH),
    };
  }

  function updatePilotSystems(dt) {
    const abilities = state.abilities;
    abilities.dashCooldown = Math.max(0, abilities.dashCooldown - dt);
    abilities.hyperspaceCooldown = Math.max(0, abilities.hyperspaceCooldown - dt);
    abilities.shieldEnergy = Math.min(
      cfg.abilities.shieldBurst.maxEnergy,
      abilities.shieldEnergy + cfg.abilities.shieldBurst.regenPerSecond * dt
    );
    state.ship.cryoSlowTime = Math.max(0, (state.ship.cryoSlowTime ?? 0) - dt);
  }

  function updateEffects(dt) {
    for (const effect of state.effects) effect.age += dt;
    state.effects = state.effects.filter(effect => effect.age < effect.duration);
  }

  function capEntitySpeed(entity, maxSpeed) {
    if (!(maxSpeed > 0)) return;
    const speed = Math.hypot(entity.vx, entity.vy);
    if (speed <= maxSpeed || speed === 0) return;
    const scale = maxSpeed / speed;
    entity.vx *= scale;
    entity.vy *= scale;
  }

  function applyGravityTo(entity, anomaly, dt, maxSpeed) {
    const dx = torusDelta(entity.x, anomaly.x, worldW);
    const dy = torusDelta(entity.y, anomaly.y, worldH);
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-9 || distance > anomaly.radius) return;
    const falloff = 1 - distance / anomaly.radius;
    const acceleration = Math.min(
      anomaly.maxAcceleration,
      (anomaly.strength / Math.max(distance, anomaly.coreRadius)) * falloff
    );
    const speedBeforePull = Math.hypot(entity.vx, entity.vy);
    entity.vx += (dx / distance) * acceleration * dt;
    entity.vy += (dy / distance) * acceleration * dt;
    // Gravity may bend an already-fast dash shot or repulsed rock, but should
    // not silently clamp it below the speed it had on entering the field.
    capEntitySpeed(entity, Math.max(maxSpeed, speedBeforePull));
  }

  function applyGravity(dt) {
    const gravity = cfg.hazards?.gravity;
    if (!gravity || state.anomalies.length === 0) return;
    for (const anomaly of state.anomalies) {
      if (!anomaly.alive) continue;
      if (!state.respawnPending) {
        applyGravityTo(state.ship, anomaly, dt, gravity.maxShipSpeed);
      }
      for (const asteroid of state.asteroids) {
        if ((asteroid.stun ?? 0) <= 0) {
          applyGravityTo(asteroid, anomaly, dt, gravity.maxAsteroidSpeed);
        }
      }
      for (const bullet of state.bullets) {
        applyGravityTo(bullet, anomaly, dt, gravity.maxBulletSpeed);
      }
    }
  }

  function updateEnvironmentalHazards(dt, iceCloudStarts, radiationFieldStarts) {
    // Age only fields that existed at step start. New fields created during the
    // step preserve their full life for the next step.
    if (iceCloudStarts) {
      for (const start of iceCloudStarts) {
        if (!start.alive) continue;
        updateIceCloud(start.entity, dt, worldW, worldH);
      }
    } else {
      for (const cloud of state.iceClouds) {
        updateIceCloud(cloud, dt, worldW, worldH);
      }
    }
    state.iceClouds = state.iceClouds.filter(cloud => cloud.alive);

    if (radiationFieldStarts) {
      for (const start of radiationFieldStarts) {
        if (!start.alive) continue;
        updateRadiationField(start.entity, dt, worldW, worldH);
      }
    } else {
      for (const field of state.radiationFields) {
        updateRadiationField(field, dt, worldW, worldH);
      }
    }
    state.radiationFields = state.radiationFields.filter(field => field.alive);

    for (const anomaly of state.anomalies) {
      updateGravityAnomaly(anomaly, dt, worldW, worldH);
    }
    state.anomalies = state.anomalies.filter(anomaly => anomaly.alive);
  }

  function armLastSquadSurvivors(aliveUfos = state.ufos) {
    const squads = new Map();
    for (const ufo of aliveUfos) {
      if (!ufo.alive) continue;
      const hadSquad = ufo.hadSquad || (ufo.initialSquadSize ?? 1) > 1;
      if (!hadSquad) continue;

      // `squadId` is always present on spawned UFOs.  The fallback retains
      // sensible behavior for hand-built legacy fixtures used by integrations.
      const key = ufo.squadId ?? '__legacy_squad__';
      const members = squads.get(key) ?? [];
      members.push(ufo);
      squads.set(key, members);
    }

    for (const members of squads.values()) {
      if (members.length !== 1) continue;
      const [ufo] = members;
      if (ufo.isLastSurvivor) continue;
      ufo.isLastSurvivor = true;
      ufo.fleeTimer = cfg.ufo?.squad?.lastSurvivorFleeTime ?? 5.0;
    }
  }

  function fireEnemyProjectile(ufo, target = state.ship) {
    const resolvedTarget = target?.alive === false ? state.ship : target;
    state.enemyBullets.push(
      createEnemyBullet(ufo, resolvedTarget, cfg, worldW, worldH)
    );
  }

  function updateFighterFire(ufo, dt, actionRateMultiplier, ufoCfg, target) {
    // Warp-in and ship respawn pause both phases of a burst.  This prevents a
    // queued follow-up projectile from appearing while the Fighter is hidden.
    if (state.respawnPending || ufo.warpInTimer > 0) return;

    const archetype = ufoCfg.fighter ?? ufoCfg.hunter;
    const burstCount = Math.max(1, Math.floor(archetype.burstCount ?? 1));
    const burstInterval = finiteNonNegative(archetype.burstInterval, 0);
    const fireCooldown = finiteNonNegative(
      archetype.fireCooldown,
      ufoCfg.hunter.fireCooldown ?? 0,
    );

    if ((ufo.burstRemaining ?? 0) > 0) {
      ufo.burstTimer = Math.max(
        0,
        (ufo.burstTimer ?? 0) - dt * actionRateMultiplier,
      );
      if (ufo.burstTimer > 0) return;

      fireEnemyProjectile(ufo, target);
      ufo.burstRemaining = Math.max(0, Math.floor(ufo.burstRemaining) - 1);
      if (ufo.burstRemaining > 0) {
        ufo.burstTimer = burstInterval;
      } else {
        ufo.burstTimer = 0;
        ufo.fireTimer = fireCooldown;
      }
      return;
    }

    ufo.fireTimer = Math.max(
      0,
      (ufo.fireTimer ?? fireCooldown) - dt * actionRateMultiplier,
    );
    if (ufo.fireTimer > 0) return;

    fireEnemyProjectile(ufo, target);
    ufo.burstRemaining = burstCount - 1;
    if (ufo.burstRemaining > 0) {
      ufo.burstTimer = burstInterval;
    } else {
      ufo.burstTimer = 0;
      ufo.fireTimer = fireCooldown;
    }
  }

  function updateUfoThreats(dt) {
    const ufoCfg = cfg.ufo;
    if (!ufoCfg) return;

    // Existing projectiles and mines age before this step's newly spawned
    // threats, so a fresh shot/mine always gets its complete configured life.
    for (const bullet of state.enemyBullets) {
      updateBullet(bullet, dt, worldW, worldH);
    }
    state.enemyBullets = state.enemyBullets.filter(bullet => bullet.alive);

    for (const mine of state.mines) updateMine(mine, dt, worldW, worldH);
    state.mines = state.mines.filter(mine => mine.alive);

    for (const ufo of [...state.ufos]) {
      if (!ufo.alive) continue;
      const updateResult = updateUfo(
        ufo,
        dt,
        state.ship,
        cfg,
        worldW,
        worldH,
        state.asteroids,
        state.bullets,
        [...state.iceClouds, ...state.radiationFields],
      ) ?? {};
      // A fleeing last survivor may expire inside updateUfo.  It must not get
      // a final shot/mine before the end-of-step compaction removes it.
      if (!ufo.alive) {
        if (ufo.isLastSurvivor) ufo.fled = true;
        continue;
      }
      const actionRateMultiplier = finiteNonNegative(
        updateResult.actionRateMultiplier,
        1,
      );
      const canAct = !state.respawnPending && ufo.warpInTimer === 0;
      const suppressFire = updateResult.suppressFire === true;
      const asteroidTarget = updateResult.asteroidTarget;
      const fireTarget = asteroidTarget?.alive && state.asteroids.includes(asteroidTarget)
        ? asteroidTarget
        : state.ship;

      if (ufo.kind === 'hunter' || ufo.kind === 'scout' || ufo.kind === 'fighter' || ufo.kind === 'bomber') {
        const defenseCfg = ufoCfg.asteroidDefense;
        const defenseCooldown = finiteNonNegative(defenseCfg?.cooldown, 0);
        const defensiveTarget = updateResult.defensiveAsteroidTarget;
        let firedDefensiveShot = false;

        // Rebounded rocks can cross the full reaction window before the normal
        // weapon cooldown expires. Give direct-fire UFOs one bounded chance to
        // clear a one-hit normal rock, without resetting or accelerating their
        // ordinary attack cadence against the player.
        if (canAct && !suppressFire) {
          ufo.asteroidDefenseTimer = Math.max(
            0,
            (ufo.asteroidDefenseTimer ?? 0) - dt * actionRateMultiplier,
          );
          if (
            defenseCfg?.enabled !== false
            && defensiveTarget?.alive
            && state.asteroids.includes(defensiveTarget)
            && ufo.asteroidDefenseTimer === 0
          ) {
            fireEnemyProjectile(ufo, defensiveTarget);
            ufo.asteroidDefenseTimer = defenseCooldown;
            firedDefensiveShot = true;
          }
        }

        if (!firedDefensiveShot && ufo.kind === 'fighter') {
          if (!suppressFire) {
            updateFighterFire(ufo, dt, actionRateMultiplier, ufoCfg, fireTarget);
          }
        } else if (!firedDefensiveShot && canAct && !suppressFire) {
          ufo.fireTimer = Math.max(0, ufo.fireTimer - dt * actionRateMultiplier);
          if (ufo.fireTimer === 0) {
            fireEnemyProjectile(ufo, fireTarget);
            const archetype = ufoCfg[ufo.kind] ?? ufoCfg.hunter;
            ufo.fireTimer = archetype.fireCooldown ?? ufoCfg.hunter.fireCooldown;
          }
        }
      } else if (ufo.kind === 'base' && canAct) {
        ufo.mineTimer = Math.max(0, ufo.mineTimer - dt * actionRateMultiplier);
        if (
          ufo.mineTimer === 0
          && state.mines.length < ufoCfg.base.maxMines
        ) {
          state.mines.push(createMine(ufo, cfg));
          ufo.mineTimer = ufoCfg.base.mineCooldown;
        }
      }
    }

    state.ufos = state.ufos.filter(ufo => ufo.alive);
    armLastSquadSurvivors(state.ufos);
  }

  function destroyAsteroids(targets, destructionTime = null, options = {}) {
    const shouldAwardPoints = options.awardPoints !== false;
    const shouldDropDataNodes = options.dropDataNodes ?? shouldAwardPoints;
    const current = new Set(state.asteroids.filter(asteroid => asteroid.alive));
    const deadAsteroids = new Set();
    const fragments = [];
    const queue = [];
    const queued = new Set();
    const chainVictims = new Map();
    let shipInsideMagmaBlast = false;

    function enqueue(asteroid, rootMagma = null) {
      if (!current.has(asteroid) || queued.has(asteroid) || !asteroid.alive) {
        return;
      }
      queued.add(asteroid);
      queue.push({ asteroid, rootMagma });
    }

    for (const target of targets) enqueue(target);

    while (queue.length > 0) {
      const { asteroid, rootMagma } = queue.shift();
      asteroid.alive = false;
      asteroid.destroyedAt = destructionTime;
      deadAsteroids.add(asteroid);

      if (shouldAwardPoints) awardPoints(asteroidPoints(asteroid.size, cfg));

      if (asteroid.dataCarrier) {
        if (shouldDropDataNodes) state.dataNodes.push(createDataNode(asteroid, cfg));
        asteroid.dataCarrier = false;
      }

      const nextSize = childSize(asteroid.size);
      if (nextSize) {
        for (let i = 0; i < cfg.asteroid.childrenPerSplit; i++) {
          const fragment = createAsteroid(
            nextSize, asteroid.x, asteroid.y, cfg, rng, state.waveSpeedMult, asteroid.kind
          );
          fragments.push(fragment);
        }
      }

      if (asteroid.kind === 'magma') {
        const magma = cfg.asteroid.types?.magma;
        const blastRadius = magma?.explosionRadius ?? 115;
        const effectiveRoot = rootMagma ?? asteroid;

        if (!shipInsideMagmaBlast && !state.respawnPending && state.ship.invuln === 0) {
          if (torusDistance(asteroid.x, asteroid.y, state.ship.x, state.ship.y, worldW, worldH) <= blastRadius + state.ship.radius) {
            shipInsideMagmaBlast = true;
          }
        }

        const ufoDamage = Number.isFinite(magma?.ufoDamage) ? Math.max(0, magma.ufoDamage) : 0;
        damageUfosInRadius(
          asteroid.x, asteroid.y, blastRadius,
          ufoDamage, destructionTime, { awardPoints: shouldAwardPoints },
        );

        for (const candidate of current) {
          if (deadAsteroids.has(candidate) || queued.has(candidate)) continue;
          if (torusDistance(asteroid.x, asteroid.y, candidate.x, candidate.y, worldW, worldH) <= blastRadius + candidate.radius) {
            chainVictims.set(candidate, effectiveRoot);
            enqueue(candidate, effectiveRoot);
          }
        }
        addEffect('magmaExplosion', asteroid.x, asteroid.y, magma?.effectDuration ?? 0.55, blastRadius);
      } else if (asteroid.kind === 'cryo') {
        state.iceClouds.push(createIceCloud(asteroid, cfg));
        const cryo = cfg.asteroid.types?.cryo;
        addEffect('cryoBurst', asteroid.x, asteroid.y, cryo?.effectDuration ?? 0.5, cryo?.cloudRadius ?? 96);
      } else if (asteroid.kind === 'radioactive') {
        state.radiationFields.push(createRadiationField(asteroid, cfg));
        const radioactive = cfg.asteroid.types?.radioactive;
        addEffect('radiationBurst', asteroid.x, asteroid.y, radioactive?.effectDuration ?? 0.5, radioactive?.fieldRadius ?? 90);
      }
    }

    const aliveAsteroids = state.asteroids.filter(a => !deadAsteroids.has(a));
    state.asteroids = [...aliveAsteroids, ...fragments];

    if (shipInsideMagmaBlast) damageShip('asteroid');

    const rootCounts = new Map();
    for (const [victim, root] of chainVictims.entries()) {
      if (victim === root) continue;
      const currentCount = rootCounts.get(root) ?? 0;
      rootCounts.set(root, currentCount + 1);
    }
    const chainCfg = cfg.scoring?.chainReaction;
    const minVictims = chainCfg?.minIndirectKills ?? 3;
    const bonusPoints = chainCfg?.bonusPoints ?? 500;
    for (const [root, count] of rootCounts.entries()) {
      if (!shouldAwardPoints) continue;
      if (count >= minVictims) {
        state.scoring.chainReactions++;
        const awardedPoints = awardPoints(bonusPoints);
        addEffect(
          'chainReaction', root.x, root.y,
          chainCfg?.effectDuration ?? 0.9,
          chainCfg?.effectRadius ?? 150,
          {
            label: 'CHAIN REACTION!',
            chainCount: count,
            awardedPoints,
          },
        );
      }
    }

    return deadAsteroids;
  }

  function damageAsteroid(asteroid, amount = 1, impactTime = null, options = {}) {
    if (!asteroid?.alive || !state.asteroids.includes(asteroid)) return new Set();
    if (asteroid.kind === 'crystal') {
      asteroid.hp = Math.max(0, (asteroid.hp ?? 1) - Math.max(0, amount));
      if (asteroid.hp > 0) {
        const crystal = cfg.asteroid.types?.crystal;
        addEffect(
          'crystalHit', asteroid.x, asteroid.y,
          crystal?.hitEffectDuration ?? 0.18,
          asteroid.radius * 1.25
        );
        return new Set();
      }
    }
    return destroyAsteroids([asteroid], impactTime, options);
  }

  /**
   * Apply area damage to every live UFO within `radius` of (x, y). Each blast
   * is a distinct physical event and may hit the same survivor again; the
   * same blast never hits a UFO twice.
   */
  function damageUfosInRadius(x, y, radius, amount, impactTime = null, options = {}) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!Number.isFinite(radius) || radius < 0) return;
    for (const ufo of [...new Set(state.ufos)]) {
      if (!ufo.alive || !state.ufos.includes(ufo)) continue;
      if (torusDistance(x, y, ufo.x, ufo.y, worldW, worldH) <= radius + ufo.radius) {
        damageUfo(ufo, amount, impactTime, options);
      }
    }
  }

  function damageUfo(ufo, amount = 1, impactTime = null, options = {}) {
    if (!ufo?.alive || !state.ufos.includes(ufo)) return false;
    ufo.hp = Math.max(0, (ufo.hp ?? 1) - Math.max(0, amount));
    if (ufo.hp > 0) {
      addEffect('ufoHit', ufo.x, ufo.y, 0.18, ufo.radius * 1.35);
      return false;
    }
    ufo.alive = false;
    ufo.destroyedAt = impactTime;
    const bonus = ufo.isLastSurvivor ? (cfg.ufo.squad?.lastSurvivorBonusMultiplier ?? 2.0) : 1;
    if (options.awardPoints !== false) awardPoints((ufo.points ?? 0) * bonus);
    addEffect('ufoDestroy', ufo.x, ufo.y, 0.48, ufo.radius * 3.2);
    state.ufos = state.ufos.filter(candidate => candidate.alive);
    // Arm the remaining member immediately, so a real projectile kill grants
    // the survivor its flee state (and later its bonus) in the same step.
    armLastSquadSurvivors(state.ufos);
    return true;
  }

  function updateBombs(dt) {
    for (const bomb of state.bombs) {
      if (!bomb.alive) continue;
      bomb.fuse -= dt;
      if (bomb.fuse > 0) continue;

      bomb.alive = false;
      const targets = state.asteroids.filter(asteroid =>
        torusDistance(
          bomb.x, bomb.y, asteroid.x, asteroid.y, worldW, worldH
        ) <= bomb.blastRadius + asteroid.radius
      );
      destroyAsteroids(targets);
      addEffect(
        'bomb', bomb.x, bomb.y,
        cfg.abilities.hyperspace.bombEffectDuration, bomb.blastRadius
      );
    }
    state.bombs = state.bombs.filter(bomb => bomb.alive);
  }

  function handlePlayerProjectileCollisions(
    bulletStarts, asteroidStarts, ufoStarts, dt
  ) {
    const events = [];

    for (let i = 0; i < bulletStarts.length; i++) {
      const bulletStart = bulletStarts[i];
      if (!bulletStart.alive) continue;
      const stepDuration = Math.max(0, dt);
      const duration = Math.min(stepDuration, Math.max(0, bulletStart.life));

      // Expiry is part of the same physical event stream as impacts. A hit at
      // the exact end of projectile life wins the tie and remains accurate.
      if (
        bulletStart.entity.accuracyShotId !== null
        && bulletStart.life <= stepDuration
      ) {
        events.push({
          kind: 'expiry',
          hitTime: Math.max(0, bulletStart.life),
          bulletIndex: i,
        });
      }
      if (bulletStart.life <= 0) continue;

      for (let j = 0; j < asteroidStarts.length; j++) {
        const asteroidStart = asteroidStarts[j];
        const frozenTime = Math.min(asteroidStart.frozenTime, duration);
        let hitTime = duration === 0 && circleCollision(
          bulletStart.x, bulletStart.y, bulletStart.entity.radius,
          asteroidStart.x, asteroidStart.y, asteroidStart.entity.radius,
          worldW, worldH
        ) ? 0 : null;

        if (frozenTime > 0) {
          hitTime = sweptCircleCollisionTime(
            bulletStart.x, bulletStart.y, bulletStart.entity.radius,
            bulletStart.vx, bulletStart.vy,
            asteroidStart.x, asteroidStart.y, asteroidStart.entity.radius,
            0, 0,
            worldW, worldH, frozenTime
          );
        }

        if (hitTime === null && duration > frozenTime) {
          const movingHit = sweptCircleCollisionTime(
            bulletStart.x + bulletStart.vx * frozenTime,
            bulletStart.y + bulletStart.vy * frozenTime,
            bulletStart.entity.radius,
            bulletStart.vx, bulletStart.vy,
            asteroidStart.x, asteroidStart.y, asteroidStart.entity.radius,
            asteroidStart.vx, asteroidStart.vy,
            worldW, worldH, duration - frozenTime
          );
          if (movingHit !== null) hitTime = frozenTime + movingHit;
        }

        if (hitTime !== null) {
          events.push({
            kind: 'hit', hitTime, bulletIndex: i,
            targetType: 'asteroid', targetIndex: j,
          });
        }
      }

      for (let j = 0; j < ufoStarts.length; j++) {
        const ufoStart = ufoStarts[j];
        const hitTime = sweptCircleCollisionTime(
          bulletStart.x, bulletStart.y, bulletStart.entity.radius,
          bulletStart.vx, bulletStart.vy,
          ufoStart.x, ufoStart.y, ufoStart.entity.radius,
          ufoStart.vx, ufoStart.vy,
          worldW, worldH, duration
        );
        if (hitTime !== null) {
          events.push({
            kind: 'hit', hitTime, bulletIndex: i,
            targetType: 'ufo', targetIndex: j,
          });
        }
      }
    }

    // Resolve the earliest physical events first. Hits beat expiry at the exact
    // same instant; remaining indices preserve deterministic collision ties.
    events.sort((a, b) =>
      a.hitTime - b.hitTime ||
      (a.kind === 'hit' ? 0 : 1) - (b.kind === 'hit' ? 0 : 1) ||
      a.bulletIndex - b.bulletIndex ||
      (a.targetType ?? '').localeCompare(b.targetType ?? '') ||
      (a.targetIndex ?? -1) - (b.targetIndex ?? -1)
    );

    const deadBullets = new Set();
    const expiredBullets = new Set();

    for (const event of events) {
      const bullet = bulletStarts[event.bulletIndex].entity;
      if (event.kind === 'expiry') {
        if (deadBullets.has(bullet) || expiredBullets.has(bullet)) continue;
        expiredBullets.add(bullet);
        resolveAccuracyExpiry(bullet);
        continue;
      }

      const target = event.targetType === 'asteroid'
        ? asteroidStarts[event.targetIndex].entity
        : ufoStarts[event.targetIndex].entity;
      if (deadBullets.has(bullet) || expiredBullets.has(bullet)) continue;
      if (!target.alive) {
        // Projectiles that reach the same target at the same physical instant
        // are all consumed, while genuinely later shots pass through the
        // already-cleared position.
        if (
          target.destroyedAt !== null
          && Math.abs(event.hitTime - target.destroyedAt) <= 1e-9
        ) {
          deadBullets.add(bullet);
          resolveAccuracyHit(bullet);
        }
        continue;
      }

      deadBullets.add(bullet);
      if (event.targetType === 'asteroid') {
        damageAsteroid(target, 1, event.hitTime);
      } else {
        damageUfo(target, 1, event.hitTime);
      }
      // The award above uses the multiplier that was active before this hit;
      // the newly armed multiplier applies to the next scoring event.
      resolveAccuracyHit(bullet);
    }

    state.bullets = state.bullets.filter(b => b.alive && !deadBullets.has(b));
  }

  function handleDataNodePickups(nodeStarts, shipStart, dt) {
    if (state.respawnPending) return;
    const duration = Math.max(0, dt);
    const shipVx = duration > 0
      ? torusDelta(shipStart.x, state.ship.x, worldW) / duration
      : 0;
    const shipVy = duration > 0
      ? torusDelta(shipStart.y, state.ship.y, worldH) / duration
      : 0;

    for (const nodeStart of nodeStarts) {
      if (!nodeStart.alive || nodeStart.life <= 0) continue;
      const node = nodeStart.entity;
      const availableTime = Math.min(duration, nodeStart.life);
      const endpointHit = node.alive && circleCollision(
        state.ship.x, state.ship.y, state.ship.radius,
        node.x, node.y, node.radius, worldW, worldH
      );
      const sweptHit = sweptCircleCollisionTime(
        shipStart.x, shipStart.y, state.ship.radius, shipVx, shipVy,
        nodeStart.x, nodeStart.y, node.radius, nodeStart.vx, nodeStart.vy,
        worldW, worldH, availableTime
      ) !== null;

      if (endpointHit || sweptHit) collectDataNode(node);
    }
    state.dataNodes = state.dataNodes.filter(node => node.alive);
  }

  function handleIceCloudContact(iceCloudStarts, shipStart, dt) {
    if (state.respawnPending || state.status !== STATUS.PLAYING) return;
    const duration = Math.max(0, dt);
    const shipVx = duration > 0
      ? torusDelta(shipStart.x, state.ship.x, worldW) / duration
      : 0;
    const shipVy = duration > 0
      ? torusDelta(shipStart.y, state.ship.y, worldH) / duration
      : 0;
    const fallbackSlow = cfg.asteroid.types?.cryo?.slowDuration ?? 0;

    for (const fieldStart of iceCloudStarts) {
      const startLife = finiteNonNegative(fieldStart.life, 0);
      if (fieldStart.alive !== true || startLife <= 0) continue;
      const availableTime = Math.min(duration, startLife);
      if (availableTime <= 0 && duration > 0) continue;
      const hit = (availableTime === 0 && duration === 0 && circleCollision(
        shipStart.x, shipStart.y, state.ship.radius,
        fieldStart.x, fieldStart.y, fieldStart.radius, worldW, worldH
      )) || sweptCircleCollisionTime(
        shipStart.x, shipStart.y, state.ship.radius, shipVx, shipVy,
        fieldStart.x, fieldStart.y, fieldStart.radius, 0, 0,
        worldW, worldH, availableTime
      ) !== null;
      if (hit) {
        const resolvedSlowDuration = finiteNonNegative(
          fieldStart.slowDuration ?? fallbackSlow, 0,
        );
        state.ship.cryoSlowTime = Math.max(
          state.ship.cryoSlowTime ?? 0,
          resolvedSlowDuration,
        );
      }
    }
  }

  function handleUfoRadiationTicks(dt) {
    if (state.status !== STATUS.PLAYING) return;
    const radioactive = cfg.asteroid.types?.radioactive;
    const rawTickInterval = radioactive?.tickInterval;
    const rawDamage = radioactive?.ufoDamagePerTick;
    const validTickInterval = Number.isFinite(rawTickInterval)
      && rawTickInterval > 0;
    const tickInterval = validTickInterval ? rawTickInterval : 0;
    const validDamage = Number.isFinite(rawDamage) && rawDamage > 0;
    const damagePerTick = validDamage ? rawDamage : 0;

    for (const ufo of [...state.ufos]) {
      if (!ufo.alive) continue;
      const timeAtStart = finiteNonNegative(ufo.radiationTime, 0);
      const duration = finiteNonNegative(dt, 0);

      if (!validTickInterval || !validDamage || timeAtStart <= 0 || duration <= 0) {
        // No ticks possible: age the timer and reset accumulator, no damage.
        ufo.radiationTime = Math.max(0, timeAtStart - duration);
        if (ufo.radiationTime === 0) ufo.radiationTickAccumulator = 0;
        continue;
      }

      const activeTime = Math.min(duration, timeAtStart);
      let remaining = activeTime;
      let elapsed = 0;
      let accumulator = finiteNonNegative(ufo.radiationTickAccumulator, 0);
      const EPSILON = 1e-9;

      while (ufo.alive && accumulator + remaining + EPSILON >= tickInterval) {
        const untilTick = Math.max(0, tickInterval - accumulator);
        elapsed += untilTick;
        remaining = Math.max(0, remaining - untilTick);
        accumulator = 0;
        damageUfo(ufo, damagePerTick, elapsed);
      }

      if (ufo.alive) {
        accumulator += remaining;
        ufo.radiationTime = Math.max(0, timeAtStart - duration);
        ufo.radiationTickAccumulator = ufo.radiationTime > 0
          ? Math.min(accumulator, tickInterval)
          : 0;
      }
    }
  }

  function handleUfoEnvironmentalFieldContacts(
    ufoMotionTraces, iceCloudStarts, radiationFieldStarts, dt,
  ) {
    if (state.status !== STATUS.PLAYING) return;
    const duration = Math.max(0, dt);
    const cryo = cfg.asteroid.types?.cryo;
    const fallbackSlow = finiteNonNegative(cryo?.slowDuration, 0);
    const fallbackExposure = finiteNonNegative(
      cfg.asteroid.types?.radioactive?.exposureDuration, 0,
    );

    for (const [ufo, trace] of ufoMotionTraces) {
      if (!ufo.alive || !state.ufos.includes(ufo)) continue;
      if (!trace || !trace.segments || trace.segments.length === 0) continue;

      // Test each segment against each eligible field snapshot.
      for (const segment of trace.segments) {
        const segDuration = finiteNonNegative(segment.duration, 0);
        if (segDuration <= 0) continue;

        for (const fieldStart of iceCloudStarts) {
          const startLife = finiteNonNegative(fieldStart.life, 0);
          if (fieldStart.alive !== true || startLife <= 0) continue;
          const availableTime = Math.min(duration, startLife);

          // Intersect segment window with available time.
          const windowStart = Math.max(segment.startTime, 0);
          const windowEnd = Math.min(
            segment.startTime + segDuration,
            availableTime,
          );
          if (windowEnd <= windowStart) continue;
          const cropDuration = windowEnd - windowStart;

          const hit = sweptCircleCollisionTime(
            segment.x, segment.y, ufo.radius,
            segment.vx, segment.vy,
            fieldStart.x, fieldStart.y, fieldStart.radius, 0, 0,
            worldW, worldH, cropDuration,
          );
          if (hit !== null) {
            const resolvedSlowDuration = finiteNonNegative(
              fieldStart.slowDuration ?? fallbackSlow, 0,
            );
            ufo.cryoSlowTime = Math.max(
              finiteNonNegative(ufo.cryoSlowTime, 0),
              resolvedSlowDuration,
            );
          }
        }

        for (const fieldStart of radiationFieldStarts) {
          const startLife = finiteNonNegative(fieldStart.life, 0);
          if (fieldStart.alive !== true || startLife <= 0) continue;
          const availableTime = Math.min(duration, startLife);

          const windowStart = Math.max(segment.startTime, 0);
          const windowEnd = Math.min(
            segment.startTime + segDuration,
            availableTime,
          );
          if (windowEnd <= windowStart) continue;
          const cropDuration = windowEnd - windowStart;

          const hit = sweptCircleCollisionTime(
            segment.x, segment.y, ufo.radius,
            segment.vx, segment.vy,
            fieldStart.x, fieldStart.y, fieldStart.radius, 0, 0,
            worldW, worldH, cropDuration,
          );
          if (hit !== null) {
            const resolvedExposure = finiteNonNegative(
              fieldStart.exposureDuration ?? fallbackExposure, 0,
            );
            const currentRadiationTime = finiteNonNegative(ufo.radiationTime, 0);
            const wasExposed = currentRadiationTime > 0;
            ufo.radiationTime = Math.max(currentRadiationTime, resolvedExposure);
            if (!wasExposed && ufo.radiationTime > 0) {
              ufo.radiationTickAccumulator = 0;
            }
          }
        }
      }

      // Also test the endpoint when availableTime >= dt.
      if (trace.endpoint) {
        for (const fieldStart of radiationFieldStarts) {
          const startLife = finiteNonNegative(fieldStart.life, 0);
          if (fieldStart.alive !== true || startLife <= 0) continue;
          const availableTime = Math.min(duration, startLife);
          if (availableTime < duration) continue;
          if (circleCollision(
            trace.endpoint.x, trace.endpoint.y, ufo.radius,
            fieldStart.x, fieldStart.y, fieldStart.radius,
            worldW, worldH,
          )) {
            const resolvedExposure = finiteNonNegative(
              fieldStart.exposureDuration ?? fallbackExposure, 0,
            );
            const currentRadiationTime = finiteNonNegative(ufo.radiationTime, 0);
            const wasExposed = currentRadiationTime > 0;
            ufo.radiationTime = Math.max(currentRadiationTime, resolvedExposure);
            if (!wasExposed && ufo.radiationTime > 0) {
              ufo.radiationTickAccumulator = 0;
            }
          }
        }
        for (const fieldStart of iceCloudStarts) {
          const startLife = finiteNonNegative(fieldStart.life, 0);
          if (fieldStart.alive !== true || startLife <= 0) continue;
          const availableTime = Math.min(duration, startLife);
          if (availableTime < duration) continue;
          if (circleCollision(
            trace.endpoint.x, trace.endpoint.y, ufo.radius,
            fieldStart.x, fieldStart.y, fieldStart.radius,
            worldW, worldH,
          )) {
            const resolvedSlowDuration = finiteNonNegative(
              fieldStart.slowDuration ?? fallbackSlow, 0,
            );
            ufo.cryoSlowTime = Math.max(
              finiteNonNegative(ufo.cryoSlowTime, 0),
              resolvedSlowDuration,
            );
          }
        }
      }
    }
  }

  function handleEnemyBulletCollisions(
    enemyBulletStarts, asteroidStarts, shipStart, dt,
  ) {
    if (state.status !== STATUS.PLAYING) return;
    const duration = Math.max(0, dt);
    const shipVx = duration > 0
      ? torusDelta(shipStart.x, state.ship.x, worldW) / duration
      : 0;
    const shipVy = duration > 0
      ? torusDelta(shipStart.y, state.ship.y, worldH) / duration
      : 0;
    const events = [];

    for (let i = 0; i < enemyBulletStarts.length; i++) {
      const bulletStart = enemyBulletStarts[i];
      if (!bulletStart.alive || bulletStart.life <= 0) continue;
      const availableTime = Math.min(duration, bulletStart.life);

      for (let j = 0; j < asteroidStarts.length; j++) {
        const asteroidStart = asteroidStarts[j];
        const frozenTime = Math.min(asteroidStart.frozenTime, availableTime);
        let hitTime = availableTime === 0 && circleCollision(
          bulletStart.x, bulletStart.y, bulletStart.entity.radius,
          asteroidStart.x, asteroidStart.y, asteroidStart.entity.radius,
          worldW, worldH,
        ) ? 0 : null;

        if (frozenTime > 0) {
          hitTime = sweptCircleCollisionTime(
            bulletStart.x, bulletStart.y, bulletStart.entity.radius,
            bulletStart.vx, bulletStart.vy,
            asteroidStart.x, asteroidStart.y, asteroidStart.entity.radius,
            0, 0,
            worldW, worldH, frozenTime,
          );
        }

        if (hitTime === null && availableTime > frozenTime) {
          const movingHit = sweptCircleCollisionTime(
            bulletStart.x + bulletStart.vx * frozenTime,
            bulletStart.y + bulletStart.vy * frozenTime,
            bulletStart.entity.radius,
            bulletStart.vx, bulletStart.vy,
            asteroidStart.x + asteroidStart.vx * frozenTime,
            asteroidStart.y + asteroidStart.vy * frozenTime,
            asteroidStart.entity.radius,
            asteroidStart.vx, asteroidStart.vy,
            worldW, worldH, availableTime - frozenTime,
          );
          if (movingHit !== null) hitTime = frozenTime + movingHit;
        }

        if (hitTime !== null) {
          events.push({
            targetType: 'asteroid', hitTime, bulletIndex: i, targetIndex: j,
          });
        }
      }

      const shipHitTime = sweptCircleCollisionTime(
        shipStart.x, shipStart.y, state.ship.radius, shipVx, shipVy,
        bulletStart.x, bulletStart.y, bulletStart.entity.radius,
        bulletStart.vx, bulletStart.vy,
        worldW, worldH, availableTime,
      );
      if (shipHitTime !== null) {
        events.push({
          targetType: 'ship', hitTime: shipHitTime, bulletIndex: i, targetIndex: 0,
        });
      }
    }

    // The earliest physical impact wins for each shot. At an exact tie a solid
    // asteroid shields the ship, matching the player's projectile semantics.
    events.sort((a, b) =>
      a.hitTime - b.hitTime
      || (a.targetType === 'asteroid' ? 0 : 1) - (b.targetType === 'asteroid' ? 0 : 1)
      || a.bulletIndex - b.bulletIndex
      || a.targetIndex - b.targetIndex
    );

    const deadBullets = new Set();
    for (const event of events) {
      const bullet = enemyBulletStarts[event.bulletIndex].entity;
      if (deadBullets.has(bullet)) continue;

      if (event.targetType === 'ship') {
        deadBullets.add(bullet);
        bullet.alive = false;
        // Each projectile is an independent impact. This matters when a burst
        // arrives in the same fixed step: every shot drains the shield, while
        // respawn/invulnerability still prevent multiple hull losses.
        damageShip('enemyBullet');
        continue;
      }

      const asteroid = asteroidStarts[event.targetIndex].entity;
      if (!asteroid.alive || !state.asteroids.includes(asteroid)) {
        // A same-instant destruction still consumes this bullet. A prior
        // player/bomb kill lets it continue, and new fragments are deliberately
        // absent from this start-of-step collision snapshot.
        if (
          asteroid.destroyedAt !== null
          && Math.abs(event.hitTime - asteroid.destroyedAt) <= 1e-9
        ) {
          deadBullets.add(bullet);
          bullet.alive = false;
        }
        continue;
      }

      deadBullets.add(bullet);
      bullet.alive = false;
      damageAsteroid(asteroid, 1, event.hitTime, {
        awardPoints: false,
        dropDataNodes: false,
      });
    }

    state.enemyBullets = state.enemyBullets.filter(
      bullet => bullet.alive && !deadBullets.has(bullet),
    );
  }

  function handleMineCollisions() {
    for (const mine of state.mines) {
      if (!mine.alive || mine.armTime > 0) continue;
      if (!circleCollision(
        state.ship.x, state.ship.y, state.ship.radius,
        mine.x, mine.y, mine.triggerRadius ?? mine.radius,
        worldW, worldH
      )) continue;

      mine.alive = false;
      addEffect(
        'mineExplosion', mine.x, mine.y,
        mine.effectDuration ?? cfg.ufo?.mine?.effectDuration ?? 0.36,
        mine.explosionRadius ?? mine.radius * 4
      );
      damageShip('mine');
      break;
    }
    state.mines = state.mines.filter(mine => mine.alive);
  }

  // --- Solid asteroid x asteroid collisions ---

  /**
   * Replay the asteroid movement for this step as an event stream.  The normal
   * update has already moved the entities once, but the snapshot lets us put
   * colliding bodies back at their true impact time and integrate the rebound
   * for the rest of the frame.  This prevents high-speed rocks from tunnelling
   * through one another and keeps the toroidal seams physical.
  */
  function handleAsteroidCollisions(asteroidStarts, dt) {
    if (
      state.status !== STATUS.PLAYING
      || asteroidStarts.length < 2
      || cfg.asteroid?.collision?.enabled === false
    ) return;

    const duration = Math.max(0, dt);
    const collisionCfg = cfg.asteroid?.collision ?? {};
    const epsilon = 1e-9;
    const restitution = Number.isFinite(collisionCfg.restitution)
      ? Math.min(3, Math.max(0, collisionCfg.restitution))
      : 1.12;
    const maxSpeed = Number.isFinite(collisionCfg.maxSpeed)
      ? Math.max(0, collisionCfg.maxSpeed)
      : 560;
    const smallReboundSpeedMultiplier = Number.isFinite(
      collisionCfg.smallReboundSpeedMultiplier,
    )
      ? Math.min(1, Math.max(0, collisionCfg.smallReboundSpeedMultiplier))
      : 1;
    const separationPadding = Number.isFinite(collisionCfg.separationPadding)
      ? Math.max(0, collisionCfg.separationPadding)
      : 0.5;

    const bodies = [];
    for (let index = 0; index < asteroidStarts.length; index++) {
      const start = asteroidStarts[index];
      const asteroid = start.entity;
      if (!asteroid.alive || !state.asteroids.includes(asteroid)) continue;
      bodies.push({
        entity: asteroid,
        index,
        x: start.x,
        y: start.y,
        vx: Number.isFinite(start.vx) ? start.vx : 0,
        vy: Number.isFinite(start.vy) ? start.vy : 0,
        radius: Math.max(0, asteroid.radius ?? 0),
        mass: Math.max(1, (asteroid.radius ?? 0) ** 2),
        frozenUntil: Math.min(
          duration,
          Math.max(0, Number.isFinite(start.frozenTime) ? start.frozenTime : 0),
        ),
      });
    }
    if (bodies.length < 2) return;

    const configuredMaxEvents = Number.isFinite(collisionCfg.maxEventsPerStep)
      ? Math.floor(collisionCfg.maxEventsPerStep)
      : Math.max(16, bodies.length * 4);
    const maxEvents = Math.max(1, configuredMaxEvents);

    const isFrozen = (body, time) => time < body.frozenUntil - epsilon;

    function advanceBody(body, fromTime, toTime) {
      const movingStart = Math.max(fromTime, body.frozenUntil);
      const movingTime = Math.max(0, toTime - movingStart);
      body.x += body.vx * movingTime;
      body.y += body.vy * movingTime;
    }

    function normalFor(first, second, time) {
      let dx = torusDelta(first.x, second.x, worldW);
      let dy = torusDelta(first.y, second.y, worldH);
      let length = Math.hypot(dx, dy);

      if (length <= epsilon) {
        const firstVx = isFrozen(first, time) ? 0 : first.vx;
        const firstVy = isFrozen(first, time) ? 0 : first.vy;
        const secondVx = isFrozen(second, time) ? 0 : second.vx;
        const secondVy = isFrozen(second, time) ? 0 : second.vy;
        // Choose the direction opposite to the relative velocity so an
        // exact-centre head-on impact still produces a separating impulse.
        dx = firstVx - secondVx;
        dy = firstVy - secondVy;
        length = Math.hypot(dx, dy);
      }

      if (length <= epsilon) {
        // Fully coincident stationary bodies are rare (usually a crafted
        // spawn). A deterministic angle avoids NaN and spreads dense fields.
        const angle = (first.index * 0.754877666 + second.index * 2.39996323)
          % (Math.PI * 2);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        length = 1;
      }

      return { x: dx / length, y: dy / length };
    }

    function pairCollisionTime(first, second, fromTime) {
      let cursor = fromTime;
      let firstX = first.x;
      let firstY = first.y;
      let secondX = second.x;
      let secondY = second.y;

      while (cursor <= duration + epsilon) {
        const firstFrozen = isFrozen(first, cursor);
        const secondFrozen = isFrozen(second, cursor);
        const firstVx = firstFrozen ? 0 : first.vx;
        const firstVy = firstFrozen ? 0 : first.vy;
        const secondVx = secondFrozen ? 0 : second.vx;
        const secondVy = secondFrozen ? 0 : second.vy;
        let segmentEnd = duration;
        if (firstFrozen) segmentEnd = Math.min(segmentEnd, first.frozenUntil);
        if (secondFrozen) segmentEnd = Math.min(segmentEnd, second.frozenUntil);
        const segmentDuration = Math.max(0, segmentEnd - cursor);
        const hit = sweptCircleCollisionTime(
          firstX, firstY, first.radius, firstVx, firstVy,
          secondX, secondY, second.radius, secondVx, secondVy,
          worldW, worldH, segmentDuration,
        );
        if (hit !== null) return cursor + hit;
        if (segmentEnd >= duration - epsilon) return null;

        firstX += firstVx * segmentDuration;
        firstY += firstVy * segmentDuration;
        secondX += secondVx * segmentDuration;
        secondY += secondVy * segmentDuration;
        cursor = segmentEnd;
      }
      return null;
    }

    function capBodySpeed(body) {
      if (!(maxSpeed > 0)) return;
      const speed = Math.hypot(body.vx, body.vy);
      if (speed <= maxSpeed || speed === 0) return;
      const scale = maxSpeed / speed;
      body.vx *= scale;
      body.vy *= scale;
    }

    function applyReboundSpeedLimit(body) {
      capBodySpeed(body);
      if (body.entity.size !== 'small' || smallReboundSpeedMultiplier === 1) return;
      body.vx *= smallReboundSpeedMultiplier;
      body.vy *= smallReboundSpeedMultiplier;
    }

    function resolveImpact(first, second, time) {
      const firstFrozen = isFrozen(first, time);
      const secondFrozen = isFrozen(second, time);
      const normal = normalFor(first, second, time);
      const firstVx = firstFrozen ? 0 : first.vx;
      const firstVy = firstFrozen ? 0 : first.vy;
      const secondVx = secondFrozen ? 0 : second.vx;
      const secondVy = secondFrozen ? 0 : second.vy;
      const inverseFirstMass = firstFrozen ? 0 : 1 / first.mass;
      const inverseSecondMass = secondFrozen ? 0 : 1 / second.mass;
      const inverseMassSum = inverseFirstMass + inverseSecondMass;
      const relativeNormalSpeed =
        (secondVx - firstVx) * normal.x + (secondVy - firstVy) * normal.y;

      // Only approaching bodies get an impulse. This avoids repeatedly
      // multiplying speed for rocks that began a step already overlapping but
      // are naturally moving apart.
      if (relativeNormalSpeed < -epsilon && inverseMassSum > epsilon) {
        const impulse = -((1 + restitution) * relativeNormalSpeed) / inverseMassSum;
        first.vx -= normal.x * impulse * inverseFirstMass;
        first.vy -= normal.y * impulse * inverseFirstMass;
        second.vx += normal.x * impulse * inverseSecondMass;
        second.vy += normal.y * impulse * inverseSecondMass;
        applyReboundSpeedLimit(first);
        applyReboundSpeedLimit(second);
      }

      // A small separation means the next event search cannot rediscover the
      // same touching pair at t=0, while mass weighting makes large rocks move
      // less than small rocks.
      const dx = torusDelta(first.x, second.x, worldW);
      const dy = torusDelta(first.y, second.y, worldH);
      const distance = Math.hypot(dx, dy);
      const targetDistance = first.radius + second.radius + separationPadding;
      const correction = Math.max(0, targetDistance - distance);
      if (correction <= 0) return;

      const firstShare = inverseMassSum > epsilon
        ? inverseFirstMass / inverseMassSum
        : 0.5;
      const secondShare = inverseMassSum > epsilon
        ? inverseSecondMass / inverseMassSum
        : 0.5;
      first.x -= normal.x * correction * firstShare;
      first.y -= normal.y * correction * firstShare;
      second.x += normal.x * correction * secondShare;
      second.y += normal.y * correction * secondShare;
    }

    let simulationTime = 0;
    let eventsResolved = 0;
    while (eventsResolved < maxEvents) {
      let event = null;
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const hitTime = pairCollisionTime(bodies[i], bodies[j], simulationTime);
          if (hitTime === null) continue;
          const clampedHitTime = Math.max(simulationTime, Math.min(duration, hitTime));
          if (
            event === null
            || clampedHitTime < event.time - epsilon
            || (
              Math.abs(clampedHitTime - event.time) <= epsilon
              && (bodies[i].index < event.first.index
                || (bodies[i].index === event.first.index
                  && bodies[j].index < event.second.index))
            )
          ) {
            event = { time: clampedHitTime, first: bodies[i], second: bodies[j] };
          }
        }
      }
      if (event === null) break;

      for (const body of bodies) advanceBody(body, simulationTime, event.time);
      simulationTime = event.time;
      resolveImpact(event.first, event.second, simulationTime);
      eventsResolved++;
    }

    for (const body of bodies) {
      advanceBody(body, simulationTime, duration);
      body.entity.x = wrap(body.x, worldW);
      body.entity.y = wrap(body.y, worldH);
      body.entity.vx = body.vx;
      body.entity.vy = body.vy;
    }
  }

  // --- UFO x asteroid environmental collisions ---

  function collisionTimeForUfoAndAsteroid(ufoStart, asteroidStart, dt) {
    const duration = Math.max(0, dt);
    const frozenTime = Math.min(asteroidStart.frozenTime, duration);
    let hitTime = duration === 0 && circleCollision(
      ufoStart.x, ufoStart.y, ufoStart.entity.radius,
      asteroidStart.x, asteroidStart.y, asteroidStart.entity.radius,
      worldW, worldH
    ) ? 0 : null;

    if (frozenTime > 0) {
      hitTime = sweptCircleCollisionTime(
        ufoStart.x, ufoStart.y, ufoStart.entity.radius,
        ufoStart.vx, ufoStart.vy,
        asteroidStart.x, asteroidStart.y, asteroidStart.entity.radius,
        0, 0,
        worldW, worldH, frozenTime
      );
    }

    if (hitTime === null && duration > frozenTime) {
      const movingHit = sweptCircleCollisionTime(
        ufoStart.x + ufoStart.vx * frozenTime,
        ufoStart.y + ufoStart.vy * frozenTime,
        ufoStart.entity.radius,
        ufoStart.vx, ufoStart.vy,
        asteroidStart.x, asteroidStart.y, asteroidStart.entity.radius,
        asteroidStart.vx, asteroidStart.vy,
        worldW, worldH, duration - frozenTime
      );
      if (movingHit !== null) hitTime = frozenTime + movingHit;
    }

    return hitTime;
  }

  function collisionNormalAtImpact(ufoStart, asteroidStart, hitTime, dt) {
    const epsilon = 1e-9;
    const frozenTime = Math.min(asteroidStart.frozenTime, Math.max(0, dt));
    const ufoImpactX = ufoStart.x + ufoStart.vx * hitTime;
    const ufoImpactY = ufoStart.y + ufoStart.vy * hitTime;
    const asteroidFrozen = hitTime < frozenTime - epsilon;
    const asteroidImpactX = asteroidStart.x
      + (asteroidFrozen ? 0 : asteroidStart.vx * (hitTime - frozenTime));
    const asteroidImpactY = asteroidStart.y
      + (asteroidFrozen ? 0 : asteroidStart.vy * (hitTime - frozenTime));

    let dx = torusDelta(asteroidImpactX, ufoImpactX, worldW);
    let dy = torusDelta(asteroidImpactY, ufoImpactY, worldH);
    let len = Math.hypot(dx, dy);

    if (len < epsilon) {
      // Centres coincident — use opposite relative velocity.
      const asteroidVx = asteroidFrozen ? 0 : asteroidStart.vx;
      const asteroidVy = asteroidFrozen ? 0 : asteroidStart.vy;
      const relVx = ufoStart.vx - asteroidVx;
      const relVy = ufoStart.vy - asteroidVy;
      len = Math.hypot(relVx, relVy);
      if (len < epsilon) {
        // Velocity also zero — use opposite heading.
        dx = -Math.cos(ufoStart.entity.angle);
        dy = -Math.sin(ufoStart.entity.angle);
        len = Math.hypot(dx, dy);
      } else {
        dx = -relVx;
        dy = -relVy;
      }
      if (len < epsilon) {
        // Ultimate fallback — stable axis from entity identities.
        dx = 1;
        dy = 0;
        len = 1;
      }
    }

    return {
      x: dx / len,
      y: dy / len,
      ufoImpactX,
      ufoImpactY,
      asteroidImpactX,
      asteroidImpactY,
    };
  }

  function resolveUfoAsteroidImpact(ufo, ufoStart, asteroid, asteroidStart, normal, hitTime, dt) {
    const collisionCfg = cfg.ufo?.asteroidCollision;
    if (!collisionCfg) return false;
    const epsilon = 1e-9;
    const desiredOutward = collisionCfg.knockbackSpeedBySize[asteroid.size];
    const hitDuringFrozenPhase = asteroidStart.frozenTime > 0
      && hitTime < asteroidStart.frozenTime - epsilon;

    const driveVx = ufoStart.driveVx;
    const driveVy = ufoStart.driveVy;
    const tangentX = -normal.y;
    const tangentY = normal.x;

    const driveNormal = driveVx * normal.x + driveVy * normal.y;
    const asteroidMovingNormal =
      asteroidStart.vx * normal.x + asteroidStart.vy * normal.y;
    const thawsBeforeStepEnd = hitDuringFrozenPhase
      && asteroidStart.frozenTime < dt - epsilon;
    const asteroidResponseNormal = hitDuringFrozenPhase
      ? (thawsBeforeStepEnd ? Math.max(0, asteroidMovingNormal) : 0)
      : asteroidMovingNormal;
    const currentKnockbackNormal =
      (ufo.knockbackVx ?? 0) * normal.x + (ufo.knockbackVy ?? 0) * normal.y;

    const requiredKnockbackNormal =
      desiredOutward + asteroidResponseNormal - driveNormal;
    const resolvedKnockbackNormal = Math.max(
      currentKnockbackNormal,
      requiredKnockbackNormal,
    );

    const currentKnockbackTangent =
      (ufo.knockbackVx ?? 0) * tangentX + (ufo.knockbackVy ?? 0) * tangentY;
    const tangentBudget = Math.sqrt(Math.max(
      0,
      collisionCfg.maxKnockbackSpeed ** 2 - resolvedKnockbackNormal ** 2,
    ));
    const resolvedKnockbackTangent = Math.max(
      -tangentBudget,
      Math.min(tangentBudget, currentKnockbackTangent),
    );

    ufo.knockbackVx =
      normal.x * resolvedKnockbackNormal
      + tangentX * resolvedKnockbackTangent;
    ufo.knockbackVy =
      normal.y * resolvedKnockbackNormal
      + tangentY * resolvedKnockbackTangent;
    ufo.vx = driveVx + ufo.knockbackVx;
    ufo.vy = driveVy + ufo.knockbackVy;

    // Place UFO at contact point.
    const clearance = ufo.radius + asteroid.radius + collisionCfg.separationPadding;
    const contactX = wrap(
      normal.asteroidImpactX + normal.x * clearance,
      worldW,
    );
    const contactY = wrap(
      normal.asteroidImpactY + normal.y * clearance,
      worldH,
    );
    ufo.x = contactX;
    ufo.y = contactY;

    // --- Damage and latch ---
    const contacts = activeUfoAsteroidContacts.get(ufo) ?? new Set();
    const continuingContact = contacts.has(asteroid);
    const cooldownReadyAtHit =
      (ufoStart.asteroidHitCooldown ?? 0) <= hitTime + epsilon;

    contacts.add(asteroid);
    activeUfoAsteroidContacts.set(ufo, contacts);

    let killed = false;
    if (
      !ufo.spawnCollisionProtected
      && !continuingContact
      && cooldownReadyAtHit
    ) {
      ufo.asteroidHitCooldown = Math.max(
        0,
        collisionCfg.hitCooldown - (dt - hitTime),
      );
      killed = damageUfo(
        ufo,
        collisionCfg.damageBySize[asteroid.size],
        hitTime,
      );
    }

    // --- Reintegrate remainder of step for survivors ---
    if (!killed && ufo.alive) {
      const remaining = Math.max(0, dt - hitTime);
      ufo.x = wrap(contactX + ufo.vx * remaining, worldW);
      ufo.y = wrap(contactY + ufo.vy * remaining, worldH);
    }

    return {
      killed,
      contactX,
      contactY,
      postVx: ufo.vx,
      postVy: ufo.vy,
    };
  }

  function geometricEndpointCleanup(ufo, asteroidStarts, primaryNormal, ufoIndex, primaryAsteroid) {
    const collisionCfg = cfg.ufo?.asteroidCollision;
    if (!collisionCfg) return;
    const epsilon = 1e-9;

    // Build the collection of solid asteroids from the snapshot that are still
    // alive and in state. This excludes fragments created during this step.
    const solidAsteroids = [];
    for (const start of asteroidStarts) {
      const asteroid = start.entity;
      if (!asteroid.alive || !state.asteroids.includes(asteroid)) continue;
      solidAsteroids.push({ start, asteroid, asteroidIndex: asteroidStarts.indexOf(start) });
    }
    if (solidAsteroids.length === 0) return;

    const maxProjections = Math.max(4, 4 * solidAsteroids.length);

    let bestX = ufo.x;
    let bestY = ufo.y;
    let bestScore = Infinity;

    function computeScore(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
      let score = 0;
      for (const { asteroid } of solidAsteroids) {
        const d = torusDistance(x, y, asteroid.x, asteroid.y, worldW, worldH);
        const pen = ufo.radius + asteroid.radius + collisionCfg.separationPadding - d;
        if (pen > 0) score += pen * pen;
      }
      return Number.isFinite(score) ? score : Infinity;
    }

    function currentScore() {
      return computeScore(ufo.x, ufo.y);
    }

    let score = currentScore();
    if (score < bestScore || (Math.abs(score - bestScore) <= epsilon && bestScore === Infinity)) {
      bestScore = score;
      bestX = ufo.x;
      bestY = ufo.y;
    }

    for (let iter = 0; iter < maxProjections; iter++) {
      // Find the deepest penetration.
      let deepest = null;
      let deepestPen = epsilon;
      let deepestIndex = Infinity;
      for (const { asteroid, asteroidIndex } of solidAsteroids) {
        const d = torusDistance(ufo.x, ufo.y, asteroid.x, asteroid.y, worldW, worldH);
        const pen = ufo.radius + asteroid.radius + collisionCfg.separationPadding - d;
        if (pen <= epsilon) continue;
        if (pen > deepestPen || (Math.abs(pen - deepestPen) <= epsilon && asteroidIndex < deepestIndex)) {
          deepestPen = pen;
          deepest = asteroid;
          deepestIndex = asteroidIndex;
        }
      }

      if (deepest === null) break;

      // Project UFO out of deepest asteroid.
      let dx = torusDelta(deepest.x, ufo.x, worldW);
      let dy = torusDelta(deepest.y, ufo.y, worldH);
      let len = Math.hypot(dx, dy);

      if (len < epsilon) {
        // Centres coincident — use fallback normal.
        const isPrimary = deepest === primaryAsteroid;
        if (isPrimary && primaryNormal) {
          dx = primaryNormal.x;
          dy = primaryNormal.y;
          len = Math.hypot(dx, dy);
        } else {
          const asteroidVx = (deepest.stun ?? 0) > 0 ? 0 : deepest.vx;
          const asteroidVy = (deepest.stun ?? 0) > 0 ? 0 : deepest.vy;
          const relVx = ufo.vx - asteroidVx;
          const relVy = ufo.vy - asteroidVy;
          len = Math.hypot(relVx, relVy);
          if (len < epsilon) {
            dx = -Math.cos(ufo.angle);
            dy = -Math.sin(ufo.angle);
            len = Math.hypot(dx, dy);
            if (len < epsilon) {
              // Stable axis from indices.
              const idx = solidAsteroids.findIndex(s => s.asteroid === deepest) ?? 0;
              dx = Math.cos(idx * 2.39);
              dy = Math.sin(idx * 2.39);
              len = Math.hypot(dx, dy);
            }
          } else {
            dx = -relVx;
            dy = -relVy;
          }
        }

        if (len < epsilon) {
          dx = 1;
          dy = 0;
          len = 1;
        }
      }

      const targetDist = ufo.radius + deepest.radius + collisionCfg.separationPadding;
      ufo.x = wrap(deepest.x + (dx / len) * targetDist, worldW);
      ufo.y = wrap(deepest.y + (dy / len) * targetDist, worldH);

      score = currentScore();
      if (score < bestScore - epsilon) {
        bestScore = score;
        bestX = ufo.x;
        bestY = ufo.y;
      }
    }

    // Restore the best endpoint found.
    ufo.x = bestX;
    ufo.y = bestY;
  }

  function handleUfoAsteroidCollisions(ufoStarts, asteroidStarts, dt) {
    // Returns a map: UFO entity → motion trace (segments + endpoint), for the
    // environmental field contact handler to sweep only over resolved physics.
    const motionTraces = new Map();

    // Initialize a simple single-segment trace for every live UFO. Collision
    // resolution may replace it with a two-segment trace.
    for (const start of ufoStarts) {
      const ufo = start.entity;
      if (!start.alive || !ufo.alive || !state.ufos.includes(ufo)) continue;
      motionTraces.set(ufo, {
        segments: [{
          startTime: 0,
          duration: Math.max(0, dt),
          x: start.x,
          y: start.y,
          vx: start.vx,
          vy: start.vy,
        }],
        endpoint: { x: ufo.x, y: ufo.y, time: Math.max(0, dt) },
      });
    }

    if (state.status !== STATUS.PLAYING) return motionTraces;
    const collisionCfg = cfg.ufo?.asteroidCollision;
    if (!collisionCfg) return motionTraces;
    const epsilon = 1e-9;

    // --- Latch cleanup: remove dead/released asteroids from contacts ---
    for (const ufo of state.ufos) {
      const contacts = activeUfoAsteroidContacts.get(ufo);
      if (!contacts) continue;
      for (const asteroid of [...contacts]) {
        if (!asteroid.alive || !state.asteroids.includes(asteroid)) {
          contacts.delete(asteroid);
          continue;
        }
        // Use snapshot positions to check surface distance.
        const start = asteroidStarts.find(s => s.entity === asteroid);
        const ax = start ? start.x : asteroid.x;
        const ay = start ? start.y : asteroid.y;
        const ux = ufoStarts.find(s => s.entity === ufo)?.x ?? ufo.x;
        const uy = ufoStarts.find(s => s.entity === ufo)?.y ?? ufo.y;
        const surfaceDist = torusDistance(ux, uy, ax, ay, worldW, worldH)
          - ufo.radius - asteroid.radius;
        if (surfaceDist > collisionCfg.contactReleasePadding) {
          contacts.delete(asteroid);
        }
      }
      if (contacts.size === 0) activeUfoAsteroidContacts.delete(ufo);
    }

    // --- Spawn protection pre-evaluation ---
    for (const start of ufoStarts) {
      const ufo = start.entity;
      if (!ufo.spawnCollisionProtected) continue;
      // If a protected UFO started the step outside all asteroids, clear the
      // flag so a new entry during this step is a normal collision.
      const stillOverlaps = asteroidStarts.some(as =>
        as.entity.alive && circleCollision(
          start.x, start.y, ufo.radius,
          as.x, as.y, as.entity.radius,
          worldW, worldH,
        )
      );
      if (!stillOverlaps) ufo.spawnCollisionProtected = false;
    }

    // --- Detect events ---
    const events = [];
    for (let i = 0; i < ufoStarts.length; i++) {
      const ufoStart = ufoStarts[i];
      if (!ufoStart.alive) continue;
      const ufo = ufoStart.entity;
      if (!ufo.alive || !state.ufos.includes(ufo)) continue;

      for (let j = 0; j < asteroidStarts.length; j++) {
        const asteroidStart = asteroidStarts[j];
        if (!asteroidStart.entity.alive) continue;
        const hitTime = collisionTimeForUfoAndAsteroid(ufoStart, asteroidStart, dt);
        if (hitTime !== null) {
          events.push({ hitTime, ufoIndex: i, asteroidIndex: j });
        }
      }
    }

    // --- Sort by time, then ufoIndex, then asteroidIndex ---
    events.sort((a, b) =>
      a.hitTime - b.hitTime
      || a.ufoIndex - b.ufoIndex
      || a.asteroidIndex - b.asteroidIndex
    );

    // --- Resolve first valid event per UFO ---
    const resolvedUfos = new Set();
    for (const event of events) {
      if (state.status !== STATUS.PLAYING) break;
      const ufoStart = ufoStarts[event.ufoIndex];
      const asteroidStart = asteroidStarts[event.asteroidIndex];
      const ufo = ufoStart.entity;
      const asteroid = asteroidStart.entity;

      if (resolvedUfos.has(ufo)) continue;
      if (!ufo.alive || !state.ufos.includes(ufo)) continue;
      if (!asteroid.alive || !state.asteroids.includes(asteroid)) continue;

      resolvedUfos.add(ufo);

      const normal = collisionNormalAtImpact(ufoStart, asteroidStart, event.hitTime, dt);
      const impactResult = resolveUfoAsteroidImpact(
        ufo, ufoStart, asteroid, asteroidStart, normal, event.hitTime, dt,
      );

      // Geometric cleanup of the endpoint for survivors.
      if (ufo.alive) {
        geometricEndpointCleanup(ufo, asteroidStarts, normal, event.ufoIndex, asteroid);
      }

      // Build the motion trace for this UFO: pre-impact segment + post-impact
      // segment (if the UFO survived), or a single segment ending at hitTime.
      if (!ufo.alive) {
        // Dead UFO: trace covers only the pre-impact segment.
        motionTraces.set(ufo, {
          segments: [{
            startTime: 0,
            duration: event.hitTime,
            x: ufoStart.x,
            y: ufoStart.y,
            vx: ufoStart.vx,
            vy: ufoStart.vy,
          }],
          endpoint: { x: ufo.x, y: ufo.y, time: event.hitTime },
        });
      } else {
        const remaining = Math.max(0, dt - event.hitTime);
        motionTraces.set(ufo, {
          segments: [
            {
              startTime: 0,
              duration: event.hitTime,
              x: ufoStart.x,
              y: ufoStart.y,
              vx: ufoStart.vx,
              vy: ufoStart.vy,
            },
            {
              startTime: event.hitTime,
              duration: remaining,
              x: impactResult.contactX,
              y: impactResult.contactY,
              vx: impactResult.postVx,
              vy: impactResult.postVy,
            },
          ],
          endpoint: { x: ufo.x, y: ufo.y, time: Math.max(0, dt) },
        });
      }
    }

    // --- Spawn protection post-evaluation ---
    for (const start of ufoStarts) {
      const ufo = start.entity;
      if (!ufo.spawnCollisionProtected) continue;
      const stillOverlaps = state.asteroids.some(asteroid =>
        asteroid.alive && circleCollision(
          ufo.x, ufo.y, ufo.radius,
          asteroid.x, asteroid.y, asteroid.radius,
          worldW, worldH,
        )
      );
      if (!stillOverlaps) ufo.spawnCollisionProtected = false;
    }

    return motionTraces;
  }

  function handleShipSolidCollisions() {
    if (state.respawnPending || state.ship.invuln > 0) {
      activeShipUfoContacts.clear();
      return;
    }

    // Asteroids always bypass the shield and retain priority over hostile
    // craft when the ship overlaps both at once.
    for (const asteroid of state.asteroids) {
      if (!asteroid.alive) continue;
      if (circleCollision(
        state.ship.x, state.ship.y, state.ship.radius,
        asteroid.x, asteroid.y, asteroid.radius, worldW, worldH
      )) {
        activeShipUfoContacts.clear();
        damageShip('asteroid');
        return;
      }
    }

    const currentUfoContacts = new Set();
    for (const ufo of state.ufos) {
      if (!ufo.alive) continue;
      if (!circleCollision(
        state.ship.x, state.ship.y, state.ship.radius,
        ufo.x, ufo.y, ufo.radius, worldW, worldH
      )) continue;

      currentUfoContacts.add(ufo);
      if (activeShipUfoContacts.has(ufo)) continue;

      damageShip('ufo');
      if (state.status !== STATUS.PLAYING || state.respawnPending) {
        activeShipUfoContacts.clear();
        return;
      }
    }
    activeShipUfoContacts = currentUfoContacts;
  }

  function checkWaveClear() {
    if (state.status !== STATUS.PLAYING) return;
    // A wave owns both its asteroid field and its active squad.  It advances
    // only after every asteroid is gone and each UFO has either been
    // destroyed or completed its last-survivor escape.
    const hasLiveAsteroids = state.asteroids.some(asteroid => asteroid.alive);
    const hasLiveUfos = state.ufos.some(ufo => ufo.alive);
    if (!hasLiveAsteroids && !hasLiveUfos) {
      state.wave++;
      spawnWave(state.wave);
    }
  }

  // --- Public API ---

  return {
    state,

    /** Update world dimensions after a viewport resize. */
    resize(w, h) {
      worldW = w;
      worldH = h;
      cfg.world.width = w;
      cfg.world.height = h;

      // Normalize immediately into the canonical world so toroidal collision
      // math stays consistent after a strong shrink.
      state.ship.x = wrap(state.ship.x, worldW);
      state.ship.y = wrap(state.ship.y, worldH);
      for (const b of state.bullets) {
        b.x = wrap(b.x, worldW);
        b.y = wrap(b.y, worldH);
      }
      for (const a of state.asteroids) {
        a.x = wrap(a.x, worldW);
        a.y = wrap(a.y, worldH);
      }
      for (const bomb of state.bombs) {
        bomb.x = wrap(bomb.x, worldW);
        bomb.y = wrap(bomb.y, worldH);
      }
      for (const effect of state.effects) {
        effect.x = wrap(effect.x, worldW);
        effect.y = wrap(effect.y, worldH);
      }
      for (const node of state.dataNodes) {
        node.x = wrap(node.x, worldW);
        node.y = wrap(node.y, worldH);
      }
      for (const drone of state.drones) {
        drone.x = wrap(drone.x, worldW);
        drone.y = wrap(drone.y, worldH);
      }
      for (const cloud of state.iceClouds) {
        cloud.x = wrap(cloud.x, worldW);
        cloud.y = wrap(cloud.y, worldH);
      }
      for (const field of state.radiationFields) {
        field.x = wrap(field.x, worldW);
        field.y = wrap(field.y, worldH);
      }
      for (const anomaly of state.anomalies) {
        anomaly.x = wrap(anomaly.x, worldW);
        anomaly.y = wrap(anomaly.y, worldH);
      }
      for (const ufo of state.ufos) {
        ufo.x = wrap(ufo.x, worldW);
        ufo.y = wrap(ufo.y, worldH);
      }
      for (const bullet of state.enemyBullets) {
        bullet.x = wrap(bullet.x, worldW);
        bullet.y = wrap(bullet.y, worldH);
      }
      for (const mine of state.mines) {
        mine.x = wrap(mine.x, worldW);
        mine.y = wrap(mine.y, worldH);
      }
      state.beam.x = wrap(state.beam.x, worldW);
      state.beam.y = wrap(state.beam.y, worldH);
    },

    /** Merge a persisted/remote record without ever lowering this session. */
    setHighScore(value) {
      const incoming = normalizeScore(value);
      if (incoming > state.highScore) {
        state.highScore = incoming;
        if (state.score <= incoming) state.scoring.newHighScore = false;
      }
      return state.highScore;
    },

    start() {
      if (state.status === STATUS.READY || state.status === STATUS.GAME_OVER) {
        state.status = STATUS.PLAYING;
        state.score = 0;
        state.lives = cfg.game.lives;
        state.wave = 1;
        state.bullets = [];
        state.asteroids = [];
        state.bulletCooldown = 0;
        state.waveSpeedMult = 1;
        state.respawnPending = false;
        state.nextExtraLifeScore = positiveInteger(cfg.game.extraLifeEvery, 10000);
        state.extraLivesAwarded = 0;
        resetPilotSystems();
        resetWeaponSystems();
        resetThreatSystems();
        resetScoringRun();
        resetShip();
        spawnWave(1);
      }
    },

    pause() {
      if (state.status === STATUS.PLAYING) state.status = STATUS.PAUSED;
    },

    resume() {
      if (state.status === STATUS.PAUSED) state.status = STATUS.PLAYING;
    },

    togglePause() {
      if (state.status === STATUS.PLAYING) state.status = STATUS.PAUSED;
      else if (state.status === STATUS.PAUSED) state.status = STATUS.PLAYING;
    },

    restart() {
      const savedHigh = state.highScore;
      state.status = STATUS.PLAYING;
      state.score = 0;
      state.lives = cfg.game.lives;
      state.wave = 1;
      state.bullets = [];
      state.asteroids = [];
      state.bulletCooldown = 0;
      state.waveSpeedMult = 1;
      state.highScore = savedHigh;
      state.respawnPending = false;
      state.nextExtraLifeScore = positiveInteger(cfg.game.extraLifeEvery, 10000);
      state.extraLivesAwarded = 0;
      resetPilotSystems();
      resetWeaponSystems();
      resetThreatSystems();
      resetScoringRun();
      resetShip();
      spawnWave(1);
    },

    /**
     * Advance the simulation by dt seconds.
     * `input` = { thrust, brake, rotLeft, rotRight, fire,
     *             dash, shieldBurst, hyperspace, emp, nuke }
     */
    update(dt, input = {}) {
      if (state.status !== STATUS.PLAYING) return;
      shieldDamagedThisStep = false;

      // Debug: nuke everything on a single key press.
      if (input.nuke) nukeEverything();
      if (state.bulletCooldown > 0) {
        state.bulletCooldown = Math.max(0, state.bulletCooldown - dt);
      }
      updatePilotSystems(dt);
      beginWeaponStep(dt);

      // Only nodes already present at the beginning of this step are eligible
      // for pickup. Drops created by a kill become collectible next step.
      const nodeStarts = state.dataNodes.map(entity => ({
        entity,
        x: entity.x,
        y: entity.y,
        vx: entity.vx,
        vy: entity.vy,
        life: entity.life,
        alive: entity.alive,
      }));

      // Snapshot environmental fields before any ability/movement can mutate
      // them or create new ones. Only these snapshots age and apply contact.
      const iceCloudStarts = state.iceClouds.map(entity => ({
        entity,
        x: entity.x,
        y: entity.y,
        radius: entity.radius,
        life: entity.life,
        alive: entity.alive,
        slowDuration: entity.slowDuration,
      }));
      const radiationFieldStarts = state.radiationFields.map(entity => ({
        entity,
        x: entity.x,
        y: entity.y,
        radius: entity.radius,
        life: entity.life,
        alive: entity.alive,
        exposureDuration: entity.exposureDuration,
      }));

      // Edge-triggered abilities. Hyperspace runs first so simultaneous input
      // applies the repulsor and dash at the arrival point.
      if (input.hyperspace) activateHyperspace();
      if (input.shieldBurst) activateShieldBurst();
      if (input.dash) activateDash();
      if (input.emp) activateEMP();

      const beamFiring = state.powerUps.weapon === 'beam' && input.fire;
      if (state.powerUps.weapon !== 'beam' && input.fire && !state.respawnPending) {
        fireBullet();
      }

      updateDrones(Math.min(dt, state.powerUps.dronesTime));
      for (const bullet of state.bullets) {
        steerHomingBullet(
          bullet, dt, [...state.asteroids, ...state.ufos], worldW, worldH
        );
      }
      applyGravity(dt);

      const shipStart = { x: state.ship.x, y: state.ship.y };

      // Update ship
      if (!state.respawnPending) {
        updateShip(state.ship, dt, input, cfg, worldW, worldH);
      } else {
        state.ship.thrusting = false;
      }
      if (state.powerUps.dronesTime > 0) positionDrones();

      // Snapshot positions before projectile/asteroid integration. Collision
      // sweeps use these unwrapped starts plus velocity, never wrapped ends.
      const bulletStarts = state.bullets.map(entity => ({
        entity,
        x: entity.x,
        y: entity.y,
        life: entity.life,
        alive: entity.alive,
        vx: entity.vx,
        vy: entity.vy,
      }));
      const asteroidStarts = state.asteroids.map(entity => ({
        entity,
        x: entity.x,
        y: entity.y,
        vx: entity.vx,
        vy: entity.vy,
        frozenTime: Math.min(Math.max(0, entity.stun ?? 0), Math.max(0, dt)),
      }));
      const ufoStarts = state.ufos.map(entity => ({
        entity,
        x: entity.x,
        y: entity.y,
        vx: entity.vx,
        vy: entity.vy,
        alive: entity.alive,
        asteroidHitCooldown: entity.asteroidHitCooldown,
        speed: entity.speed ?? (cfg.ufo[entity.kind] ?? cfg.ufo.hunter).speed,
      }));
      const enemyBulletStarts = state.enemyBullets.map(entity => ({
        entity,
        x: entity.x,
        y: entity.y,
        life: entity.life,
        alive: entity.alive,
        vx: entity.vx,
        vy: entity.vy,
      }));

      // Update bullets
      for (const b of state.bullets) updateBullet(b, dt, worldW, worldH);

      // Update collectible nodes
      for (const nodeStart of nodeStarts) {
        updateDataNode(nodeStart.entity, dt, worldW, worldH);
      }

      // Update asteroids
      for (const a of state.asteroids) updateAsteroid(a, dt, worldW, worldH);

      updateEnvironmentalHazards(dt, iceCloudStarts, radiationFieldStarts);
      updateUfoThreats(dt);
      for (const start of ufoStarts) {
        start.vx = start.entity.vx;
        start.vy = start.entity.vy;
        start.driveVx = start.entity.vx - (start.entity.knockbackVx ?? 0);
        start.driveVy = start.entity.vy - (start.entity.knockbackVy ?? 0);
      }

      // Collisions
      handlePlayerProjectileCollisions(bulletStarts, asteroidStarts, ufoStarts, dt);
      updateBombs(dt);
      if (beamFiring) updateBeam(true);

      // Radiation DoT ticks use only exposure that existed at step start.
      handleUfoRadiationTicks(dt);

      // Solid UFO–asteroid collisions produce motion traces for the contact
      // handler to sweep only over resolved physics segments.
      const ufoMotionTraces = handleUfoAsteroidCollisions(ufoStarts, asteroidStarts, dt);

      // New environmental contacts only arm status for future steps.
      handleUfoEnvironmentalFieldContacts(
        ufoMotionTraces, iceCloudStarts, radiationFieldStarts, dt,
      );

      // Age only powers that existed at step start. A node collected below
      // receives its full configured duration for the next simulation step.
      ageTemporaryPowerUps(dt);
      handleDataNodePickups(nodeStarts, shipStart, dt);
      handleIceCloudContact(iceCloudStarts, shipStart, dt);
      handleEnemyBulletCollisions(enemyBulletStarts, asteroidStarts, shipStart, dt);
      handleMineCollisions();
      if (state.respawnPending) resetShip();
      handleShipSolidCollisions();
      updateShieldRegen(dt);

      // Resolve rock-on-rock rebound after the step's offensive and ship
      // contacts. That keeps their established collision priorities intact;
      // the replay below still puts each survivor on its bounced endpoint.
      handleAsteroidCollisions(asteroidStarts, dt);

      updateEffects(dt);

      // Wave clear check
      checkWaveClear();
    },
  };
}
