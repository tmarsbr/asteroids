import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createGame } from '../src/game.js';
import { createAsteroid } from '../src/entities.js';

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

function makeAsteroid(cfg, size, x, y, seed = 100) {
  const asteroid = createAsteroid(size, x, y, cfg, makeRng(seed));
  asteroid.vx = 0;
  asteroid.vy = 0;
  asteroid.rotSpeed = 0;
  return asteroid;
}

function setupGame(seed = 1) {
  const cfg = cloneConfig();
  const rng = makeRng(seed);
  const game = createGame(cfg, rng);
  game.start();

  // Keep one harmless asteroid in play so ability-only updates do not
  // implicitly clear the wave and consume more values from the game RNG.
  game.state.asteroids = [makeAsteroid(cfg, 'small', 350, 30, seed + 1000)];
  game.state.ship.invuln = 0;

  return { cfg, rng, game };
}

function assertClose(actual, expected, epsilon = 1e-9, message) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    message ?? `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('CONFIG exposes the documented balance values and initializes pilot systems', () => {
  assert.deepEqual(CONFIG.abilities.dash, {
    speed: 820,
    duration: 0.18,
    invuln: 0.3,
    cooldown: 1.5,
  });

  const shield = CONFIG.abilities.shieldBurst;
  assert.deepEqual(
    {
      maxEnergy: shield.maxEnergy,
      cost: shield.cost,
      regenPerSecond: shield.regenPerSecond,
      radius: shield.radius,
      impulse: shield.impulse,
      maxAsteroidSpeed: shield.maxAsteroidSpeed,
      grace: shield.grace,
    },
    {
      maxEnergy: 100,
      cost: 45,
      regenPerSecond: 14,
      radius: 180,
      impulse: 360,
      maxAsteroidSpeed: 520,
      grace: 0.2,
    },
  );

  const hyperspace = CONFIG.abilities.hyperspace;
  assert.deepEqual(
    {
      cooldown: hyperspace.cooldown,
      arrivalInvuln: hyperspace.arrivalInvuln,
      minDistance: hyperspace.minDistance,
      maxDestinationAttempts: hyperspace.maxDestinationAttempts,
      bombFuse: hyperspace.bombFuse,
      bombRadius: hyperspace.bombRadius,
    },
    {
      cooldown: 6,
      arrivalInvuln: 0.12,
      minDistance: 160,
      maxDestinationAttempts: 16,
      bombFuse: 0.8,
      bombRadius: 125,
    },
  );

  const cfg = cloneConfig();
  const game = createGame(cfg, makeRng(7));
  assert.deepEqual(game.state.abilities, {
    dashCooldown: 0,
    shieldEnergy: 100,
    hyperspaceCooldown: 0,
  });
  assert.deepEqual(game.state.bombs, []);
  assert.deepEqual(game.state.effects, []);
});

test('dash applies a fixed 820 px/s impulse for 0.18 s, wraps, and grants 0.3 s invulnerability', () => {
  const { cfg, game } = setupGame(2);
  const ship = game.state.ship;
  const overlapping = makeAsteroid(cfg, 'small', 790, 300, 202);
  game.state.asteroids = [overlapping];

  ship.x = 790;
  ship.y = 300;
  ship.angle = 0;
  ship.vx = -75;
  ship.vy = 40;
  ship.invuln = 0;
  const livesBefore = game.state.lives;

  game.update(0, { dash: true });

  assert.equal(game.state.lives, livesBefore, 'dash invulnerability must protect an existing overlap');
  assert.equal(ship.dashing, true);
  assertClose(ship.dashTime, 0.18);
  assertClose(ship.vx, 820);
  assertClose(ship.vy, 0);
  assertClose(Math.hypot(ship.dashVx, ship.dashVy), 820);
  assertClose(ship.invuln, 0.3);
  assertClose(game.state.abilities.dashCooldown, 1.5);

  game.update(0.1, { rotRight: true, thrust: true });
  assert.equal(ship.dashing, true);
  assertClose(ship.dashTime, 0.08);
  assertClose(ship.x, 72, 1e-8, 'dash movement should wrap across the right seam');
  assertClose(ship.y, 300);
  assertClose(ship.angle, 0, 1e-9, 'rotation is locked during the impulse');
  assertClose(Math.hypot(ship.vx, ship.vy), 820);

  game.update(0.08, { rotRight: true, thrust: true });
  assert.equal(ship.dashing, false);
  assertClose(ship.dashTime, 0);
  assertClose(ship.x, 137.6, 1e-8);
  assertClose(ship.y, 300, 1e-8);
  assertClose(ship.angle, 0, 1e-8);
  assertClose(Math.hypot(ship.vx, ship.vy), cfg.ship.maxSpeed, 1e-8);
  assertClose(ship.invuln, 0.12, 1e-9);
  assertClose(game.state.abilities.dashCooldown, 1.32, 1e-9);
});

test('dash cooldown blocks retriggering and rearms after 1.5 seconds', () => {
  const { game } = setupGame(3);
  const ship = game.state.ship;
  ship.x = 100;
  ship.y = 300;
  ship.angle = 0;

  game.update(0, { dash: true });
  ship.angle = Math.PI;
  game.update(0, { dash: true });

  assertClose(ship.dashVx, 820, 1e-9, 'a held/repeated dash must not replace the active impulse');
  assertClose(game.state.abilities.dashCooldown, 1.5);

  game.update(1.499, {});
  assert.ok(game.state.abilities.dashCooldown > 0);
  game.update(0, { dash: true });
  assert.equal(ship.dashTime, 0, 'dash must still be blocked immediately before cooldown expiry');

  game.update(0.002, {});
  assert.equal(game.state.abilities.dashCooldown, 0);
  game.update(0, { dash: true });
  assertClose(ship.dashVx, -820, 1e-8);
  assertClose(ship.dashVy, 0, 1e-8);
  assertClose(ship.dashTime, 0.18);
  assertClose(game.state.abilities.dashCooldown, 1.5);
});

test('swept collision catches a 1340 px/s dash-inherited shot against a -520 px/s asteroid', () => {
  const { cfg, game } = setupGame(31);
  const ship = game.state.ship;
  ship.x = 100;
  ship.y = 300;
  ship.angle = 0;

  const incoming = makeAsteroid(cfg, 'small', 154, 300, 3101);
  incoming.vx = -520;
  const sentinel = makeAsteroid(cfg, 'small', 350, 30, 3102);
  game.state.asteroids = [incoming, sentinel];

  game.update(0, { dash: true, fire: true });

  assert.equal(game.state.bullets.length, 1);
  assert.equal(game.state.bullets[0].vx, 1340);
  assert.equal(incoming.vx, -520);

  // In 1/30 s the circles pass completely through one another: their final
  // centre distance is 22 px while their combined radius is 16 px.
  game.update(1 / 30, {});

  assert.equal(incoming.alive, false);
  assert.equal(game.state.bullets.length, 0);
  assert.equal(game.state.score, cfg.asteroid.smallPoints);
  assert.ok(game.state.asteroids.includes(sentinel));
});

test('shield burst repels through a toroidal seam, caps speed, and never destroys or scores', () => {
  const { cfg, game } = setupGame(4);
  const ship = game.state.ship;
  ship.x = 10;
  ship.y = 300;
  ship.angle = 0;
  ship.invuln = 0;

  const alreadyOutward = makeAsteroid(cfg, 'small', 790, 300, 401);
  alreadyOutward.vx = -500;
  const capped = makeAsteroid(cfg, 'small', 750, 300, 404);
  capped.vx = -700;
  const falloff = makeAsteroid(cfg, 'small', 720, 300, 402);
  const outside = makeAsteroid(cfg, 'small', 220, 300, 403);
  game.state.asteroids = [alreadyOutward, capped, falloff, outside];
  game.state.score = 77;
  const livesBefore = game.state.lives;

  game.update(0, { shieldBurst: true });

  assert.equal(game.state.lives, livesBefore, 'shield grace must protect an existing overlap');
  assertClose(ship.invuln, 0.2);
  assertClose(game.state.abilities.shieldEnergy, 55);

  assertClose(
    alreadyOutward.vx,
    -500,
    1e-8,
    'an asteroid already moving outward faster than the target is not accelerated again',
  );
  assertClose(alreadyOutward.vy, 0);

  assertClose(capped.vx, -520, 1e-8, 'total asteroid speed must still be capped');
  assertClose(capped.vy, 0);
  assertClose(Math.hypot(capped.vx, capped.vy), 520, 1e-8);

  // Toroidal distance is 90: 360 * (1 - 0.65 * 90 / 180) = 243.
  assertClose(falloff.vx, -243, 1e-8);
  assertClose(falloff.vy, 0);
  assertClose(outside.vx, 0, 1e-9, 'an asteroid beyond burst radius + its radius is unaffected');
  assertClose(outside.vy, 0);

  assert.equal(game.state.score, 77);
  assert.deepEqual(game.state.asteroids, [alreadyOutward, capped, falloff, outside]);
  assert.ok(game.state.asteroids.every(asteroid => asteroid.alive));

  const effect = game.state.effects.find(item => item.kind === 'shield');
  assert.ok(effect);
  assert.equal(effect.x, 10);
  assert.equal(effect.y, 300);
  assert.equal(effect.maxRadius, 180);
  assert.equal(effect.age, 0);
});

test('shield reverses an asteroid moving toward the ship into guaranteed outward motion', () => {
  const { cfg, game } = setupGame(41);
  const ship = game.state.ship;
  ship.x = 400;
  ship.y = 300;
  ship.invuln = 0;

  const incoming = makeAsteroid(cfg, 'small', 500, 300, 4101);
  incoming.vx = -520;
  game.state.asteroids = [incoming];

  game.update(0, { shieldBurst: true });

  // At distance 100, the configured falloff gives a target radial speed of
  // 360 * (1 - 0.65 * 100 / 180) = 230 px/s away from the ship.
  assertClose(incoming.vx, 230, 1e-8);
  assertClose(incoming.vy, 0);
  assert.ok(incoming.vx > 0, 'the post-burst radial component must point away from the ship');
  assert.equal(incoming.alive, true);
  assert.equal(game.state.score, 0);
});

test('shield energy costs 45, blocks below cost, regenerates at 14/s, and caps at 100', () => {
  const { game } = setupGame(5);

  game.update(0, { shieldBurst: true });
  game.update(0, { shieldBurst: true });
  assert.equal(game.state.abilities.shieldEnergy, 10);
  assert.equal(game.state.effects.filter(effect => effect.kind === 'shield').length, 2);

  game.update(0, { shieldBurst: true });
  assert.equal(game.state.abilities.shieldEnergy, 10);
  assert.equal(
    game.state.effects.filter(effect => effect.kind === 'shield').length,
    2,
    'an unaffordable burst must not create an effect',
  );

  game.update(1, {});
  assertClose(game.state.abilities.shieldEnergy, 24);

  game.state.abilities.shieldEnergy = 99;
  game.update(1, {});
  assert.equal(game.state.abilities.shieldEnergy, 100);
});

test('hyperspace rejects a near RNG candidate but remains blind to asteroids at a distant candidate', () => {
  const { cfg, rng, game } = setupGame(6);
  const ship = game.state.ship;
  ship.x = 100;
  ship.y = 120;
  ship.vx = 123;
  ship.vy = -45;
  ship.invuln = 0;

  const destinationOccupant = makeAsteroid(cfg, 'small', 200, 450, 601);
  game.state.asteroids = [destinationOccupant];
  // (200,120) is only 100 px away and must be rejected. The second candidate
  // is far enough even though an asteroid occupies it.
  rng.queue(0.25, 0.2, 0.25, 0.75, 0.9, 0.9);
  const livesBefore = game.state.lives;

  game.update(0, { hyperspace: true });

  assert.equal(ship.x, 200);
  assert.equal(ship.y, 450);
  assert.equal(ship.vx, 0);
  assert.equal(ship.vy, 0);
  assert.equal(ship.invuln, 0.12);
  assert.equal(game.state.lives, livesBefore, 'arrival invulnerability must protect a blind occupied destination');
  assert.ok(game.state.asteroids.includes(destinationOccupant));
  assert.equal(game.state.abilities.hyperspaceCooldown, 6);

  assert.equal(game.state.bombs.length, 1);
  assert.deepEqual(
    {
      x: game.state.bombs[0].x,
      y: game.state.bombs[0].y,
      fuse: game.state.bombs[0].fuse,
      fuseTotal: game.state.bombs[0].fuseTotal,
      blastRadius: game.state.bombs[0].blastRadius,
      alive: game.state.bombs[0].alive,
    },
    { x: 100, y: 120, fuse: 0.8, fuseTotal: 0.8, blastRadius: 125, alive: true },
  );

  const teleport = game.state.effects.find(effect => effect.kind === 'teleport');
  assert.ok(teleport);
  assert.equal(teleport.x, 200);
  assert.equal(teleport.y, 450);
  assert.equal(teleport.age, 0);

  game.update(0, { hyperspace: true });
  assert.equal(game.state.bombs.length, 1, 'cooldown must prevent a second departure bomb');
  assert.equal(ship.x, 200, 'blocked hyperspace must not consume the queued destination');
  assert.equal(ship.y, 450);
});

test('hyperspace falls back to the antipode with constant RNG and caps min distance in small worlds', () => {
  const cfg = cloneConfig();
  let calls = 0;
  const constantRng = () => {
    calls++;
    return 0.5;
  };
  const game = createGame(cfg, constantRng);
  game.start();
  game.state.asteroids = [makeAsteroid(cfg, 'small', 350, 30, 6201)];
  game.state.ship.x = 400;
  game.state.ship.y = 300;
  game.state.ship.invuln = 0;
  const callsBefore = calls;

  game.update(0, { hyperspace: true });

  assert.equal(calls - callsBefore, 32, '16 rejected destinations consume an x/y RNG pair each');
  assert.equal(game.state.ship.x, 0);
  assert.equal(game.state.ship.y, 0);

  const smallCfg = cloneConfig();
  smallCfg.world.width = 200;
  smallCfg.world.height = 100;
  const smallRng = makeRng(6202);
  const smallGame = createGame(smallCfg, smallRng);
  smallGame.start();
  smallGame.state.asteroids = [makeAsteroid(smallCfg, 'small', 0, 0, 6203)];
  smallGame.state.ship.x = 100;
  smallGame.state.ship.y = 50;
  smallGame.state.ship.invuln = 0;
  smallRng.queue(0.7, 0.5); // 40 px away; effective minimum is 35% of 100 = 35.

  smallGame.update(0, { hyperspace: true });

  assert.equal(smallGame.state.ship.x, 140);
  assert.equal(smallGame.state.ship.y, 50);
});

test('hyperspace cooldown blocks reuse until six seconds have elapsed', () => {
  const { rng, game } = setupGame(7);
  rng.queue(0.1, 0.1, 0.8, 0.7);

  game.update(0, { hyperspace: true });
  game.update(5.999, {});
  assert.ok(game.state.abilities.hyperspaceCooldown > 0);
  assert.equal(game.state.bombs.length, 0, 'the first departure bomb has already detonated');

  game.update(0, { hyperspace: true });
  assert.equal(game.state.bombs.length, 0);
  assert.equal(game.state.ship.x, 80);
  assert.equal(game.state.ship.y, 60);

  game.update(0.002, {});
  assert.equal(game.state.abilities.hyperspaceCooldown, 0);
  game.update(0, { hyperspace: true });

  assert.equal(game.state.bombs.length, 1);
  assert.equal(game.state.ship.x, 640);
  assert.equal(game.state.ship.y, 420);
  assert.equal(game.state.abilities.hyperspaceCooldown, 6);
});

test('hyperspace bomb honors its fuse and toroidal radius, fragments, and scores each target once', () => {
  const { cfg, rng, game } = setupGame(8);
  const ship = game.state.ship;
  ship.x = 10;
  ship.y = 300;
  ship.vx = 0;
  ship.vy = 0;
  ship.invuln = 0;

  const acrossSeam = makeAsteroid(cfg, 'large', 790, 300, 801);
  const justOutside = makeAsteroid(cfg, 'small', 150, 300, 802);
  game.state.asteroids = [acrossSeam, justOutside];
  rng.queue(0.5, 0.1);

  game.update(0, { hyperspace: true });
  game.update(0.799, {});

  assert.equal(game.state.bombs.length, 1);
  assert.ok(game.state.bombs[0].fuse > 0);
  assertClose(game.state.bombs[0].fuse, 0.001, 1e-9);
  assert.equal(game.state.score, 0);
  assert.ok(game.state.asteroids.includes(acrossSeam));

  game.update(0.002, {});

  assert.equal(game.state.bombs.length, 0);
  assert.equal(acrossSeam.alive, false);
  assert.equal(game.state.score, cfg.asteroid.largePoints);
  assert.ok(game.state.asteroids.includes(justOutside));
  assert.equal(justOutside.alive, true);
  assert.equal(game.state.asteroids.filter(asteroid => asteroid.size === 'medium').length, 2);
  assert.equal(game.state.asteroids.filter(asteroid => asteroid.size === 'large').length, 0);

  const blast = game.state.effects.find(effect => effect.kind === 'bomb');
  assert.ok(blast);
  assert.equal(blast.x, 10);
  assert.equal(blast.y, 300);
  assert.equal(blast.maxRadius, 125);

  game.update(0.2, {});
  assert.equal(game.state.score, cfg.asteroid.largePoints, 'a spent bomb must not score again');
  assert.equal(game.state.asteroids.filter(asteroid => asteroid.size === 'medium').length, 2);

  game.update(cfg.abilities.hyperspace.bombEffectDuration, {});
  assert.equal(game.state.effects.some(effect => effect.kind === 'bomb'), false);
  assert.equal(game.state.score, cfg.asteroid.largePoints);
});

test('pause freezes ability cooldowns, energy, dash, bomb fuse, and effect ages', () => {
  const { rng, game } = setupGame(9);
  const ship = game.state.ship;
  ship.x = 100;
  ship.y = 100;
  ship.angle = 0;
  rng.queue(0.75, 0.75);

  game.update(0, { hyperspace: true, shieldBurst: true, dash: true });
  const before = structuredClone({
    abilities: game.state.abilities,
    bombs: game.state.bombs,
    effects: game.state.effects,
    ship: {
      x: ship.x,
      y: ship.y,
      vx: ship.vx,
      vy: ship.vy,
      invuln: ship.invuln,
      dashing: ship.dashing,
      dashTime: ship.dashTime,
      dashVx: ship.dashVx,
      dashVy: ship.dashVy,
    },
  });

  game.pause();
  game.update(10, { hyperspace: true, shieldBurst: true, dash: true });

  assert.deepEqual(
    {
      abilities: game.state.abilities,
      bombs: game.state.bombs,
      effects: game.state.effects,
      ship: {
        x: ship.x,
        y: ship.y,
        vx: ship.vx,
        vy: ship.vy,
        invuln: ship.invuln,
        dashing: ship.dashing,
        dashTime: ship.dashTime,
        dashVx: ship.dashVx,
        dashVy: ship.dashVy,
      },
    },
    before,
  );

  game.resume();
  game.update(0.1, {});
  assertClose(game.state.abilities.dashCooldown, 1.4);
  assertClose(game.state.abilities.hyperspaceCooldown, 5.9);
  assertClose(game.state.abilities.shieldEnergy, 56.4);
  assertClose(game.state.bombs[0].fuse, 0.7);
  assert.ok(game.state.effects.every(effect => Math.abs(effect.age - 0.1) < 1e-9));
  assertClose(ship.dashTime, 0.08);
});

test('restart clears every transient ability object and restores pilot resources', () => {
  const { cfg, rng, game } = setupGame(10);
  game.state.ship.angle = 0;
  game.state.highScore = 321;
  rng.queue(0.6, 0.7, 0.1, 0.1);
  game.update(0, { hyperspace: true, shieldBurst: true, dash: true });

  assert.ok(game.state.bombs.length > 0);
  assert.ok(game.state.effects.length > 0);
  assert.ok(game.state.ship.dashing);

  game.restart();

  assert.deepEqual(game.state.abilities, {
    dashCooldown: 0,
    shieldEnergy: cfg.abilities.shieldBurst.maxEnergy,
    hyperspaceCooldown: 0,
  });
  assert.deepEqual(game.state.bombs, []);
  assert.deepEqual(game.state.effects, []);
  assert.equal(game.state.ship.dashing, false);
  assert.equal(game.state.ship.dashTime, 0);
  assert.equal(game.state.ship.dashVx, 0);
  assert.equal(game.state.ship.dashVy, 0);
  assert.equal(game.state.ship.vx, 0);
  assert.equal(game.state.ship.vy, 0);
  assert.equal(game.state.ship.invuln, cfg.ship.respawnInvuln);
  assert.equal(game.state.highScore, 321);
});

test('resize canonicalizes active bombs and effects without changing their timers', () => {
  const { cfg, rng, game } = setupGame(11);
  const ship = game.state.ship;
  ship.x = 750;
  ship.y = 550;
  ship.invuln = 0;
  // The first candidate is only ~76 px from the origin and is rejected. The
  // second is distant, giving a deterministic destination for resize checks.
  rng.queue(0.9, 0.8, 0.4, 0.2);

  game.update(0, { hyperspace: true, shieldBurst: true });
  assert.equal(game.state.bombs.length, 1);
  assert.equal(game.state.effects.length, 2);
  const fuseBefore = game.state.bombs[0].fuse;
  const effectTimersBefore = game.state.effects.map(effect => ({
    age: effect.age,
    duration: effect.duration,
    maxRadius: effect.maxRadius,
  }));

  game.resize(200, 150);

  assert.equal(game.state.bombs[0].x, 150);
  assert.equal(game.state.bombs[0].y, 100);
  assert.equal(game.state.bombs[0].fuse, fuseBefore);
  assert.equal(game.state.ship.x, 120);
  assert.equal(game.state.ship.y, 120);
  assert.ok(game.state.effects.every(effect => effect.x === 120 && effect.y === 120));
  assert.deepEqual(
    game.state.effects.map(effect => ({
      age: effect.age,
      duration: effect.duration,
      maxRadius: effect.maxRadius,
    })),
    effectTimersBefore,
  );
  assert.equal(cfg.world.width, 200);
  assert.equal(cfg.world.height, 150);
  assert.equal(CONFIG.world.width, W, 'resizing a cloned config must not mutate CONFIG');
  assert.equal(CONFIG.world.height, H);
});
