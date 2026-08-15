import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame } from '../src/game.js';
import { createBullet, createUfo } from '../src/entities.js';

const STEP = 1 / 120;

function createThreeCraftSquadGame() {
  const cfg = structuredClone(CONFIG);
  // Exercise the actual three-member template without spending ten waves on
  // unrelated asteroid cleanup.  The first size-3 template is bomber + scout
  // + scout, so this also proves the pincer composition is reachable.
  cfg.ufo.unlockWave = 1;
  cfg.ufo.squadSize = {
    ...cfg.ufo.squadSize,
    base: 3,
    growthPerWave: 0,
    max: 3,
    lateGameMax: 3,
    lateGameWave: 1,
  };
  cfg.ufo.squad = { ...cfg.ufo.squad, warpInDuration: 0 };

  const game = createGame(cfg, () => 0.5);
  game.restart();
  // The tests below focus on squad state.  Removing the asteroids is safe only
  // because a live UFO must now keep the wave alive.
  game.state.asteroids = [];
  return { cfg, game };
}

function hitUfoWithPlayerBullet(game, cfg, ufo) {
  const bullet = createBullet(game.state.ship, cfg, { inheritVelocity: false });
  // A real player projectile at the target resolves through the normal swept
  // collision/damage/scoring path at t=0.  Do not write hp directly: that only
  // changes data and never executes the death path.
  bullet.x = ufo.x;
  bullet.y = ufo.y;
  bullet.vx = 0;
  bullet.vy = 0;
  bullet.life = 1;
  bullet.accuracyShotId = null;
  game.state.bullets.push(bullet);
  game.update(STEP, {});
}

function destroyUfoWithPlayerBullets(game, cfg, ufo) {
  const maximumShots = Math.max(1, Math.ceil(ufo.hp ?? ufo.maxHp ?? 1)) + 1;
  for (let shot = 0; shot < maximumShots && ufo.alive; shot++) {
    hitUfoWithPlayerBullet(game, cfg, ufo);
  }
  assert.equal(ufo.alive, false, `${ufo.kind} should die through projectile damage`);
  assert.equal(game.state.ufos.includes(ufo), false, 'dead UFO is removed from state');
}

function armLastSurvivor(game, cfg) {
  const bomber = game.state.ufos.find(ufo => ufo.kind === 'bomber');
  assert.ok(bomber, 'the squad must contain a bomber');

  const escorts = game.state.ufos.filter(ufo => ufo !== bomber);
  assert.equal(escorts.length, 2, 'the bomber must have two squadmates');
  const waveBefore = game.state.wave;
  for (const escort of escorts) destroyUfoWithPlayerBullets(game, cfg, escort);

  // The final kill is resolved after updateUfoThreats in its frame.  Advance a
  // bounded extra step so squad logic observes the single remaining UFO.
  game.update(STEP, {});
  assert.equal(game.state.wave, waveBefore, 'a living squad member blocks wave advance');
  assert.equal(game.state.ufos.length, 1);
  assert.equal(game.state.ufos[0], bomber);
  assert.equal(bomber.isLastSurvivor, true, 'remaining UFO is marked as last survivor');
  assert.ok(bomber.fleeTimer > 0, 'last survivor receives a flee timer');
  return bomber;
}

test('squad tactics: a three-UFO template creates a bomber pincer with real squad identity', () => {
  const { game } = createThreeCraftSquadGame();
  const squad = game.state.ufos;

  assert.equal(squad.length, 3, 'configured three-craft squad spawns three UFOs');
  assert.equal(new Set(squad.map(ufo => ufo.id)).size, squad.length, 'each UFO has a unique id');
  assert.ok(squad.every(ufo => Number.isSafeInteger(ufo.id)), 'UFO ids are concrete integers');
  assert.equal(new Set(squad.map(ufo => ufo.squadId)).size, 1, 'members share one squad id');
  assert.ok(squad.every(ufo => ufo.initialSquadSize === 3));
  assert.ok(squad.every(ufo => ufo.hadSquad === true));

  const bomber = squad.find(ufo => ufo.kind === 'bomber');
  const scouts = squad.filter(ufo => ufo.kind === 'scout');
  assert.ok(bomber, 'the size-3 template includes a bomber');
  assert.equal(scouts.length, 2, 'the size-3 template includes two scouts');
  assert.equal(new Set(squad.map(ufo => ufo.formationSlot)).size, squad.length,
    'each member occupies its own formation slot');

  for (const scout of scouts) {
    assert.equal(scout.squadRole, 'escort');
    assert.equal(scout.squadTarget, bomber);
    assert.ok(scout.formationOffset, 'escort retains its formation offset');
  }
  assert.notEqual(scouts[0].orbitDirection, scouts[1].orbitDirection,
    'the two scouts take opposite sides of the bomber');
});

test('squad tactics: the last survivor flees and awards the configured destruction bonus', () => {
  const { cfg, game } = createThreeCraftSquadGame();
  const survivor = armLastSurvivor(game, cfg);

  const scoreBeforeKill = game.state.score;
  const bonus = cfg.ufo.squad.lastSurvivorBonusMultiplier;
  const expectedAward = survivor.points * bonus * game.state.scoring.multiplier;
  destroyUfoWithPlayerBullets(game, cfg, survivor);

  assert.equal(
    game.state.score - scoreBeforeKill,
    expectedAward,
    'destroying the fleeing survivor awards its 2x squad bonus',
  );
});

test('squad tactics: a last survivor leaving by timer ends the wave without an infinite loop', () => {
  const { cfg, game } = createThreeCraftSquadGame();
  const survivor = armLastSurvivor(game, cfg);
  const waveBeforeFlee = game.state.wave;

  survivor.fleeTimer = STEP / 2;
  game.update(STEP, {});

  assert.equal(survivor.alive, false, 'survivor despawns when its flee timer expires');
  assert.equal(game.state.ufos.includes(survivor), false, 'despawned survivor is removed');
  assert.equal(game.state.wave, waveBeforeFlee + 1,
    'the next wave starts only after the final UFO has died or fled');
});

test('fighter tactics: a burst fires three spaced shots, then rearms on its normal cooldown', () => {
  const cfg = structuredClone(CONFIG);
  cfg.ufo.fighter.fireCooldown = 0.5;
  cfg.ufo.fighter.burstCount = 3;
  cfg.ufo.fighter.burstInterval = 0.1;
  const game = createGame(cfg, () => 0.5);
  game.restart();
  game.state.asteroids = [];

  const fighter = createUfo('fighter', 100, 100, cfg, () => 0, 1, 2);
  fighter.fireTimer = 0;
  fighter.warpInTimer = 0;
  game.state.ufos = [fighter];

  game.update(0.001, {});
  assert.equal(game.state.enemyBullets.length, 1, 'the lead shot fires when cooldown expires');
  assert.equal(fighter.burstRemaining, 2);

  game.update(cfg.ufo.fighter.burstInterval / 2, {});
  assert.equal(game.state.enemyBullets.length, 1, 'no follow-up arrives before burstInterval');

  game.update(cfg.ufo.fighter.burstInterval / 2 + 0.001, {});
  assert.equal(game.state.enemyBullets.length, 2, 'second shot arrives after burstInterval');
  assert.equal(fighter.burstRemaining, 1);

  game.update(cfg.ufo.fighter.burstInterval, {});
  assert.equal(game.state.enemyBullets.length, 3, 'third shot completes the burst');
  assert.equal(fighter.burstRemaining, 0);
  assert.equal(fighter.fireTimer, cfg.ufo.fighter.fireCooldown,
    'only a completed burst rearms the normal fire cooldown');

  game.update(cfg.ufo.fighter.fireCooldown - 0.01, {});
  assert.equal(game.state.enemyBullets.length, 3, 'fighter does not restart early');
  game.update(0.011, {});
  assert.equal(game.state.enemyBullets.length, 4, 'fighter starts its next burst after cooldown');
});
