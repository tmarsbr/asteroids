import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame } from '../src/game.js';
import { createAsteroid, createBullet } from '../src/entities.js';

const W = CONFIG.world.width;
const H = CONFIG.world.height;

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

function makeSentinel(cfg, seed = 9000) {
  return makeAsteroid(cfg, 'large', 700, 50, 'normal', seed);
}

function setupGame({ seed = 1, highScore = 0 } = {}) {
  const cfg = structuredClone(CONFIG);
  const game = createGame(cfg, makeRng(seed), { highScore });
  game.start();
  game.state.ship.x = 100;
  game.state.ship.y = 300;
  game.state.ship.vx = 0;
  game.state.ship.vy = 0;
  game.state.ship.angle = 0;
  game.state.ship.invuln = 1e6;
  const sentinel = makeSentinel(cfg, seed + 9000);
  game.state.asteroids = [sentinel];
  return { cfg, game, sentinel };
}

function assertScoring(game, combo, multiplier, bestCombo = combo) {
  assert.equal(game.state.scoring.combo, combo);
  assert.equal(game.state.scoring.multiplier, multiplier);
  assert.equal(game.state.scoring.bestCombo, bestCombo);
}

function hitManualSmall(context, seed = 100) {
  const { cfg, game, sentinel } = context;
  const ship = game.state.ship;
  const target = makeAsteroid(
    cfg,
    'small',
    ship.x + Math.cos(ship.angle) * ship.radius,
    ship.y + Math.sin(ship.angle) * ship.radius,
    'normal',
    seed,
  );
  game.state.asteroids = [target, sentinel];
  game.state.bulletCooldown = 0;
  game.update(0, { fire: true });
  assert.equal(target.alive, false, 'the accepted manual shot must hit its fixture');
  return target;
}

function buildCombo(context, hits) {
  for (let index = 0; index < hits; index++) {
    hitManualSmall(context, 1000 + index);
  }
}

function firePendingManualShot(context) {
  const { game, sentinel } = context;
  game.state.asteroids = [sentinel];
  game.state.bulletCooldown = 0;
  const countBefore = game.state.bullets.length;
  game.update(0, { fire: true });
  assert.equal(game.state.bullets.length, countBefore + 1);
  const bullet = game.state.bullets.at(-1);
  assert.notEqual(bullet.accuracyShotId, null);
  return bullet;
}

function stationaryProjectileAt(game, cfg, target, options = {}) {
  const bullet = createBullet(game.state.ship, cfg, {
    source: options.source ?? 'player',
    kind: options.kind ?? 'bullet',
    speed: 0,
    life: options.life ?? cfg.bullet.life,
    inheritVelocity: false,
  });
  bullet.x = target.x;
  bullet.y = target.y;
  bullet.vx = 0;
  bullet.vy = 0;
  return bullet;
}

test('accuracy sequence scores with the armed multiplier and caps it at x5', () => {
  const context = setupGame({ seed: 11 });
  const { cfg, game } = context;
  const multiplierCfg = cfg.scoring.multiplier;
  let expectedScore = 0;

  assertScoring(game, 0, multiplierCfg.initial, 0);

  for (let hit = 0; hit < 10; hit++) {
    const multiplierUsed = Math.min(
      multiplierCfg.max,
      multiplierCfg.initial + hit * multiplierCfg.increment,
    );
    expectedScore += Math.round(cfg.asteroid.smallPoints * multiplierUsed);
    hitManualSmall(context, 1100 + hit);

    const armedMultiplier = Math.min(
      multiplierCfg.max,
      multiplierCfg.initial + (hit + 1) * multiplierCfg.increment,
    );
    assert.equal(game.state.score, expectedScore);
    assertScoring(game, hit + 1, armedMultiplier, hit + 1);
  }

  assert.equal(game.state.scoring.multiplier, 5);
  assert.equal(game.state.score, 3200);
  assert.equal(game.state.highScore, game.state.score);
});

test('a manual miss resets only when its projectile actually expires', () => {
  const context = setupGame({ seed: 12 });
  const { cfg, game } = context;
  buildCombo(context, 3);
  const scoreBeforeMiss = game.state.score;
  assertScoring(game, 3, 2.5, 3);

  const miss = firePendingManualShot(context);
  miss.x = 100;
  miss.y = 500;
  miss.vx = 0;
  miss.vy = 0;

  game.update(cfg.bullet.life - 0.01, {});
  assert.equal(game.state.bullets.includes(miss), true);
  assertScoring(game, 3, 2.5, 3);

  game.update(0.02, {});
  assert.equal(game.state.bullets.includes(miss), false);
  assert.equal(game.state.score, scoreBeforeMiss);
  assertScoring(game, 0, 1, 3);
});

test('an impact exactly at projectile expiry is a hit, not a miss', () => {
  const context = setupGame({ seed: 13 });
  const { cfg, game, sentinel } = context;
  const ship = game.state.ship;
  const contactX = ship.x
    + ship.radius
    + cfg.bullet.speed * cfg.bullet.life
    + cfg.bullet.radius
    + cfg.asteroid.smallR;
  assert.ok(contactX < W, 'the exact-expiry fixture must not wrap');

  const target = makeAsteroid(cfg, 'small', contactX, ship.y, 'normal', 1301);
  game.state.asteroids = [target, sentinel];
  game.update(cfg.bullet.life, { fire: true });

  assert.equal(target.alive, false);
  assert.equal(game.state.bullets.length, 0);
  assert.equal(game.state.score, cfg.asteroid.smallPoints);
  assertScoring(game, 1, 1.5, 1);
});

test('misses and hits resolve by physical time within the same update', () => {
  const missThenHit = setupGame({ seed: 14 });
  buildCombo(missThenHit, 2);
  const earlierMiss = firePendingManualShot(missThenHit);
  const laterHit = firePendingManualShot(missThenHit);
  earlierMiss.x = 50;
  earlierMiss.y = 50;
  earlierMiss.vx = 0;
  earlierMiss.vy = 0;
  earlierMiss.life = 0.25;
  laterHit.x = 100;
  laterHit.y = 100;
  laterHit.vx = 100;
  laterHit.vy = 0;
  laterHit.life = 1;
  const lateTarget = makeAsteroid(
    missThenHit.cfg,
    'small',
    laterHit.x + laterHit.vx * 0.75 + laterHit.radius + missThenHit.cfg.asteroid.smallR,
    laterHit.y,
    'normal',
    1401,
  );
  missThenHit.game.state.asteroids = [lateTarget, missThenHit.sentinel];
  missThenHit.game.update(1, {});

  assert.equal(lateTarget.alive, false);
  assert.equal(missThenHit.game.state.score, 350,
    'the later hit must score at x1 after the earlier miss resets the combo');
  assertScoring(missThenHit.game, 1, 1.5, 2);

  const hitThenMiss = setupGame({ seed: 15 });
  buildCombo(hitThenMiss, 2);
  const earlierHit = firePendingManualShot(hitThenMiss);
  const laterMiss = firePendingManualShot(hitThenMiss);
  earlierHit.x = 100;
  earlierHit.y = 100;
  earlierHit.vx = 100;
  earlierHit.vy = 0;
  earlierHit.life = 1;
  laterMiss.x = 50;
  laterMiss.y = 500;
  laterMiss.vx = 0;
  laterMiss.vy = 0;
  laterMiss.life = 0.75;
  const earlyTarget = makeAsteroid(
    hitThenMiss.cfg,
    'small',
    earlierHit.x + earlierHit.vx * 0.25 + earlierHit.radius + hitThenMiss.cfg.asteroid.smallR,
    earlierHit.y,
    'normal',
    1501,
  );
  hitThenMiss.game.state.asteroids = [earlyTarget, hitThenMiss.sentinel];
  hitThenMiss.game.update(1, {});

  assert.equal(earlyTarget.alive, false);
  assert.equal(hitThenMiss.game.state.score, 450,
    'the earlier hit must score at x2 before the later miss resets the combo');
  assertScoring(hitThenMiss.game, 0, 1, 3);
});

test('a spread volley resolves atomically on its first hit or its final expiry', () => {
  const context = setupGame({ seed: 16 });
  const { cfg, game, sentinel } = context;
  buildCombo(context, 2);
  const scoreBeforeSpread = game.state.score;
  game.state.powerUps.weapon = 'spread';
  game.state.powerUps.weaponTime = cfg.powerUps.spread.duration;
  game.state.bulletCooldown = 0;

  const target = makeAsteroid(cfg, 'small', 300, 300, 'normal', 1601);
  game.state.asteroids = [target, sentinel];
  game.update(0, { fire: true });
  const shotIds = new Set(game.state.bullets.map(bullet => bullet.accuracyShotId));
  assert.equal(game.state.bullets.length, cfg.powerUps.spread.count);
  assert.equal(shotIds.size, 1, 'all pellets must share one logical shot id');

  game.update(0.4, {});
  assert.equal(target.alive, false);
  assert.equal(game.state.bullets.length, 2, 'only the centre pellet should hit');
  assert.equal(game.state.score, scoreBeforeSpread + cfg.asteroid.smallPoints * 2);
  assertScoring(game, 3, 2.5, 3);

  game.update(0.61, {});
  assert.equal(game.state.bullets.length, 0);
  assertScoring(game, 3, 2.5, 3);

  game.state.asteroids = [sentinel];
  game.state.bulletCooldown = 0;
  game.update(0, { fire: true });
  assert.equal(game.state.bullets.length, cfg.powerUps.spread.count);
  for (const [index, bullet] of game.state.bullets.entries()) {
    bullet.x = 100 + index * 10;
    bullet.y = 500;
    bullet.vx = 0;
    bullet.vy = 0;
  }
  game.update(cfg.bullet.life + 0.01, {});

  assert.equal(game.state.bullets.length, 0);
  assertScoring(game, 0, 1, 3);
});

test('drone, beam, EMP and bomb awards do not alter accuracy', () => {
  const context = setupGame({ seed: 17 });
  const { cfg, game, sentinel } = context;
  buildCombo(context, 2);
  const expectedMultiplier = 2;
  let expectedScore = game.state.score;
  assertScoring(game, 2, expectedMultiplier, 2);

  const droneTarget = makeAsteroid(cfg, 'small', 300, 300, 'normal', 1701);
  game.state.asteroids = [droneTarget, sentinel];
  const droneHit = stationaryProjectileAt(game, cfg, droneTarget, {
    source: 'drone',
    kind: 'drone',
  });
  assert.equal(droneHit.accuracyShotId, null);
  game.state.bullets.push(droneHit);
  game.update(0, {});
  expectedScore += cfg.asteroid.smallPoints * expectedMultiplier;
  assert.equal(game.state.score, expectedScore);
  assertScoring(game, 2, expectedMultiplier, 2);

  const droneMiss = createBullet(game.state.ship, cfg, {
    source: 'drone',
    kind: 'drone',
    speed: 0,
    life: 0.1,
    inheritVelocity: false,
  });
  droneMiss.x = 100;
  droneMiss.y = 500;
  game.state.bullets.push(droneMiss);
  game.update(0.11, {});
  assert.equal(game.state.bullets.includes(droneMiss), false);
  assertScoring(game, 2, expectedMultiplier, 2);

  const beamTarget = makeAsteroid(cfg, 'small', 200, 300, 'normal', 1702);
  game.state.asteroids = [beamTarget, sentinel];
  game.state.powerUps.weapon = 'beam';
  game.state.powerUps.weaponTime = cfg.powerUps.beam.duration;
  game.state.powerUps.beamCooldown = 0;
  game.update(0, { fire: true });
  expectedScore += cfg.asteroid.smallPoints * expectedMultiplier;
  assert.equal(beamTarget.alive, false);
  assert.equal(game.state.score, expectedScore);
  assertScoring(game, 2, expectedMultiplier, 2);

  const empTarget = makeAsteroid(cfg, 'small', 300, 100, 'normal', 1703);
  game.state.asteroids = [empTarget, sentinel];
  game.state.powerUps.weapon = null;
  game.state.powerUps.weaponTime = 0;
  game.state.powerUps.empStored = true;
  game.update(0, { emp: true });
  expectedScore += cfg.asteroid.smallPoints * expectedMultiplier;
  assert.equal(empTarget.alive, false);
  assert.equal(game.state.score, expectedScore);
  assertScoring(game, 2, expectedMultiplier, 2);

  const bombTarget = makeAsteroid(cfg, 'small', 300, 300, 'normal', 1704);
  game.state.asteroids = [bombTarget, sentinel];
  game.state.bombs.push({
    x: bombTarget.x,
    y: bombTarget.y,
    radius: 7,
    visualRadius: 18,
    fuse: 0,
    fuseTotal: cfg.abilities.hyperspace.bombFuse,
    blastRadius: cfg.abilities.hyperspace.bombRadius,
    alive: true,
  });
  game.update(0, {});
  expectedScore += cfg.asteroid.smallPoints * expectedMultiplier;
  assert.equal(bombTarget.alive, false);
  assert.equal(game.state.score, expectedScore);
  assertScoring(game, 2, expectedMultiplier, 2);
});

test('restart resets the scoring run while preserving the live high score', () => {
  const context = setupGame({ seed: 18, highScore: 200 });
  const { cfg, game } = context;
  buildCombo(context, 2);

  assert.equal(game.state.score, 250);
  assert.equal(game.state.highScore, 250);
  assert.equal(game.state.scoring.newHighScore, true);
  assertScoring(game, 2, 2, 2);

  firePendingManualShot(context);
  game.state.scoring.chainReactions = 2;
  game.restart();

  assert.equal(game.state.score, 0);
  assert.equal(game.state.highScore, 250);
  assert.equal(game.state.bullets.length, 0);
  assert.equal(game.state.scoring.chainReactions, 0);
  assert.equal(game.state.scoring.newHighScore, false);
  assertScoring(game, 0, cfg.scoring.multiplier.initial, 0);

  context.sentinel = makeSentinel(cfg, 1801);
  game.state.ship.x = 100;
  game.state.ship.y = 300;
  game.state.ship.vx = 0;
  game.state.ship.vy = 0;
  game.state.ship.angle = 0;
  game.state.ship.invuln = 1e6;
  game.state.asteroids = [context.sentinel];
  hitManualSmall(context, 1802);

  assert.equal(game.state.score, cfg.asteroid.smallPoints);
  assert.equal(game.state.highScore, 250, 'a new run must not lower the record');
  assert.equal(game.state.scoring.newHighScore, false);
  assertScoring(game, 1, 1.5, 1);
});

function runMagmaChain(indirectKills, seed) {
  const context = setupGame({ seed });
  const { cfg, game, sentinel } = context;
  const root = makeAsteroid(cfg, 'small', 400, 300, 'magma', seed * 100);
  const victimPositions = [
    [500, 300],
    [400, 400],
    [300, 300],
  ];
  const victims = victimPositions.slice(0, indirectKills).map(([x, y], index) =>
    makeAsteroid(cfg, 'small', x, y, 'normal', seed * 100 + index + 1)
  );
  game.state.asteroids = [root, ...victims, sentinel];
  game.state.bullets = [stationaryProjectileAt(game, cfg, root)];
  game.update(0, {});
  return { ...context, root, victims };
}

test('magma chain requires three unique indirect victims and awards once', () => {
  const belowThreshold = runMagmaChain(2, 19);
  assert.equal(
    belowThreshold.game.state.score,
    belowThreshold.cfg.asteroid.smallPoints * 3,
  );
  assert.equal(belowThreshold.game.state.scoring.chainReactions, 0);
  assert.equal(
    belowThreshold.game.state.effects.some(effect => effect.kind === 'chainReaction'),
    false,
  );

  const atThreshold = runMagmaChain(3, 20);
  const chainCfg = atThreshold.cfg.scoring.chainReaction;
  assert.equal(
    atThreshold.game.state.score,
    atThreshold.cfg.asteroid.smallPoints * 4 + chainCfg.bonusPoints,
  );
  assert.equal(atThreshold.game.state.scoring.chainReactions, 1);
  const effects = atThreshold.game.state.effects.filter(
    effect => effect.kind === 'chainReaction'
  );
  assert.equal(effects.length, 1);
  assert.equal(effects[0].label, 'CHAIN REACTION!');
  assert.equal(effects[0].chainCount, 3);
  assert.equal(effects[0].awardedPoints, chainCfg.bonusPoints);
  assertScoring(atThreshold.game, 0, 1, 0);
});
