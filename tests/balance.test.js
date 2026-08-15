import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame } from '../src/game.js';
import {
  createDataNode,
  createEnemyBullet,
} from '../src/entities.js';

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

function setupGame(seed = 1) {
  const cfg = cloneConfig();
  if (cfg.ufo.squadSize) cfg.ufo.squadSize.growthPerWave = 0;
  const game = createGame(cfg, makeRng(seed));
  game.start();
  return { cfg, game };
}

function advanceToWave(game, targetWave) {
  const maximumTransitions = Math.max(1, targetWave - game.state.wave + 1);
  for (let transition = 0;
    game.state.wave < targetWave && transition < maximumTransitions;
    transition++) {
    game.state.asteroids = [];
    // This helper is only navigating spawn waves. Resolve the previous squad
    // explicitly so a living UFO cannot keep the current wave active.
    game.state.ufos = [];
    game.update(0, {});
  }
  assert.equal(game.state.wave, targetWave, `should reach wave ${targetWave}`);
}

function entitySpeed(entity) {
  return Math.hypot(entity.vx, entity.vy);
}

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('Data Nodes use a materially larger collision radius', () => {
  assert.ok(
    CONFIG.powerUps.nodeRadius >= 16,
    'the collectible radius must be at least 16 px so pickups are easier',
  );

  const node = createDataNode({ x: 120, y: 240, angle: 0 }, CONFIG);

  assert.equal(node.radius, CONFIG.powerUps.nodeRadius);
  assert.ok(node.visualRadius >= node.radius);

  const { cfg, game } = setupGame(900);
  const pickup = createDataNode({
    x: game.state.ship.x + 30,
    y: game.state.ship.y,
    angle: 0,
  }, cfg);
  pickup.vx = 0;
  pickup.vy = 0;
  game.state.dataNodes = [pickup];
  game.update(0, {});

  assert.equal(
    pickup.alive,
    false,
    'a pickup 30 px away must now be collected (the old 10 px radius missed it)',
  );
});

test('each UFO kind starts at baseline speed, then grows monotonically up to the configured cap', () => {
  const { cfg, game } = setupGame(901);
  const growth = cfg.ufo.speedGrowthPerAppearance;
  const cap = cfg.ufo.maxSpeedMultiplier;

  assert.ok(growth > 0, 'later appearances need a positive speed increase');
  assert.ok(cap > 1, 'the cap must permit progression after the first appearance');

  const kinds = ['hunter', 'base', 'scout', 'fighter', 'bomber'];
  const appearancesUntilCap = Math.ceil((cap - 1) / growth);
  const finalWave = cfg.ufo.unlockWave + appearancesUntilCap * kinds.length + 1;
  const previousSpeed = Object.fromEntries(kinds.map(k => [k, 0]));

  for (let wave = cfg.ufo.unlockWave; wave <= finalWave; wave++) {
    advanceToWave(game, wave);

    assert.equal(game.state.ufos.length, 1);
    const ufo = game.state.ufos[0];
    const kindIndex = (wave - cfg.ufo.unlockWave) % kinds.length;
    const expectedKind = kinds[kindIndex];
    const appearanceIndex = Math.floor((wave - cfg.ufo.unlockWave) / kinds.length);
    const expectedMultiplier = Math.min(1 + appearanceIndex * growth, cap);
    const expectedSpeed = cfg.ufo[expectedKind].speed * expectedMultiplier;

    assert.equal(ufo.kind, expectedKind);
    assertClose(ufo.speedMultiplier, expectedMultiplier);
    assertClose(ufo.speed, expectedSpeed);
    assertClose(entitySpeed(ufo), expectedSpeed);
    assert.ok(
      ufo.speed >= previousSpeed[expectedKind],
      `${expectedKind} speed must never decrease between appearances`,
    );
    assert.ok(
      ufo.speed <= cfg.ufo[expectedKind].speed * cap + 1e-9,
      `${expectedKind} speed must respect maxSpeedMultiplier`,
    );
    previousSpeed[expectedKind] = ufo.speed;

    if (wave === 5) assertClose(ufo.speed, cfg.ufo.hunter.speed);
    if (wave === 6) assertClose(ufo.speed, cfg.ufo.base.speed);
    if (wave === 7) assertClose(ufo.speed, cfg.ufo.scout.speed);
    if (wave === 8) assertClose(ufo.speed, cfg.ufo.fighter.speed);
    if (wave === 9) assertClose(ufo.speed, cfg.ufo.bomber.speed);
  }

  for (const kind of kinds) {
    assertClose(previousSpeed[kind], cfg.ufo[kind].speed * cap);
  }
});

test('hunter bullets start slower and inherit later appearance speed growth', () => {
  const { cfg, game } = setupGame(902);

  assert.ok(
    cfg.ufo.enemyBullet.speed < 300,
    'the first enemy projectile must be slower than the former 300 px/s baseline',
  );

  advanceToWave(game, 5);
  const firstHunter = game.state.ufos[0];
  const firstBullet = createEnemyBullet(
    firstHunter,
    game.state.ship,
    cfg,
    cfg.world.width,
    cfg.world.height,
  );

  assert.equal(firstHunter.kind, 'hunter');
  assertClose(firstHunter.speedMultiplier, 1);
  assertClose(firstBullet.speed, cfg.ufo.enemyBullet.speed);
  assertClose(entitySpeed(firstBullet), cfg.ufo.enemyBullet.speed);

  advanceToWave(game, 10);
  const laterHunter = game.state.ufos[0];
  const laterBullet = createEnemyBullet(
    laterHunter,
    game.state.ship,
    cfg,
    cfg.world.width,
    cfg.world.height,
  );
  const expectedMultiplier = Math.min(
    1 + cfg.ufo.speedGrowthPerAppearance,
    cfg.ufo.maxSpeedMultiplier,
  );

  assert.equal(laterHunter.kind, 'hunter');
  assertClose(laterHunter.speedMultiplier, expectedMultiplier);
  assertClose(laterBullet.speed, cfg.ufo.enemyBullet.speed * expectedMultiplier);
  assertClose(entitySpeed(laterBullet), laterBullet.speed);
  assert.ok(laterBullet.speed > firstBullet.speed);
});
