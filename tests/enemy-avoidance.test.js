import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame, STATUS } from '../src/game.js';
import {
  createAsteroid,
  createUfo,
  createBullet,
  updateUfo,
} from '../src/entities.js';
import {
  wrap,
  torusDelta,
  torusDistance,
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

function disableAvoidance(cfg, kind) {
  const balance = cfg.ufo[kind] ?? cfg.ufo.hunter;
  if (balance.avoidance) {
    balance.avoidance = { ...balance.avoidance, enabled: false };
  }
}

function makeShip(x, y) {
  return { x, y, radius: CONFIG.ship.radius };
}

function setupGame(seed = 1, opts = {}) {
  const cfg = cloneConfig();
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

// ============================================================================
// P0 — contrato obrigatório
// ============================================================================

test('P0-1: without avoidance config the heading matches the baseline', () => {
  const cfg = cloneConfig();
  disableAvoidance(cfg, 'hunter');
  disableAvoidance(cfg, 'base');
  const ship = makeShip(400, 300);
  const hunter = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const base = makeUfo(cfg, 'base', 200, 300, { angle: 0 });

  updateUfo(hunter, DT, ship, cfg, W, H, [
    makeAsteroid(cfg, 'large', 500, 300, 'normal', 1),
  ]);
  updateUfo(base, DT, ship, cfg, W, H, [
    makeAsteroid(cfg, 'large', 500, 300, 'normal', 1),
  ]);

  // Directly to the right is still 0, so heading stays near 0.
  assertClose(hunter.angle, 0, 0.02, 'hunter without avoidance keeps heading');
  assertClose(base.angle, 0, 0.02, 'base without avoidance keeps heading');
});

test('P0-2: a large asteroid ahead of a hunter steers it sideways', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const rock = makeAsteroid(cfg, 'large', 360, 300, 'normal', 1);

  updateUfo(ufo, DT, ship, cfg, W, H, [rock]);

  // Should have turned either up or down.
  const absAngle = Math.abs(ufo.angle);
  assert.ok(absAngle > 0.05, `hunter should steer sideways, got ${ufo.angle}`);
  assert.ok(absAngle <= cfg.ufo.hunter.avoidance.maxDeflectionAngle + 0.02,
    `hunter deflection ${ufo.angle} exceeds max`);
});

test('P0-3: an asteroid behind the UFO does not alter heading', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const rock = makeAsteroid(cfg, 'large', 50, 300, 'normal', 1);

  updateUfo(ufo, DT, ship, cfg, W, H, [rock]);
  assertClose(ufo.angle, 0, 0.02, 'behind asteroid should not alter heading');
});

test('P0-4: an asteroid outside the frontal cone does not alter heading', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  // 80° up is outside the 60° half-cone of the hunter.
  const rock = makeAsteroid(cfg, 'large', 220, 411, 'normal', 1);

  updateUfo(ufo, DT, ship, cfg, W, H, [rock]);
  assertClose(ufo.angle, 0, 0.02, 'out-of-cone asteroid should not alter heading');
});

test('P0-5: base deflects less than hunter for the same threat', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const hunter = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const base = makeUfo(cfg, 'base', 200, 300, { angle: 0 });
  // Place the rock at 100px ahead so the base (lookAhead=120) still sees it.
  const rock = makeAsteroid(cfg, 'large', 300, 300, 'normal', 1);

  // Use a larger dt so the archetype turn-rate difference is observable; the
  // UFO remains well clear of the rock during the step.
  const dt = 0.1;
  updateUfo(hunter, dt, ship, cfg, W, H, [rock]);
  updateUfo(base, dt, ship, cfg, W, H, [rock]);

  const hunterDeflection = Math.abs(hunter.angle);
  const baseDeflection = Math.abs(base.angle);
  assert.ok(hunterDeflection > 0.1, 'hunter should deflect');
  assert.ok(baseDeflection > 0.02, 'base should still deflect slightly');
  assert.ok(baseDeflection < hunterDeflection,
    `base ${baseDeflection} should deflect less than hunter ${hunterDeflection}`);
});

test('P0-6: pressure from multiple aligned rocks reduces effective deflection', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufoSingle = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const ufoPressure = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });

  // A single small rock ahead.
  const singleRock = makeAsteroid(cfg, 'small', 300, 300, 'normal', 1);
  // A dense cluster of small rocks ahead; total threat crosses the pressure
  // threshold and saturates, so the deflection per unit of threat drops.
  const rocks = [];
  for (let i = 0; i < 12; i++) {
    const offset = (i - 5.5) * 4;
    rocks.push(makeAsteroid(cfg, 'small', 300, 300 + offset, 'normal', i + 2));
  }

  updateUfo(ufoSingle, DT, ship, cfg, W, H, [singleRock]);
  updateUfo(ufoPressure, DT, ship, cfg, W, H, rocks);

  const singleDeflection = Math.abs(ufoSingle.angle);
  const pressureDeflection = Math.abs(ufoPressure.angle);
  assert.ok(singleDeflection > 0.03, 'single rock should deflect');
  assert.ok(pressureDeflection > 0.03, 'pressure should still produce deflection');
  // With more threats the absolute deflection can grow, but the efficiency
  // (deflection per unit of threat) must drop once pressure is engaged.
  const singleThreat = singleDeflection / computeTotalThreat(ufoSingle, [singleRock], cfg, W, H);
  const pressureThreat = pressureDeflection / computeTotalThreat(ufoPressure, rocks, cfg, W, H);
  assert.ok(
    pressureThreat < singleThreat,
    `pressure efficiency ${pressureThreat} should be lower than single ${singleThreat}`,
  );
});

test('P0-7: panic distance further reduces the deflection', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufoFar = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const ufoNear = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });

  // Far rock: surface distance well beyond panic distance.
  const farRock = makeAsteroid(cfg, 'small', 300, 300, 'normal', 1);
  // Near rock: surface distance inside panic distance (smallR=14, hunterR=18 => surface ~8).
  const nearRock = makeAsteroid(cfg, 'small', 230, 300, 'normal', 2);

  updateUfo(ufoFar, DT, ship, cfg, W, H, [farRock]);
  updateUfo(ufoNear, DT, ship, cfg, W, H, [nearRock]);

  const farDeflection = Math.abs(ufoFar.angle);
  const nearDeflection = Math.abs(ufoNear.angle);
  // Panic reduces the deflection per unit of threat, even though the nearby
  // rock is individually more threatening.
  const farEfficiency = farDeflection / computeTotalThreat(ufoFar, [farRock], cfg, W, H);
  const nearEfficiency = nearDeflection / computeTotalThreat(ufoNear, [nearRock], cfg, W, H);
  assert.ok(farDeflection > 0.03, 'far rock should deflect');
  assert.ok(nearDeflection > 0.001, 'near rock should still produce tiny deflection');
  assert.ok(
    nearEfficiency < farEfficiency,
    `panic efficiency ${nearEfficiency} should be lower than far ${farEfficiency}`,
  );
});

test('P0-8: deflection never exceeds maxDeflectionAngle', () => {
  const cfg = cloneConfig();
  cfg.ufo.hunter.turnRate = 1000; // reach the requested heading in one step
  cfg.ufo.hunter.avoidance.maxDeflectionAngle = 0.1;
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const rock = makeAsteroid(cfg, 'large', 360, 300, 'normal', 1);

  updateUfo(ufo, DT, ship, cfg, W, H, [rock]);
  assert.ok(Math.abs(ufo.angle) <= cfg.ufo.hunter.avoidance.maxDeflectionAngle + EPS,
    `deflection ${ufo.angle} exceeds configured max`);
});

test('P0-9: knockback and cryo slow still compose over the deflected drive', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  ufo.knockbackVx = 80;
  ufo.knockbackVy = 0;
  ufo.cryoSlowTime = 10;
  const rock = makeAsteroid(cfg, 'large', 360, 300, 'normal', 1, -220, 0);

  updateUfo(ufo, DT, ship, cfg, W, H, [rock]);

  const expectedDriveLen = cfg.ufo.hunter.speed
    * cfg.asteroid.types.cryo.ufoDriveMultiplier
    * cfg.ufo.hunter.avoidance.evasionDriveMultiplier;
  const driveLen = Math.hypot(
    ufo.vx - ufo.knockbackVx,
    ufo.vy - ufo.knockbackVy,
  );
  assertClose(driveLen, expectedDriveLen, 0.01,
    'drive magnitude should compose cryo slow and the evasive brake');
});

test('P0-10: physical collision still works when there is no room to dodge', () => {
  const { cfg, game } = setupGame(10, { shipX: 0, shipY: 0 });
  const ufo = makeUfo(cfg, 'hunter', 250, 300, { angle: 0 });
  const rock = makeAsteroid(cfg, 'large', 300, 300, 'normal', 1, -90, 0);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 22);
  game.state.ufos.push(ufo);
  game.state.asteroids = [rock, sentinel];

  // The UFO tries to move toward the ship (0,0) but the rock is right ahead
  // and moving toward it. Even with avoidance, a collision should happen.
  runStep(game);

  assert.ok(
    ufo.hp < cfg.ufo.hunter.hp || !ufo.alive,
    'UFO should still take damage when a collision is unavoidable',
  );
});

test('P0-11: dead asteroids do not influence avoidance', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const rock = makeAsteroid(cfg, 'large', 360, 300, 'normal', 1);
  rock.alive = false;

  updateUfo(ufo, DT, ship, cfg, W, H, [rock]);
  assertClose(ufo.angle, 0, 0.02, 'dead asteroid should not alter heading');
});

test('P0-12: drive snapshot captures the avoidance-adjusted drive', () => {
  const { cfg, game } = setupGame(12, { shipX: 0, shipY: 0 });
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const rock = makeAsteroid(cfg, 'large', 360, 300, 'normal', 1);
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 22);
  game.state.ufos.push(ufo);
  game.state.asteroids = [rock, sentinel];

  runStep(game);

  const driveVx = ufo.vx - (ufo.knockbackVx ?? 0);
  const driveVy = ufo.vy - (ufo.knockbackVy ?? 0);
  const driveAngle = Math.atan2(driveVy, driveVx);
  // The drive should have been deflected up or down from the original ship direction.
  assert.ok(Math.abs(normalizeAngle(driveAngle)) > 0.03,
    `drive angle ${driveAngle} should reflect avoidance`);
});

test('P0-13: hunter commits to a safe route around a large asteroid ahead', () => {
  const { cfg, game } = setupGame(13, { shipX: 800, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 200, 300, {
    angle: 0,
    vx: cfg.ufo.hunter.speed,
    vy: 0,
  });
  const rock = makeAsteroid(cfg, 'large', 400, 300, 'normal', 13, 0, 0);
  ufo.fireTimer = 999; // Isolate navigation from the defensive-fire behaviour.
  game.state.ufos.push(ufo);
  game.state.asteroids.push(rock);

  const startingHp = ufo.hp;
  let minimumDistance = Infinity;
  for (let step = 0; step < 120; step++) {
    runStep(game);
    minimumDistance = Math.min(
      minimumDistance,
      torusDistance(ufo.x, ufo.y, rock.x, rock.y, W, H),
    );
  }

  assert.equal(ufo.alive, true, 'hunter should survive an avoidable head-on rock');
  assert.equal(ufo.hp, startingHp, 'hunter should not take collision damage');
  assert.ok(
    minimumDistance > ufo.radius + rock.radius,
    `hunter must retain physical clearance, got ${minimumDistance}`,
  );
});

test('P0-14: hunter predicts and evades an oncoming asteroid', () => {
  const { cfg, game } = setupGame(14, { shipX: 800, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 250, 300, {
    angle: 0,
    vx: cfg.ufo.hunter.speed,
    vy: 0,
  });
  const rock = makeAsteroid(cfg, 'large', 510, 300, 'normal', 14, -100, 0);
  ufo.fireTimer = 999;
  game.state.ufos.push(ufo);
  game.state.asteroids.push(rock);

  const startingHp = ufo.hp;
  let maximumLateralEscape = 0;
  for (let step = 0; step < 120; step++) {
    runStep(game);
    maximumLateralEscape = Math.max(
      maximumLateralEscape,
      Math.abs(torusDelta(300, ufo.y, H)),
    );
  }

  assert.equal(ufo.alive, true, 'hunter should survive an oncoming rock');
  assert.equal(ufo.hp, startingHp, 'relative-velocity prediction should prevent damage');
  assert.ok(
    maximumLateralEscape > 40,
    'hunter should have made a visible lateral escape instead of continuing straight',
  );
});

test('P0-15: pursuit route detects an asteroid before the UFO turns into it', () => {
  const cfg = cloneConfig();
  const ship = makeShip(600, 300);
  // The current heading is upward, but the chase route turns right through
  // the large asteroid. Prediction must use that intended route immediately.
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: Math.PI / 2 });
  const rock = makeAsteroid(cfg, 'large', 360, 300, 'normal', 15, 0, 0);

  const result = updateUfo(ufo, DT, ship, cfg, W, H, [rock]);

  assert.equal(result.asteroidTarget, rock, 'the pursuit route should target the blocking asteroid');
  assert.equal(ufo.avoidanceTarget, rock, 'the UFO should begin its escape before turning into the rock');
});

// ============================================================================
// P1 — robustez
// ============================================================================

test('P1-1: seam-aware avoidance considers rocks on the far side of the world', () => {
  const cfg = cloneConfig();
  const ship = makeShip(50, 300);
  const ufo = makeUfo(cfg, 'hunter', W - 50, 300, { angle: 0 });
  const rock = makeAsteroid(cfg, 'large', 30, 300, 'normal', 1);

  updateUfo(ufo, DT, ship, cfg, W, H, [rock]);
  assert.ok(Math.abs(ufo.angle) > 0.02,
    `UFO near right edge should avoid rock near left edge, got ${ufo.angle}`);
});

test('P1-2: turnRate still clamps the rotation; avoidance is a target not a jump', () => {
  const cfg = cloneConfig();
  cfg.ufo.hunter.turnRate = 0.1; // extremely slow turn
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const rock = makeAsteroid(cfg, 'large', 360, 300, 'normal', 1);

  updateUfo(ufo, DT, ship, cfg, W, H, [rock]);
  assert.ok(Math.abs(ufo.angle) <= 0.1 * DT + EPS,
    `turnRate should clamp rotation to ${0.1 * DT}, got ${ufo.angle}`);
});

test('P1-3: ship is never treated as an obstacle', () => {
  const cfg = cloneConfig();
  const ship = makeShip(360, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  // No asteroids, only the ship directly ahead.
  updateUfo(ufo, DT, ship, cfg, W, H, []);
  assertClose(ufo.angle, 0, 0.02, 'ship alone should not cause avoidance');
});

test('P1-4: partial/missing avoidance config stays finite and safe', () => {
  const cfg = cloneConfig();
  cfg.ufo.hunter.avoidance = { enabled: true }; // everything else missing
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const rock = makeAsteroid(cfg, 'large', 360, 300, 'normal', 1);

  assert.doesNotThrow(() => {
    updateUfo(ufo, DT, ship, cfg, W, H, [rock]);
  });
  assert.ok(Number.isFinite(ufo.angle), `angle stays finite, got ${ufo.angle}`);
  assert.ok(Number.isFinite(ufo.x) && Number.isFinite(ufo.y), 'position stays finite');
});

test('P1-5: a radioactive asteroid is treated as a larger obstacle than a normal one', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  // Normal rock far enough that it is ignored; radioactive rock at the same
  // spot must trigger avoidance because its hazard radius expands the
  // effective collision size.  At 740 px the normal rock is just outside the
  // prediction horizon while the radioactive one is inside.
  const normalRock = makeAsteroid(cfg, 'medium', 740, 300, 'normal', 1, -80, 0);
  const radioactiveRock = makeAsteroid(cfg, 'medium', 740, 300, 'radioactive', 2, -80, 0);

  const normalResult = updateUfo(ufo, DT, ship, cfg, W, H, [normalRock]);
  const normalAngle = ufo.angle;
  ufo.x = 200;
  ufo.y = 300;
  ufo.angle = 0;
  ufo.avoidanceTarget = null;
  ufo.avoidanceSide = 0;
  const radioResult = updateUfo(ufo, DT, ship, cfg, W, H, [radioactiveRock]);

  assert.equal(normalResult.asteroidTarget, null, 'normal rock at 740 px is ignored');
  assert.equal(radioResult.asteroidTarget, radioactiveRock, 'radioactive rock triggers avoidance at same distance');
  // The radioactive threat must cause a meaningful dodge over a few steps; the
  // normal one does not.  One fixed step only allows a small turn, so let the
  // UFO react for a short while.
  for (let i = 0; i < 20; i++) {
    updateUfo(ufo, DT, ship, cfg, W, H, [radioactiveRock]);
  }
  assert.ok(Math.abs(normalAngle) < 0.05, 'normal rock causes essentially no dodge');
  assert.ok(Math.abs(ufo.angle) > 0.3, 'radioactive rock causes a meaningful sideways dodge');
});

test('P1-6: high-threat rocks are prioritised when two collisions are predicted at similar times', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  // Normal rock will hit slightly sooner, but the radioactive one is far more
  // dangerous.  Both are on the same route, so the selected target determines
  // which rock the UFO tries to shoot.
  const normalRock = makeAsteroid(cfg, 'medium', 360, 300, 'normal', 1, -100, 0);
  const radioactiveRock = makeAsteroid(cfg, 'medium', 400, 300, 'radioactive', 2, -120, 0);

  const result = updateUfo(ufo, DT, ship, cfg, W, H, [normalRock, radioactiveRock]);
  assert.equal(result.asteroidTarget, radioactiveRock, 'radioactive rock wins the tie-break');
});

test('P1-7: UFO targets a nearby high-threat asteroid even without an imminent crash course', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  // UFO at (300,300), pointing right, no asteroid directly ahead.
  // This radioactive rock is within the weapon cone/range but its 140px
  // lateral offset is outside the expanded 128px collision corridor.
  const ufo = makeUfo(cfg, 'hunter', 300, 300, { angle: 0 });
  const radioactiveRock = makeAsteroid(cfg, 'small', 480, 440, 'radioactive', 2, 0, 0);

  const result = updateUfo(ufo, DT, ship, cfg, W, H, [radioactiveRock]);
  assert.equal(result.asteroidTarget, radioactiveRock, 'rock is targeted for fire despite no crash course');
  assert.equal(ufo.avoidanceTarget, null, 'target came from proactive fire, not avoidance');
  assertClose(ufo.angle, 0, 0.02, 'no collision route means the UFO keeps its chase heading');
});

test('P1-8: high-threat tie-break is deterministic across asteroid order', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const normalRock = makeAsteroid(cfg, 'medium', 268.7, 300, 'normal', 1, 0, 0);
  const crystalRock = makeAsteroid(cfg, 'medium', 291.56, 300, 'crystal', 2, 0, 0);
  const radioactiveRock = makeAsteroid(cfg, 'medium', 345.92, 300, 'radioactive', 3, 0, 0);

  const orders = [
    [normalRock, crystalRock, radioactiveRock],
    [crystalRock, normalRock, radioactiveRock],
    [normalRock, radioactiveRock, crystalRock],
    [radioactiveRock, crystalRock, normalRock],
  ];

  for (const rocks of orders) {
    const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
    const result = updateUfo(ufo, DT, ship, cfg, W, H, rocks);
    assert.equal(result.asteroidTarget, radioactiveRock,
      'radioactive threat wins every near-simultaneous ordering');
  }
});

test('P1-9: a committed normal route cannot override a near-simultaneous radioactive threat', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });
  const normalRock = makeAsteroid(cfg, 'medium', 360, 300, 'normal', 1, -100, 0);
  const radioactiveRock = makeAsteroid(cfg, 'medium', 400, 300, 'radioactive', 2, -120, 0);
  ufo.avoidanceTarget = normalRock;
  ufo.avoidanceSide = 1;
  ufo.avoidanceCommitTime = 0.55;

  const result = updateUfo(ufo, DT, ship, cfg, W, H, [normalRock, radioactiveRock]);
  assert.equal(result.asteroidTarget, radioactiveRock,
    'higher risk wins even while a lower-risk route is committed');
});

test('P1-10: null asteroid input is treated as an empty field', () => {
  const cfg = cloneConfig();
  const ship = makeShip(400, 300);
  const ufo = makeUfo(cfg, 'hunter', 200, 300, { angle: 0 });

  assert.doesNotThrow(() => updateUfo(ufo, DT, ship, cfg, W, H, null));
});

test('P1-11: proactive fire launches a real projectile at a reachable high-threat asteroid', () => {
  const { cfg, game } = setupGame(111, { shipX: 700, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 300, 300, { angle: 0 });
  const radioactiveRock = makeAsteroid(cfg, 'small', 480, 440, 'radioactive', 2, 0, 0);
  ufo.fireTimer = 0;
  game.state.ufos = [ufo];
  game.state.asteroids = [radioactiveRock];

  runStep(game);

  assert.equal(game.state.enemyBullets.length, 1, 'ready UFO fires one projectile');
  const [bullet] = game.state.enemyBullets;
  const expectedAngle = Math.atan2(
    torusDelta(ufo.y, radioactiveRock.y, H),
    torusDelta(ufo.x, radioactiveRock.x, W),
  );
  assertClose(normalizeAngle(bullet.angle - expectedAngle), 0, 0.03,
    'projectile is aimed at the proactive high-threat target');
});

test('P1-12: unreachable high-threat asteroid does not steal a shot from the player', () => {
  const cfg = cloneConfig();
  const ship = makeShip(700, 300);
  const ufo = makeUfo(cfg, 'hunter', 300, 300, { angle: 0 });
  // The asteroid moves faster than the 220 px/s enemy bullet and cannot be
  // intercepted before its 2.4-second lifetime ends.
  const radioactiveRock = makeAsteroid(cfg, 'small', 520, 300, 'radioactive', 2, 230, 0);

  const result = updateUfo(ufo, DT, ship, cfg, W, H, [radioactiveRock]);
  assert.equal(result.asteroidTarget, null, 'unreachable target is rejected');
});

test('P1-13: a UFO waits for a safe magma shot instead of detonating itself', () => {
  const { cfg, game } = setupGame(113, { shipX: 700, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 300, 300, { angle: 0 });
  const magma = makeAsteroid(cfg, 'medium', 420, 300, 'magma', 3, 0, 0);
  ufo.fireTimer = 0;
  game.state.ufos = [ufo];
  game.state.asteroids = [magma];
  const startingHp = ufo.hp;

  for (let step = 0; step < 240 && magma.alive; step++) runStep(game);

  assert.equal(magma.alive, false, 'magma is eventually cleared after a safe escape');
  assert.equal(ufo.hp, startingHp, 'magma blast must not damage its shooter');
});

test('P1-14: curved avoidance does not let a later magma shot hit its shooter', () => {
  const { cfg, game } = setupGame(115, { shipX: 700, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 300, 300, { angle: 0 });
  const magma = makeAsteroid(cfg, 'medium', 480, 300, 'magma', 4, 0, 0);
  ufo.fireTimer = 0;
  game.state.ufos = [ufo];
  game.state.asteroids = [magma];
  const startingHp = ufo.hp;

  for (let step = 0; step < 240; step++) runStep(game);

  assert.equal(magma.alive, false, 'magma is cleared after the curved escape');
  assert.equal(ufo.hp, startingHp, 'later shot must remain outside the blast radius');
});

test('P1-15: a UFO avoids the radioactive field created by its own shot', () => {
  const { cfg, game } = setupGame(21, { shipX: 700, shipY: 500 });
  const ufo = makeUfo(cfg, 'hunter', 300, 300, { angle: 0 });
  const radioactiveRock = makeAsteroid(cfg, 'small', 450, 445, 'radioactive', 5, 0, 0);
  ufo.fireTimer = 0;
  game.state.ufos = [ufo];
  game.state.asteroids = [radioactiveRock];
  const startingHp = ufo.hp;

  // Covers the delayed field lifetime and multiple possible radiation ticks.
  for (let step = 0; step < 420; step++) runStep(game);

  assert.equal(radioactiveRock.alive, false, 'radioactive threat is eventually cleared');
  assert.equal(ufo.hp, startingHp, 'the shooter must not be contaminated by its own field');
});

test('P1-16: an unreachable high-threat target leaves the real shot aimed at the ship', () => {
  const { cfg, game } = setupGame(116, { shipX: 700, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 300, 300, { angle: 0 });
  const radioactiveRock = makeAsteroid(cfg, 'small', 520, 300, 'radioactive', 6, 230, 0);
  ufo.fireTimer = 0;
  ufo.specialShotTarget = radioactiveRock; // stale remembered target must not stall fire
  game.state.ufos = [ufo];
  game.state.asteroids = [radioactiveRock];

  runStep(game);

  assert.equal(game.state.enemyBullets.length, 1, 'UFO still takes its normal shot');
  const [bullet] = game.state.enemyBullets;
  const expectedAngle = Math.atan2(
    torusDelta(ufo.y, game.state.ship.y, H),
    torusDelta(ufo.x, game.state.ship.x, W),
  );
  assertClose(normalizeAngle(bullet.angle - expectedAngle), 0, 0.03,
    'unreachable asteroid does not replace the ship as the fire target');
});

test('P1-17: a radioactive shot stays suppressed until the committed escape route clears', () => {
  // Keep the ship outside this navigation fixture so ship-contact mechanics do
  // not influence the UFO's committed escape route.
  const { cfg, game } = setupGame(90, { shipX: 700, shipY: 100 });
  const ufo = makeUfo(cfg, 'hunter', 300, 300, { angle: 0 });
  const radioactiveRock = makeAsteroid(cfg, 'small', 520, 180, 'radioactive', 7, 0, 0);
  ufo.fireTimer = 0;
  game.state.ufos = [ufo];
  game.state.asteroids = [radioactiveRock];
  const startingHp = ufo.hp;

  // The collision prediction clears after the first turn, but the UFO is
  // still following its committed escape route. It must not create a field in
  // that route and later receive radiation damage from its own shot.
  for (let step = 0; step < 360; step++) runStep(game);

  assert.equal(radioactiveRock.alive, false, 'radioactive threat is eventually cleared');
  assert.equal(ufo.hp, startingHp, 'the committed escape route stays clear of its own field');
});

test('P1-18: committed escape keeps a normal asteroid as the defensive fire target', () => {
  const { cfg, game } = setupGame(118, { shipX: 600, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 200, 300, {
    angle: 0,
    vx: cfg.ufo.hunter.speed,
    vy: 0,
  });
  const rock = makeAsteroid(cfg, 'large', 320, 300, 'normal', 18, 0, 0);
  ufo.fireTimer = cfg.ufo.hunter.fireCooldown;
  game.state.ufos = [ufo];
  game.state.asteroids = [rock];

  let defensiveShot = null;
  for (let step = 0; step < 90 && !defensiveShot; step++) {
    runStep(game);
    defensiveShot = game.state.enemyBullets[0] ?? null;
  }

  assert.ok(defensiveShot, 'the first ready shot should be fired during the escape');
  assert.equal(ufo.avoidanceTarget, rock, 'escape commitment should still refer to the blocking rock');
  const expectedAngle = Math.atan2(
    torusDelta(ufo.y, rock.y, H),
    torusDelta(ufo.x, rock.x, W),
  );
  assertClose(
    normalizeAngle(defensiveShot.angle - expectedAngle),
    0,
    0.03,
    'the shot should clear the blocking asteroid instead of chasing the player',
  );
});

test('P1-19: a rebounded normal asteroid gets an emergency shot before normal cooldown', () => {
  const { cfg, game } = setupGame(119, { shipX: 600, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 200, 300, {
    angle: 0,
    vx: cfg.ufo.hunter.speed,
    vy: 0,
  });
  // Mimics a large rock that has just been accelerated by a rebound. The
  // ordinary hunter cooldown is still full, so survival depends on the
  // bounded defensive reaction rather than a general fire-rate buff.
  const rock = makeAsteroid(cfg, 'large', 400, 300, 'normal', 19, -560, 0);
  const startingFireTimer = ufo.fireTimer;
  game.state.ufos = [ufo];
  game.state.asteroids = [rock];

  runStep(game);

  assert.equal(game.state.enemyBullets.length, 1,
    'imminent rebound should produce one defensive shot immediately');
  assert.equal(ufo.fireTimer, startingFireTimer,
    'defensive shot must not reset or accelerate the normal weapon cooldown');

  for (let step = 0; step < 120 && ufo.alive; step++) runStep(game);

  assert.equal(ufo.alive, true,
    'hunter should survive the rebounded large rock long enough to resume the fight');
  assert.equal(rock.alive, false, 'the defensive projectile should clear the threatening rock');
});

test('P1-20: emergency defense never shoots a material asteroid', () => {
  const { cfg, game } = setupGame(120, { shipX: 600, shipY: 300 });
  const ufo = makeUfo(cfg, 'hunter', 200, 300, {
    angle: 0,
    vx: cfg.ufo.hunter.speed,
    vy: 0,
  });
  const magma = makeAsteroid(cfg, 'large', 400, 300, 'magma', 20, -560, 0);
  ufo.fireTimer = 999;
  game.state.ufos = [ufo];
  game.state.asteroids = [magma];

  runStep(game);

  assert.equal(game.state.enemyBullets.length, 0,
    'magma remains governed by the conservative special-asteroid safety rules');
});

// ============================================================================
// helpers
// ============================================================================

function normalizeAngle(angle) {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  if (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

/**
 * Replicate the threat sum used by computeAvoidanceOffset so the tests can
 * measure deflection efficiency (deflection per unit of threat).
 */
function computeTotalThreat(ufo, asteroids, cfg, w, h) {
  const balance = cfg.ufo[ufo.kind] ?? cfg.ufo.hunter;
  const avoidance = balance.avoidance;
  if (!avoidance?.enabled) return 1;

  const lookAhead = Math.max(0, avoidance.lookAhead ?? 0);
  const coneHalf = Math.max(0, (avoidance.coneAngle ?? 0) / 2);
  const sizeWeights = avoidance.sizeWeightBySize ?? {};
  let total = 0;

  for (const a of asteroids) {
    if (!a?.alive) continue;
    const dx = torusDelta(ufo.x, a.x, w);
    const dy = torusDelta(ufo.y, a.y, h);
    const dist = Math.hypot(dx, dy);
    if (dist > lookAhead + a.radius) continue;
    const angleToAsteroid = Math.atan2(dy, dx);
    const angleDiff = normalizeAngle(angleToAsteroid - ufo.angle);
    if (Math.abs(angleDiff) > coneHalf) continue;
    const sizeWeight = sizeWeights[a.size] ?? 1;
    const coneFactor = Math.max(0, 1 - Math.abs(angleDiff) / coneHalf);
    const distanceFactor = Math.max(0, 1 - dist / lookAhead);
    total += sizeWeight * coneFactor * distanceFactor;
  }
  return total > 0 ? total : 1;
}
