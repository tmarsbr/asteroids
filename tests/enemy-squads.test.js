import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame } from '../src/game.js';
import { createBullet } from '../src/entities.js';

const STEP = 1 / 120;

function createTestGame() {
  const cfg = structuredClone(CONFIG);
  const game = createGame(cfg, () => 0.5);
  game.restart();
  return { cfg, game };
}

function destroyUfoWithPlayerBullets(game, cfg, ufo) {
  const maximumShots = Math.max(1, Math.ceil(ufo.hp ?? ufo.maxHp ?? 1)) + 1;
  for (let shot = 0; shot < maximumShots && ufo.alive; shot++) {
    const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
    bullet.x = ufo.x;
    bullet.y = ufo.y;
    bullet.vx = 0;
    bullet.vy = 0;
    bullet.life = 1;
    bullet.accuracyShotId = null;
    game.state.bullets.push(bullet);
    game.update(STEP, {});
  }
  assert.equal(ufo.alive, false, `${ufo.kind} should be destroyed by real bullets`);
}

function advanceToWave(game, cfg, targetWave) {
  const maximumTransitions = Math.max(1, targetWave) + 2;
  for (let transition = 0;
    game.state.wave < targetWave && transition < maximumTransitions;
    transition++) {
    const waveBefore = game.state.wave;
    game.state.asteroids = [];

    // A cleared asteroid field no longer advances a wave past live UFOs.  Kill
    // each current enemy through the same projectile path used during play.
    for (const ufo of [...game.state.ufos]) {
      destroyUfoWithPlayerBullets(game, cfg, ufo);
    }

    // Early waves contain no UFOs, so one normal simulation step starts the
    // next wave.  Later waves advance during the final real UFO death.
    if (game.state.wave === waveBefore) game.update(STEP, {});
    assert.ok(game.state.wave > waveBefore, `wave ${waveBefore} should clear`);
  }
  assert.equal(game.state.wave, targetWave, `should reach wave ${targetWave}`);
}

test('enemy squads: wave 5 spawns 1 UFO (unlock wave)', () => {
  const { cfg, game } = createTestGame();
  advanceToWave(game, cfg, 5);

  assert.equal(game.state.ufos.length, 1);
});

test('enemy squads: subsequent waves spawn multiple UFOs according to growth cap', () => {
  const { cfg, game } = createTestGame();
  advanceToWave(game, cfg, 10);

  assert.equal(game.state.ufos.length, 3);
  assert.ok(game.state.ufos.every(ufo => ufo.hadSquad),
    'the three UFOs retain their squad provenance');
});

test('enemy squads: HP scaling scales every UFO HP on higher waves', () => {
  const { cfg, game } = createTestGame();
  advanceToWave(game, cfg, 10);

  for (const ufo of game.state.ufos) {
    const baseHp = cfg.ufo[ufo.kind].hp;
    assert.equal(ufo.hp, baseHp + 1, `${ufo.kind} receives the wave-10 HP bonus`);
  }
});
