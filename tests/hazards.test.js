import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame } from '../src/game.js';
import {
  createAsteroid,
  createBullet,
  createEnemyBullet,
  createGravityAnomaly,
  createIceCloud,
  createMine,
  createUfo,
} from '../src/entities.js';
import { torusDelta } from '../src/math.js';

const W = CONFIG.world.width;
const H = CONFIG.world.height;

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

function makeAsteroid(cfg, size, x, y, kind = 'normal', seed = 1) {
  const asteroid = createAsteroid(size, x, y, cfg, makeRng(seed), 1, kind);
  asteroid.vx = 0;
  asteroid.vy = 0;
  asteroid.rotSpeed = 0;
  return asteroid;
}

function setupGame(seed = 1) {
  const cfg = cloneConfig();
  if (cfg.ufo.squadSize) cfg.ufo.squadSize.growthPerWave = 0;
  const game = createGame(cfg, makeRng(seed));
  game.start();
  game.state.ship.invuln = 0;
  return { cfg, game };
}

function projectileAt(game, cfg, target) {
  const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
  bullet.x = target.x;
  bullet.y = target.y;
  bullet.vx = 0;
  bullet.vy = 0;
  return bullet;
}

function hitAsteroid(game, cfg, asteroid) {
  game.state.bullets.push(projectileAt(game, cfg, asteroid));
  game.update(0, {});
}

function advanceWave(game) {
  game.state.asteroids = [];
  // This test only samples each wave's spawn table, so remove the preceding
  // squad before asking the game to advance to the next wave.
  game.state.ufos = [];
  game.update(0, {});
}

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('waves introduce normal, magma, cryo, crystal/gravity, then all five UFO kinds', () => {
  const { game } = setupGame(11);

  assert.equal(game.state.wave, 1);
  assert.ok(game.state.asteroids.every(asteroid => asteroid.kind === 'normal'));
  assert.deepEqual(game.state.anomalies, []);
  assert.deepEqual(game.state.ufos, []);

  advanceWave(game);
  assert.equal(game.state.wave, 2);
  assert.ok(game.state.asteroids.some(asteroid => asteroid.kind === 'magma'));
  assert.deepEqual(game.state.anomalies, []);
  assert.deepEqual(game.state.ufos, []);

  advanceWave(game);
  assert.equal(game.state.wave, 3);
  assert.ok(game.state.asteroids.some(asteroid => asteroid.kind === 'cryo'));
  assert.deepEqual(game.state.anomalies, []);
  assert.deepEqual(game.state.ufos, []);

  advanceWave(game);
  assert.equal(game.state.wave, 4);
  assert.ok(game.state.asteroids.some(asteroid => asteroid.kind === 'crystal'));
  assert.equal(game.state.anomalies.length, 1);
  assert.equal(game.state.anomalies[0].kind, 'gravity');
  assert.deepEqual(game.state.ufos, []);

  advanceWave(game);
  assert.equal(game.state.wave, 5);
  assert.equal(game.state.ufos.length, 1);
  assert.equal(game.state.ufos[0].kind, 'hunter');

  advanceWave(game);
  assert.equal(game.state.wave, 6);
  assert.equal(game.state.ufos.length, 1);
  assert.equal(game.state.ufos[0].kind, 'base');

  advanceWave(game);
  assert.equal(game.state.wave, 7);
  assert.equal(game.state.ufos.length, 1);
  assert.equal(game.state.ufos[0].kind, 'scout');

  advanceWave(game);
  assert.equal(game.state.wave, 8);
  assert.equal(game.state.ufos.length, 1);
  assert.equal(game.state.ufos[0].kind, 'fighter');

  advanceWave(game);
  assert.equal(game.state.wave, 9);
  assert.equal(game.state.ufos.length, 1);
  assert.equal(game.state.ufos[0].kind, 'bomber');
});

test('magma blast is toroidal and lethal, chains exactly once, and costs at most one life', () => {
  const { cfg, game } = setupGame(12);
  const ship = game.state.ship;
  ship.x = 10;
  ship.y = 300;
  ship.vx = 0;
  ship.vy = 0;
  ship.invuln = 0;

  const first = makeAsteroid(cfg, 'small', 790, 300, 'magma', 121);
  const chained = makeAsteroid(cfg, 'small', 100, 300, 'magma', 122);
  const toughVictim = makeAsteroid(cfg, 'small', 220, 300, 'crystal', 123);
  toughVictim.dataCarrier = true;
  const sentinel = makeAsteroid(cfg, 'small', 450, 60, 'normal', 124);
  assert.equal(toughVictim.hp, 2, 'the AoE fixture must require multiple direct hits');
  game.state.asteroids = [first, chained, toughVictim, sentinel];

  const livesBefore = game.state.lives;
  hitAsteroid(game, cfg, first);

  assert.equal(game.state.lives, livesBefore - 1);
  assert.equal(game.state.score, cfg.asteroid.smallPoints * 3);
  assert.deepEqual(game.state.asteroids, [sentinel]);
  assert.equal(toughVictim.hp, 2, 'magma AoE is lethal instead of ordinary HP damage');
  assert.equal(game.state.dataNodes.length, 1, 'the chained carrier still drops its reward');

  const blasts = game.state.effects.filter(effect => effect.kind === 'magmaExplosion');
  assert.equal(blasts.length, 2, 'each destroyed magma creates one blast effect');
  assert.deepEqual(blasts.map(effect => effect.x), [790, 100]);
  assert.ok(blasts.every(effect => effect.maxRadius === cfg.asteroid.types.magma.explosionRadius));
});

test('cryo destruction creates a finite cloud whose contact slows rotation temporarily', () => {
  const { cfg, game } = setupGame(13);
  const cryo = makeAsteroid(cfg, 'small', 300, 300, 'cryo', 131);
  const sentinel = makeAsteroid(cfg, 'small', 650, 50, 'normal', 132);
  game.state.asteroids = [cryo, sentinel];
  game.state.ship.x = 100;
  game.state.ship.y = 300;

  hitAsteroid(game, cfg, cryo);

  assert.equal(game.state.iceClouds.length, 1);
  const cloud = game.state.iceClouds[0];
  assert.equal(cloud.x, 300);
  assert.equal(cloud.y, 300);
  assert.equal(cloud.life, cfg.asteroid.types.cryo.cloudLife);
  assert.equal(cloud.slowDuration, cfg.asteroid.types.cryo.slowDuration);
  assert.equal(game.state.effects.filter(effect => effect.kind === 'cryoBurst').length, 1);

  const ship = game.state.ship;
  ship.x = cloud.x;
  ship.y = cloud.y;
  ship.vx = 0;
  ship.vy = 0;
  game.update(0, {});
  assert.equal(ship.cryoSlowTime, cfg.asteroid.types.cryo.slowDuration);

  ship.x = 500;
  ship.y = 300;
  ship.angle = 0;
  game.update(0.25, { rotRight: true });
  assertClose(
    ship.angle,
    cfg.ship.rotSpeed * cfg.asteroid.types.cryo.rotationMultiplier * 0.25,
  );
  assertClose(ship.cryoSlowTime, cfg.asteroid.types.cryo.slowDuration - 0.25);

  game.update(ship.cryoSlowTime + 0.001, {});
  assert.equal(ship.cryoSlowTime, 0);
  const angleBefore = ship.angle;
  game.update(0.25, { rotRight: true });
  assertClose(ship.angle - angleBefore, cfg.ship.rotSpeed * 0.25);

  game.update(cfg.asteroid.types.cryo.cloudLife, {});
  assert.deepEqual(game.state.iceClouds, []);
});

test('crystal HP gates score, fragmentation, and its single guaranteed carrier drop', () => {
  const { cfg, game } = setupGame(14);
  const target = makeAsteroid(cfg, 'large', 400, 300, 'crystal', 141);
  target.dataCarrier = true;
  const sentinel = makeAsteroid(cfg, 'small', 700, 50, 'normal', 142);
  const mediumProbe = makeAsteroid(cfg, 'medium', 0, 0, 'crystal', 143);
  const smallProbe = makeAsteroid(cfg, 'small', 0, 0, 'crystal', 144);

  assert.deepEqual(
    [target.hp, mediumProbe.hp, smallProbe.hp],
    [3, 2, 2],
    'crystal HP must match the documented size table',
  );
  game.state.asteroids = [target, sentinel];
  game.state.ship.x = 100;
  game.state.ship.y = 300;

  hitAsteroid(game, cfg, target);
  assert.equal(target.hp, 2);
  assert.equal(game.state.score, 0);
  assert.deepEqual(game.state.asteroids, [target, sentinel]);
  assert.deepEqual(game.state.dataNodes, []);

  hitAsteroid(game, cfg, target);
  assert.equal(target.hp, 1);
  assert.equal(game.state.score, 0);
  assert.deepEqual(game.state.asteroids, [target, sentinel]);
  assert.deepEqual(game.state.dataNodes, []);
  assert.equal(game.state.effects.filter(effect => effect.kind === 'crystalHit').length, 2);

  hitAsteroid(game, cfg, target);
  assert.equal(game.state.score, cfg.asteroid.largePoints);
  assert.equal(game.state.asteroids.includes(target), false);
  const fragments = game.state.asteroids.filter(asteroid => asteroid !== sentinel);
  assert.equal(fragments.length, cfg.asteroid.childrenPerSplit);
  assert.ok(fragments.every(asteroid => asteroid.size === 'medium'));
  assert.ok(fragments.every(asteroid => asteroid.kind === 'crystal' && asteroid.hp === 2));
  assert.equal(game.state.dataNodes.length, 1, 'crystal + carrier conditions collapse to one Node');
});

test('gravity uses toroidal pull for ship, asteroid, and projectile and curves the shot', () => {
  const { cfg, game } = setupGame(15);
  const ship = game.state.ship;
  ship.x = 10;
  ship.y = 300;
  ship.vx = 0;
  ship.vy = 0;

  const asteroid = makeAsteroid(cfg, 'large', 10, 200, 'normal', 151);
  const anomaly = createGravityAnomaly(790, 300, cfg);
  const bullet = createBullet(ship, cfg, { angle: 0, inheritVelocity: false });
  bullet.x = 10;
  bullet.y = 400;
  const bulletVelocityBefore = { vx: bullet.vx, vy: bullet.vy };

  game.state.asteroids = [asteroid];
  game.state.anomalies = [anomaly];
  game.state.bullets = [bullet];
  game.update(0.1, {});

  assert.ok(ship.vx < 0, 'ship must take the short pull across the left seam');
  assertClose(ship.vy, 0);

  const asteroidPull = {
    x: torusDelta(10, anomaly.x, W),
    y: torusDelta(200, anomaly.y, H),
  };
  assert.ok(asteroid.vx * asteroidPull.x + asteroid.vy * asteroidPull.y > 0);

  const bulletPull = {
    x: torusDelta(10, anomaly.x, W),
    y: torusDelta(400, anomaly.y, H),
  };
  const bulletDeltaV = {
    x: bullet.vx - bulletVelocityBefore.vx,
    y: bullet.vy - bulletVelocityBefore.vy,
  };
  assert.ok(bulletDeltaV.x * bulletPull.x + bulletDeltaV.y * bulletPull.y > 0);
  assert.ok(bullet.vx < bulletVelocityBefore.vx);
  assert.ok(bullet.vy < 0, 'the initially horizontal projectile must acquire curvature');
});

test('hunter emits a toroidally aimed bullet and base emits a stationary mine', () => {
  const { cfg, game } = setupGame(16);
  game.state.asteroids = [makeAsteroid(cfg, 'small', 400, 50, 'normal', 161)];
  const ship = game.state.ship;
  ship.x = 20;
  ship.y = 300;
  ship.vx = 0;
  ship.vy = 0;

  const hunter = createUfo('hunter', 700, 300, cfg, makeRng(162));
  hunter.speed = 0;
  hunter.vx = 0;
  hunter.vy = 0;
  hunter.fireTimer = 0;
  game.state.ufos = [hunter];
  game.update(0, {});

  assert.equal(game.state.enemyBullets.length, 1);
  const enemyBullet = game.state.enemyBullets[0];
  assert.equal(enemyBullet.kind, 'enemyBullet');
  assert.equal(enemyBullet.source, 'enemy');
  assert.ok(enemyBullet.vx > 0, 'aiming must cross the right seam toward the ship');
  assertClose(enemyBullet.vy, 0, 1e-8);
  assert.equal(hunter.fireTimer, cfg.ufo.hunter.fireCooldown);

  const base = createUfo('base', 500, 100, cfg, makeRng(163));
  base.speed = 0;
  base.vx = 0;
  base.vy = 0;
  base.mineTimer = 0;
  game.state.ufos = [base];
  game.state.enemyBullets = [];
  game.update(0, {});

  assert.equal(game.state.mines.length, 1);
  const mine = game.state.mines[0];
  assert.equal(mine.kind, 'mine');
  assert.equal(mine.x, base.x);
  assert.equal(mine.y, base.y);
  assert.equal(mine.vx, 0);
  assert.equal(mine.vy, 0);
  assert.equal(mine.armed, false);
  assert.equal(mine.armTime, cfg.ufo.mine.armDelay);

  game.update(cfg.ufo.mine.armDelay / 2, {});
  assert.equal(mine.x, base.x);
  assert.equal(mine.y, base.y);
  assertClose(mine.armTime, cfg.ufo.mine.armDelay / 2);
});

test('an enemy bullet damages a vulnerable ship and is consumed', () => {
  const { cfg, game } = setupGame(17);
  const ship = game.state.ship;
  ship.x = 400;
  ship.y = 300;
  ship.vx = 0;
  ship.vy = 0;
  ship.invuln = 0;
  game.state.asteroids = [makeAsteroid(cfg, 'small', 700, 50, 'normal', 171)];

  const hunter = createUfo('hunter', 100, 300, cfg, makeRng(172));
  const bullet = createEnemyBullet(hunter, ship, cfg, W, H);
  // The shield now absorbs non-asteroid hits. Force a direct life loss by
  // zeroing the shield *and* ensuring no regeneration occurs during travel.
  ship.shield = 0;
  ship.shieldRegenDelay = 100;
  game.state.enemyBullets = [bullet];
  const livesBefore = game.state.lives;

  const travelTime = Math.min(
    bullet.life,
    W / Math.max(1, cfg.ufo.enemyBullet.speed)
  );
  game.update(travelTime, {});

  assert.equal(game.state.lives, livesBefore - 1);
  assert.equal(bullet.alive, false);
  assert.deepEqual(game.state.enemyBullets, []);
});

test('an armed stationary mine damages a vulnerable ship and explodes', () => {
  const { cfg, game } = setupGame(18);
  const ship = game.state.ship;
  ship.x = 100;
  ship.y = 100;
  ship.vx = 0;
  ship.vy = 0;
  ship.invuln = 0;
  game.state.asteroids = [makeAsteroid(cfg, 'small', 700, 50, 'normal', 181)];

  const base = createUfo('base', 300, 300, cfg, makeRng(182));
  const mine = createMine(base, cfg);
  game.state.mines = [mine];
  game.update(cfg.ufo.mine.armDelay, {});
  assert.equal(mine.armed, true);
  assert.equal(mine.armTime, 0);
  assert.equal(mine.x, 300);
  assert.equal(mine.y, 300);

  ship.x = mine.x;
  ship.y = mine.y;
  ship.vx = 0;
  ship.vy = 0;
  ship.invuln = 0;
  ship.shield = 0;
  const livesBefore = game.state.lives;
  game.update(0, {});

  assert.equal(game.state.lives, livesBefore - 1);
  assert.deepEqual(game.state.mines, []);
  assert.equal(game.state.effects.filter(effect => effect.kind === 'mineExplosion').length, 1);
});

test('pause, resize, and restart preserve the hazard lifecycle contract', () => {
  const { cfg, game } = setupGame(19);
  const cryoSource = makeAsteroid(cfg, 'small', 850, 650, 'cryo', 191);
  const cloud = createIceCloud(cryoSource, cfg);
  const anomaly = createGravityAnomaly(810, 620, cfg);
  const hunter = createUfo('hunter', 830, 630, cfg, makeRng(192));
  hunter.speed = 0;
  hunter.vx = 0;
  hunter.vy = 0;
  const enemyBullet = createEnemyBullet(hunter, game.state.ship, cfg, W, H);
  enemyBullet.x = 840;
  enemyBullet.y = 640;
  const base = createUfo('base', 860, 660, cfg, makeRng(193));
  const mine = createMine(base, cfg);

  game.state.asteroids = [makeAsteroid(cfg, 'small', 700, 50, 'normal', 194)];
  game.state.iceClouds = [cloud];
  game.state.anomalies = [anomaly];
  game.state.ufos = [hunter];
  game.state.enemyBullets = [enemyBullet];
  game.state.mines = [mine];
  game.state.ship.x = 870;
  game.state.ship.y = 670;
  game.state.ship.cryoSlowTime = 1;

  game.pause();
  const paused = structuredClone({
    ship: game.state.ship,
    iceClouds: game.state.iceClouds,
    anomalies: game.state.anomalies,
    ufos: game.state.ufos,
    enemyBullets: game.state.enemyBullets,
    mines: game.state.mines,
  });
  game.update(5, { thrust: true, fire: true });
  assert.deepEqual({
    ship: game.state.ship,
    iceClouds: game.state.iceClouds,
    anomalies: game.state.anomalies,
    ufos: game.state.ufos,
    enemyBullets: game.state.enemyBullets,
    mines: game.state.mines,
  }, paused);

  game.resize(400, 300);
  assert.deepEqual(
    [game.state.ship.x, cloud.x, anomaly.x, hunter.x, enemyBullet.x, mine.x],
    [70, 50, 10, 30, 40, 60],
  );
  assert.deepEqual(
    [game.state.ship.y, cloud.y, anomaly.y, hunter.y, enemyBullet.y, mine.y],
    [70, 50, 20, 30, 40, 60],
  );
  assert.deepEqual(cfg.world, { width: 400, height: 300 });

  game.state.highScore = 321;
  game.restart();
  assert.equal(game.state.status, 'playing');
  assert.equal(game.state.wave, 1);
  assert.equal(game.state.highScore, 321);
  assert.equal(game.state.ship.cryoSlowTime, 0);
  assert.deepEqual(game.state.iceClouds, []);
  assert.deepEqual(game.state.anomalies, []);
  assert.deepEqual(game.state.ufos, []);
  assert.deepEqual(game.state.enemyBullets, []);
  assert.deepEqual(game.state.mines, []);
  assert.ok(game.state.asteroids.every(asteroid => asteroid.kind === 'normal'));
});
