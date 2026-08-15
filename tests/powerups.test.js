import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame } from '../src/game.js';
import {
  createAsteroid,
  createBullet,
  createDataNode,
} from '../src/entities.js';
import { createInputManager } from '../src/input.js';
import { torusDelta, torusDistance } from '../src/math.js';

const W = 800;
const H = 600;

function cloneConfig() {
  return structuredClone(CONFIG);
}

function makeRng(seed = 1) {
  let state = seed >>> 0;
  const scripted = [];

  const rng = () => {
    if (scripted.length > 0) return scripted.shift();
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  rng.queue = (...values) => scripted.push(...values);
  return rng;
}

function makeAsteroid(cfg, size, x, y, seed = 100, options = {}) {
  const asteroid = createAsteroid(size, x, y, cfg, makeRng(seed));
  asteroid.vx = options.vx ?? 0;
  asteroid.vy = options.vy ?? 0;
  asteroid.rotSpeed = options.rotSpeed ?? 0;
  asteroid.angle = options.angle ?? 0;
  asteroid.dataCarrier = options.dataCarrier ?? false;
  return asteroid;
}

function makeSentinel(cfg, seed = 9000) {
  return makeAsteroid(cfg, 'small', 60, 50, seed);
}

function setupGame(seed = 1) {
  const cfg = cloneConfig();
  const rng = makeRng(seed);
  const game = createGame(cfg, rng);
  game.start();
  game.state.ship.x = W / 2;
  game.state.ship.y = H / 2;
  game.state.ship.vx = 0;
  game.state.ship.vy = 0;
  game.state.ship.angle = 0;
  game.state.ship.invuln = 1e6;
  game.state.asteroids = [makeSentinel(cfg, seed + 9000)];
  return { cfg, rng, game };
}

function assertClose(actual, expected, epsilon = 1e-8, message) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    message ?? `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function rollForType(cfg, type, empStored = false) {
  const options = cfg.powerUps.types
    .map((candidate, index) => ({
      type: candidate,
      weight: cfg.powerUps.weights[index],
    }))
    .filter(option => !(option.type === 'emp' && empStored));
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  let before = 0;
  for (const option of options) {
    if (option.type === type) return (before + option.weight / 2) / total;
    before += option.weight;
  }
  throw new Error(`power-up type is unavailable: ${type}`);
}

function addNode(game, cfg, options = {}) {
  const carrier = makeAsteroid(
    cfg,
    'small',
    options.x ?? game.state.ship.x,
    options.y ?? game.state.ship.y,
    options.seed ?? 7000,
    { angle: options.angle ?? 0, dataCarrier: true },
  );
  const node = createDataNode(carrier, cfg);
  node.vx = options.vx ?? 0;
  node.vy = options.vy ?? 0;
  if (options.life !== undefined) node.life = options.life;
  game.state.dataNodes.push(node);
  return node;
}

function collectType(context, type) {
  const { cfg, rng, game } = context;
  rng.queue(rollForType(cfg, type, game.state.powerUps.empStored));
  const node = addNode(game, cfg);
  game.update(0, {});
  assert.equal(node.alive, false, `${type} node should be consumed`);
  assert.ok(!game.state.dataNodes.includes(node));
}

function activateWeapon(game, cfg, type) {
  game.state.powerUps.weapon = type;
  game.state.powerUps.weaponTime = cfg.powerUps[type].duration;
  game.state.powerUps.beamCooldown = 0;
  game.state.bulletCooldown = 0;
}

function stationaryProjectile(game, cfg, options = {}) {
  const bullet = createBullet(game.state.ship, cfg, {
    kind: options.kind ?? 'bullet',
    source: options.source ?? 'player',
    speed: options.speed,
    life: options.life,
    radius: options.radius,
    turnRate: options.turnRate,
    inheritVelocity: false,
  });
  bullet.x = options.x ?? 250;
  bullet.y = options.y ?? 100;
  bullet.vx = options.vx ?? 0;
  bullet.vy = options.vy ?? 0;
  return bullet;
}

test('power-ups: real CONFIG exposes all five types and clean initial state', () => {
  assert.deepEqual(CONFIG.powerUps.types, ['spread', 'beam', 'homing', 'emp', 'drones']);
  assert.equal(CONFIG.powerUps.weights.length, CONFIG.powerUps.types.length);
  assert.ok(CONFIG.powerUps.nodeLife > 0);
  assert.ok(CONFIG.powerUps.guaranteedCarriersPerWave >= 1);
  assert.ok(CONFIG.powerUps.maxCarriersPerWave >= CONFIG.powerUps.guaranteedCarriersPerWave);

  const cfg = cloneConfig();
  const game = createGame(cfg, makeRng(1));
  assert.deepEqual(game.state.dataNodes, []);
  assert.deepEqual(game.state.drones, []);
  assert.deepEqual(game.state.powerUps, {
    weapon: null,
    weaponTime: 0,
    dronesTime: 0,
    empStored: false,
    beamCooldown: 0,
    dronePhase: 0,
  });
  assert.equal(game.state.beam.active, false);
});

test('carriers: every spawned wave guarantees the configured bounded count', () => {
  const cfg = cloneConfig();
  const game = createGame(cfg, makeRng(2));
  game.start();

  for (let wave = 1; wave <= 4; wave++) {
    assert.equal(game.state.wave, wave);
    const carriers = game.state.asteroids.filter(asteroid => asteroid.dataCarrier);
    const guaranteed = Math.min(
      cfg.powerUps.guaranteedCarriersPerWave,
      game.state.asteroids.length,
    );
    assert.ok(
      carriers.length >= guaranteed,
      `wave ${wave}: expected at least ${guaranteed} carrier(s), got ${carriers.length}`,
    );
    assert.ok(
      carriers.length <= cfg.powerUps.maxCarriersPerWave,
      `wave ${wave}: carrier cap exceeded`,
    );

    if (wave < 4) {
      game.state.asteroids = [];
      game.update(0, {});
    }
  }
});

test('carrier: simultaneous hits score, split, and drop exactly once', () => {
  const { cfg, game } = setupGame(3);
  const carrier = makeAsteroid(cfg, 'large', 300, 300, 301, { dataCarrier: true });
  const sentinel = makeSentinel(cfg, 302);
  game.state.asteroids = [carrier, sentinel];

  const first = stationaryProjectile(game, cfg, { x: carrier.x, y: carrier.y });
  const second = stationaryProjectile(game, cfg, { x: carrier.x, y: carrier.y });
  game.state.bullets = [first, second];
  game.update(0, {});

  assert.equal(game.state.score, cfg.asteroid.largePoints);
  assert.equal(game.state.dataNodes.length, 1);
  assert.equal(game.state.dataNodes[0].x, carrier.x);
  assert.equal(game.state.dataNodes[0].y, carrier.y);
  assert.equal(game.state.asteroids.filter(a => a.size === 'medium').length, 2);
  assert.ok(game.state.asteroids.includes(sentinel));
  assert.equal(
    game.state.bullets.length,
    0,
    'all projectiles that hit the carrier at the same instant must be consumed',
  );
  game.update(0, {});
  assert.equal(game.state.score, cfg.asteroid.largePoints);
  assert.equal(game.state.dataNodes.length, 1);
  assert.equal(game.state.asteroids.filter(a => a.size === 'medium').length, 2);
});

test('carrier: a fresh drop cannot be collected until the next simulation step', () => {
  const context = setupGame(4);
  const { cfg, rng, game } = context;
  const carrier = makeAsteroid(
    cfg,
    'small',
    game.state.ship.x,
    game.state.ship.y,
    401,
    { dataCarrier: true },
  );
  game.state.asteroids = [carrier, makeSentinel(cfg, 402)];
  game.state.powerUps.empStored = true;

  game.update(0, { emp: true });
  assert.equal(game.state.dataNodes.length, 1);
  assert.equal(game.state.powerUps.weapon, null);

  rng.queue(rollForType(cfg, 'spread'));
  game.update(0, {});
  assert.equal(game.state.dataNodes.length, 0);
  assert.equal(game.state.powerUps.weapon, 'spread');
  assert.equal(game.state.powerUps.weaponTime, cfg.powerUps.spread.duration);
});

test('Data Node: expires cleanly without granting a power-up', () => {
  const { cfg, game } = setupGame(5);
  const node = addNode(game, cfg, { x: 700, y: 550, life: 0.05 });
  game.update(0.051, {});

  assert.equal(node.alive, false);
  assert.equal(game.state.dataNodes.length, 0);
  assert.equal(game.state.powerUps.weapon, null);
  assert.equal(game.state.powerUps.dronesTime, 0);
  assert.equal(game.state.powerUps.empStored, false);
});

test('Data Node: swept dash pickup and toroidal endpoint pickup cannot tunnel', () => {
  const dashContext = setupGame(6);
  const { cfg: dashCfg, rng: dashRng, game: dashGame } = dashContext;
  dashGame.state.ship.x = 100;
  dashGame.state.ship.y = 300;
  dashGame.state.ship.angle = 0;
  const sweptNode = addNode(dashGame, dashCfg, { x: 200, y: 300 });
  dashRng.queue(rollForType(dashCfg, 'homing'));

  dashGame.update(dashCfg.abilities.dash.duration, { dash: true });
  assert.equal(sweptNode.alive, false);
  assert.equal(dashGame.state.powerUps.weapon, 'homing');

  const seamContext = setupGame(7);
  const { cfg: seamCfg, rng: seamRng, game: seamGame } = seamContext;
  seamGame.state.ship.x = 790;
  seamGame.state.ship.y = 300;
  const seamNode = addNode(seamGame, seamCfg, { x: 5, y: 300 });
  seamRng.queue(rollForType(seamCfg, 'beam'));

  seamGame.update(0, {});
  assert.equal(seamNode.alive, false);
  assert.equal(seamGame.state.powerUps.weapon, 'beam');
});

test('slots: primary pickups refresh or replace while drones and EMP stay independent', () => {
  const context = setupGame(8);
  const { cfg, game } = context;

  collectType(context, 'spread');
  assert.equal(game.state.powerUps.weapon, 'spread');
  game.update(1, {});
  assertClose(game.state.powerUps.weaponTime, cfg.powerUps.spread.duration - 1);

  collectType(context, 'spread');
  assert.equal(game.state.powerUps.weaponTime, cfg.powerUps.spread.duration);

  game.state.bulletCooldown = 0.17;
  collectType(context, 'beam');
  assert.equal(game.state.powerUps.weapon, 'beam');
  assert.equal(game.state.powerUps.weaponTime, cfg.powerUps.beam.duration);
  assert.equal(game.state.bulletCooldown, 0);
  assert.equal(game.state.powerUps.beamCooldown, 0);

  collectType(context, 'drones');
  assert.equal(game.state.powerUps.weapon, 'beam');
  assert.equal(game.state.powerUps.dronesTime, cfg.powerUps.drones.duration);
  assert.equal(game.state.drones.length, cfg.powerUps.drones.count);

  collectType(context, 'emp');
  assert.equal(game.state.powerUps.weapon, 'beam');
  assert.equal(game.state.powerUps.empStored, true);
});

test('timers: primary and drone durations expire at zero without going negative', () => {
  const context = setupGame(9);
  const { cfg, game } = context;
  collectType(context, 'spread');
  collectType(context, 'drones');

  game.update(cfg.powerUps.spread.duration - 0.001, {});
  assert.equal(game.state.powerUps.weapon, 'spread');
  assert.ok(game.state.powerUps.weaponTime > 0);

  game.update(0.002, {});
  assert.equal(game.state.powerUps.weapon, null);
  assert.equal(game.state.powerUps.weaponTime, 0);

  const droneRemaining = game.state.powerUps.dronesTime;
  assert.ok(droneRemaining > 0);
  game.update(droneRemaining + 0.001, {});
  assert.equal(game.state.powerUps.dronesTime, 0);
  assert.deepEqual(game.state.drones, []);
});

test('timers: a primary weapon remains usable for the final partial step, then expires', () => {
  const { cfg, game } = setupGame(901);
  activateWeapon(game, cfg, 'spread');
  game.state.powerUps.weaponTime = 0.01;

  game.update(0.02, { fire: true });

  assert.equal(
    game.state.bullets.filter(bullet => bullet.kind === 'spread').length,
    cfg.powerUps.spread.count,
  );
  assert.equal(game.state.powerUps.weapon, null);
  assert.equal(game.state.powerUps.weaponTime, 0);
});

test('spread: fires the configured atomic three-shot fan with inherited velocity', () => {
  const { cfg, game } = setupGame(10);
  activateWeapon(game, cfg, 'spread');
  game.state.ship.vx = 35;
  game.state.ship.vy = -12;
  game.state.ship.angle = 0;

  game.update(0, { fire: true });

  assert.equal(game.state.bullets.length, cfg.powerUps.spread.count);
  assert.ok(game.state.bullets.every(bullet => bullet.kind === 'spread'));
  const expectedAngles = [-cfg.powerUps.spread.angle, 0, cfg.powerUps.spread.angle];
  game.state.bullets.forEach((bullet, index) => {
    assertClose(
      Math.atan2(bullet.vy - game.state.ship.vy, bullet.vx - game.state.ship.vx),
      expectedAngles[index],
    );
    assertClose(
      Math.hypot(bullet.vx - game.state.ship.vx, bullet.vy - game.state.ship.vy),
      cfg.bullet.speed,
    );
  });
  assert.equal(game.state.bulletCooldown, cfg.powerUps.spread.cooldown);
});

test('spread: volley is atomic at the powered projectile cap', () => {
  const { cfg, game } = setupGame(11);
  activateWeapon(game, cfg, 'spread');
  const spread = cfg.powerUps.spread;

  game.state.bullets = Array.from(
    { length: spread.maxProjectiles - spread.count + 1 },
    (_, index) => stationaryProjectile(game, cfg, { x: 200 + index, y: 100 }),
  );
  const blockedCount = game.state.bullets.length;
  game.update(0, { fire: true });
  assert.equal(game.state.bullets.length, blockedCount);
  assert.equal(game.state.bulletCooldown, 0);

  game.state.bullets.length = spread.maxProjectiles - spread.count;
  game.update(0, { fire: true });
  assert.equal(game.state.bullets.length, spread.maxProjectiles);
  assert.equal(game.state.bulletCooldown, spread.cooldown);
});

test('spread: swept toroidal collision scores and drops a shared target once', () => {
  const { cfg, game } = setupGame(12);
  activateWeapon(game, cfg, 'spread');
  game.state.ship.x = 780;
  game.state.ship.y = 300;
  game.state.ship.angle = 0;
  const carrier = makeAsteroid(cfg, 'small', 40, 300, 1201, { dataCarrier: true });
  game.state.asteroids = [carrier, makeSentinel(cfg, 1202)];

  game.update(0.1, { fire: true });

  assert.equal(carrier.alive, false);
  assert.equal(game.state.score, cfg.asteroid.smallPoints);
  assert.equal(game.state.dataNodes.length, 1);
});

test('beam: toroidal ray kills only the nearest target and obeys tick cooldown', () => {
  const { cfg, game } = setupGame(13);
  activateWeapon(game, cfg, 'beam');
  game.state.ship.x = 780;
  game.state.ship.y = 300;
  game.state.ship.angle = 0;

  const near = makeAsteroid(cfg, 'small', 40, 300, 1301);
  const far = makeAsteroid(cfg, 'small', 160, 300, 1302);
  const behind = makeAsteroid(cfg, 'small', 740, 300, 1303);
  game.state.asteroids = [near, far, behind];

  game.update(0, { fire: true });
  assert.equal(game.state.beam.active, true);
  assert.equal(near.alive, false);
  assert.equal(far.alive, true);
  assert.equal(behind.alive, true);
  assert.equal(game.state.score, cfg.asteroid.smallPoints);
  assert.ok(game.state.beam.length < cfg.powerUps.beam.range);
  assert.equal(game.state.powerUps.beamCooldown, cfg.powerUps.beam.tickCooldown);

  game.update(cfg.powerUps.beam.tickCooldown - 0.001, { fire: true });
  assert.equal(far.alive, true);
  assert.equal(game.state.score, cfg.asteroid.smallPoints);

  game.update(0.002, { fire: true });
  assert.equal(far.alive, false);
  assert.equal(behind.alive, true);
  assert.equal(game.state.score, cfg.asteroid.smallPoints * 2);

  game.update(0, { fire: false });
  assert.equal(game.state.beam.active, false);
});

test('homing: missile uses configured speed and turns toward the nearest toroidal target', () => {
  const { cfg, game } = setupGame(14);
  activateWeapon(game, cfg, 'homing');
  game.state.ship.x = 760;
  game.state.ship.y = 300;
  game.state.ship.angle = 0;
  game.state.ship.vx = 300;

  const acrossSeam = makeAsteroid(cfg, 'small', 20, 250, 1401);
  const localButFarther = makeAsteroid(cfg, 'small', 80, 350, 1402);
  game.state.asteroids = [acrossSeam, localButFarther];

  game.update(0, { fire: true });
  const missile = game.state.bullets[0];
  assert.equal(missile.kind, 'missile');
  assertClose(Math.hypot(missile.vx, missile.vy), cfg.powerUps.homing.speed);
  assert.equal(game.state.bulletCooldown, cfg.powerUps.homing.cooldown);

  game.update(0.1, {});
  const firstAngle = Math.atan2(missile.vy, missile.vx);
  assertClose(firstAngle, -cfg.powerUps.homing.turnRate * 0.1);

  game.state.asteroids = [localButFarther];
  game.update(0.1, {});
  const reacquiredAngle = Math.atan2(missile.vy, missile.vx);
  assert.ok(reacquiredAngle > firstAngle, 'missile should turn back toward the surviving target');
  assert.ok(
    reacquiredAngle - firstAngle <= cfg.powerUps.homing.turnRate * 0.1 + 1e-9,
    'reacquisition must still obey the turn-rate cap',
  );
});

test('homing: max missile cap is exact and a seam crossing is collision-swept', () => {
  const capContext = setupGame(15);
  const { cfg: capCfg, game: capGame } = capContext;
  activateWeapon(capGame, capCfg, 'homing');
  for (let i = 0; i < capCfg.powerUps.homing.maxMissiles + 3; i++) {
    capGame.state.bulletCooldown = 0;
    capGame.update(0, { fire: true });
  }
  assert.equal(
    capGame.state.bullets.filter(bullet => bullet.kind === 'missile').length,
    capCfg.powerUps.homing.maxMissiles,
  );

  const sweepContext = setupGame(16);
  const { cfg, game } = sweepContext;
  activateWeapon(game, cfg, 'homing');
  game.state.ship.x = 760;
  game.state.ship.y = 300;
  game.state.ship.angle = 0;
  const carrier = makeAsteroid(cfg, 'small', 20, 300, 1601, { dataCarrier: true });
  game.state.asteroids = [carrier, makeSentinel(cfg, 1602)];

  game.update(0.1, { fire: true });
  assert.equal(carrier.alive, false);
  assert.equal(game.state.score, cfg.asteroid.smallPoints);
  assert.equal(game.state.dataNodes.length, 1);
});

test('homing: powered global cap includes legacy player projectiles', () => {
  const { cfg, game } = setupGame(1603);
  activateWeapon(game, cfg, 'homing');
  game.state.bullets = Array.from(
    { length: cfg.bullet.poweredMax },
    (_, index) => stationaryProjectile(game, cfg, { x: 200 + index, y: 100 }),
  );

  game.update(0, { fire: true });

  assert.equal(game.state.bullets.length, cfg.bullet.poweredMax);
  assert.equal(game.state.bullets.some(bullet => bullet.kind === 'missile'), false);
  assert.equal(game.state.bulletCooldown, 0);
});

test('projectile sweep: resolves the frozen and moving phases of a partially stunned target', () => {
  const { cfg, game } = setupGame(1604);
  const bullet = stationaryProjectile(game, cfg, {
    x: 100,
    y: 100,
    vx: 516.7288876,
    vy: 58.2344979,
  });
  const target = makeAsteroid(cfg, 'small', 116.1127526, 89.2336465, 160401, {
    vx: 140.2428701,
    vy: -287.6316001,
  });
  target.stun = 0.0099039169;
  game.state.bullets = [bullet];
  game.state.asteroids = [target, makeSentinel(cfg, 160402)];

  game.update(cfg.game.fixedStep, {});

  assert.equal(target.alive, false);
  assert.equal(game.state.score, cfg.asteroid.smallPoints);
  assert.equal(game.state.bullets.length, 0);
});

test('EMP: one stored charge destroys smalls, stuns medium/large, and cannot repeat', () => {
  const { cfg, game } = setupGame(17);
  game.state.powerUps.empStored = true;
  const smallCarrier = makeAsteroid(cfg, 'small', 100, 100, 1701, { dataCarrier: true });
  const otherSmall = makeAsteroid(cfg, 'small', 700, 500, 1702);
  const medium = makeAsteroid(cfg, 'medium', 200, 450, 1703, {
    vx: 40,
    vy: -20,
    rotSpeed: 0.5,
  });
  const large = makeAsteroid(cfg, 'large', 650, 150, 1704, {
    vx: -30,
    vy: 10,
    rotSpeed: -0.25,
  });
  game.state.asteroids = [smallCarrier, otherSmall, medium, large];

  game.update(0, { emp: true });

  assert.equal(game.state.powerUps.empStored, false);
  assert.equal(game.state.score, cfg.asteroid.smallPoints * 2);
  assert.equal(game.state.dataNodes.length, 1);
  assert.equal(medium.stun, cfg.powerUps.emp.stunDuration);
  assert.equal(large.stun, cfg.powerUps.emp.stunDuration);
  assert.ok(game.state.asteroids.includes(medium));
  assert.ok(game.state.asteroids.includes(large));
  assert.equal(game.state.effects.filter(effect => effect.kind === 'emp').length, 1);

  game.update(0, { emp: true });
  assert.equal(game.state.score, cfg.asteroid.smallPoints * 2);
  assert.equal(game.state.dataNodes.length, 1);
  assert.equal(game.state.effects.filter(effect => effect.kind === 'emp').length, 1);
});

test('EMP: stun freezes motion/rotation, then resumes for only the excess dt', () => {
  const { cfg, game } = setupGame(18);
  game.state.powerUps.empStored = true;
  const asteroid = makeAsteroid(cfg, 'medium', 200, 200, 1801, {
    vx: 50,
    vy: -20,
    rotSpeed: 0.75,
  });
  game.state.asteroids = [asteroid];
  game.update(0, { emp: true });

  const initial = { x: asteroid.x, y: asteroid.y, angle: asteroid.angle };
  game.update(cfg.powerUps.emp.stunDuration - 0.1, {});
  assertClose(asteroid.x, initial.x);
  assertClose(asteroid.y, initial.y);
  assertClose(asteroid.angle, initial.angle);
  assertClose(asteroid.stun, 0.1);

  game.update(0.2, {});
  assert.equal(asteroid.stun, 0);
  assertClose(asteroid.x, initial.x + asteroid.vx * 0.1);
  assertClose(asteroid.y, initial.y + asteroid.vy * 0.1);
  assertClose(asteroid.angle, initial.angle + asteroid.rotSpeed * 0.1);
});

test('drones: exactly two orbit opposite each other and target across a seam', () => {
  const context = setupGame(19);
  const { cfg, game } = context;
  game.state.ship.x = 740;
  game.state.ship.y = 300;
  game.state.asteroids = [
    makeAsteroid(cfg, 'small', 10, 300, 1901),
    makeAsteroid(cfg, 'small', 550, 450, 1902),
  ];
  collectType(context, 'drones');

  assert.equal(game.state.drones.length, cfg.powerUps.drones.count);
  const [first, second] = game.state.drones;
  assertClose(
    torusDistance(first.x, first.y, game.state.ship.x, game.state.ship.y, W, H),
    cfg.powerUps.drones.orbitRadius,
  );
  assertClose(
    torusDistance(second.x, second.y, game.state.ship.x, game.state.ship.y, W, H),
    cfg.powerUps.drones.orbitRadius,
  );
  assertClose(torusDelta(first.x, second.x, W), -cfg.powerUps.drones.orbitRadius * 2);

  game.update(0, {});
  const droneShots = game.state.bullets.filter(bullet => bullet.source === 'drone');
  assert.equal(droneShots.length, 1, 'the initially-ready drone should fire once');
  assert.ok(droneShots[0].vx > 0, 'shortest toroidal aim should point right across the seam');
  assertClose(Math.hypot(droneShots[0].vx, droneShots[0].vy), cfg.powerUps.drones.bulletSpeed);
});

test('drones: projectile cap is hard and expiry removes orbiters but not live shots', () => {
  const context = setupGame(20);
  const { cfg, game } = context;
  collectType(context, 'drones');
  game.state.asteroids = [makeAsteroid(cfg, 'small', 500, 300, 2001)];
  game.state.bullets = Array.from(
    { length: cfg.powerUps.drones.maxProjectiles },
    (_, index) => stationaryProjectile(game, cfg, {
      source: 'drone',
      kind: 'drone',
      x: 100 + index,
      y: 100,
      life: 1,
    }),
  );
  for (const drone of game.state.drones) drone.cooldown = 0;
  game.update(0, {});
  assert.equal(
    game.state.bullets.filter(bullet => bullet.source === 'drone').length,
    cfg.powerUps.drones.maxProjectiles,
  );

  game.state.powerUps.dronesTime = 0.01;
  const survivingShot = game.state.bullets[0];
  game.update(0.02, {});
  assert.equal(game.state.powerUps.dronesTime, 0);
  assert.deepEqual(game.state.drones, []);
  assert.ok(game.state.bullets.includes(survivingShot));
  assertClose(survivingShot.life, 0.98);
});

test('pause: every power-up timer, projectile, node, drone, stun, and effect freezes', () => {
  const context = setupGame(21);
  const { cfg, game } = context;
  activateWeapon(game, cfg, 'homing');
  collectType(context, 'drones');
  game.state.powerUps.empStored = true;
  game.state.powerUps.beamCooldown = 0.1;
  game.state.bulletCooldown = 0.2;
  game.state.bullets.push(stationaryProjectile(game, cfg, {
    kind: 'missile',
    speed: cfg.powerUps.homing.speed,
    life: 1.5,
    turnRate: cfg.powerUps.homing.turnRate,
  }));
  addNode(game, cfg, { x: 700, y: 550, life: 4 });
  game.state.asteroids[0].stun = 1.25;
  game.state.effects.push({
    kind: 'test', x: 10, y: 10, age: 0.1, duration: 2, maxRadius: 20,
  });

  game.pause();
  const before = structuredClone(game.state);
  game.update(10, { fire: true, emp: true, dash: true });
  assert.deepEqual(game.state, before);
});

test('restart: clears every temporary weapon object while preserving high score', () => {
  const context = setupGame(22);
  const { cfg, game } = context;
  activateWeapon(game, cfg, 'beam');
  collectType(context, 'drones');
  game.state.powerUps.empStored = true;
  addNode(game, cfg, { x: 700, y: 550 });
  game.state.bullets.push(stationaryProjectile(game, cfg));
  game.state.beam.active = true;
  game.state.beam.length = 123;
  game.state.highScore = 4321;

  game.restart();

  assert.equal(game.state.highScore, 4321);
  assert.equal(game.state.powerUps.weapon, null);
  assert.equal(game.state.powerUps.weaponTime, 0);
  assert.equal(game.state.powerUps.dronesTime, 0);
  assert.equal(game.state.powerUps.empStored, false);
  assert.equal(game.state.powerUps.beamCooldown, 0);
  assert.equal(game.state.powerUps.dronePhase, 0);
  assert.deepEqual(game.state.dataNodes, []);
  assert.deepEqual(game.state.drones, []);
  assert.deepEqual(game.state.bullets, []);
  assert.equal(game.state.beam.active, false);
  assert.equal(game.state.beam.length, 0);
  assert.ok(
    game.state.asteroids.filter(asteroid => asteroid.dataCarrier).length
      >= cfg.powerUps.guaranteedCarriersPerWave,
  );
});

test('resize: canonicalizes all power-up entities without changing resources or timers', () => {
  const { cfg, game } = setupGame(23);
  activateWeapon(game, cfg, 'homing');
  game.state.powerUps.weaponTime = 4.25;
  game.state.powerUps.dronesTime = 3.75;
  game.state.powerUps.empStored = true;
  const node = addNode(game, cfg, { x: 950, y: 750, life: 5 });
  const missile = stationaryProjectile(game, cfg, {
    kind: 'missile', x: 920, y: 620, life: 1.2,
  });
  game.state.bullets = [missile];
  game.state.drones = [{
    x: 830, y: 620, radius: 7, visualRadius: 13,
    phaseOffset: 0, cooldown: 0.4, angle: 0,
  }];
  game.state.beam.x = 810;
  game.state.beam.y = 610;
  game.state.beam.active = true;
  game.state.effects.push({
    kind: 'test', x: 870, y: 640, age: 0.2, duration: 1, maxRadius: 10,
  });
  const before = {
    weaponTime: game.state.powerUps.weaponTime,
    dronesTime: game.state.powerUps.dronesTime,
    empStored: game.state.powerUps.empStored,
    nodeLife: node.life,
    missileLife: missile.life,
    droneCooldown: game.state.drones[0].cooldown,
    effectAge: game.state.effects.at(-1).age,
  };

  game.resize(200, 150);

  assert.deepEqual({ x: node.x, y: node.y }, { x: 150, y: 0 });
  assert.deepEqual({ x: missile.x, y: missile.y }, { x: 120, y: 20 });
  assert.deepEqual(
    { x: game.state.drones[0].x, y: game.state.drones[0].y },
    { x: 30, y: 20 },
  );
  assert.deepEqual({ x: game.state.beam.x, y: game.state.beam.y }, { x: 10, y: 10 });
  assert.deepEqual(
    { x: game.state.effects.at(-1).x, y: game.state.effects.at(-1).y },
    { x: 70, y: 40 },
  );
  assert.deepEqual(
    {
      weaponTime: game.state.powerUps.weaponTime,
      dronesTime: game.state.powerUps.dronesTime,
      empStored: game.state.powerUps.empStored,
      nodeLife: node.life,
      missileLife: missile.life,
      droneCooldown: game.state.drones[0].cooldown,
      effectAge: game.state.effects.at(-1).age,
    },
    before,
  );
  assert.equal(cfg.world.width, 200);
  assert.equal(cfg.world.height, 150);
  assert.equal(CONFIG.world.width, W);
  assert.equal(CONFIG.world.height, H);
});

test('input: KeyF is queued, edge-triggered, consumed once, and cleared on blur', () => {
  const fakeWindow = {
    handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
    removeEventListener() {},
  };
  const actions = [];
  const onAction = action => actions.push(action);
  const input = createInputManager(fakeWindow, onAction);
  input.setActive(true);
  let prevented = 0;
  const event = {
    code: 'KeyF',
    repeat: false,
    preventDefault() { prevented++; },
  };

  fakeWindow.handlers.keydown(event);
  assert.equal(prevented, 1);
  assert.equal(input.getInput().emp, true);
  assert.equal(input.getInput().emp, true, 'render-only frames must retain the press');

  input.consumePresses();
  assert.equal(input.getInput().emp, false);
  fakeWindow.handlers.keydown({ ...event, repeat: true });
  assert.equal(input.getInput().emp, false, 'keyboard repeat must not queue EMP again');

  fakeWindow.handlers.keydown(event);
  assert.equal(input.getInput().emp, true);
  fakeWindow.handlers.blur();
  assert.equal(input.getInput().emp, false);
  assert.deepEqual(actions, ['blur']);
});
