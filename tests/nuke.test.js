import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createGame } from '../src/game.js';
import { createInputManager } from '../src/input.js';
import {
  createAsteroid,
  createEnemyBullet,
  createGravityAnomaly,
  createIceCloud,
  createMine,
  createRadiationField,
  createUfo,
} from '../src/entities.js';

function makeRng(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

test('Nuke: KeyK clears every threat, awards points, and advances the wave', () => {
  const cfg = structuredClone(CONFIG);
  const game = createGame(cfg, makeRng(17));
  game.start();

  const large = createAsteroid('large', 120, 100, cfg, makeRng(1));
  const cryo = createAsteroid('medium', 240, 100, cfg, makeRng(2), 1, 'cryo');
  const radioactive = createAsteroid('small', 360, 100, cfg, makeRng(3), 1, 'radioactive');
  large.dataCarrier = true;
  game.state.asteroids = [large, cryo, radioactive];

  const ufo = createUfo('hunter', 520, 300, cfg, makeRng(4), 1, 1);
  ufo.warpInTimer = 0;
  const scout = createUfo('scout', 620, 300, cfg, makeRng(5), 1, 2);
  scout.warpInTimer = 0;
  game.state.ufos = [ufo, scout];
  game.state.enemyBullets = [createEnemyBullet(ufo, game.state.ship, cfg, cfg.world.width, cfg.world.height)];
  game.state.mines = [createMine(ufo, cfg)];
  game.state.iceClouds = [createIceCloud(cryo, cfg)];
  game.state.radiationFields = [createRadiationField(radioactive, cfg)];
  game.state.anomalies = [createGravityAnomaly(600, 400, cfg)];

  const fakeWindow = {
    handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
    removeEventListener() {},
  };
  const input = createInputManager(fakeWindow);
  input.setActive(true);
  let prevented = 0;
  fakeWindow.handlers.keydown({
    code: 'KeyK',
    repeat: false,
    preventDefault() { prevented++; },
  });

  assert.equal(prevented, 1);
  assert.equal(input.getInput().nuke, true, 'KeyK must reach the game input');
  game.update(0, input.getInput());
  input.consumePresses();

  const expectedScore = cfg.asteroid.largePoints
    + cfg.asteroid.mediumPoints
    + cfg.asteroid.smallPoints
    + cfg.ufo.hunter.points
    + cfg.ufo.scout.points;
  assert.equal(game.state.score, expectedScore);
  assert.equal(game.state.wave, 2, 'an empty field advances immediately');
  assert.equal(game.state.asteroids.length, cfg.asteroid.initialCount + 1);
  assert.ok(game.state.asteroids.every(asteroid => ![large, cryo, radioactive].includes(asteroid)));
  assert.equal(game.state.ufos.length, 0);
  assert.equal(game.state.enemyBullets.length, 0);
  assert.equal(game.state.mines.length, 0);
  assert.equal(game.state.iceClouds.length, 0);
  assert.equal(game.state.radiationFields.length, 0);
  assert.equal(game.state.anomalies.length, 0);
  assert.equal(game.state.dataNodes.length, 0, 'Nuke does not turn carriers into drops');
  assert.ok(game.state.effects.some(effect => effect.kind === 'emp'));
  assert.ok(!game.state.effects.some(effect =>
    ['magmaExplosion', 'cryoBurst', 'radiationBurst'].includes(effect.kind)
  ));
  assert.equal(input.getInput().nuke, false, 'Nuke is an edge-triggered action');
});
