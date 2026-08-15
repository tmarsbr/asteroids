import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame, STATUS } from '../src/game.js';
import {
  createAsteroid,
  createUfo,
  createBullet,
  updateAsteroid,
  updateUfo,
} from '../src/entities.js';
import {
  wrap,
  torusDelta,
  torusDistance,
  circleCollision,
  sweptCircleCollisionTime,
} from '../src/math.js';

const W = CONFIG.world.width;
const H = CONFIG.world.height;
const DT = CONFIG.game.fixedStep;
const EPS = 1e-9;

function cloneConfig() {
  return structuredClone(CONFIG);
}

function makeRng(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeCountedRng(seed = 1) {
  const source = makeRng(seed);
  let calls = 0;
  return {
    rng() {
      calls++;
      return source();
    },
    get calls() {
      return calls;
    },
    reset() {
      calls = 0;
    },
  };
}

function makeSequenceRng(values, fallback = 0.5) {
  let index = 0;
  return () => values[index++] ?? fallback;
}

function waveHash(wave, index, salt = 0) {
  const value = Math.sin(
    (wave + 1) * 12.9898 + (index + 1) * 78.233 + (salt + 1) * 37.719,
  ) * 43758.5453;
  return value - Math.floor(value);
}

function ufoSpawnCandidate(wave, attempt) {
  return {
    x: waveHash(wave, attempt, 149) * W,
    y: waveHash(wave, attempt, 150) * H,
  };
}

function makeAsteroid(cfg, size, x, y, kind = 'normal', seed = 1, vx = 0, vy = 0) {
  const asteroid = createAsteroid(size, x, y, cfg, makeRng(seed), 1, kind);
  asteroid.vx = vx;
  asteroid.vy = vy;
  asteroid.rotSpeed = 0;
  return asteroid;
}

function makeUfo(cfg, kind, x, y, opts = {}) {
  const ufo = createUfo(kind, x, y, cfg, makeRng(opts.seed ?? 1), opts.speedMult ?? 1);
  if (opts.vx !== undefined) ufo.vx = opts.vx;
  if (opts.vy !== undefined) ufo.vy = opts.vy;
  if (opts.angle !== undefined) ufo.angle = opts.angle;
  if (opts.hp !== undefined) ufo.hp = opts.hp;
  if (opts.cooldown !== undefined) ufo.asteroidHitCooldown = opts.cooldown;
  if (opts.protected !== undefined) ufo.spawnCollisionProtected = opts.protected;
  // Collision tests were written against the no-avoidance baseline; new avoidance
  // tests opt-in explicitly so older fixtures keep isolating physical collision.
  if (opts.avoidance === false || opts.avoidance === undefined) {
    if (cfg.ufo[ufo.kind]?.avoidance) {
      cfg.ufo[ufo.kind].avoidance = { ...cfg.ufo[ufo.kind].avoidance, enabled: false };
    }
  }
  if (opts.bulletEvasion === false || opts.bulletEvasion === undefined) {
    if (cfg.ufo[ufo.kind]?.bulletEvasion) {
      cfg.ufo[ufo.kind].bulletEvasion = { ...cfg.ufo[ufo.kind].bulletEvasion, enabled: false };
    }
  }
  return ufo;
}

function setupGame(seed = 1, opts = {}) {
  const cfg = cloneConfig();
  if (cfg.ufo.hunter) cfg.ufo.hunter.hp = 2;
  if (cfg.ufo.base) cfg.ufo.base.hp = 4;
  if (cfg.ufo.scout) cfg.ufo.scout.hp = 1;
  if (cfg.ufo.fighter) cfg.ufo.fighter.hp = 2;
  if (cfg.ufo.bomber) cfg.ufo.bomber.hp = 5;
  const game = createGame(cfg, makeRng(seed));
  game.start();
  game.state.ship.invuln = 0;
  // Clear default asteroids and UFOs to get a controlled environment.
  game.state.asteroids = [];
  game.state.ufos = [];
  // Place ship out of the way.
  game.state.ship.x = opts.shipX ?? 0;
  game.state.ship.y = opts.shipY ?? 0;
  game.state.ship.vx = 0;
  game.state.ship.vy = 0;
  return { cfg, game };
}

function runStep(game, dt = DT) {
  game.update(dt, {});
}

function assertClose(actual, expected, epsilon = EPS, msg) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    msg ?? `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function assertNoNaN(obj, label = 'object') {
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === 'number') {
      assert.ok(!Number.isNaN(v), `${label}.${key} is NaN`);
      assert.ok(Number.isFinite(v), `${label}.${key} is not finite`);
    }
  }
}

// ---- P0-1: Small asteroid deals exactly 1 damage to hunter ----

test('P0-1: small asteroid deals 1 damage to hunter', () => {
  const { cfg, game } = setupGame(1);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  // Overlap: UFO radius=18, small radius=14. Place at distance 20 (< 32).
  const asteroid = makeAsteroid(cfg, 'small', 420, 300);
  game.state.asteroids.push(asteroid);

  runStep(game);
  assert.equal(ufo.hp, 1, 'hunter should lose 1 HP (from 2 to 1)');
});

// ---- P0-2: Medium asteroid deals exactly 1 damage ----

test('P0-2: medium asteroid deals 1 damage to hunter', () => {
  const { cfg, game } = setupGame(2);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  // Overlap: UFO radius=18, medium radius=26. Place at distance 30 (< 44).
  const asteroid = makeAsteroid(cfg, 'medium', 430, 300);
  game.state.asteroids.push(asteroid);

  runStep(game);
  assert.equal(ufo.hp, 1, 'hunter should lose 1 HP');
});

// ---- P0-3: Large asteroid deals 2, leaving a healthy hunter alive ----

test('P0-3: large asteroid deals 2 damage to a healthy hunter', () => {
  const { cfg, game } = setupGame(3);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, {
    angle: 0,
    hp: CONFIG.ufo.hunter.hp,
  });
  game.state.ufos.push(ufo);
  // Overlap: UFO radius=18, large radius=48. Place at distance 50 (< 66).
  const asteroid = makeAsteroid(cfg, 'large', 450, 300);
  game.state.asteroids.push(asteroid);

  runStep(game);

  assert.equal(ufo.hp, CONFIG.ufo.hunter.hp - 2, 'large asteroid should remove 2 HP');
  assert.equal(ufo.alive, true, 'a healthy hunter should survive the impact');
  assert.equal(game.state.ufos.length, 1, 'surviving hunter remains in state');
});

// ---- P0-4: Base loses 2 of 4 HP from large ----

test('P0-4: base loses 2 of 4 HP from large asteroid', () => {
  const { cfg, game } = setupGame(4);
  const ufo = makeUfo(cfg, 'base', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'large', 440, 300);
  game.state.asteroids.push(asteroid);

  runStep(game);
  assert.equal(ufo.hp, 2, 'base should lose 2 HP (from 4 to 2)');
  assert.equal(ufo.alive, true, 'base should survive');
  assert.equal(game.state.ufos.length, 1, 'base should still be in state');
});

// ---- P0-5: Asteroid is immutable after collision ----

test('P0-5: asteroid position, velocity, HP, stun and alive are unchanged by collision', () => {
  const { cfg, game } = setupGame(5);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  // Place asteroid at distance 30 (< 44) moving at vx=30, vy=0 so collision occurs in step
  const asteroid = makeAsteroid(cfg, 'medium', 430, 300, 'normal', 5, 30, 0);
  game.state.asteroids.push(asteroid);

  // Parallel control game without UFO
  const { game: gameControl } = setupGame(5);
  const controlAsteroid = makeAsteroid(cfg, 'medium', 430, 300, 'normal', 5, 30, 0);
  gameControl.state.asteroids.push(controlAsteroid);

  runStep(game);
  runStep(gameControl);

  // The collided asteroid must match the control asteroid in every physical property
  assertClose(asteroid.x, controlAsteroid.x, EPS, 'asteroid x should match control integration');
  assertClose(asteroid.y, controlAsteroid.y, EPS, 'asteroid y should match control integration');
  assert.equal(asteroid.vx, controlAsteroid.vx, 'asteroid vx unchanged');
  assert.equal(asteroid.vy, controlAsteroid.vy, 'asteroid vy unchanged');
  assert.equal(asteroid.hp, controlAsteroid.hp, 'asteroid hp unchanged');
  assert.equal(asteroid.stun, controlAsteroid.stun, 'asteroid stun unchanged');
  assert.equal(asteroid.alive, controlAsteroid.alive, 'asteroid alive unchanged');
});

// ---- P0-6: Knockback persists and decays exponentially ----

test('P0-6: knockback points away from rock, persists next step, decays exponentially', () => {
  const { cfg, game } = setupGame(6);
  // UFO moves right; asteroid sits ahead to the right. Impact must push the UFO left.
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'medium', 430, 300);
  game.state.asteroids.push(asteroid);

  runStep(game);

  // UFO should survive (medium deals 1, hunter has 2 HP).
  assert.equal(ufo.alive, true, 'ufo should survive medium hit');
  // Knockback should have a component pushing the UFO away from the asteroid
  // (i.e. in -x direction, since the asteroid is at +x relative to UFO).
  assert.ok(ufo.knockbackVx < -EPS, 'knockbackVx should be negative (away from rock at +x)');

  // Snapshot knockback after first step.
  const kb0x = ufo.knockbackVx;
  const kb0y = ufo.knockbackVy;

  // Run another step without the asteroid (remove it to avoid re-collision).
  // But the latch prevents re-damage anyway. Keep the asteroid.
  // Move ship away to avoid UFO turning. Run another step.
  game.state.ship.x = 0;
  game.state.ship.y = 0;
  runStep(game);

  const damping = Math.exp(-cfg.ufo.asteroidCollision.knockbackDamping * DT);
  // After updateUfo, knockback is damped. The value stored in ufo.knockbackVx
  // is post-damping for the second step.
  // Check it's smaller in magnitude than initial (decay).
  const mag0 = Math.hypot(kb0x, kb0y);
  const mag1 = Math.hypot(ufo.knockbackVx, ufo.knockbackVy);
  assert.ok(mag1 < mag0, 'knockback magnitude should decay after a step');
  // The decay ratio should be approximately damping (with some tolerance for
  // potential second collision effects).
  if (ufo.knockbackVx !== 0 || ufo.knockbackVy !== 0) {
    assertClose(mag1 / mag0, damping, 0.15, 'decay ratio should approximate damping factor');
  }
});

// ---- P0-7: Relative output velocities by size and worst-case invariant ----

test('P0-7a: collisions produce the exact configured relative output by size', () => {
  const expectedBySize = {
    small: 70,
    medium: 150,
    large: 280,
  };

  for (const [index, [size, expectedOutward]] of Object.entries(expectedBySize).entries()) {
    const { cfg, game } = setupGame(71 + index, { shipX: 799, shipY: 300 });
    assert.equal(
      cfg.ufo.asteroidCollision.knockbackSpeedBySize[size],
      expectedOutward,
      `${size} balance value`,
    );

    const ufo = makeUfo(cfg, 'base', 400, 300, { angle: 0, hp: 10 });
    const rock = makeAsteroid(
      cfg,
      size,
      400 + ufo.radius + cfg.asteroid[`${size}R`] - 2,
      300,
      'normal',
      71 + index,
      0,
      0,
    );
    game.state.ufos.push(ufo);
    game.state.asteroids.push(rock);

    const nx = torusDelta(rock.x, ufo.x, W) / torusDistance(
      rock.x, rock.y, ufo.x, ufo.y, W, H,
    );
    const ny = torusDelta(rock.y, ufo.y, H) / torusDistance(
      rock.x, rock.y, ufo.x, ufo.y, W, H,
    );

    runStep(game);

    const relativeOutward =
      (ufo.vx - rock.vx) * nx
      + (ufo.vy - rock.vy) * ny;
    assertClose(
      relativeOutward,
      expectedOutward,
      EPS,
      `${size} collision should leave exactly ${expectedOutward} px/s outward`,
    );
  }
});

test('P0-7b: maxKnockbackSpeed covers worst-case closing speed', () => {
  const cfg = cloneConfig();
  const maxUfoSpeed = cfg.ufo.hunter.speed * cfg.ufo.maxSpeedMultiplier;
  const maxAsteroidSpeed = cfg.abilities.shieldBurst.maxAsteroidSpeed;
  const desiredLarge = cfg.ufo.asteroidCollision.knockbackSpeedBySize.large;
  const worstCase = maxUfoSpeed + maxAsteroidSpeed + desiredLarge;
  assert.ok(
    cfg.ufo.asteroidCollision.maxKnockbackSpeed >= worstCase,
    `maxKnockbackSpeed (${cfg.ufo.asteroidCollision.maxKnockbackSpeed}) must cover worst case (${worstCase})`,
  );

  // Execute extreme closing speed collision in step (ship at 800,300 so angle stays 0)
  const { game, cfg: gameCfg } = setupGame(74, { shipX: 800, shipY: 300 });
  // This fixture measures the collision solver's theoretical velocity bound,
  // not navigation behaviour. Keep the drive at the requested maximum.
  gameCfg.ufo.base.avoidance.enabled = false;
  const ufo = makeUfo(cfg, 'base', 400, 300, { angle: 0, hp: 10, vx: maxUfoSpeed, vy: 0 });
  ufo.speed = maxUfoSpeed; // Set ufo.speed so updateUfo uses maxUfoSpeed (the capped baseline * multiplier)
  game.state.ufos.push(ufo);
  const rock = makeAsteroid(cfg, 'large', 470, 300, 'normal', 74, -maxAsteroidSpeed, 0);
  game.state.asteroids.push(rock);
  runStep(game);

  const finalKb = Math.hypot(ufo.knockbackVx, ufo.knockbackVy);
  const expectedKb = desiredLarge + maxAsteroidSpeed + maxUfoSpeed;
  assertClose(finalKb, expectedKb, 0.05, `final knockback matches exact theoretical maximum (${expectedKb} px/s)`);
  assert.ok(finalKb <= cfg.ufo.asteroidCollision.maxKnockbackSpeed, `final knockback (${finalKb}) must not exceed maxKnockbackSpeed`);
});

// ---- P0-8: Same contact does not re-damage; reentry after release can ----

test('P0-8: same contact no new damage after cooldown; reentry after release damages', () => {
  const { cfg, game } = setupGame(8);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, hp: 1 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'large', 400 + ufo.radius + cfg.asteroid.largeR, 300);
  game.state.asteroids.push(asteroid);

  runStep(game);
  assert.equal(ufo.alive, false, 'first contact should kill the hunter');

  // Base UFO survives and stays in continuous contact past the configured cooldown.
  const { game: game2, cfg: cfg2 } = setupGame(81);
  const base = makeUfo(cfg2, 'base', 400, 300, { angle: 0, hp: 4 });
  game2.state.ufos.push(base);
  const rock = makeAsteroid(cfg2, 'large', 400 + base.radius + cfg2.asteroid.largeR - 2, 300, 'normal', 81, 0, 0);
  game2.state.asteroids.push(rock);

  runStep(game2);
  assert.equal(base.hp, 2, 'base should lose 2 HP on first contact');

  // Keep stepping past the configured cooldown while maintaining contact.
  const stepsPastCooldown = Math.ceil(cfg2.ufo.asteroidCollision.hitCooldown / DT) + 2;
  for (let i = 0; i < stepsPastCooldown; i++) {
    base.x = 400;
    base.y = 300;
    rock.x = 400 + base.radius + cfg2.asteroid.largeR - 2;
    rock.y = 300;
    game2.state.ship.x = 0;
    game2.state.ship.y = 0;
    runStep(game2);
  }
  assert.equal(base.hp, 2, 'continuous contact past cooldown duration should deal no new damage');
  assert.ok(base.alive, 'base should remain alive during continuous contact');

  // Move rock away to release contact latch (surface distance > contactReleasePadding = 8)
  rock.x = 400 + base.radius + cfg2.asteroid.largeR + 20;
  runStep(game2); // Latch cleared

  // Move rock outside contact (r=93 > 78) moving left at -3000 -> re-entry during step deals damage again!
  rock.x = 400 + base.radius + cfg2.asteroid.largeR + 15;
  rock.vx = -3000;
  runStep(game2);
  assert.equal(base.hp, 0, 'reentry after release should deal damage again');
  assert.equal(base.alive, false, 'base should be destroyed on re-entry');
});

// ---- P0-9: Contact with different rock during cooldown: physical only; after cooldown: damage ----

test('P0-9: second rock during cooldown only pushes; after cooldown damages', () => {
  const { cfg, game } = setupGame(9);
  const ufo = makeUfo(cfg, 'base', 400, 300, { angle: 0, hp: 4 });
  game.state.ufos.push(ufo);
  const rock1 = makeAsteroid(cfg, 'small', 420, 300, 'normal', 91, 0, 0);
  game.state.asteroids.push(rock1);

  runStep(game);
  assert.equal(ufo.hp, 3, 'first small rock deals 1 damage');

  // Second rock added during the configured cooldown.
  const rock2 = makeAsteroid(cfg, 'small', 400, 270, 'normal', 92, 0, 0);
  game.state.asteroids.push(rock2);
  runStep(game);
  // Keep a dummy rock far away so wave clear does not trigger while the
  // configured cooldown is allowed to expire.
  const dummyRock = makeAsteroid(cfg, 'small', 100, 100, 'normal', 99, 0, 0);
  game.state.asteroids = [dummyRock];
  const waitSteps = Math.ceil(cfg.ufo.asteroidCollision.hitCooldown / DT) + 2;
  for (let i = 0; i < waitSteps; i++) {
    game.state.ship.x = 0;
    game.state.ship.y = 0;
    runStep(game);
  }

  // Rock 3 placed outside current UFO position moving into it after cooldown expired -> deals damage and rearms cooldown
  const rock3 = makeAsteroid(cfg, 'small', (ufo.x + 55) % W, ufo.y, 'normal', 93, -3000, 0);
  game.state.asteroids.push(rock3);
  runStep(game);
  assert.equal(ufo.hp, 2, 'rock hit after cooldown expiry deals damage');
});

// ---- P0-10: Toroidal seam collision ----

test('P0-10: collision across toroidal seam pushes in short direction', () => {
  const { cfg, game } = setupGame(10);
  // UFO near right edge, asteroid near left edge (wrapping seam).
  const ufo = makeUfo(cfg, 'hunter', W - 10, 300, { angle: 0, vx: 60 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'small', 10, 300);
  game.state.asteroids.push(asteroid);

  runStep(game);
  // UFO should have taken damage (small = 1). Hunter has 2 HP.
  assert.equal(ufo.hp, 1, 'ufo should be hit across seam');
  // The asteroid is to the right of the UFO via the short toroidal path
  // (790 + 20 = 810 → wraps to 10). The normal points from asteroid to UFO
  // = left (-x), so the knockback pushes the UFO left (away from the rock).
  assert.ok(ufo.knockbackVx < 0, 'knockback should push UFO left (away from rock across seam)');
});

// ---- P0-11: Fast crossing without final overlap caught by sweep ----

test('P0-11: fast crossing without final overlap is caught by sweep', () => {
  const { cfg, game } = setupGame(11, { shipX: 800, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 300, 300, { angle: 0 });
  ufo.speed = 12000;
  ufo.vx = 12000;
  ufo.vy = 0;
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'small', 500, 300, 'normal', 11, -12000, 0);
  game.state.asteroids.push(asteroid);

  // In dt = 1/60s:
  // UFO moves +200px (300 -> 500). Asteroid moves -200px (500 -> 300).
  // Initial distance = 200 > 32 (no overlap).
  // Final distance at t=1/60 = 200 > 32 (no endpoint overlap!).
  // Midpoint t=1/120: both at 400, distance = 0 (cross).
  runStep(game);

  // Endpoint distance is 200 (no endpoint overlap), so ONLY sweep could catch this!
  assert.equal(ufo.hp, 1, 'ufo should be hit by fast crossing sweep');
});

// ---- P0-12: Two rocks — earliest hitTime wins; tie uses asteroidIndex ----

test('P0-12: two rocks, earliest hitTime wins even if later in array; tie uses asteroidIndex', () => {
  const { cfg, game } = setupGame(12);
  const ufo = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 10 });
  game.state.ufos.push(ufo);

  // Both rocks collide within step (dt = 1/60s = 0.01667s).
  // Index 0: small rock (1 damage) at 460 (r=14, dist=60 > 44), vx=-1000 -> hitTime = 16/1000 = 0.01600s
  const farRock = makeAsteroid(cfg, 'small', 460, 300, 'normal', 121, -1000, 0);
  // Index 1: large rock (2 damage) at 500 (r=48, dist=100 > 78), vx=-5000 -> hitTime = 22/5000 = 0.00440s
  const nearRock = makeAsteroid(cfg, 'large', 500, 300, 'normal', 122, -5000, 0);
  game.state.asteroids.push(farRock, nearRock);

  runStep(game);
  // Near rock (large = 2 damage) hits first at t=0.0044s despite being index 1 in array
  assert.equal(ufo.hp, 8, 'earliest hitTime (near rock, large=2 damage) wins');

  // Tie-breaker: 799 is the canonical right edge coordinate. Using 800 would
  // wrap the ship to 0 before updateUfo and perturb the two hit times.
  // With vy=0, both rocks have bit-identical hitTimes = (dist - sumR) / relVx.
  // rockA: dist=100, sumR=78, gap=22. rockB: dist=66, sumR=44, gap=22. hitTime = 22/relVx.
  const { game: gTie, cfg: cfgTie } = setupGame(122, { shipX: 799, shipY: 300 });
  const ufoTie = makeUfo(cfgTie, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 10 });
  gTie.state.ufos.push(ufoTie);

  const rockA = makeAsteroid(cfgTie, 'large', 500, 300, 'normal', 123, -5000, 0); // index 0 (large = 2 damage)
  const rockB = makeAsteroid(cfgTie, 'small', 466, 300, 'normal', 124, -5000, 0); // index 1 (small = 1 damage)
  gTie.state.asteroids.push(rockA, rockB);

  const hitA = sweptCircleCollisionTime(
    ufoTie.x, ufoTie.y, ufoTie.radius, ufoTie.speed, 0,
    rockA.x, rockA.y, rockA.radius, rockA.vx, rockA.vy,
    W, H, DT,
  );
  const hitB = sweptCircleCollisionTime(
    ufoTie.x, ufoTie.y, ufoTie.radius, ufoTie.speed, 0,
    rockB.x, rockB.y, rockB.radius, rockB.vx, rockB.vy,
    W, H, DT,
  );
  assert.equal(hitA, hitB, 'precondition: the two hit times are exactly tied');
  assertClose(hitA, 22 / (5000 + ufoTie.speed), EPS, 'exact tie occurs at the intended time');

  runStep(gTie);
  assert.equal(ufoTie.angle, 0, 'canonical right-side ship keeps the UFO heading exact');
  assert.equal(ufoTie.hp, 8, 'tie in hitTime resolves to lowest asteroidIndex (rockA, index 0)');
});

// ---- P0-13: Two UFOs colliding in same step are limited individually ----

test('P0-13: two UFOs colliding in same step are limited individually', () => {
  const { cfg, game } = setupGame(13);
  const ufo1 = makeUfo(cfg, 'hunter', 300, 300, { angle: 0 });
  const ufo2 = makeUfo(cfg, 'hunter', 500, 300, { angle: Math.PI });
  game.state.ufos.push(ufo1, ufo2);
  const rock1 = makeAsteroid(cfg, 'small', 320, 300, 'normal', 131);
  const rock2 = makeAsteroid(cfg, 'small', 480, 300, 'normal', 132);
  game.state.asteroids.push(rock1, rock2);

  runStep(game);
  // Each UFO should take exactly 1 damage (from their respective rocks).
  assert.equal(ufo1.hp, 1, 'ufo1 should lose 1 HP');
  assert.equal(ufo2.hp, 1, 'ufo2 should lose 1 HP');
  assert.ok(ufo1.alive && ufo2.alive, 'both should survive');
});

// ---- P0-14: Environmental death awards points once, one ufoDestroy, no asteroid points ----

test('P0-14: environmental death awards ufo.points once, one ufoDestroy, no asteroid points', () => {
  const { cfg, game } = setupGame(14);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, hp: 1 });
  game.state.ufos.push(ufo);
  // Overlap: UFO radius=18, large radius=48. Distance=50 < 66.
  const asteroid = makeAsteroid(cfg, 'large', 450, 300);
  game.state.asteroids.push(asteroid);

  const scoreBefore = game.state.score;
  runStep(game);

  assert.equal(ufo.alive, false, 'ufo should be dead');
  assert.equal(game.state.score, scoreBefore + ufo.points, 'score should be ufo.points only');
  const destroys = game.state.effects.filter(e => e.kind === 'ufoDestroy');
  assert.equal(destroys.length, 1, 'exactly one ufoDestroy');
  assert.equal(game.state.ufos.length, 0, 'ufo removed from state');
  assert.equal(asteroid.alive, true, 'asteroid should survive');
});

// ---- P0-15: Environmental death does not alter combo or multiplier ----

test('P0-15: environmental death does not change combo or multiplier', () => {
  const { cfg, game } = setupGame(15);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, hp: 1 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'large', 450, 300);
  game.state.asteroids.push(asteroid);

  // Set up a combo and multiplier.
  game.state.scoring.combo = 3;
  game.state.scoring.multiplier = 2;

  runStep(game);

  assert.equal(ufo.alive, false, 'ufo should be dead');
  assert.equal(game.state.scoring.combo, 3, 'combo unchanged');
  assert.equal(game.state.scoring.multiplier, 2, 'multiplier unchanged');
});

// ---- P0-16: Non-lethal manual hit then environmental death uses newly armed multiplier ----

test('P0-16: non-lethal manual shot then environmental death uses armed multiplier', () => {
  const { cfg, game } = setupGame(16);
  cfg.bullet.speed = 6000;

  // Hunter UFO has 2 HP. 1 bullet damage leaves 1 HP.
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, hp: 2 });
  game.state.ufos.push(ufo);
  // Large asteroid (r=48) at 480, 300 moving left at -3000 px/s (hits at t ≈ 0.0046s)
  const asteroid = makeAsteroid(cfg, 'large', 480, 300, 'normal', 16, -3000, 0);
  game.state.asteroids.push(asteroid);

  // Position ship at 350, 300 facing right (angle = 0) to fire bullet directly into UFO at 400, 300
  game.state.ship.x = 350;
  game.state.ship.y = 300;
  game.state.ship.angle = 0;
  game.state.bulletCooldown = 0;

  const scoreBefore = game.state.score;
  game.update(DT, { fire: true });

  // Bullet hits UFO first at t ≈ 0.0028s (non-lethal, arms multiplier to 1.5x), then large rock hits UFO at t ≈ 0.0046s and kills it
  assert.equal(ufo.alive, false, 'ufo should be killed');
  assert.ok(game.state.scoring.multiplier >= 1.5, 'multiplier armed by manual shot');
  assert.equal(game.state.score, scoreBefore + ufo.points * 1.5, 'score uses newly armed multiplier from manual shot');
});

// ---- P0-17: UFO already dead by projectile does not suffer collision ----

test('P0-17: UFO killed by projectile does not suffer asteroid collision', () => {
  const { cfg, game } = setupGame(17);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  // Large rock at 470, moving left at -3000: gap = 70-66 = 4, hitTime ≈ 4/3125 ≈ 0.00128s.
  // Without the bullet, this WOULD collide within the step.
  const asteroid = makeAsteroid(cfg, 'large', 470, 300, 'normal', 17, -3000, 0);
  game.state.asteroids.push(asteroid);

  // Kill the UFO with a bullet before the step.
  ufo.hp = 1; // Make it die from one bullet hit.

  const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
  bullet.x = ufo.x;
  bullet.y = ufo.y;
  bullet.vx = 0;
  bullet.vy = 0;
  bullet.accuracyShotId = null;
  game.state.bullets.push(bullet);

  runStep(game);

  // The bullet kills the UFO first, then the asteroid collision should be
  // skipped (UFO already dead/removed).
  assert.equal(game.state.ufos.length, 0, 'ufo should be removed by bullet');
  // Only one ufoDestroy effect (from the bullet kill, not from collision).
  const destroys = game.state.effects.filter(e => e.kind === 'ufoDestroy');
  assert.equal(destroys.length, 1, 'only one ufoDestroy from bullet kill');
});

// ---- P0-18: Rock destroyed by projectile does not collide after ----

test('P0-18: rock destroyed by projectile does not collide with UFO after', () => {
  const { cfg, game } = setupGame(18);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  // Small asteroid (1 HP, dies from one bullet).
  const asteroid = makeAsteroid(cfg, 'small', 420, 300);
  game.state.asteroids.push(asteroid);

  // Place a bullet on the asteroid to destroy it in the same step.
  const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
  bullet.x = asteroid.x;
  bullet.y = asteroid.y;
  bullet.vx = 0;
  bullet.vy = 0;
  bullet.accuracyShotId = null;
  game.state.bullets.push(bullet);

  runStep(game);

  // The asteroid should be destroyed (bullet has priority).
  assert.equal(asteroid.alive, false, 'asteroid should be destroyed by bullet');
  // The UFO should not have taken damage from the now-dead asteroid.
  assert.equal(ufo.hp, 2, 'ufo should not lose HP from destroyed asteroid');
});

// ---- P0-19: Fragments created in step do not participate in sweep or cleanup ----

test('P0-19a: new fragments skip same-step sweep, then collide next step', () => {
  const { cfg, game } = setupGame(190, { shipX: 700, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  const unimpededX = 400 + cfg.ufo.hunter.speed * 0.5;
  const parent = makeAsteroid(cfg, 'medium', unimpededX, 300, 'normal', 190, 0, 0);
  game.state.ufos.push(ufo);
  game.state.asteroids.push(parent);

  const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
  bullet.x = parent.x;
  bullet.y = parent.y;
  bullet.vx = 0;
  bullet.vy = 0;
  bullet.accuracyShotId = null;
  game.state.bullets.push(bullet);

  // In 0.5 s the unimpeded UFO integrates from x=400 to x=unimpededX. The parent
  // dies at t=0 and creates small fragments at that exact endpoint. With no
  // surviving original primary, only an illegal same-step fragment sweep could
  // damage or displace the UFO.
  game.update(0.5, {});

  const fragments = [...game.state.asteroids];
  assert.equal(parent.alive, false, 'medium parent is destroyed before UFO collisions');
  assert.equal(fragments.length, cfg.asteroid.childrenPerSplit, 'medium parent creates two fragments');
  assertClose(ufo.x, unimpededX, EPS, 'same-step fragments do not alter normal UFO integration');
  assertClose(ufo.y, 300, EPS);
  assert.equal(ufo.hp, 2, 'same-step fragments cannot damage through the sweep');
  for (const fragment of fragments) {
    assert.equal(fragment.size, 'small');
    assert.equal(
      circleCollision(
        ufo.x, ufo.y, ufo.radius,
        fragment.x, fragment.y, fragment.radius,
        W, H,
      ),
      true,
      'fragment is coincident with the endpoint it was excluded from sweeping',
    );
  }

  game.update(0, {});
  assert.equal(ufo.hp, 1, 'fragment becomes collision-eligible on the next snapshot');
  assert.equal(ufo.alive, true, 'next-step small fragment deals exactly one damage');
});

test('P0-19b: new fragments skip same-step cleanup, then collide next step', () => {
  const { cfg, game } = setupGame(19, { shipX: 799, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  const primary = makeAsteroid(cfg, 'small', 420, 300, 'normal', 191, 0, 0);
  game.state.ufos.push(ufo);
  game.state.asteroids.push(primary);

  // The primary-only control establishes the endpoint produced by the real
  // collision. A destroyed large rock is centred exactly at that endpoint, so
  // both new medium fragments would move the UFO if cleanup admitted them.
  const { cfg: controlCfg, game: control } = setupGame(19, { shipX: 799, shipY: 300 });
  const controlUfo = makeUfo(controlCfg, 'hunter', 400, 300, { angle: 0 });
  const controlPrimary = makeAsteroid(controlCfg, 'small', 420, 300, 'normal', 191, 0, 0);
  control.state.ufos.push(controlUfo);
  control.state.asteroids.push(controlPrimary);
  runStep(control, 0);

  const parent = makeAsteroid(
    cfg, 'large', controlUfo.x, controlUfo.y, 'normal', 192, 0, 0,
  );
  game.state.asteroids.push(parent);

  const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
  bullet.x = parent.x - 40; // inside the large rock, outside the UFO hitbox
  bullet.y = parent.y;
  bullet.vx = 0;
  bullet.vy = 0;
  bullet.accuracyShotId = null;
  game.state.bullets.push(bullet);

  runStep(game, 0);

  const fragments = game.state.asteroids.filter(asteroid => asteroid !== primary);
  assert.equal(parent.alive, false, 'large parent should be destroyed before UFO collisions');
  assert.equal(fragments.length, cfg.asteroid.childrenPerSplit, 'large parent creates its fragments');
  assertClose(ufo.x, controlUfo.x, EPS, 'new fragments do not alter cleanup x');
  assertClose(ufo.y, controlUfo.y, EPS, 'new fragments do not alter cleanup y');
  assertClose(ufo.knockbackVx, controlUfo.knockbackVx, EPS, 'new fragments do not alter knockback');
  assert.equal(ufo.hp, controlUfo.hp, 'only the original primary can damage in this step');
  for (const fragment of fragments) {
    assert.equal(fragment.size, 'medium');
    assert.equal(
      circleCollision(
        ufo.x, ufo.y, ufo.radius,
        fragment.x, fragment.y, fragment.radius,
        W, H,
      ),
      true,
      'fragment is deliberately overlapping the same-step endpoint',
    );
  }

  // On the next snapshot the fragments are eligible; resetting only the public
  // global cooldown lets their first real contact finish the damaged hunter.
  ufo.asteroidHitCooldown = 0;
  runStep(game, 0);
  assert.equal(ufo.alive, false, 'an overlapping fragment collides on the next step');
  assert.equal(ufo.hp, 0, 'next-step medium fragment deals its normal damage');
});

// ---- P0-20: Partially frozen asteroid — hit in frozen, mobile, and boundary phases ----

test('P0-20a: hit during frozen phase with post-thaw reintegration', () => {
  const { cfg, game } = setupGame(20, { shipX: 799, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  // Medium cryo at 444.2 (r=26, ufo r=18, sumR=44, dist=44.2, gap=0.2).
  // Stun = 0.005s (thaws at 5ms, step is 16.67ms).
  // UFO vx=cfg.ufo.hunter.speed. Hit occurs at t = 0.2 / speed < 0.005s (during frozen phase).
  const asteroid = makeAsteroid(cfg, 'medium', 444.2, 300, 'cryo', 20, -3000, 0);
  asteroid.stun = 0.005;
  game.state.asteroids.push(asteroid);

  const frozenHit = sweptCircleCollisionTime(
    400, 300, ufo.radius, ufo.speed, 0,
    asteroid.x, asteroid.y, asteroid.radius, 0, 0,
    W, H, asteroid.stun,
  );
  assertClose(frozenHit, 0.2 / ufo.speed, 1e-12, 'hit occurs inside the frozen phase');

  const controlAsteroid = structuredClone(asteroid);
  updateAsteroid(controlAsteroid, DT, W, H);

  runStep(game);
  assert.equal(ufo.hp, 1, 'ufo should be hit during frozen phase');
  // Since thaw occurs at 0.005s < DT (0.01667s), knockback incorporates asteroid velocity response (-3000)
  assert.ok(ufo.knockbackVx < -3000, 'knockback incorporates post-thaw velocity response');
  assertClose(asteroid.x, controlAsteroid.x, EPS, 'rock x matches independent two-phase integration');
  assertClose(asteroid.y, controlAsteroid.y, EPS, 'rock y matches independent two-phase integration');
  assert.equal(asteroid.vx, controlAsteroid.vx, 'collision does not alter rock vx');
  assert.equal(asteroid.vy, controlAsteroid.vy, 'collision does not alter rock vy');
  assertClose(asteroid.stun, controlAsteroid.stun, EPS, 'collision does not alter thaw timing');
  assertClose(
    ufo.asteroidHitCooldown,
    cfg.ufo.asteroidCollision.hitCooldown - (DT - frozenHit),
    EPS,
    'cooldown residual encodes the frozen-phase impact time',
  );
  assert.ok(
    torusDistance(ufo.x, ufo.y, asteroid.x, asteroid.y, W, H)
      >= ufo.radius + asteroid.radius + cfg.ufo.asteroidCollision.separationPadding - EPS,
    'cleanup uses the actual integrated rock endpoint and leaves no final overlap',
  );
  assertNoNaN(ufo, 'ufo');
});

test('P0-20b: hit during mobile phase after thaw', () => {
  const { cfg, game } = setupGame(21, { shipX: 799, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0 });
  game.state.ufos.push(ufo);
  // Initial distance = 70 > 44 (radii sum 18+26). Starts OUTSIDE.
  const asteroid = makeAsteroid(cfg, 'medium', 470, 300, 'cryo', 21, -3000, 0);
  const thawTime = 0.002;
  // Frozen for 2 ms. The UFO advances cfg.ufo.hunter.speed * thawTime while the rock is stopped,
  // then the pair closes the remaining gap at (speed + 3000) px/s.
  asteroid.stun = thawTime;
  game.state.asteroids.push(asteroid);

  const frozenHit = sweptCircleCollisionTime(
    400, 300, ufo.radius, ufo.speed, 0,
    asteroid.x, asteroid.y, asteroid.radius, 0, 0,
    W, H, thawTime,
  );
  const ufoXAfterFrozen = 400 + ufo.speed * thawTime;
  const gapAfterFrozen = asteroid.x - ufoXAfterFrozen - (ufo.radius + asteroid.radius);
  const movingHit = sweptCircleCollisionTime(
    ufoXAfterFrozen, 300, ufo.radius, ufo.speed, 0,
    asteroid.x, asteroid.y, asteroid.radius, asteroid.vx, asteroid.vy,
    W, H, DT - thawTime,
  );
  assert.equal(frozenHit, null, 'no contact occurs while the rock is frozen');
  assertClose(movingHit, gapAfterFrozen / (ufo.speed - asteroid.vx), 1e-12, 'moving-phase hit has the intended relative timing');

  runStep(game);
  assert.equal(ufo.hp, 1, 'ufo should be hit during mobile phase after thaw');
  const desiredOutward = cfg.ufo.asteroidCollision.knockbackSpeedBySize.medium;
  assertClose(
    asteroid.vx - ufo.vx,
    desiredOutward,
    EPS,
    'mobile-phase response leaves the exact relative outward speed',
  );
  assertClose(ufo.vy, asteroid.vy, EPS, 'mobile response has no spurious tangential velocity');
  assertClose(
    ufo.asteroidHitCooldown,
    cfg.ufo.asteroidCollision.hitCooldown - (DT - (thawTime + movingHit)),
    EPS,
    'cooldown residual encodes the post-thaw impact time',
  );
  const movingTime = DT - thawTime;
  const expectedX = ((470 + (-3000) * movingTime) % W + W) % W;
  assertClose(asteroid.x, expectedX, EPS, 'asteroid endpoint should match independent integration');
});

test('P0-20c: hit exactly on thaw boundary', () => {
  const thawTime = 0.005;
  // Ship at canonical x=799 keeps angle=0, so UFO vx=cfg.ufo.hunter.speed and vy=0.
  // During frozenTime, UFO advances to 400 + speed*frozenTime.
  // Asteroid stays at 444.825 (frozen). sumR = 18+26 = 44.
  // At frozenTime=0.005: UFO at 400.825, dist = 444.825-400.825 = 44 = sumR.
  // sweptCircle moving phase starts with c = 44^2 - 44^2 = 0, so movingHit = 0.
  // hitTime = frozenTime + 0 = 0.005 = exact thaw boundary.
  const { cfg, game } = setupGame(211, { shipX: 799, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0 });
  game.state.ufos.push(ufo);
  // Moving right after thaw makes the boundary classification observable:
  // mobile response gives knockbackVx=-175, while frozen response gives -275.
  const boundaryX = 400 + ufo.speed * thawTime + (ufo.radius + 26);
  const asteroid = makeAsteroid(cfg, 'medium', boundaryX, 300, 'cryo', 211, 100, 0);
  asteroid.stun = thawTime;
  game.state.asteroids.push(asteroid);

  const frozenHit = sweptCircleCollisionTime(
    400, 300, ufo.radius, ufo.speed, 0,
    asteroid.x, asteroid.y, asteroid.radius, 0, 0,
    W, H, thawTime,
  );
  const ufoXAfterFrozen = 400 + ufo.speed * thawTime;
  const movingHit = sweptCircleCollisionTime(
    ufoXAfterFrozen, 300, ufo.radius, ufo.speed, 0,
    asteroid.x, asteroid.y, asteroid.radius, asteroid.vx, asteroid.vy,
    W, H, DT - thawTime,
  );
  assertClose(frozenHit, thawTime, 1e-12, 'frozen sweep reaches contact exactly at thaw');
  assertClose(movingHit, 0, 1e-12, 'moving sweep begins in contact at the same boundary');

  runStep(game);
  assert.equal(ufo.hp, 1, 'ufo should be hit exactly at thaw boundary');
  // The important invariant is the final relative outward speed, not the absolute
  // knockback; the latter depends on the UFO's drive speed baseline.
  assertClose(
    (ufo.vx - asteroid.vx) * -1,
    cfg.ufo.asteroidCollision.knockbackSpeedBySize.medium,
    EPS,
    'boundary response preserves the configured relative outward speed',
  );
  assertClose(
    asteroid.x,
    boundaryX + asteroid.vx * (DT - thawTime),
    EPS,
    'rock integrates only the mobile remainder after the exact boundary',
  );
  assertNoNaN(ufo, 'ufo');
});

// ---- P0-21: dt === 0 and coincident centres produce deterministic normal, no NaN ----

test('P0-21: dt=0 and coincident centres produce deterministic result, no NaN', () => {
  const { cfg, game } = setupGame(22);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'medium', 400, 300, 'normal', 22, 0, 0);
  game.state.asteroids.push(asteroid);

  runStep(game, 0); // dt = 0

  assertNoNaN(ufo, 'ufo');
  assertNoNaN(asteroid, 'asteroid');
  // The UFO should be separated from the asteroid (no longer coincident).
  const dist = torusDistance(ufo.x, ufo.y, asteroid.x, asteroid.y, W, H);
  assert.ok(dist > 0, 'ufo should be separated from asteroid');
});

// ---- P0-22: Normal spawn respects safe distance and avoids asteroids ----

test('P0-22: normal spawn respects ship distance, avoids asteroids, no extra RNG', () => {
  function prepareWaveFive(counter, ufoEnabled) {
    const cfg = cloneConfig();
    if (!ufoEnabled) cfg.ufo.unlockWave = Number.POSITIVE_INFINITY;
    const game = createGame(cfg, counter.rng);
    game.start();
    game.state.ship.invuln = 0;
    game.state.ship.x = 400;
    game.state.ship.y = 300;
    game.state.ship.vx = 0;
    game.state.ship.vy = 0;
    game.state.wave = 4;
    game.state.asteroids = [];
    game.state.ufos = [];
    counter.reset();
    return { cfg, game };
  }

  const treatmentCounter = makeCountedRng(23);
  const controlCounter = makeCountedRng(23);
  const { cfg, game } = prepareWaveFive(treatmentCounter, true);
  const { game: control } = prepareWaveFive(controlCounter, false);

  runStep(game);
  runStep(control);
  assert.equal(game.state.wave, 5);
  assert.equal(game.state.ufos.length, 1, 'one UFO should spawn');

  const ufo = game.state.ufos[0];
  const headingProbe = makeCountedRng(230);
  createUfo(ufo.kind, 0, 0, cfg, headingProbe.rng, ufo.speedMultiplier);
  assert.equal(
    treatmentCounter.calls - controlCounter.calls,
    headingProbe.calls,
    'spawn search consumes no RNG beyond createUfo heading initialization',
  );
  assert.deepEqual(
    game.state.asteroids.map(a => [a.x, a.y, a.vx, a.vy, a.radius, a.kind]),
    control.state.asteroids.map(a => [a.x, a.y, a.vx, a.vy, a.radius, a.kind]),
    'RNG control produces the same wave asteroids when UFO spawning is disabled',
  );

  const dist = torusDistance(ufo.x, ufo.y, game.state.ship.x, game.state.ship.y, W, H);
  assert.ok(
    dist >= cfg.ufo.safeSpawnRadius - EPS,
    `ufo should be at least safeSpawnRadius from ship (dist=${dist})`,
  );
  assert.equal(ufo.spawnCollisionProtected, false, 'normal spawn should not be protected');
  // No asteroid overlap.
  for (const a of game.state.asteroids) {
    assert.ok(
      !circleCollision(ufo.x, ufo.y, ufo.radius, a.x, a.y, a.radius, W, H),
      'ufo should not overlap any asteroid',
    );
    assert.ok(
      torusDistance(ufo.x, ufo.y, a.x, a.y, W, H)
        >= ufo.radius + a.radius + cfg.ufo.asteroidCollision.spawnClearance - EPS,
      'normal spawn should satisfy configured asteroid clearance, not only physical separation',
    );
  }
});

// ---- P0-22b: Zero live asteroids — spawn is finite and canonical ----

test('P0-22b: with zero asteroids, UFO spawns at finite position, respects ship distance', () => {
  const { cfg, game } = setupGame(231, { shipX: 400, shipY: 300 });
  game.state.wave = 4;
  game.state.asteroids = [];
  cfg.asteroid.initialCount = 0;
  cfg.asteroid.maxInitial = 0;
  cfg.asteroid.guaranteedSpecialsPerWave = 0;
  runStep(game);

  assert.equal(game.state.wave, 5);
  assert.equal(game.state.asteroids.length, 0, 'zero asteroids spawned when initialCount and maxInitial are 0');
  assert.equal(game.state.ufos.length, 1, 'UFO must be spawned on wave 5');
  const ufo = game.state.ufos[0];
  assert.ok(Number.isFinite(ufo.x), 'ufo.x should be finite');
  assert.ok(Number.isFinite(ufo.y), 'ufo.y should be finite');
  assert.ok(ufo.x >= 0 && ufo.x < W, 'ufo.x should be canonical');
  assert.ok(ufo.y >= 0 && ufo.y < H, 'ufo.y should be canonical');
  const dist = torusDistance(ufo.x, ufo.y, 400, 300, W, H);
  assert.ok(dist >= cfg.ufo.safeSpawnRadius - EPS, `ufo distance (${dist}) must respect safeSpawnRadius (${cfg.ufo.safeSpawnRadius})`);
  assert.equal(ufo.spawnCollisionProtected, false, 'no asteroids → not protected');
});

// ---- P0-23: Fallback overlapping or tangent activates protection, no damage/score/effects ----

test('P0-23a: exactly tangent fallback is protected for dt beyond hit cooldown', () => {
  const cfg = cloneConfig();
  cfg.asteroid.initialCount = 0;
  cfg.asteroid.maxInitial = 1;
  cfg.asteroid.safeSpawnRadius = 0;
  cfg.ufo.asteroidCollision.spawnAttempts = 0;
  const tangentRockX = W / 2 + cfg.ufo.hunter.radius + cfg.asteroid.largeR;
  const game = createGame(cfg, makeSequenceRng([tangentRockX / W, 0.5]));
  game.start();
  game.state.ship.invuln = 0;
  game.state.ship.x = 50;
  game.state.ship.y = 50;
  game.state.wave = 4;
  game.state.asteroids = [];

  runStep(game);

  assert.equal(game.state.wave, 5);
  assert.equal(game.state.ufos.length, 1, 'UFO should be spawned by wave 5 threat spawner');
  const ufo = game.state.ufos[0];
  const rock = game.state.asteroids[0];
  assertClose(
    torusDistance(ufo.x, ufo.y, rock.x, rock.y, W, H),
    ufo.radius + rock.radius,
    EPS,
    'fallback fixture starts at exact physical tangency',
  );
  assert.equal(
    circleCollision(ufo.x, ufo.y, ufo.radius, rock.x, rock.y, rock.radius, W, H),
    true,
    'inclusive tangency counts as overlap for spawn protection',
  );
  assert.equal(ufo.spawnCollisionProtected, true, 'tangent fallback activates protection');

  ufo.speed = 0;
  rock.vx = 0;
  rock.vy = 0;

  const hpBefore = ufo.hp;
  const scoreBefore = game.state.score;

  runStep(game, cfg.ufo.asteroidCollision.hitCooldown + DT);

  assert.equal(ufo.hp, hpBefore, 'protected UFO should not lose HP');
  assert.equal(game.state.score, scoreBefore, 'no score from protected collision');
  const hits = game.state.effects.filter(e => e.kind === 'ufoHit' || e.kind === 'ufoDestroy');
  assert.equal(hits.length, 0, 'no hit/destroy effects from protected collision');
});

test('P0-23b: overlapping fallback stays harmless with multiple rocks and long dt', () => {
  const cfg = cloneConfig();
  cfg.asteroid.initialCount = 0;
  cfg.asteroid.maxInitial = 2;
  cfg.asteroid.safeSpawnRadius = 0;
  cfg.ufo.asteroidCollision.spawnAttempts = 0;
  // Rock 0 is deliberately clear at (100,100). createAsteroid consumes 14
  // draws with a 9-sided silhouette; the following two draws place rock 1 at
  // the fallback centre. Protection therefore requires scanning past rock 0.
  const game = createGame(cfg, makeSequenceRng([
    100 / W,
    100 / H,
    ...Array(14).fill(0.5),
    0.5,
    0.5,
  ]));
  game.start();
  game.state.ship.invuln = 0;
  game.state.ship.x = 50;
  game.state.ship.y = 50;
  game.state.wave = 4;
  game.state.asteroids = [];

  runStep(game);

  const ufo = game.state.ufos[0];
  const [clearRock, overlappingRock] = game.state.asteroids;
  assert.equal(game.state.asteroids.length, 2, 'fixture spawns two original rocks');
  assert.equal(
    circleCollision(
      ufo.x, ufo.y, ufo.radius,
      clearRock.x, clearRock.y, clearRock.radius,
      W, H,
    ),
    false,
    'first live rock is physically clear of the fallback',
  );
  assert.equal(
    circleCollision(
      ufo.x, ufo.y, ufo.radius,
      overlappingRock.x, overlappingRock.y, overlappingRock.radius,
      W, H,
    ),
    true,
    'later live rock physically overlaps the fallback',
  );
  assert.equal(
    ufo.spawnCollisionProtected,
    true,
    'spawner scans the full multi-rock collection before activating protection',
  );

  ufo.speed = 0;
  for (const rock of game.state.asteroids) {
    rock.vx = 0;
    rock.vy = 0;
  }
  const hpBefore = ufo.hp;
  const scoreBefore = game.state.score;
  const effectsBefore = game.state.effects.filter(
    effect => effect.kind === 'ufoHit' || effect.kind === 'ufoDestroy',
  ).length;

  runStep(game, cfg.ufo.asteroidCollision.hitCooldown + DT);

  assert.equal(ufo.hp, hpBefore, 'long protected contact with several rocks causes no damage');
  assert.equal(game.state.score, scoreBefore, 'long protected contact causes no score');
  assert.equal(
    game.state.effects.filter(
      effect => effect.kind === 'ufoHit' || effect.kind === 'ufoDestroy',
    ).length,
    effectsBefore,
    'long protected contact creates no UFO hit or death effect',
  );
});

// ---- P0-24: Protection ends after UFO leaves all rocks; subsequent collision damages ----

test('P0-24: protection ends after leaving all rocks; subsequent collision damages', () => {
  const { cfg, game } = setupGame(25, { shipX: 0, shipY: 0 });
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, protected: true });
  ufo.speed = 0;
  game.state.ufos.push(ufo);
  // The first rock is clear and the second overlaps. A broken pre-check that
  // inspects only one rock would remove protection before resolving rock 2.
  const clearRock = makeAsteroid(cfg, 'small', 650, 300, 'normal', 25, 0, 0);
  const overlappingRock = makeAsteroid(cfg, 'small', 420, 300, 'normal', 26, 0, 0);
  game.state.asteroids.push(clearRock, overlappingRock);

  runStep(game);
  assert.equal(ufo.hp, 2, 'overlap with any rock keeps protection through resolution');
  assert.equal(ufo.spawnCollisionProtected, false, 'protection clears only after final separation from both rocks');
  for (const rock of game.state.asteroids) {
    assert.equal(
      circleCollision(ufo.x, ufo.y, ufo.radius, rock.x, rock.y, rock.radius, W, H),
      false,
      'protected resolution ends outside every live rock',
    );
  }

  // The initially clear rock was never latched. Once protection has ended, its
  // first controlled contact must deal normal damage.
  ufo.x = clearRock.x;
  ufo.y = clearRock.y;
  ufo.knockbackVx = 0;
  ufo.knockbackVy = 0;
  ufo.asteroidHitCooldown = 0;
  runStep(game, 0);
  assert.equal(ufo.hp, 1, 'post-protection contact with another rock deals damage');
});

// ---- P0-25: Player-safe sample overlapping rock wins over unsafe clear sample ----

test('P0-25: player-safe sample overlapping rock wins over unsafe clear sample', () => {
  const safeOverlapping = ufoSpawnCandidate(5, 0);
  const unsafeClear = ufoSpawnCandidate(5, 1);
  const cfg = cloneConfig();
  cfg.asteroid.initialCount = 0;
  cfg.asteroid.maxInitial = 1;
  cfg.asteroid.safeSpawnRadius = 0;
  cfg.ufo.asteroidCollision.spawnAttempts = 2;
  const game = createGame(
    cfg,
    makeSequenceRng([safeOverlapping.x / W, safeOverlapping.y / H]),
  );
  game.start();
  game.state.ship.invuln = 0;
  game.state.ship.x = unsafeClear.x;
  game.state.ship.y = wrap(unsafeClear.y + cfg.ufo.safeSpawnRadius - 1, H);
  game.state.ship.vx = 0;
  game.state.ship.vy = 0;
  game.state.wave = 4;
  game.state.asteroids = [];

  runStep(game);

  assert.equal(game.state.wave, 5);
  assert.equal(game.state.ufos.length, 1, 'UFO should spawn on wave 5');
  const ufo = game.state.ufos[0];
  const rock = game.state.asteroids[0];
  const safeShipMargin = torusDistance(
    safeOverlapping.x, safeOverlapping.y,
    game.state.ship.x, game.state.ship.y,
    W, H,
  ) - cfg.ufo.safeSpawnRadius;
  const safeAsteroidMargin = torusDistance(
    safeOverlapping.x, safeOverlapping.y, rock.x, rock.y, W, H,
  ) - (ufo.radius + rock.radius + cfg.ufo.asteroidCollision.spawnClearance);
  const unsafeShipMargin = torusDistance(
    unsafeClear.x, unsafeClear.y,
    game.state.ship.x, game.state.ship.y,
    W, H,
  ) - cfg.ufo.safeSpawnRadius;
  const unsafeAsteroidMargin = torusDistance(
    unsafeClear.x, unsafeClear.y, rock.x, rock.y, W, H,
  ) - (ufo.radius + rock.radius + cfg.ufo.asteroidCollision.spawnClearance);

  assert.ok(safeShipMargin >= 0, 'candidate 0 is genuinely player-safe');
  assert.equal(
    circleCollision(
      safeOverlapping.x, safeOverlapping.y, ufo.radius,
      rock.x, rock.y, rock.radius,
      W, H,
    ),
    true,
    'candidate 0 physically overlaps the rock',
  );
  assert.ok(unsafeShipMargin < 0, 'candidate 1 is genuinely unsafe for the player');
  assert.equal(
    circleCollision(
      unsafeClear.x, unsafeClear.y, ufo.radius,
      rock.x, rock.y, rock.radius,
      W, H,
    ),
    false,
    'candidate 1 is physically free of the rock',
  );
  assert.ok(unsafeAsteroidMargin >= 0, 'candidate 1 also satisfies configured rock clearance');
  assert.ok(
    Math.min(unsafeShipMargin, unsafeAsteroidMargin)
      > Math.min(safeShipMargin, safeAsteroidMargin),
    'generic best-minimum-margin fallback would prefer the unsafe candidate',
  );

  assertClose(ufo.x, safeOverlapping.x, EPS, 'priority selects the player-safe candidate x');
  assertClose(ufo.y, safeOverlapping.y, EPS, 'priority selects the player-safe candidate y');
  assert.ok(
    torusDistance(ufo.x, ufo.y, game.state.ship.x, game.state.ship.y, W, H)
      >= cfg.ufo.safeSpawnRadius - EPS,
    'selected fallback remains player-safe',
  );
  assert.equal(
    circleCollision(ufo.x, ufo.y, ufo.radius, rock.x, rock.y, rock.radius, W, H),
    true,
    'selected fallback is physically overlapping',
  );
  assert.equal(ufo.spawnCollisionProtected, true, 'overlapping priority fallback is protected');
});

// ---- P0-26: GAME_OVER from prior offensive makes handler no-op ----

test('P0-26c: GAME_OVER from magma cascade before handler → no-op for UFO handler', () => {
  const { cfg, game } = setupGame(274, { shipX: 100, shipY: 100 });
  const ufo = makeUfo(cfg, 'hunter', 600, 400, { angle: 0, protected: true });
  ufo.knockbackVx = 15;
  ufo.knockbackVy = -10;
  ufo.asteroidHitCooldown = 0.25;
  game.state.ufos.push(ufo);

  // Position large asteroid at 640, 400 (dist=40 < radii sum 66) moving left at -3000 px/s (WOULD collide if game continued)
  const asteroid = makeAsteroid(cfg, 'large', 640, 400, 'normal', 274, -3000, 0);
  game.state.asteroids.push(asteroid);

  // Player at 1 life, ship overlaps a magma asteroid.
  game.state.lives = 1;
  game.state.ship.invuln = 0;
  game.state.ship.x = 100;
  game.state.ship.y = 100;

  // Magma asteroid on top of the ship.
  const magma = makeAsteroid(cfg, 'small', 100, 100, 'magma', 275, 0, 0);
  game.state.asteroids.push(magma);

  // Bullet to destroy the magma → chain → ship death → GAME_OVER in projectile phase.
  const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
  bullet.x = magma.x;
  bullet.y = magma.y;
  bullet.vx = 0;
  bullet.vy = 0;
  bullet.accuracyShotId = null;
  game.state.bullets.push(bullet);

  const ufoHpBefore = ufo.hp;
  const ufoCooldownBefore = ufo.asteroidHitCooldown;
  const ufoProtectedBefore = ufo.spawnCollisionProtected;
  const scoreBefore = game.state.score;
  const movementControl = structuredClone(ufo);
  const asteroidControl = structuredClone(asteroid);
  updateUfo(
    movementControl,
    DT,
    structuredClone(game.state.ship),
    cfg,
    W,
    H,
  );
  updateAsteroid(asteroidControl, DT, W, H);

  runStep(game);

  // The magma blast should kill the player → GAME_OVER.
  assert.equal(game.state.status, STATUS.GAME_OVER, 'should be GAME_OVER');
  assert.equal(
    game.state.score,
    scoreBefore + cfg.asteroid.smallPoints,
    'only the projectile-destroyed magma scores before GAME_OVER',
  );
  // All UFO collision state must be completely preserved (handler is no-op, only normal movement updateUfo ran).
  assert.equal(ufo.hp, ufoHpBefore, 'ufo hp preserved');
  assertClose(ufo.x, movementControl.x, EPS, 'ufo keeps its normal post-integration x');
  assertClose(ufo.y, movementControl.y, EPS, 'ufo keeps its normal post-integration y');
  assertClose(ufo.vx, movementControl.vx, EPS, 'ufo keeps its normal post-integration vx');
  assertClose(ufo.vy, movementControl.vy, EPS, 'ufo keeps its normal post-integration vy');
  assertClose(ufo.angle, movementControl.angle, EPS, 'ufo keeps its normal post-integration angle');
  assertClose(asteroid.x, asteroidControl.x, EPS, 'rock keeps its normal post-integration x');
  assertClose(asteroid.y, asteroidControl.y, EPS, 'rock keeps its normal post-integration y');
  assertClose(ufo.knockbackVx, movementControl.knockbackVx, EPS, 'knockbackVx matches normal damping');
  assertClose(ufo.knockbackVy, movementControl.knockbackVy, EPS, 'knockbackVy matches normal damping');
  assertClose(ufo.asteroidHitCooldown, Math.max(0, ufoCooldownBefore - DT), EPS, 'cooldown matches normal step reduction');
  assert.equal(ufo.spawnCollisionProtected, ufoProtectedBefore, 'protection preserved');
  const ufoEffects = game.state.effects.filter(e => e.kind === 'ufoHit' || e.kind === 'ufoDestroy');
  assert.equal(ufoEffects.length, 0, 'no UFO collision effects generated after GAME_OVER');

  // Resume only for this behavioral probe, preserving the same UFO/asteroid
  // identities. If the aborted handler had touched its private latch, this
  // first contact would be suppressed even though the public cooldown is reset.
  game.state.status = STATUS.PLAYING;
  game.state.lives = 1;
  game.state.ship.invuln = 999;
  game.state.asteroids = [asteroid];
  game.state.ufos = [ufo];
  Object.assign(asteroid, {
    x: 500,
    y: 300,
    vx: 0,
    vy: 0,
    alive: true,
  });
  Object.assign(ufo, {
    x: 500,
    y: 300,
    hp: 1,
    alive: true,
    speed: 0,
    knockbackVx: 0,
    knockbackVy: 0,
    asteroidHitCooldown: 0,
    spawnCollisionProtected: false,
  });
  const scoreBeforeResume = game.state.score;
  const destroysBeforeResume = game.state.effects.filter(e => e.kind === 'ufoDestroy').length;

  runStep(game, 0);

  assert.equal(ufo.alive, false, 'same pair behaves as a first contact after controlled resume');
  assert.equal(ufo.hp, 0, 'large rock deals its full first-contact damage after resume');
  assert.equal(
    game.state.score,
    scoreBeforeResume + ufo.points,
    'resumed first contact follows the normal UFO death scoring path',
  );
  assert.equal(
    game.state.effects.filter(e => e.kind === 'ufoDestroy').length,
    destroysBeforeResume + 1,
    'resumed first contact creates exactly one death effect',
  );
});

// ---- P0-27: Colliding with magma/cryo/crystal uses only size, no elemental effects ----

test('P0-27: colliding with magma asteroid uses size only, no elemental effects', () => {
  const { cfg, game } = setupGame(28);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'small', 420, 300, 'magma', 28, 0, 0);
  game.state.asteroids.push(asteroid);

  runStep(game);
  assert.equal(ufo.hp, 1, 'magma small asteroid deals 1 damage (size only)');
  // No magma explosion effect should be triggered by the collision.
  const magmaBlasts = game.state.effects.filter(e => e.kind === 'magmaExplosion');
  assert.equal(magmaBlasts.length, 0, 'no magma explosion from UFO collision');
  assert.equal(asteroid.alive, true, 'magma asteroid should not be destroyed');
});

test('P0-27b: colliding with cryo asteroid uses size only, no cloud', () => {
  const { cfg, game } = setupGame(29);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'small', 420, 300, 'cryo', 29, 0, 0);
  game.state.asteroids.push(asteroid);

  runStep(game);
  assert.equal(ufo.hp, 1, 'cryo small asteroid deals 1 damage (size only)');
  assert.equal(game.state.iceClouds.length, 0, 'no ice cloud from UFO collision');
  assert.equal(asteroid.alive, true, 'cryo asteroid should not be destroyed');
});

test('P0-27c: colliding with crystal asteroid uses size only, no special effect', () => {
  const { cfg, game } = setupGame(30);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'small', 420, 300, 'crystal', 30, 0, 0);
  game.state.asteroids.push(asteroid);

  runStep(game);
  assert.equal(ufo.hp, 1, 'crystal small asteroid deals 1 damage (size only)');
  assert.equal(asteroid.alive, true, 'crystal asteroid should not be destroyed');
  // No data node should be dropped (asteroid not destroyed).
  assert.equal(game.state.dataNodes.length, 0, 'no data node from UFO collision');
});

// ---- P0-28: Fixture without ufo.speed uses same fallback as updateUfo ----

test('P0-28: fixture without ufo.speed uses fallback, drive is identical', () => {
  const { cfg, game } = setupGame(31);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  delete ufo.speed;
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'small', 420, 300);
  game.state.asteroids.push(asteroid);

  // The UFO should function correctly with the speed fallback.
  runStep(game);
  assert.equal(ufo.hp, 1, 'ufo should take damage with speed fallback');
  assertNoNaN(ufo, 'ufo');
  // The drive should use balance.speed (the configured hunter speed).
  const expectedSpeed = cfg.ufo.hunter.speed;
  const driveSpeed = Math.hypot(ufo.vx - ufo.knockbackVx, ufo.vy - ufo.knockbackVy);
  assertClose(driveSpeed, expectedSpeed, 1e-4, 'drive speed must match hunter balance speed fallback');
  assert.ok(Number.isFinite(ufo.x) && Number.isFinite(ufo.y), 'ufo position should be finite');
});

// ---- P0-29: Dense field — geometric cleanup converges, secondary not latched ----

test('P0-29: dense field endpoint cleanup converges, secondary not latched', () => {
  function makeFixture(includeSecondaries) {
    const { cfg, game } = setupGame(32, { shipX: 100, shipY: 300 });
    const ufo = makeUfo(cfg, 'hunter', 1, 300, { angle: 0, hp: 10 });
    const primary = makeAsteroid(cfg, 'small', 33, 300, 'normal', 321, 0, 0);
    const secondaryA = makeAsteroid(cfg, 'small', W - 31, 290, 'normal', 322, 0, 0);
    const secondaryB = makeAsteroid(cfg, 'small', W - 31, 310, 'normal', 323, 0, 0);
    game.state.ufos.push(ufo);
    game.state.asteroids.push(
      primary,
      ...(includeSecondaries ? [secondaryA, secondaryB] : []),
    );
    return { cfg, game, ufo, primary, secondaryA, secondaryB };
  }

  const control = makeFixture(false);
  const dense = makeFixture(true);
  runStep(control.game);

  assert.ok(control.ufo.x > W - 2, 'primary reintegration crosses the left seam');
  for (const secondary of [dense.secondaryA, dense.secondaryB]) {
    assert.equal(
      circleCollision(
        control.ufo.x, control.ufo.y, control.ufo.radius,
        secondary.x, secondary.y, secondary.radius,
        W, H,
      ),
      true,
      'primary-only reintegration penetrates each secondary rock',
    );
  }

  runStep(dense.game);

  assertNoNaN(dense.ufo, 'ufo');
  assert.equal(control.ufo.hp, 9, 'primary-only control takes exactly one small-rock damage');
  assert.equal(dense.ufo.hp, 9, 'dense fixture still takes damage only from the primary');
  assert.ok(dense.ufo.x >= 0 && dense.ufo.x < W, 'cleanup endpoint x is canonical');
  assert.ok(dense.ufo.y >= 0 && dense.ufo.y < H, 'cleanup endpoint y is canonical');
  for (const rock of [dense.primary, dense.secondaryA, dense.secondaryB]) {
    const clearance = dense.ufo.radius + rock.radius
      + dense.cfg.ufo.asteroidCollision.separationPadding;
    assert.ok(
      torusDistance(dense.ufo.x, dense.ufo.y, rock.x, rock.y, W, H)
        >= clearance - EPS,
      'solvable dense fixture converges outside every original rock',
    );
  }

  assert.equal(dense.ufo.hp, control.ufo.hp, 'secondary cleanup does not alter HP');
  assertClose(dense.ufo.vx, control.ufo.vx, EPS, 'secondary cleanup does not alter vx');
  assertClose(dense.ufo.vy, control.ufo.vy, EPS, 'secondary cleanup does not alter vy');
  assertClose(dense.ufo.knockbackVx, control.ufo.knockbackVx, EPS, 'secondary cleanup does not alter knockbackVx');
  assertClose(dense.ufo.knockbackVy, control.ufo.knockbackVy, EPS, 'secondary cleanup does not alter knockbackVy');
  assertClose(
    dense.ufo.asteroidHitCooldown,
    control.ufo.asteroidHitCooldown,
    EPS,
    'secondary cleanup does not alter cooldown',
  );

  // Enter secondary A without crossing its release margin. If cleanup had
  // inserted A into the private contact latch, this first hit would be muted.
  const hpBeforeSecondaryEntry = dense.ufo.hp;
  dense.ufo.x = W - 31;
  dense.ufo.y = 259;
  dense.ufo.asteroidHitCooldown = 0;
  dense.game.update(0, {});
  assert.equal(
    dense.ufo.hp,
    hpBeforeSecondaryEntry - 1,
    'controlled later entry proves the secondary was not latched by cleanup',
  );
});

// ---- P1 tests: robustness and lifecycle ----

// ---- P1-30: Pause does not decay knockback, cooldown, latch, or protection ----

test('P1-30: pause preserves knockback, cooldown, latch, and protection', () => {
  const { cfg, game } = setupGame(33);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'small', 420, 300);
  game.state.asteroids.push(asteroid);

  runStep(game);
  assert.equal(ufo.hp, 1, 'first hit deals damage');
  const kbBefore = { vx: ufo.knockbackVx, vy: ufo.knockbackVy };
  const cooldownBefore = ufo.asteroidHitCooldown;
  ufo.spawnCollisionProtected = true;

  // Pause returns before any transient collision state can change.
  game.pause();
  game.update(DT, {});

  assert.equal(ufo.knockbackVx, kbBefore.vx, 'knockbackVx preserved during pause');
  assert.equal(ufo.knockbackVy, kbBefore.vy, 'knockbackVy preserved during pause');
  assert.equal(ufo.asteroidHitCooldown, cooldownBefore, 'cooldown preserved during pause');
  assert.equal(ufo.spawnCollisionProtected, true, 'spawn protection preserved during pause');

  // Behavioral latch probe: resume with the same pair overlapping and public
  // cooldown ready. Preserved contact state must still suppress repeat damage.
  game.resume();
  ufo.x = asteroid.x;
  ufo.y = asteroid.y;
  ufo.speed = 0;
  ufo.knockbackVx = 0;
  ufo.knockbackVy = 0;
  ufo.asteroidHitCooldown = 0;
  ufo.spawnCollisionProtected = false;
  game.update(0, {});
  assert.equal(ufo.hp, 1, 'same latched pair remains non-damaging after pause/resume');
});

// ---- P1-31: Resize does not alter knockback, cooldown, or flags ----

test('P1-31: resize does not alter knockback, cooldown, or protection', () => {
  const { cfg, game } = setupGame(34);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, protected: true });
  game.state.ufos.push(ufo);

  // Set some knockback and cooldown.
  ufo.knockbackVx = 50;
  ufo.knockbackVy = -30;
  ufo.asteroidHitCooldown = 0.15;

  game.resize(900, 700);

  assert.equal(ufo.knockbackVx, 50, 'knockbackVx unchanged by resize');
  assert.equal(ufo.knockbackVy, -30, 'knockbackVy unchanged by resize');
  assert.equal(ufo.asteroidHitCooldown, 0.15, 'cooldown unchanged by resize');
  assert.equal(ufo.spawnCollisionProtected, true, 'protection unchanged by resize');
  // UFO position should be canonicalized.
  assert.ok(ufo.x >= 0 && ufo.x < 900, 'ufo.x in new world bounds');
  assert.ok(ufo.y >= 0 && ufo.y < 700, 'ufo.y in new world bounds');
});

// ---- P1-32: Restart and new wave remove transient state ----

test('P1-32: restart removes old UFO with all transient state', () => {
  const { cfg, game } = setupGame(35);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  ufo.knockbackVx = 100;
  ufo.asteroidHitCooldown = 0.2;
  game.state.ufos.push(ufo);

  game.restart();

  assert.equal(game.state.ufos.length, 0, 'old UFO should be gone after restart');
  // New wave 1 has no UFOs (unlockWave = 5).
  assert.equal(game.state.wave, 1, 'wave reset to 1');
});

test('P1-32b: a resolved squad does not leak transient state into the next wave', () => {
  const { cfg, game } = setupGame(352, { shipX: 400, shipY: 300 });
  cfg.asteroid.initialCount = 0;
  cfg.asteroid.maxInitial = 0;
  cfg.asteroid.guaranteedSpecialsPerWave = 0;
  const oldUfo = makeUfo(cfg, 'hunter', 400, 200, { angle: 0, protected: true });
  oldUfo.knockbackVx = 100;
  oldUfo.knockbackVy = -40;
  oldUfo.asteroidHitCooldown = 0.2;
  game.state.ufos.push(oldUfo);
  game.state.wave = 4;
  game.state.asteroids = [];

  // A live UFO now keeps its wave active.  This test is concerned with the
  // fresh spawn's transient state, so explicitly resolve the old fixture
  // before advancing to the unlock wave.
  game.state.ufos = [];

  game.update(0, {});

  assert.equal(game.state.wave, 5, 'empty wave advances to the UFO unlock wave');
  assert.equal(game.state.ufos.length, 1, 'wave 5 creates exactly its new UFO');
  const newUfo = game.state.ufos[0];
  assert.notEqual(newUfo, oldUfo, 'old UFO identity is removed at the wave boundary');
  assert.equal(game.state.ufos.includes(oldUfo), false, 'old transient owner is absent from state');
  assert.equal(newUfo.knockbackVx, 0, 'new wave does not inherit knockbackVx');
  assert.equal(newUfo.knockbackVy, 0, 'new wave does not inherit knockbackVy');
  assert.equal(newUfo.asteroidHitCooldown, 0, 'new wave does not inherit collision cooldown');
  assert.equal(newUfo.spawnCollisionProtected, false, 'zero-rock wave does not inherit protection');
});

// ---- P1-33: UFO whose timer expired can still fire before dying in collision ----

test('P1-33: UFO fires before collision death in same step', () => {
  const { cfg, game } = setupGame(36, { shipX: 400, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 400, 200, { angle: 0, hp: 1 });
  // Set fire timer to 0 so it fires this step.
  ufo.fireTimer = 0;
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'large', 400, 170, 'normal', 36, 0, 0);
  game.state.asteroids.push(asteroid);

  const bulletsBefore = game.state.enemyBullets.length;
  runStep(game);

  // The UFO should have fired (updateUfoThreats runs before collision handler).
  assert.ok(
    game.state.enemyBullets.length > bulletsBefore,
    'UFO should fire before dying in collision',
  );
  assert.equal(ufo.alive, false, 'UFO should be dead from large asteroid');
});

// ---- P1-34: Spawn search is reproducible ----

test('P1-34: spawn search is reproducible for same wave and asteroids', () => {
  const { cfg, game } = setupGame(37, { shipX: 400, shipY: 300 });
  cfg.asteroid.initialCount = 4;

  // Run to wave 5 twice with the same seed.
  const { game: game1 } = setupGame(37, { shipX: 400, shipY: 300 });
  game1.state.wave = 4;
  game1.state.asteroids = [];
  runStep(game1);
  const ufo1 = game1.state.ufos[0];

  const { game: game2 } = setupGame(37, { shipX: 400, shipY: 300 });
  game2.state.wave = 4;
  game2.state.asteroids = [];
  runStep(game2);
  const ufo2 = game2.state.ufos[0];

  assert.ok(ufo1 && ufo2, 'both should spawn a UFO');
  assertClose(ufo1.x, ufo2.x, EPS, 'same x for same seed');
  assertClose(ufo1.y, ufo2.y, EPS, 'same y for same seed');
});

// ---- P1-35: Endpoint at exact clearance stays unchanged; penetration ties use asteroidIndex ----

test('P1-35: endpoint at clearance is stable, penetration ties use asteroidIndex', () => {
  const { cfg, game } = setupGame(38);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  const primary = makeAsteroid(cfg, 'small', 420, 300, 'normal', 381, 0, 0);
  const atClearance = makeAsteroid(cfg, 'small', 355, 300, 'normal', 382, 0, 0);
  game.state.ufos.push(ufo);
  game.state.asteroids.push(primary, atClearance);

  runStep(game, 0);

  const clearance = ufo.radius + primary.radius
    + cfg.ufo.asteroidCollision.separationPadding;
  assert.equal(ufo.hp, 1, 'primary impact proves endpoint cleanup was invoked');
  assertClose(ufo.x, 387.5, EPS, 'impact creates the intended shared-clearance endpoint');
  assertClose(ufo.y, 300, EPS);
  assertClose(
    torusDistance(ufo.x, ufo.y, primary.x, primary.y, W, H),
    clearance,
    EPS,
    'primary remains exactly at clearance',
  );
  assertClose(
    torusDistance(ufo.x, ufo.y, atClearance.x, atClearance.y, W, H),
    clearance,
    EPS,
    'secondary already at clearance does not move the endpoint',
  );

  function runTieFixture(firstSecondary) {
    const { cfg: tieCfg, game: tieGame } = setupGame(382);
    const tieUfo = makeUfo(tieCfg, 'hunter', 400, 300, { angle: 0, hp: 10 });
    const tiePrimary = makeAsteroid(tieCfg, 'small', 420, 300, 'normal', 383, 0, 0);
    const rockA = makeAsteroid(tieCfg, 'small', 389.5, 300, 'normal', 384, 0, 0);
    const rockB = makeAsteroid(tieCfg, 'small', 387.5, 302, 'normal', 385, 0, 0);
    tieGame.state.ufos.push(tieUfo);
    tieGame.state.asteroids.push(
      tiePrimary,
      ...(firstSecondary === 'A' ? [rockA, rockB] : [rockB, rockA]),
    );

    // The primary contact endpoint is (387.5, 300); A and B are exactly two
    // pixels from it, so only asteroidIndex can break their penetration tie.
    assert.equal(torusDistance(387.5, 300, rockA.x, rockA.y, W, H), 2);
    assert.equal(torusDistance(387.5, 300, rockB.x, rockB.y, W, H), 2);
    tieGame.update(0, {});
    return tieUfo;
  }

  const aFirst = runTieFixture('A');
  const bFirst = runTieFixture('B');
  assertNoNaN(aFirst, 'aFirst');
  assertNoNaN(bFirst, 'bFirst');
  assert.ok(
    aFirst.x < 360 && Math.abs(aFirst.y - 300) < 1,
    'lower-index A resolves the exact tie along A’s horizontal axis',
  );
  assert.ok(
    bFirst.y < 270 && Math.abs(bFirst.x - 387.5) < 1,
    'lower-index B resolves the exact tie along B’s vertical axis',
  );
  assert.ok(
    torusDistance(aFirst.x, aFirst.y, bFirst.x, bFirst.y, W, H) > 30,
    'swapping only asteroidIndex makes the tie-break outcome observable',
  );
});

// ---- P1-36: Geometric cleanup revisits rocks across toroidal seam ----

test('P1-36: cleanup revisits rocks when projection reopens previous across seam', () => {
  const { cfg, game } = setupGame(39, { shipX: 0, shipY: 0 });
  const ufo = makeUfo(cfg, 'hunter', W - 10, 300, { angle: 0, vx: 0, vy: 0 });
  const rockA = makeAsteroid(cfg, 'small', W - 35, 300, 'normal', 391, 0, 0);
  const rockB = makeAsteroid(cfg, 'small', 7.5, 290, 'normal', 392, 0, 0);
  game.state.ufos.push(ufo);
  game.state.asteroids.push(rockA, rockB);

  const clearance = ufo.radius + rockA.radius
    + cfg.ufo.asteroidCollision.separationPadding;
  function projectOutside(point, rock) {
    const dx = torusDelta(rock.x, point.x, W);
    const dy = torusDelta(rock.y, point.y, H);
    const length = Math.hypot(dx, dy);
    return {
      x: wrap(rock.x + (dx / length) * clearance, W),
      y: wrap(rock.y + (dy / length) * clearance, H),
    };
  }

  const primaryContact = { x: 797.5, y: 300 };
  const afterRockB = projectOutside(primaryContact, rockB);
  assert.ok(
    torusDistance(afterRockB.x, afterRockB.y, rockA.x, rockA.y, W, H) < clearance,
    'projecting out of seam-side B reopens primary A',
  );
  const afterRevisitedA = projectOutside(afterRockB, rockA);
  assert.ok(
    torusDistance(afterRevisitedA.x, afterRevisitedA.y, rockB.x, rockB.y, W, H) < clearance,
    'revisiting A reopens seam-side B again',
  );
  const converged = projectOutside(afterRevisitedA, rockB);

  runStep(game, 0);

  assertNoNaN(ufo, 'ufo');
  assert.ok(ufo.x >= 0 && ufo.x < W, 'ufo.x within toroidal bounds');
  assert.ok(ufo.y >= 0 && ufo.y < H, 'ufo.y within toroidal bounds');
  assertClose(ufo.x, converged.x, EPS, 'cleanup reaches the expected revisited x');
  assertClose(ufo.y, converged.y, EPS, 'cleanup reaches the expected revisited y');
  for (const rock of [rockA, rockB]) {
    assert.ok(
      torusDistance(ufo.x, ufo.y, rock.x, rock.y, W, H) >= clearance - EPS,
      'revisited cleanup converges outside both seam-adjacent rocks',
    );
  }
});

// ---- P1-37: Pathological cluster restores minimum overlapScore and recovers next step ----

test('P1-37: capped pathological cleanup restores reproducible minimum score', { timeout: 1000 }, () => {
  const rockPositions = [
    [420, 300],
    [376.8360230512917, 262.23606122657657],
    [438.5359308356419, 314.68472393229604],
    [382.6124482508749, 292.5963600538671],
    [389.49211358558387, 332.54414359107614],
  ];

  function makePathologicalFixture(seed) {
    const { cfg, game } = setupGame(seed);
    // This fixture isolates the capped UFO cleanup algorithm with deliberately
    // overlapping static obstacles. Rock-on-rock rebound is a separate system.
    cfg.asteroid.collision.enabled = false;
    const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, hp: 10 });
    const rocks = rockPositions.map(([x, y], index) =>
      makeAsteroid(cfg, 'small', x, y, 'normal', 400 + index, 0, 0));
    game.state.ufos.push(ufo);
    game.state.asteroids.push(...rocks);
    return { cfg, game, ufo, rocks };
  }

  function overlapScore(fixture, point) {
    return fixture.rocks.reduce((score, rock) => {
      const clearance = fixture.ufo.radius + rock.radius
        + fixture.cfg.ufo.asteroidCollision.separationPadding;
      const penetration = Math.max(
        0,
        clearance - torusDistance(point.x, point.y, rock.x, rock.y, W, H),
      );
      return score + penetration ** 2;
    }, 0);
  }

  const first = makePathologicalFixture(40);
  const repeat = makePathologicalFixture(401);
  first.game.update(0, {});
  repeat.game.update(0, {});

  // For this fixed 20-projection trace, the lowest candidate is reached after
  // projection 1. Projection 20 is deliberately worse, so returning the last
  // endpoint instead of the recorded minimum is observable.
  const expectedBest = {
    x: 400.51775298610846,
    y: 319.71922978290615,
  };
  const rawTerminalCandidate = {
    x: 388.3419124525328,
    y: 307.34952330677993,
  };
  assertClose(overlapScore(first, expectedBest), 265.8075898496975, 1e-7);
  assertClose(overlapScore(first, rawTerminalCandidate), 330.98673613301185, 1e-7);
  assert.ok(
    overlapScore(first, expectedBest) < overlapScore(first, rawTerminalCandidate),
    'recorded candidate has lower overlapScore than the capped terminal projection',
  );
  assertClose(first.ufo.x, expectedBest.x, 1e-7, 'cleanup restores minimum-score x');
  assertClose(first.ufo.y, expectedBest.y, 1e-7, 'cleanup restores minimum-score y');
  assertClose(repeat.ufo.x, first.ufo.x, EPS, 'pathological endpoint x is reproducible');
  assertClose(repeat.ufo.y, first.ufo.y, EPS, 'pathological endpoint y is reproducible');
  assertNoNaN(first.ufo, 'ufo');
  assert.ok(first.ufo.x >= 0 && first.ufo.x < W, 'best-effort x remains canonical');
  assert.ok(first.ufo.y >= 0 && first.ufo.y < H, 'best-effort y remains canonical');

  const residualSecondary = first.rocks[4];
  assert.equal(
    circleCollision(
      first.ufo.x, first.ufo.y, first.ufo.radius,
      residualSecondary.x, residualSecondary.y, residualSecondary.radius,
      W, H,
    ),
    true,
    'pathological cap intentionally leaves a physical secondary overlap',
  );

  // Preserve the residual pair and remove competing rocks so the next fixed
  // step directly observes that cleanup did not latch the secondary.
  const hpBeforeResidual = first.ufo.hp;
  first.game.state.asteroids = [residualSecondary];
  first.ufo.asteroidHitCooldown = 0;
  first.game.update(0, {});
  assert.equal(
    first.ufo.hp,
    hpBeforeResidual - 1,
    'residual secondary overlap is eligible on the next step',
  );
});

// ---- P1-38: Coincident centres with secondary frozen rock — no NaN ----

test('P1-39: hunter fires at and clears an asteroid that blocks its route', () => {
  const { cfg, game } = setupGame(42, { shipX: 600, shipY: 300 });
  game.state.ship.invuln = 10;
  const ufo = makeUfo(cfg, 'hunter', 200, 300, {
    angle: 0,
    vx: cfg.ufo.hunter.speed,
    vy: 0,
    avoidance: true,
  });
  ufo.fireTimer = 0;
  const rock = makeAsteroid(cfg, 'small', 330, 300, 'normal', 42, 0, 0);
  game.state.ufos.push(ufo);
  game.state.asteroids.push(rock);

  runStep(game);
  assert.equal(game.state.enemyBullets.length, 1,
    'imminent obstacle should receive the hunter\'s first shot');
  const shot = game.state.enemyBullets[0];
  assert.ok(Math.abs(shot.vy) < 8,
    'defensive shot should aim at the rock instead of the off-axis ship');

  for (let step = 0; step < 40 && rock.alive; step++) runStep(game);

  assert.equal(rock.alive, false, 'enemy projectile should destroy a blocking small asteroid');
  assert.equal(game.state.score, 0, 'enemy-cleared rocks must not award player score');
  assert.equal(game.state.lives, cfg.game.lives, 'the blocked shot must not damage the ship');
});

test('P1-38: frozen coincident secondary uses zero velocity and excludes new fragments', () => {
  const { cfg, game } = setupGame(41, { shipX: 700, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, hp: 10 });
  const primary = makeAsteroid(cfg, 'small', 420, 300, 'normal', 411, 0, 0);
  const parent = makeAsteroid(cfg, 'large', 352.5, 300, 'normal', 412, 0, 0);
  const frozenSecondary = makeAsteroid(
    cfg, 'small', 352.5, 300, 'normal', 413, 0, 1000,
  );
  frozenSecondary.stun = 1;
  game.state.ufos.push(ufo);
  // Parent precedes the frozen secondary in the snapshot but is destroyed by
  // the projectile phase, leaving only the secondary in endpoint cleanup.
  game.state.asteroids.push(primary, parent, frozenSecondary);

  const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
  bullet.x = parent.x - 40;
  bullet.y = parent.y;
  bullet.vx = 0;
  bullet.vy = 0;
  bullet.accuracyShotId = null;
  game.state.bullets.push(bullet);

  game.update(0.5, {});

  assert.equal(ufo.hp, 9, 'only the primary original rock deals damage');
  assertClose(ufo.x, 385, EPS, 'frozen zero-velocity fallback projects horizontally');
  assertClose(ufo.y, 300, EPS, 'frozen zero-velocity fallback has no vertical component');
  assertNoNaN(ufo, 'ufo');
  assertNoNaN(primary, 'primary');
  assertNoNaN(frozenSecondary, 'frozenSecondary');
  assertClose(frozenSecondary.x, 352.5, EPS, 'secondary stays frozen at its original x');
  assertClose(frozenSecondary.y, 300, EPS, 'secondary stays frozen at its original y');
  assert.equal(frozenSecondary.vy, 1000, 'stored future velocity remains unchanged');
  assertClose(frozenSecondary.stun, 0.5, EPS, 'secondary remains frozen at endpoint');

  // Had cleanup used stored vy=1000 instead of effective zero, the projection
  // would be near (354.77, 332.42), not the exact horizontal endpoint above.
  const incorrectMovingProjection = { x: 354.769447, y: 332.420666 };
  assert.ok(
    torusDistance(ufo.x, ufo.y, incorrectMovingProjection.x, incorrectMovingProjection.y, W, H) > 40,
    'result is discriminant from a fallback using the future moving velocity',
  );

  const fragments = game.state.asteroids.filter(
    asteroid => asteroid !== primary && asteroid !== frozenSecondary,
  );
  assert.equal(parent.alive, false, 'large parent is destroyed before endpoint cleanup');
  assert.equal(fragments.length, cfg.asteroid.childrenPerSplit, 'parent creates two medium fragments');
  for (const fragment of fragments) {
    assert.equal(fragment.size, 'medium');
    assertClose(fragment.x, parent.x, EPS);
    assertClose(fragment.y, parent.y, EPS);
    assert.equal(
      circleCollision(
        ufo.x, ufo.y, ufo.radius,
        fragment.x, fragment.y, fragment.radius,
        W, H,
      ),
      true,
      'new fragment still overlaps final UFO because cleanup excluded it',
    );
  }
});
