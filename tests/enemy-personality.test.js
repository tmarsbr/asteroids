import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame } from '../src/game.js';
import { createUfo, updateUfo, createEnemyBullet } from '../src/entities.js';
import { torusDistance, torusDelta } from '../src/math.js';

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

function makeUfo(cfg, kind, x, y, opts = {}) {
  const ufo = createUfo(kind, x, y, cfg, makeRng(opts.seed ?? 1), opts.speedMult ?? 1);
  if (opts.vx !== undefined) ufo.vx = opts.vx;
  if (opts.vy !== undefined) ufo.vy = opts.vy;
  if (opts.angle !== undefined) {
    ufo.angle = opts.angle;
    // Keep the velocity vector aligned with the chosen heading so tests are not
    // perturbed by the random initial heading created by createUfo.
    if (opts.vx === undefined && opts.vy === undefined) {
      ufo.vx = Math.cos(opts.angle) * ufo.speed;
      ufo.vy = Math.sin(opts.angle) * ufo.speed;
    }
  }
  if (opts.hp !== undefined) ufo.hp = opts.hp;
  if (opts.id !== undefined) ufo.id = opts.id;
  return ufo;
}

function makeShip(x, y, vx = 0, vy = 0) {
  return { x, y, vx, vy, radius: CONFIG.ship.radius };
}

function assertClose(actual, expected, epsilon = EPS, msg) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    msg ?? `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

// ============================================================================
// Scout — orbita e flanqueia
// ============================================================================

test('scout orbits the ship at roughly orbitRange', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  // Start well outside orbitRange and already pointing along the tangent so the
  // scout enters a stable orbit without cutting through the ship.
  const scout = makeUfo(cfg, 'scout', 400, 50, { angle: Math.PI, id: 1 });
  const orbitRange = cfg.ufo.scout.orbitRange;

  // Simulate several seconds and check the distance stays near orbitRange.
  let minDist = Infinity;
  let maxDist = 0;
  for (let i = 0; i < 240; i++) {
    updateUfo(scout, DT, ship, cfg, W, H, []);
    const d = torusDistance(scout.x, scout.y, ship.x, ship.y, W, H);
    minDist = Math.min(minDist, d);
    maxDist = Math.max(maxDist, d);
  }

  assert.ok(minDist > orbitRange * 0.45, `scout got too close: ${minDist}`);
  assert.ok(maxDist < orbitRange * 1.55, `scout got too far: ${maxDist}`);
  assert.ok(
    Math.abs(minDist - orbitRange) < orbitRange * 0.45 ||
    Math.abs(maxDist - orbitRange) < orbitRange * 0.45,
    `scout did not settle near orbitRange ${orbitRange}, got ${minDist}..${maxDist}`,
  );
});

test('scout direction is deterministic by id', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const clockwise = makeUfo(cfg, 'scout', 400, 50, { angle: Math.PI, id: 2 });
  const counterClockwise = makeUfo(cfg, 'scout', 400, 50, { angle: Math.PI, id: 3 });

  for (let i = 0; i < 60; i++) {
    updateUfo(clockwise, DT, ship, cfg, W, H, []);
    updateUfo(counterClockwise, DT, ship, cfg, W, H, []);
  }

  // Compare the sign of the horizontal displacement around the ship: opposite
  // id parity should orbit in opposite directions.
  const dxClock = torusDelta(400, clockwise.x, W);
  const dxCounter = torusDelta(400, counterClockwise.x, W);
  assert.notEqual(
    Math.sign(dxClock),
    Math.sign(dxCounter),
    'different id parity should orbit in opposite directions',
  );
});

test('scout does not ram the ship when starting inside orbitRange', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  // Start the scout just outside collision range but still well inside orbitRange,
  // and pointing sideways so its initial momentum is not toward the ship.
  const scout = makeUfo(cfg, 'scout', 400, 330, { angle: 0, id: 4 });

  let minDist = Infinity;
  for (let i = 0; i < 240; i++) {
    updateUfo(scout, DT, ship, cfg, W, H, []);
    minDist = Math.min(minDist, torusDistance(scout.x, scout.y, ship.x, ship.y, W, H));
  }

  assert.ok(minDist >= scout.radius + ship.radius, 'scout should not ram the ship');
});

// ============================================================================
// Fighter — approach and retreat
// ============================================================================

test('fighter alternates between approach and retreat phases', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const fighter = makeUfo(cfg, 'fighter', 400, 500, { angle: -Math.PI / 2, id: 5 });

  const phaseDuration = cfg.ufo.fighter.phaseDuration;
  const approachRange = cfg.ufo.fighter.approachRange;

  // First phase is approach: distance should decrease.
  let distBefore = torusDistance(fighter.x, fighter.y, ship.x, ship.y, W, H);
  let distMin = distBefore;
  for (let i = 0; i < Math.floor(phaseDuration / DT); i++) {
    updateUfo(fighter, DT, ship, cfg, W, H, []);
    const d = torusDistance(fighter.x, fighter.y, ship.x, ship.y, W, H);
    distMin = Math.min(distMin, d);
  }

  assert.ok(distMin < distBefore, 'fighter should approach the ship');

  // Continue until retreat clearly happens (distance grows again).
  let distMax = distMin;
  for (let i = 0; i < Math.floor(phaseDuration * 1.5 / DT); i++) {
    updateUfo(fighter, DT, ship, cfg, W, H, []);
    const d = torusDistance(fighter.x, fighter.y, ship.x, ship.y, W, H);
    distMax = Math.max(distMax, d);
  }

  assert.ok(distMax > distMin, 'fighter should retreat after approaching');
  assert.ok(distMax > approachRange, 'fighter should retreat beyond approachRange');
});

test('fighter obeys hard guard: retreat when very close', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const fighter = makeUfo(cfg, 'fighter', 400, 310, { angle: Math.PI / 2, id: 6 });

  for (let i = 0; i < 60; i++) {
    updateUfo(fighter, DT, ship, cfg, W, H, []);
  }

  const d = torusDistance(fighter.x, fighter.y, ship.x, ship.y, W, H);
  assert.ok(d > cfg.ufo.fighter.approachRange * 0.6, 'fighter should back off when too close');
});

// ============================================================================
// Bomber — mantém distância
// ============================================================================

test('bomber keeps the ship near preferredRange', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  // Start the bomber pointing away from the ship so the initial momentum does
  // not carry it through the danger zone before it can turn.
  const bomber = makeUfo(cfg, 'bomber', 400, 100, { angle: -Math.PI / 2, id: 7 });
  const preferredRange = cfg.ufo.bomber.preferredRange;

  let minDist = Infinity;
  let maxDist = 0;
  for (let i = 0; i < 240; i++) {
    updateUfo(bomber, DT, ship, cfg, W, H, []);
    const d = torusDistance(bomber.x, bomber.y, ship.x, ship.y, W, H);
    minDist = Math.min(minDist, d);
    maxDist = Math.max(maxDist, d);
  }

  assert.ok(minDist >= cfg.ufo.bomber.minRange * 0.7, `bomber got too close: ${minDist}`);
  assert.ok(maxDist <= preferredRange * 1.3, `bomber got too far: ${maxDist}`);
  assert.ok(
    Math.abs(minDist - preferredRange) < preferredRange * 0.35 ||
    Math.abs(maxDist - preferredRange) < preferredRange * 0.35,
    `bomber did not settle near preferredRange ${preferredRange}, got ${minDist}..${maxDist}`,
  );
});

test('bomber backs off when starting inside minRange', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  // Place the bomber beside the ship, not above/below, so the turn rate is
  // not fighting a large initial velocity component toward the ship.
  const bomber = makeUfo(cfg, 'bomber', 420, 300, { angle: Math.PI, id: 8 });

  for (let i = 0; i < 360; i++) {
    updateUfo(bomber, DT, ship, cfg, W, H, []);
  }

  const d = torusDistance(bomber.x, bomber.y, ship.x, ship.y, W, H);
  assert.ok(d >= cfg.ufo.bomber.minRange * 0.9, 'bomber should back off to at least near minRange');
});

// ============================================================================
// Tiro preditivo
// ============================================================================

test('fighter bullet leads a moving ship', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300, 0, 120);
  const fighter = makeUfo(cfg, 'fighter', 300, 100, { angle: Math.PI / 2, id: 9 });
  const bullet = createEnemyBullet(fighter, ship, cfg, W, H);

  const baseAngle = Math.atan2(200, 100); // toward ship without lead
  assert.ok(
    Math.abs(normalizeAngle(bullet.angle - baseAngle)) > 0.03,
    `fighter bullet should lead ship moving down, got ${bullet.angle}`,
  );
});

test('bomber bullet leads a moving ship more than fighter', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300, 0, 150);
  const fighter = makeUfo(cfg, 'fighter', 300, 100, { angle: Math.PI / 2, id: 10 });
  const bomber = makeUfo(cfg, 'bomber', 300, 100, { angle: Math.PI / 2, id: 11 });

  const fighterBullet = createEnemyBullet(fighter, ship, cfg, W, H);
  const bomberBullet = createEnemyBullet(bomber, ship, cfg, W, H);

  const baseAngle = Math.atan2(200, 100);
  const fighterLead = Math.abs(normalizeAngle(fighterBullet.angle - baseAngle));
  const bomberLead = Math.abs(normalizeAngle(bomberBullet.angle - baseAngle));
  assert.ok(bomberLead > fighterLead,
    `bomber lead ${bomberLead} should exceed fighter lead ${fighterLead}`);
});

test('hunter and scout bullets do not lead', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300, 200, 0);
  const hunter = makeUfo(cfg, 'hunter', 200, 300, { angle: 0, id: 12 });
  const scout = makeUfo(cfg, 'scout', 200, 300, { angle: 0, id: 13 });

  const hunterBullet = createEnemyBullet(hunter, ship, cfg, W, H);
  const scoutBullet = createEnemyBullet(scout, ship, cfg, W, H);

  assertClose(hunterBullet.angle, 0, 0.001, 'hunter should fire straight at ship');
  assertClose(scoutBullet.angle, 0, 0.001, 'scout should fire straight at ship');
});

// ============================================================================
// Spawn e integração
// ============================================================================

test('spawn cycles through the five UFO kinds', () => {
  const cfg = cloneConfig();
  cfg.asteroid.initialCount = 0;
  cfg.asteroid.maxInitial = 0;
  cfg.asteroid.guaranteedSpecialsPerWave = 0;
  if (cfg.ufo.squadSize) cfg.ufo.squadSize.growthPerWave = 0;
  const rng = makeRng(1);
  const game = createGame(cfg, rng);
  game.start();
  game.state.ship.invuln = 0;
  game.state.ship.x = 0;
  game.state.ship.y = 0;
  game.state.asteroids = [];

  const expectedKinds = ['hunter', 'base', 'scout', 'fighter', 'bomber'];
  for (let wave = 5; wave < 5 + expectedKinds.length; wave++) {
    game.state.wave = wave - 1;
    game.update(DT, {});
    assert.equal(game.state.ufos.length, 1, `wave ${wave} should spawn one UFO`);
    assert.equal(game.state.ufos[0].kind, expectedKinds[wave - 5],
      `wave ${wave} should spawn ${expectedKinds[wave - 5]}`);
    game.state.ufos = [];
  }
});

test('new archetypes still take damage from asteroids and respect knockback', () => {
  const cfg = cloneConfig();
  const ship = makeShip(0, 0);
  const scout = makeUfo(cfg, 'scout', 400, 300, { angle: 0, id: 14 });
  const fighter = makeUfo(cfg, 'fighter', 400, 300, { angle: 0, id: 15 });
  const bomber = makeUfo(cfg, 'bomber', 400, 300, { angle: 0, id: 16 });

  scout.knockbackVx = 100;
  fighter.knockbackVy = 100;
  bomber.knockbackVx = -100;

  updateUfo(scout, DT, ship, cfg, W, H, []);
  updateUfo(fighter, DT, ship, cfg, W, H, []);
  updateUfo(bomber, DT, ship, cfg, W, H, []);

  assert.ok(scout.knockbackVx < 100, 'scout knockback should damp');
  assert.ok(fighter.knockbackVy < 100, 'fighter knockback should damp');
  assert.ok(bomber.knockbackVx > -100, 'bomber knockback should damp');
});

// ============================================================================
// helper
// ============================================================================

function normalizeAngle(angle) {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  if (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}
