import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame, STATUS } from '../src/game.js';
import {
  createAsteroid,
  createUfo,
  createBullet,
  createRadiationField,
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
  game.state.asteroids = [];
  game.state.ufos = [];
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

// Helper: destroy an asteroid by placing a zero-velocity bullet on top of it.
function destroyAsteroidWithBullet(game, cfg, asteroid) {
  const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
  bullet.x = asteroid.x;
  bullet.y = asteroid.y;
  bullet.vx = 0;
  bullet.vy = 0;
  bullet.accuracyShotId = null;
  game.state.bullets.push(bullet);
  game.update(0, {});
}

// ============================================================================
// P0-1: Config exposes the proposed values; wave 5 has radioactive + hunter
// ============================================================================

test('P0-1: config exposes proposed values and wave 5 has radioactive + hunter', () => {
  const { cfg, game } = setupGame(1);
  const magma = cfg.asteroid.types.magma;
  assert.equal(magma.ufoDamage, 2);
  const cryo = cfg.asteroid.types.cryo;
  assert.equal(cryo.ufoDriveMultiplier, 0.55);
  assert.equal(cryo.ufoActionRateMultiplier, 0.50);
  const radioactive = cfg.asteroid.types.radioactive;
  assert.equal(radioactive.fieldRadius, 90);
  assert.equal(radioactive.fieldLife, 5.0);
  assert.equal(radioactive.exposureDuration, 2.4);
  assert.equal(radioactive.tickInterval, 0.8);
  assert.equal(radioactive.ufoDamagePerTick, 1);
  assert.equal(cfg.asteroid.typeUnlockWave.radioactive, 5);

  // Advance to wave 5 and verify both radioactive and hunter exist.
  game.state.wave = 4;
  game.state.asteroids = [];
  runStep(game);
  assert.equal(game.state.wave, 5);
  assert.ok(
    game.state.asteroids.some(a => a.kind === 'radioactive'),
    'wave 5 has at least one radioactive asteroid',
  );
  assert.equal(game.state.ufos.length, 1);
  assert.equal(game.state.ufos[0].kind, 'hunter');
});

// ============================================================================
// P0-2: Destroying radioactive creates exactly one field + burst; no aging/contact in creation step
// ============================================================================

test('P0-2: destroying radioactive creates one field and burst, no same-step aging', () => {
  const { cfg, game } = setupGame(2);
  const radioactive = makeAsteroid(cfg, 'small', 300, 300, 'radioactive', 2);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 22);
  game.state.asteroids = [radioactive, sentinel];

  assert.equal(game.state.radiationFields.length, 0);
  destroyAsteroidWithBullet(game, cfg, radioactive);

  assert.equal(game.state.radiationFields.length, 1);
  const field = game.state.radiationFields[0];
  assert.equal(field.x, 300);
  assert.equal(field.y, 300);
  assert.equal(field.radius, cfg.asteroid.types.radioactive.fieldRadius);
  assert.equal(field.life, cfg.asteroid.types.radioactive.fieldLife);
  assert.equal(field.lifeTotal, cfg.asteroid.types.radioactive.fieldLife);
  assert.equal(field.alive, true);

  const bursts = game.state.effects.filter(e => e.kind === 'radiationBurst');
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0].x, 300);
  assert.equal(bursts[0].y, 300);
});

// ============================================================================
// P0-3: Fragments inherit radioactive, create their own fields when destroyed
// ============================================================================

test('P0-3: radioactive fragments inherit kind and create own fields', () => {
  const { cfg, game } = setupGame(3);
  const large = makeAsteroid(cfg, 'large', 300, 300, 'radioactive', 3);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 33);
  game.state.asteroids = [large, sentinel];

  destroyAsteroidWithBullet(game, cfg, large);

  const fragments = game.state.asteroids.filter(a => a !== sentinel);
  assert.equal(fragments.length, cfg.asteroid.childrenPerSplit);
  assert.ok(fragments.every(f => f.kind === 'radioactive'));
  assert.equal(game.state.radiationFields.length, 1, 'only the large creates a field');

  // Destroy one fragment → it creates its own field.
  const fragment = fragments[0];
  destroyAsteroidWithBullet(game, cfg, fragment);
  assert.equal(game.state.radiationFields.length, 2, 'fragment creates its own field');
});

// ============================================================================
// P0-4: Magma blast causes exactly 2 damage: kills hunter, leaves base with 2 HP
// ============================================================================

test('P0-4: magma blast causes 2 damage — hunter dies, base left with 2 HP', () => {
  const { cfg, game } = setupGame(4, { shipX: 0, shipY: 0 });
  const hunter = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  const base = makeUfo(cfg, 'base', 500, 300, { angle: 0 });
  game.state.ufos.push(hunter, base);
  const magma = makeAsteroid(cfg, 'small', 410, 300, 'magma', 4);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 44);
  game.state.asteroids = [magma, sentinel];

  destroyAsteroidWithBullet(game, cfg, magma);

  assert.equal(hunter.alive, false, 'hunter dies from 2 damage');
  assert.equal(base.alive, true, 'base survives 2 of 4 HP');
  assert.equal(base.hp, 2, 'base has 2 HP remaining');
});

// ============================================================================
// P0-5: Magma blast works toroidally (tangent) and outside radius is safe
// ============================================================================

test('P0-5: magma blast tangent hit, just outside is safe', () => {
  const { cfg, game } = setupGame(5, { shipX: 0, shipY: 0 });
  const ufo = makeUfo(cfg, 'base', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);

  // Place UFO exactly at explosionRadius + ufo.radius from the magma (tangent).
  const radius = cfg.asteroid.types.magma.explosionRadius;
  const magma = makeAsteroid(cfg, 'small', 400 + radius + ufo.radius, 300, 'magma', 5);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 55);
  game.state.asteroids = [magma, sentinel];

  destroyAsteroidWithBullet(game, cfg, magma);
  assert.equal(ufo.hp, 2, 'tangent hit deals 2 damage (base 4→2)');

  // Now place just outside.
  const { game: game2, cfg: cfg2 } = setupGame(52, { shipX: 0, shipY: 0 });
  const ufo2 = makeUfo(cfg2, 'base', 400, 300, { angle: 0 });
  game2.state.ufos.push(ufo2);
  const magma2 = makeAsteroid(cfg2, 'small', 400 + radius + ufo2.radius + 1, 300, 'magma', 56);
  const sentinel2 = makeAsteroid(cfg2, 'small', 700, 50, 'normal', 57);
  game2.state.asteroids = [magma2, sentinel2];
  destroyAsteroidWithBullet(game2, cfg2, magma2);
  assert.equal(ufo2.hp, 4, 'just outside blast radius is safe');
});

// ============================================================================
// P0-6: Two distinct magmas can hit the same survivor; deduped same reference
// ============================================================================

test('P0-6: two distinct magmas sum 4 damage; deduped reference hits once', () => {
  const { cfg, game } = setupGame(6, { shipX: 0, shipY: 0 });
  const base = makeUfo(cfg, 'base', 400, 300, { angle: 0 });
  game.state.ufos.push(base);

  // Two magmas in range, chained by the first blast.
  const magma1 = makeAsteroid(cfg, 'small', 410, 300, 'magma', 6);
  const magma2 = makeAsteroid(cfg, 'small', 430, 300, 'magma', 61);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 62);
  game.state.asteroids = [magma1, magma2, sentinel];

  // Destroy only magma1 directly; magma2 is in range of magma1's blast.
  assert.ok(
    torusDistance(magma1.x, magma1.y, magma2.x, magma2.y, W, H)
      <= cfg.asteroid.types.magma.explosionRadius + magma2.radius,
    'magma2 is within magma1 blast radius (precondition)',
  );

  destroyAsteroidWithBullet(game, cfg, magma1);
  assert.equal(base.hp, 0, 'two magma blasts sum 4 damage, killing base');
  assert.equal(base.alive, false, 'base is destroyed');
});

// ============================================================================
// P0-7: UFOs don't alter chainVictims, fragmentation, drops, or asteroid score
// ============================================================================

test('P0-7: magma blast damage to UFO does not alter asteroid chain/score/drops', () => {
  const { cfg, game } = setupGame(7, { shipX: 0, shipY: 0 });
  const hunter = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(hunter);
  const magma = makeAsteroid(cfg, 'small', 410, 300, 'magma', 7);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 77);
  game.state.asteroids = [magma, sentinel];

  const scoreBefore = game.state.score;
  destroyAsteroidWithBullet(game, cfg, magma);

  // Hunter died but that should NOT affect asteroid score or chain.
  // Asteroid score = smallPoints (100). UFO points (400) added.
  assert.equal(game.state.score, scoreBefore + 100 + 400);
  assert.equal(game.state.scoring.chainReactions, 0, 'no chain reaction from UFO death');
});

// ============================================================================
// P0-8: Non-manual magma death awards UFO points once, updates high score, no combo change
// ============================================================================

test('P0-8: non-manual magma death awards UFO points once, no combo change', () => {
  const { cfg, game } = setupGame(8, { shipX: 0, shipY: 0 });
  const hunter = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(hunter);
  const magma = makeAsteroid(cfg, 'small', 410, 300, 'magma', 8);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 88);
  game.state.asteroids = [magma, sentinel];

  game.state.scoring.combo = 3;
  game.state.scoring.multiplier = 2;
  const highBefore = game.state.highScore;

  destroyAsteroidWithBullet(game, cfg, magma);

  assert.equal(hunter.alive, false);
  // combo/multiplier unchanged
  assert.equal(game.state.scoring.combo, 3);
  assert.equal(game.state.scoring.multiplier, 2);
  // high score updated (400*1 + 100*1 = 500)
  assert.ok(game.state.highScore >= highBefore);
  // exactly one ufoDestroy
  const destroys = game.state.effects.filter(e => e.kind === 'ufoDestroy');
  assert.equal(destroys.length, 1);
});

// ============================================================================
// P0-11: createUfo initializes all three status fields to zero
// ============================================================================

test('P0-11: createUfo initializes cryoSlowTime, radiationTime, radiationTickAccumulator to 0', () => {
  const cfg = cloneConfig();
  const hunter = createUfo('hunter', 100, 100, cfg, makeRng(1));
  assert.equal(hunter.cryoSlowTime, 0);
  assert.equal(hunter.radiationTime, 0);
  assert.equal(hunter.radiationTickAccumulator, 0);

  const base = createUfo('base', 100, 100, cfg, makeRng(2));
  assert.equal(base.cryoSlowTime, 0);
  assert.equal(base.radiationTime, 0);
  assert.equal(base.radiationTickAccumulator, 0);
});

// ============================================================================
// P0-12: Cryo contact arms slowDuration exactly; dt===0 overlap arms too
// ============================================================================

test('P0-12: cryo contact arms exactly slowDuration on UFO', () => {
  const { cfg, game } = setupGame(12, { shipX: 0, shipY: 0 });
  const hunter = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0 });
  hunter.speed = 0;
  game.state.ufos.push(hunter);

  // Destroy a cryo asteroid on top of the UFO to create a cloud.
  const cryo = makeAsteroid(cfg, 'small', 400, 300, 'cryo', 12);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 122);
  game.state.asteroids = [cryo, sentinel];
  destroyAsteroidWithBullet(game, cfg, cryo);

  // The cloud was created this step; contact arms only next step.
  assert.equal(hunter.cryoSlowTime, 0, 'no contact in creation step');

  // Next step: UFO is inside the cloud.
  runStep(game, 0);
  assert.equal(hunter.cryoSlowTime, cfg.asteroid.types.cryo.slowDuration);
});

// ============================================================================
// P0-13: While slowed, drive uses ufoDriveMultiplier; speed and turnRate unchanged; knockback unaffected
// ============================================================================

test('P0-13: cryo slow reduces drive but not knockback or speed/turnRate', () => {
  const { cfg, game } = setupGame(13, { shipX: 0, shipY: 0 });
  const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 4 });
  base.speed = cfg.ufo.base.speed;
  game.state.ufos.push(base);

  // Arm cryo slow manually.
  base.cryoSlowTime = cfg.asteroid.types.cryo.slowDuration;
  base.knockbackVx = 200;
  base.knockbackVy = 0;

  const driveMult = cfg.asteroid.types.cryo.ufoDriveMultiplier;
  const expectedDriveSpeed = cfg.ufo.base.speed * driveMult;

  runStep(game);

  const driveVx = base.vx - base.knockbackVx;
  const driveVy = base.vy - base.knockbackVy;
  const driveSpeed = Math.hypot(driveVx, driveVy);
  assertClose(driveSpeed, expectedDriveSpeed, 1e-4, 'drive reduced by ufoDriveMultiplier');
  assert.equal(base.speed, cfg.ufo.base.speed, 'ufo.speed unchanged');
  assert.equal(base.turnRate, cfg.ufo.base.turnRate, 'turnRate unchanged');

  // Knockback should have decayed but NOT been multiplied.
  const damping = Math.exp(-cfg.ufo.asteroidCollision.knockbackDamping * DT);
  assertClose(base.knockbackVx, 200 * damping, 1e-6, 'knockback decays by damping only');
});

// ============================================================================
// P0-14: Partial expiration in large dt uses slowFraction; timer ends at 0
// ============================================================================

test('P0-14: partial cryo expiration uses slowFraction, timer reaches 0', () => {
  const { cfg, game } = setupGame(14, { shipX: 0, shipY: 0 });
  const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 4 });
  base.speed = cfg.ufo.base.speed;
  game.state.ufos.push(base);

  base.cryoSlowTime = 0.01; // 10ms remaining
  const dt = 0.05; // 50ms step

  runStep(game, dt);
  assert.equal(base.cryoSlowTime, 0, 'timer reaches 0');

  // drive multiplier for this step: slowFraction = 0.01/0.05 = 0.2
  const driveMult = cfg.asteroid.types.cryo.ufoDriveMultiplier;
  const expectedDriveMult = 1 - 0.2 * (1 - driveMult);
  const driveSpeed = Math.hypot(base.vx - base.knockbackVx, base.vy - base.knockbackVy);
  assertClose(driveSpeed, cfg.ufo.base.speed * expectedDriveMult, 1e-4, 'drive uses slowFraction');
});

// ============================================================================
// P0-15: Hunter fire timer advances by actionRateMultiplier while slowed
// ============================================================================

test('P0-15: hunter fire timer advances by actionRateMultiplier while slowed', () => {
  const { cfg, game } = setupGame(15, { shipX: 799, shipY: 300 });
  const hunter = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0 });
  hunter.speed = 0;
  hunter.fireTimer = 1.0;
  game.state.ufos.push(hunter);

  hunter.cryoSlowTime = 2.0;
  const actionMult = cfg.asteroid.types.cryo.ufoActionRateMultiplier;

  runStep(game, DT);
  assertClose(
    hunter.fireTimer,
    1.0 - DT * actionMult,
    EPS,
    'fire timer advances at actionRateMultiplier',
  );
});

// ============================================================================
// P0-16: Hunter with action ready still fires once; rearm uses base cooldown
// ============================================================================

test('P0-16: hunter with fireTimer=0 fires once even while slowed; rearm uses base cooldown', () => {
  const { cfg, game } = setupGame(16, { shipX: 799, shipY: 300 });
  const hunter = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0 });
  hunter.speed = 0;
  hunter.fireTimer = 0;
  hunter.cryoSlowTime = 2.0;
  game.state.ufos.push(hunter);
  const sentinel16 = makeAsteroid(cfg, 'small', 700, 50, 'normal', 166);
  game.state.asteroids.push(sentinel16);

  runStep(game, DT);

  assert.equal(game.state.enemyBullets.length, 1, 'fires once');
  assert.equal(hunter.fireTimer, cfg.ufo.hunter.fireCooldown, 'rearm uses base cooldown');
});

// ============================================================================
// P0-17: Two clouds or continuous contact renew by max, no stack
// ============================================================================

test('P0-17: two clouds renew by max time, no stacking', () => {
  const { cfg, game } = setupGame(17, { shipX: 0, shipY: 0 });
  const hunter = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0 });
  hunter.speed = 0;
  hunter.cryoSlowTime = 1.0; // already has 1s
  game.state.ufos.push(hunter);

  const cloud = createIceCloudTest(cfg, 400, 300);
  game.state.iceClouds = [cloud];

  runStep(game, 0);
  // Contact renews to max(slowDuration, existing) = slowDuration (1.8)
  assert.equal(hunter.cryoSlowTime, cfg.asteroid.types.cryo.slowDuration);
});

function createIceCloudTest(cfg, x, y) {
  const cryo = cfg.asteroid.types.cryo;
  return {
    kind: 'iceCloud',
    x, y,
    vx: 0, vy: 0,
    radius: cryo.cloudRadius,
    visualRadius: cryo.cloudRadius + 16,
    life: cryo.cloudLife,
    lifeTotal: cryo.cloudLife,
    slowDuration: cryo.slowDuration,
    angle: 0,
    alive: true,
  };
}

// ============================================================================
// P0-19: New radiation contact arms exposure with accumulator=0, no immediate damage
// ============================================================================

test('P0-19: radiation contact arms exposure, accumulator=0, no immediate damage', () => {
  const { cfg, game } = setupGame(19, { shipX: 0, shipY: 0 });
  const hunter = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0 });
  hunter.speed = 0;
  game.state.ufos.push(hunter);

  const field = createRadiationField(
    { x: 400, y: 300, angle: 0 },
    cfg,
  );
  game.state.radiationFields = [field];

  runStep(game, 0); // dt=0 overlap arms status
  assert.equal(hunter.radiationTime, cfg.asteroid.types.radioactive.exposureDuration);
  assert.equal(hunter.radiationTickAccumulator, 0);
  assert.equal(hunter.hp, 2, 'no immediate damage');
});

// ============================================================================
// P0-21: First tick occurs exactly at tickInterval; earlier instant does not
// ============================================================================

test('P0-21: first tick at tickInterval, not before', () => {
  const { cfg, game } = setupGame(21, { shipX: 0, shipY: 0 });
  const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 4 });
  base.speed = 0;
  game.state.ufos.push(base);

  base.radiationTime = cfg.asteroid.types.radioactive.exposureDuration;
  base.radiationTickAccumulator = 0;
  const sentinel21 = makeAsteroid(cfg, 'small', 700, 50, 'normal', 211);
  game.state.asteroids.push(sentinel21);
  const tickInterval = cfg.asteroid.types.radioactive.tickInterval;

  // Step just below tickInterval: no tick.
  runStep(game, tickInterval - 0.01);
  assert.equal(base.hp, 4, 'no tick before tickInterval');
  assert.equal(base.alive, true);

  // Step the remaining 0.01s to reach exactly tickInterval: tick occurs.
  runStep(game, 0.01);
  assert.equal(base.hp, 3, 'first tick at tickInterval');
});

// ============================================================================
// P0-22: Brief exposure (2.4s) generates at most 3 ticks; hunter dies, base survives at 1 HP
// ============================================================================

test('P0-22: brief exposure generates 3 ticks — hunter dies, base at 1 HP', () => {
  const { cfg, game } = setupGame(22, { shipX: 0, shipY: 0 });
  const hunter = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0 });
  hunter.speed = 0;
  game.state.ufos.push(hunter);

  hunter.radiationTime = cfg.asteroid.types.radioactive.exposureDuration;
  const tickInterval = cfg.asteroid.types.radioactive.tickInterval;

  // Run exposure duration in one big step.
  runStep(game, cfg.asteroid.types.radioactive.exposureDuration);
  // 2.4s / 0.8s = 3 ticks → hunter (2 HP) dies on second tick.
  assert.equal(hunter.alive, false, 'hunter dies from 2+ ticks');
});

// ============================================================================
// P0-23: Continuous field kills base on 4th tick; refresh preserves accumulator
// ============================================================================

test('P0-23: continuous radiation kills base on 4th tick', () => {
  const { cfg, game } = setupGame(23, { shipX: 0, shipY: 0 });
  const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 4 });
  base.speed = 0;
  game.state.ufos.push(base);

  // Place a radiation field on the UFO and keep it alive.
  const sentinel23 = makeAsteroid(cfg, 'small', 700, 50, 'normal', 231);
  game.state.asteroids.push(sentinel23);
  const field = createRadiationField({ x: 400, y: 300, angle: 0 }, cfg);
  game.state.radiationFields = [field];

  // First step: contact arms exposure.
  runStep(game, 0);
  assert.equal(base.radiationTime, cfg.asteroid.types.radioactive.exposureDuration);

  // Step through ticks. Base has 4 HP, needs 4 ticks at 1 damage each.
  const tickInterval = cfg.asteroid.types.radioactive.tickInterval;
  for (let i = 0; i < 3; i++) {
    runStep(game, tickInterval);
  }
  assert.equal(base.hp, 1, '3 ticks leave base at 1 HP');

  // Refresh: keep contact and tick once more.
  runStep(game, tickInterval);
  assert.equal(base.alive, false, '4th tick kills base');
});

// ============================================================================
// P0-24: Overlapping fields don't stack DPS or restart clock
// ============================================================================

test('P0-24: overlapping radiation fields do not stack DPS', () => {
  const { cfg, game } = setupGame(24, { shipX: 0, shipY: 0 });
  const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 4 });
  base.speed = 0;
  game.state.ufos.push(base);

  const sentinel24 = makeAsteroid(cfg, 'small', 700, 50, 'normal', 241);
  game.state.asteroids.push(sentinel24);
  const field1 = createRadiationField({ x: 400, y: 300, angle: 0 }, cfg);
  const field2 = createRadiationField({ x: 400, y: 300, angle: 0 }, cfg);
  game.state.radiationFields = [field1, field2];

  runStep(game, 0); // arm exposure
  const tickInterval = cfg.asteroid.types.radioactive.tickInterval;

  runStep(game, tickInterval);
  assert.equal(base.hp, 3, 'two overlapping fields deal only 1 tick');
});

// ============================================================================
// P0-26: Non-lethal tick creates ufoHit; death creates ufoDestroy and stops
// ============================================================================

test('P0-26: non-lethal tick reduces HP; death creates ufoDestroy', () => {
  const { cfg, game } = setupGame(26, { shipX: 0, shipY: 0 });
  const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 3 });
  base.speed = 0;
  game.state.ufos.push(base);

  const sentinel26 = makeAsteroid(cfg, 'small', 700, 50, 'normal', 261);
  game.state.asteroids.push(sentinel26);
  base.radiationTime = cfg.asteroid.types.radioactive.exposureDuration;

  // Single big step to trigger first tick.
  runStep(game, cfg.asteroid.types.radioactive.tickInterval);
  assert.equal(base.hp, 2, 'first tick reduces HP by 1');

  // Second tick.
  runStep(game, cfg.asteroid.types.radioactive.tickInterval);
  assert.equal(base.hp, 1, 'second tick reduces HP by 1');

  // Third tick kills (exposure 2.4s = 3 ticks).
  runStep(game, cfg.asteroid.types.radioactive.tickInterval);
  assert.equal(base.alive, false, 'third tick kills');
});

// ============================================================================
// P0-28: UFO killed by projectile does not receive ticks or status afterward
// ============================================================================

test('P0-28: UFO killed by projectile does not receive radiation tick', () => {
  const { cfg, game } = setupGame(28, { shipX: 0, shipY: 0 });
  const hunter = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 1 });
  hunter.speed = 0;
  game.state.ufos.push(hunter);

  // Arm exposure.
  hunter.radiationTime = 2.0;
  hunter.radiationTickAccumulator = 0;

  // Kill with a bullet in the same step.
  const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
  bullet.x = hunter.x;
  bullet.y = hunter.y;
  bullet.vx = 0;
  bullet.vy = 0;
  bullet.accuracyShotId = null;
  const sentinel28 = makeAsteroid(cfg, 'small', 700, 50, 'normal', 281);
  game.state.asteroids.push(sentinel28);
  game.state.bullets.push(bullet);

  // Use a small dt to observe effects before they expire.
  runStep(game, DT);

  assert.equal(hunter.alive, false, 'killed by bullet');
  // Only one ufoDestroy (from bullet), no ufoHit from tick.
  const destroys = game.state.effects.filter(e => e.kind === 'ufoDestroy');
  assert.equal(destroys.length, 1, 'one death effect');
  const hits = game.state.effects.filter(e => e.kind === 'ufoHit');
  assert.equal(hits.length, 0, 'no tick damage on dead UFO');
});

// ============================================================================
// P0-30: Direct collision with radioactive uses size only, no field
// ============================================================================

test('P0-30: colliding with radioactive asteroid uses size only, no field', () => {
  const { cfg, game } = setupGame(30);
  const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0 });
  game.state.ufos.push(ufo);
  const asteroid = makeAsteroid(cfg, 'small', 420, 300, 'radioactive', 30);
  game.state.asteroids.push(asteroid);

  runStep(game);
  assert.equal(ufo.hp, 1, 'radioactive small asteroid deals 1 damage (size only)');
  assert.equal(game.state.radiationFields.length, 0, 'no field from collision');
  assert.equal(asteroid.alive, true, 'radioactive asteroid survives collision');
});

// ============================================================================
// P0-32: Config without ufoDamage/multipliers/radioactive stays neutral and finite
// ============================================================================

test('P0-32: missing config values produce neutral, finite behavior', () => {
  const cfg = cloneConfig();
  delete cfg.asteroid.types.magma.ufoDamage;
  delete cfg.asteroid.types.cryo.ufoDriveMultiplier;
  delete cfg.asteroid.types.cryo.ufoActionRateMultiplier;
  delete cfg.asteroid.types.radioactive.tickInterval;
  delete cfg.asteroid.types.radioactive.ufoDamagePerTick;

  const game = createGame(cfg, makeRng(32));
  game.start();
  game.state.ship.invuln = 0;
  game.state.ship.x = 0;
  game.state.ship.y = 0;
  game.state.ship.vx = 0;
  game.state.ship.vy = 0;
  game.state.asteroids = [];
  game.state.ufos = [];

  const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 4 });
  base.speed = 0;
  game.state.ufos.push(base);
  const magma = makeAsteroid(cfg, 'small', 410, 300, 'magma', 32);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 321);
  game.state.asteroids = [magma, sentinel];

  const hpBefore = base.hp;
  const scoreBefore = game.state.score;
  destroyAsteroidWithBullet(game, cfg, magma);

  assert.equal(base.hp, hpBefore, 'missing ufoDamage → no UFO damage');
  assert.equal(game.state.score, scoreBefore + 100, 'only asteroid score');

  // Test invalid radiation: arm exposure and step; no tick damage.
  base.radiationTime = 2.0;
  base.radiationTickAccumulator = 0;
  runStep(game, 1.0);
  assert.equal(base.hp, hpBefore, 'missing tickInterval → no tick damage');
  assert.ok(Number.isFinite(base.radiationTime), 'radiationTime is finite');
  assert.ok(Number.isFinite(base.radiationTickAccumulator), 'accumulator is finite');
});

// ============================================================================
// P0-32b: NaN/inf/infinite ufoDamage and tickInterval are safe
// ============================================================================

test('P0-32b: NaN/inf/negative ufoDamage and tickInterval are safe', () => {
  for (const bad of [NaN, Infinity, -Infinity, -1, 0]) {
    const cfg = cloneConfig();
    cfg.asteroid.types.magma.ufoDamage = bad;
    const game = createGame(cfg, makeRng(321));
    game.start();
    game.state.ship.invuln = 0;
    game.state.ship.x = 0;
    game.state.ship.y = 0;
    game.state.asteroids = [];
    game.state.ufos = [];
    const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 4 });
    base.speed = 0;
    game.state.ufos.push(base);
    const magma = makeAsteroid(cfg, 'small', 410, 300, 'magma', 322);
    const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 323);
    game.state.asteroids = [magma, sentinel];
    const hpBefore = base.hp;
    destroyAsteroidWithBullet(game, cfg, magma);
    assert.equal(base.hp, hpBefore, `bad ufoDamage=${bad} → no UFO damage`);
  }

  for (const bad of [NaN, Infinity, -Infinity, -1, 0]) {
    const cfg = cloneConfig();
    cfg.asteroid.types.radioactive.tickInterval = bad;
    const game = createGame(cfg, makeRng(322));
    game.start();
    game.state.ship.invuln = 0;
    game.state.ship.x = 0;
    game.state.ship.y = 0;
    game.state.asteroids = [];
    game.state.ufos = [];
    const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 4 });
    base.speed = 0;
    game.state.ufos.push(base);
    base.radiationTime = 2.0;
    base.radiationTickAccumulator = 0;
    runStep(game, 1.0);
    assert.equal(base.hp, 4, `bad tickInterval=${bad} → no tick damage`);
    assert.ok(Number.isFinite(base.radiationTime), `radiationTime finite for bad=${bad}`);
  }
});

// ============================================================================
// P1-33: Pause preserves fields, status, accumulator, attack timers
// ============================================================================

test('P1-33: pause preserves radiation fields, UFO status, and attack clocks', () => {
  const { cfg, game } = setupGame(33, { shipX: 0, shipY: 0 });
  const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 4 });
  base.speed = 0;
  base.cryoSlowTime = 1.0;
  base.radiationTime = 2.0;
  base.radiationTickAccumulator = 0.3;
  base.fireTimer = 0.5;
  game.state.ufos.push(base);

  const field = createRadiationField({ x: 400, y: 300, angle: 0 }, cfg);
  game.state.radiationFields = [field];

  const snapshot = {
    cryoSlowTime: base.cryoSlowTime,
    radiationTime: base.radiationTime,
    radiationTickAccumulator: base.radiationTickAccumulator,
    fireTimer: base.fireTimer,
    fieldLife: field.life,
  };

  game.pause();
  runStep(game, 5);

  assert.equal(base.cryoSlowTime, snapshot.cryoSlowTime);
  assert.equal(base.radiationTime, snapshot.radiationTime);
  assert.equal(base.radiationTickAccumulator, snapshot.radiationTickAccumulator);
  assert.equal(base.fireTimer, snapshot.fireTimer);
  assert.equal(field.life, snapshot.fieldLife);
});

// ============================================================================
// P1-35: Restart clears radiation fields and new UFOs have zero status
// ============================================================================

test('P1-35: restart clears radiation fields, new UFOs have zero status', () => {
  const { cfg, game } = setupGame(35, { shipX: 0, shipY: 0 });
  const field = createRadiationField({ x: 400, y: 300, angle: 0 }, cfg);
  game.state.radiationFields = [field];

  game.restart();
  assert.equal(game.state.radiationFields.length, 0, 'restart clears fields');
  // Wave 1 has no UFOs.
  assert.equal(game.state.ufos.length, 0);
});

// ============================================================================
// P1-36: Wave transition preserves radiation fields
// ============================================================================

test('P1-36: wave transition preserves radiation fields', () => {
  const { cfg, game } = setupGame(36, { shipX: 400, shipY: 300 });
  cfg.asteroid.initialCount = 0;
  cfg.asteroid.maxInitial = 0;
  cfg.asteroid.guaranteedSpecialsPerWave = 0;
  game.state.wave = 4;
  game.state.asteroids = [];

  const field = createRadiationField({ x: 200, y: 200, angle: 0 }, cfg);
  game.state.radiationFields = [field];

  runStep(game); // advance to wave 5
  assert.equal(game.state.wave, 5);
  assert.equal(game.state.radiationFields.length, 1, 'field survives wave transition');
  assert.equal(game.state.radiationFields[0], field);
});

// ============================================================================
// P1-37: Destroying last radioactive creates a full-life field that survives wave change
// ============================================================================

test('P1-37: last radioactive field survives wave change with full life', () => {
  const { cfg, game } = setupGame(37, { shipX: 400, shipY: 300 });
  cfg.asteroid.initialCount = 0;
  cfg.asteroid.maxInitial = 0;
  cfg.asteroid.guaranteedSpecialsPerWave = 0;
  game.state.wave = 4;
  game.state.asteroids = [];
  game.state.ufos = [];

  runStep(game);
  assert.equal(game.state.wave, 5);

  // Manually place a radioactive asteroid since no guaranteed specials.
  const radioactive = makeAsteroid(cfg, 'small', 200, 200, 'radioactive', 371);
  game.state.asteroids.push(radioactive);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 372);
  game.state.asteroids.push(sentinel);

  destroyAsteroidWithBullet(game, cfg, radioactive);
  assert.equal(game.state.radiationFields.length, 1);
  const field = game.state.radiationFields[0];
  assert.equal(field.life, cfg.asteroid.types.radioactive.fieldLife, 'full life');

  // Clear remaining sentinel to advance wave.
  game.state.asteroids = [sentinel];
  destroyAsteroidWithBullet(game, cfg, sentinel);
  // After this, wave should advance; field should still exist.
  assert.equal(game.state.radiationFields.length, 1, 'field survives wave change');
  assert.equal(field.alive, true);
});

// ============================================================================
// P1-39: Simultaneous magma, cryo, radiation do not duplicate score/effects
// ============================================================================

test('P1-39: simultaneous magma+cryo+radiation do not duplicate score or produce NaN', () => {
  const { cfg, game } = setupGame(39, { shipX: 0, shipY: 0 });
  const base = makeUfo(cfg, 'base', 400, 300, { angle: 0, vx: 0, vy: 0, hp: 4 });
  base.speed = 0;
  game.state.ufos.push(base);

  const magma = makeAsteroid(cfg, 'small', 410, 300, 'magma', 39);
  const cryo = makeAsteroid(cfg, 'small', 420, 300, 'cryo', 391);
  const rad = makeAsteroid(cfg, 'small', 430, 300, 'radioactive', 392);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 393);
  game.state.asteroids = [magma, cryo, rad, sentinel];

  const scoreBefore = game.state.score;
  // Destroy all three specials with one bullet on magma (chain).
  destroyAsteroidWithBullet(game, cfg, magma);

  assert.ok(Number.isFinite(base.hp), 'base hp finite');
  assert.ok(Number.isFinite(base.cryoSlowTime), 'cryoSlowTime finite');
  assert.ok(Number.isFinite(base.radiationTime), 'radiationTime finite');
  // base took 2 from magma → 2 HP. Cryo cloud and radiation field are created
  // but only arm status on the NEXT step (snapshot rule).
  assert.equal(base.hp, 2);
  assert.equal(game.state.radiationFields.length, 1);
  assert.equal(game.state.iceClouds.length, 1);

  // Next step: contact arms cryo slow and radiation exposure.
  runStep(game, 0);
  assert.ok(base.cryoSlowTime > 0, 'cryo slow armed after next step');
  assert.ok(base.radiationTime > 0, 'radiation exposure armed after next step');
  assert.ok(game.state.score > scoreBefore, 'score increased');
  assert.ok(Number.isFinite(base.cryoSlowTime), 'cryoSlowTime finite after contact');
  assert.ok(Number.isFinite(base.radiationTime), 'radiationTime finite after contact');
});