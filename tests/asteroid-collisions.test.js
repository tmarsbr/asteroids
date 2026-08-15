import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONFIG } from '../src/config.js';
import { createAsteroid } from '../src/entities.js';
import { createGame } from '../src/game.js';
import { torusDistance } from '../src/math.js';

function makeRng(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function setupGame(seed = 1) {
  const cfg = structuredClone(CONFIG);
  const game = createGame(cfg, makeRng(seed));
  game.start();
  game.state.asteroids = [];
  game.state.ufos = [];
  game.state.ship.x = 700;
  game.state.ship.y = 500;
  game.state.ship.vx = 0;
  game.state.ship.vy = 0;
  game.state.ship.invuln = 99;
  return { cfg, game };
}

function makeAsteroid(cfg, x, y, vx, vy = 0, seed = 1) {
  const asteroid = createAsteroid('small', x, y, cfg, makeRng(seed));
  asteroid.vx = vx;
  asteroid.vy = vy;
  asteroid.rotSpeed = 0;
  return asteroid;
}

function assertClose(actual, expected, epsilon = 1e-7) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function assertSeparated(first, second, cfg) {
  const distance = torusDistance(
    first.x, first.y, second.x, second.y,
    cfg.world.width, cfg.world.height,
  );
  const clearance = first.radius + second.radius
    + cfg.asteroid.collision.separationPadding;
  assert.ok(
    distance >= clearance - 1e-7,
    `asteroids should be separated: ${distance} < ${clearance}`,
  );
}

test('asteroids: small head-on rebound loses the configured post-impact speed', () => {
  const { cfg, game } = setupGame();
  const first = makeAsteroid(cfg, 380, 300, 400, 0, 11);
  const second = makeAsteroid(cfg, 420, 300, -400, 0, 12);
  game.state.asteroids.push(first, second);

  game.update(cfg.game.fixedStep, {});

  const expectedSpeed = 400
    * cfg.asteroid.collision.restitution
    * cfg.asteroid.collision.smallReboundSpeedMultiplier;
  assert.ok(first.vx < 0, 'first asteroid should leave to the left');
  assert.ok(second.vx > 0, 'second asteroid should leave to the right');
  assertClose(Math.abs(first.vx), expectedSpeed);
  assertClose(Math.abs(second.vx), expectedSpeed);
  assert.ok(expectedSpeed < 400, 'small fragments should leave the rebound slower');
  assertSeparated(first, second, cfg);
  assert.equal(game.state.score, 0, 'rock impacts do not grant score');
});

test('asteroids: high-speed crossing is swept instead of passing through', () => {
  const { cfg, game } = setupGame();
  const first = makeAsteroid(cfg, 300, 300, 12000, 0, 21);
  const second = makeAsteroid(cfg, 500, 300, -12000, 0, 22);
  game.state.asteroids.push(first, second);

  game.update(cfg.game.fixedStep, {});

  assert.ok(first.vx < 0, 'first high-speed asteroid should rebound');
  assert.ok(second.vx > 0, 'second high-speed asteroid should rebound');
  assert.ok(Math.hypot(first.vx, first.vy) <= cfg.asteroid.collision.maxSpeed + 1e-7);
  assert.ok(Math.hypot(second.vx, second.vy) <= cfg.asteroid.collision.maxSpeed + 1e-7);
  assertSeparated(first, second, cfg);
});

test('asteroids: rebound works across the toroidal seam', () => {
  const { cfg, game } = setupGame();
  const first = makeAsteroid(cfg, 770, 300, 400, 0, 31);
  const second = makeAsteroid(cfg, 30, 300, -400, 0, 32);
  game.state.asteroids.push(first, second);

  game.update(0.05, {});

  assert.ok(first.vx < 0, 'seam-side asteroid should rebound left');
  assert.ok(second.vx > 0, 'seam-side asteroid should rebound right');
  assert.ok(first.x >= 0 && first.x < cfg.world.width);
  assert.ok(second.x >= 0 && second.x < cfg.world.width);
  assertSeparated(first, second, cfg);
});

test('asteroids: separating overlap is fixed without another speed boost', () => {
  const { cfg, game } = setupGame();
  const first = makeAsteroid(cfg, 390, 300, -100, 0, 41);
  const second = makeAsteroid(cfg, 400, 300, 100, 0, 42);
  game.state.asteroids.push(first, second);

  game.update(0, {});

  assertClose(first.vx, -100);
  assertClose(second.vx, 100);
  assertSeparated(first, second, cfg);
});
