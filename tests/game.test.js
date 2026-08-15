import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createGame } from '../src/game.js';
import {
  createBullet, createAsteroid, createEnemyBullet, createMine, createUfo,
} from '../src/entities.js';
import { wrap, torusDistance } from '../src/math.js';
import { createInputManager } from '../src/input.js';

// Deterministic PRNG for reproducible tests
function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Fire and advance frames until bullet hits something or expires
function fireAndAdvance(g, maxFrames = 120) {
  g.update(1/60, { fire: true });
  for (let i = 0; i < maxFrames; i++) {
    if (g.state.bullets.length === 0) break;
    g.update(1/60, {});
  }
}

const W = 800, H = 600;

// ---- Ship movement ----

test('ship: same logical displacement with different deltaTime divisions', () => {
  const cfg = makeTestConfig();
  // 1 step of 1/60 s
  const g1 = createGame(cfg, makeRng(42));
  g1.start();
  const ship1 = g1.state.ship;
  ship1.x = 400; ship1.y = 300; ship1.vx = 0; ship1.vy = 0; ship1.angle = 0;
  g1.update(1/60, { thrust: true, rotLeft: false, rotRight: false, fire: false });

  // 4 steps of 1/240 s (same total time)
  const g2 = createGame(cfg, makeRng(42));
  g2.start();
  const ship2 = g2.state.ship;
  ship2.x = 400; ship2.y = 300; ship2.vx = 0; ship2.vy = 0; ship2.angle = 0;
  for (let i = 0; i < 4; i++) g2.update(1/240, { thrust: true, rotLeft: false, rotRight: false, fire: false });

  assert.ok(Math.abs(ship1.x - ship2.x) < 0.5, `x: ${ship1.x} vs ${ship2.x}`);
  assert.ok(Math.abs(ship1.y - ship2.y) < 0.5, `y: ${ship1.y} vs ${ship2.y}`);
});

test('ship: velocity does not exceed maxSpeed', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  const ship = g.state.ship;
  ship.vx = cfg.ship.maxSpeed;
  ship.vy = 0;
  // thrust in same direction — should not exceed
  g.update(1/60, { thrust: true, rotLeft: false, rotRight: false, fire: false });
  const speed = Math.hypot(ship.vx, ship.vy);
  assert.ok(speed <= cfg.ship.maxSpeed + 1, `speed ${speed} > max ${cfg.ship.maxSpeed}`);
});

test('ship: wrap around left edge', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  const ship = g.state.ship;
  // Place centre past the left edge; canonical wrap teleports to right side.
  ship.x = -ship.radius - 1; ship.y = 300; ship.vx = -200; ship.vy = 0;
  g.update(1/60, {});
  assert.ok(ship.x > W/2, `should wrap to right side, got x=${ship.x}`);
});

test('ship: wrap around right edge', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  const ship = g.state.ship;
  // Place centre past the right edge; canonical wrap teleports to left side.
  ship.x = W + ship.radius + 1; ship.y = 300; ship.vx = 200; ship.vy = 0;
  g.update(1/60, {});
  assert.ok(ship.x < W/2, `should wrap to left side, got x=${ship.x}`);
});

// ---- Bullets ----

test('bullet: spawns at ship nose and inherits velocity', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  const ship = g.state.ship;
  ship.x = 400; ship.y = 300; ship.angle = 0;
  // Non-zero ship velocity — bullet must inherit it.
  ship.vx = 85; ship.vy = 0;
  g.update(1/60, { fire: true });
  assert.equal(g.state.bullets.length, 1);
  const b = g.state.bullets[0];
  // nose is at ship.x + radius in direction angle=0 → +x
  // Bullet also moves one step in the same frame.
  // Bullet velocity = bullet.speed + ship.vx (inheritance).
  const expectedNose = 400 + cfg.ship.radius;
  const oneStepMove = (cfg.bullet.speed + 85) * (1/60);
  assert.ok(Math.abs(b.x - (expectedNose + oneStepMove)) < 1, `nose+step x=${b.x}, expected ~${expectedNose + oneStepMove}`);
  assert.ok(b.vx > cfg.bullet.speed, 'bullet should inherit ship velocity (vx > bullet.speed)');
  assert.equal(b.vy, 0, 'no vertical velocity');
});

test('bullet: cooldown is respected', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300;
  g.update(1/60, { fire: true });
  assert.equal(g.state.bullets.length, 1);
  // fire again immediately — should be blocked by cooldown
  g.update(1/60, { fire: true });
  assert.equal(g.state.bullets.length, 1);
});

test('bullet: max 6 simultaneous bullets', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300;
  for (let i = 0; i < 10; i++) {
    g.update(cfg.bullet.cooldown + 0.01, { fire: true });
  }
  assert.ok(g.state.bullets.length <= cfg.bullet.max, `got ${g.state.bullets.length}`);
});

test('bullet: expires after configured life', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300;
  g.update(1/60, { fire: true });
  assert.equal(g.state.bullets.length, 1);
  // advance past life
  g.update(cfg.bullet.life + 0.1, {});
  assert.equal(g.state.bullets.length, 0);
});

test('bullet: does not tunnel through smallest asteroid at max speed', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = []; // clear wave asteroids for deterministic test
  // Place a small asteroid directly in front of the ship, stationary
  const ship = g.state.ship;
  ship.x = 100; ship.y = 300; ship.angle = 0; ship.vx = 0; ship.vy = 0;
  const ast = createAsteroid('small', 200, 300, cfg, makeRng(2));
  ast.vx = 0; ast.vy = 0; // stationary
  g.state.asteroids.push(ast);
  g.update(1/60, { fire: true });
  // bullet now exists; advance steps until bullet would have passed
  let hit = false;
  for (let i = 0; i < 60; i++) {
    g.update(1/60, {});
    // Check if the small asteroid was destroyed (score increased or bullet consumed)
    if (g.state.score >= 100) { hit = true; break; }
    // Stop if a new wave spawned (asteroids became large)
    if (g.state.asteroids.some(a => a.size === 'large')) break;
  }
  assert.ok(hit, 'bullet should have hit the small asteroid (no tunneling)');
});

// ---- Asteroids / fragmentation ----

test('asteroid: large splits into exactly 2 medium', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  g.state.ship.x = 100; g.state.ship.y = 300; g.state.ship.angle = 0;
  const ast = createAsteroid('large', 400, 300, cfg, makeRng(3));
  ast.vx = 0; ast.vy = 0;
  g.state.asteroids.push(ast);
  fireAndAdvance(g);
  // bullet hits large → should split
  assert.equal(g.state.asteroids.filter(a => a.size === 'medium').length, 2);
  assert.equal(g.state.asteroids.filter(a => a.size === 'large').length, 0);
});

test('asteroid: medium splits into exactly 2 small', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  g.state.ship.x = 100; g.state.ship.y = 300; g.state.ship.angle = 0;
  const ast = createAsteroid('medium', 400, 300, cfg, makeRng(3));
  ast.vx = 0; ast.vy = 0;
  g.state.asteroids.push(ast);
  fireAndAdvance(g);
  assert.equal(g.state.asteroids.filter(a => a.size === 'small').length, 2);
  assert.equal(g.state.asteroids.filter(a => a.size === 'medium').length, 0);
});

test('asteroid: small does not split', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  g.state.ship.x = 100; g.state.ship.y = 300; g.state.ship.angle = 0;
  const ast = createAsteroid('small', 400, 300, cfg, makeRng(3));
  ast.vx = 0; ast.vy = 0;
  g.state.asteroids.push(ast);
  // Fire and advance just enough for bullet to hit (no wave clear)
  g.update(1/60, { fire: true });
  for (let i = 0; i < 60; i++) {
    g.update(1/60, {});
    if (g.state.score >= 100) break; // hit!
  }
  // The small asteroid was destroyed; no fragments should have been created.
  // (A new wave may have spawned if all asteroids cleared, so check score only.)
  assert.equal(g.state.score, 100);
  // No medium or small fragments from the split (small has no children)
  assert.ok(!g.state.asteroids.some(a => a.size === 'medium'), 'should not produce medium fragments');
});

test('scoring: large=20, medium=50, small=100 and never duplicated', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  g.state.ship.x = 100; g.state.ship.y = 300; g.state.ship.angle = 0;

  // Large → 20
  const a1 = createAsteroid('large', 400, 300, cfg, makeRng(3));
  a1.vx = 0; a1.vy = 0;
  g.state.asteroids.push(a1);
  fireAndAdvance(g);
  assert.equal(g.state.score, 20);

  // Medium → 50
  const a2 = createAsteroid('medium', 400, 300, cfg, makeRng(4));
  a2.vx = 0; a2.vy = 0;
  g.state.asteroids.push(a2);
  // Wait for cooldown, then fire
  g.update(cfg.bullet.cooldown + 0.01, {});
  fireAndAdvance(g);
  assert.equal(g.state.score, 70);

  // Small → 100
  const a3 = createAsteroid('small', 400, 300, cfg, makeRng(5));
  a3.vx = 0; a3.vy = 0;
  g.state.asteroids.push(a3);
  g.update(cfg.bullet.cooldown + 0.01, {});
  fireAndAdvance(g);
  assert.equal(g.state.score, 170);
});

test('bullet: hitting two overlapping targets hits only one', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  g.state.ship.x = 100; g.state.ship.y = 300; g.state.ship.angle = 0;
  // Two small asteroids overlapping at the same spot, stationary
  const a1 = createAsteroid('small', 400, 300, cfg, makeRng(3));
  a1.vx = 0; a1.vy = 0;
  const a2 = createAsteroid('small', 400, 300, cfg, makeRng(4));
  a2.vx = 0; a2.vy = 0;
  g.state.asteroids.push(a1, a2);
  fireAndAdvance(g);
  // Only one should be destroyed, bullet consumed
  assert.equal(g.state.asteroids.length, 1);
  assert.equal(g.state.bullets.length, 0);
  assert.equal(g.state.score, 100);
});

// ---- Lives / respawn / game over ----

test('collision: ship loses one life during vulnerability', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300; g.state.ship.invuln = 0;
  g.state.asteroids.push(createAsteroid('large', 400, 300, cfg, makeRng(3)));
  g.update(1/60, {});
  assert.equal(g.state.lives, cfg.game.lives - 1);
});

test('collision: ship invulnerable does not lose life', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300; g.state.ship.invuln = 2.0;
  g.state.asteroids.push(createAsteroid('large', 400, 300, cfg, makeRng(3)));
  g.update(1/60, {});
  assert.equal(g.state.lives, cfg.game.lives);
});

test('last life produces gameOver', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.lives = 1;
  g.state.ship.x = 400; g.state.ship.y = 300; g.state.ship.invuln = 0;
  g.state.asteroids.push(createAsteroid('large', 400, 300, cfg, makeRng(3)));
  g.update(1/60, {});
  assert.equal(g.state.status, 'gameOver');
});

// ---- Extra lives ----

test('extra life: stays on fixed score milestones after an overshoot', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.score = 9990;
  g.state.nextExtraLifeScore = 10000;
  g.state.lives = 3;
  g.state.ship.x = 400; g.state.ship.y = 300;
  g.state.asteroids = [createAsteroid('small', 400, 300, cfg, makeRng(3))];
  g.state.ship.angle = 0;
  g.update(1/60, { fire: true });
  for (let i = 0; i < 120 && g.state.score === 9990; i++) {
    g.update(1/60, {});
  }
  assert.equal(g.state.score, 10090, `score=${g.state.score}`);
  assert.equal(g.state.lives, 4, 'should gain one life');
  assert.equal(g.state.nextExtraLifeScore, 20000, 'next milestone remains fixed at 20,000');
});

test('extra life: one award can cross multiple fixed milestones', () => {
  const cfg = makeTestConfig();
  cfg.asteroid.largePoints = 25000;
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.score = 0;
  g.state.nextExtraLifeScore = 10000;
  g.state.lives = 3;
  g.state.ship.x = 400; g.state.ship.y = 300;
  g.state.asteroids = [createAsteroid('large', 400, 300, cfg, makeRng(3))];
  g.state.ship.angle = 0;
  g.update(1/60, { fire: true });
  assert.equal(g.state.score, 25000);
  assert.equal(g.state.lives, 5, 'the 10k and 20k milestones both award a life');
  assert.equal(g.state.nextExtraLifeScore, 30000);
  assert.equal(g.state.extraLivesAwarded, 2);
  assert.equal(g.state.effects.filter(e => e.kind === 'extraLife').length, 2);
});

test('extra life: capped at maxLives', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.score = 9990;
  g.state.lives = 6;
  g.state.nextExtraLifeScore = 10000;
  g.state.ship.x = 400; g.state.ship.y = 300;
  g.state.asteroids = [createAsteroid('small', 400, 300, cfg, makeRng(3))];
  g.state.ship.angle = 0;
  g.update(1/60, { fire: true });
  for (let i = 0; i < 120 && g.state.score === 9990; i++) {
    g.update(1/60, {});
  }
  assert.equal(g.state.lives, 6, 'should not exceed maxLives');
  assert.equal(g.state.nextExtraLifeScore, 20000, 'the consumed milestone is not retried later');
});

// ---- Ship shield against hostile craft ----

test('shield: absorbs UFO collision without losing life', () => {
  const cfg = makeTestConfig();
  // Ensure UFO config exists for this test config.
  cfg.ufo = cfg.ufo ?? {
    unlockWave: 5,
    squadSize: { base: 1, growthPerWave: 0, max: 1, lateGameMax: 1, lateGameWave: 20 },
    hunter: { radius: 18, speed: 254, turnRate: 3.2, hp: 4, points: 400, fireCooldown: 0.86, avoidance: { enabled: false }, bulletEvasion: { enabled: false } },
    enemyBullet: { speed: 220, life: 2.4, radius: 3 },
    asteroidCollision: {
      enabled: true,
      restitution: 1.12,
      contactReleasePadding: 1.0,
      knockbackDamping: 5.0,
      maxSeparationIterations: 24,
      maxDeflectionAngle: Math.PI / 4,
      predictionLookahead: 0.4,
      avoidanceWeight: 0.65,
    },
  };
  cfg.ufo.unlockWave = 5;
  cfg.ufo.squadSize = { base: 1, growthPerWave: 0, max: 1, lateGameMax: 1, lateGameWave: 20 };
  const g = createGame(cfg, makeRng(1));
  g.start();
  while (g.state.wave < 5) {
    g.state.asteroids = [];
    g.state.ufos = [];
    g.update(0, {});
  }
  g.state.asteroids = [];
  g.state.ship.shield = 100;
  g.state.ship.invuln = 0;
  g.state.ship.x = 400; g.state.ship.y = 300;
  const ufo = createUfo('hunter', 400, 300, cfg, makeRng(3), 1, 1);
  g.state.ufos = [ufo];
  Object.assign(ufo, { x: 400, y: 300, vx: 0, vy: 0, alive: true, hp: 4, warpInTimer: 0, radius: 18, visualRadius: 36 });
  const livesBefore = g.state.lives;
  g.update(1/60, {});
  assert.ok(g.state.ship.shield < 100, `shield should take damage, got ${g.state.ship.shield}`);
  assert.equal(g.state.lives, livesBefore, 'life should be preserved while shield holds');
});

test('shield: a continuous UFO overlap is one impact until separation', () => {
  const cfg = structuredClone(CONFIG);
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  Object.assign(g.state.ship, {
    x: 400, y: 300, vx: 0, vy: 0, invuln: 0,
    shield: cfg.ship.shield.max,
    shieldRegenDelay: 10,
  });
  const ufo = createUfo('hunter', 400, 300, cfg, makeRng(3), 1, 1);
  Object.assign(ufo, {
    x: 400, y: 300, vx: 0, vy: 0, speed: 0,
    warpInTimer: 0, fireTimer: 999, alive: true,
  });
  g.state.ufos = [ufo];

  g.update(1/60, {});
  const firstImpactShield = g.state.ship.shield;
  assert.equal(firstImpactShield, cfg.ship.shield.max - cfg.ship.shield.damageBySource.ufo);

  g.update(1/60, {});
  assert.equal(g.state.ship.shield, firstImpactShield, 'same contact must not drain again');

  ufo.x = 200;
  g.update(1/60, {});
  ufo.x = 400;
  g.update(1/60, {});
  assert.equal(
    g.state.ship.shield,
    firstImpactShield - cfg.ship.shield.damageBySource.ufo,
    'a new contact after separation damages the shield again',
  );
});

test('shield: enemy bullet is absorbed by shield', () => {
  const cfg = makeTestConfig();
  cfg.ufo = cfg.ufo ?? {
    hunter: { radius: 18, speed: 254, turnRate: 3.2, hp: 4, points: 400, fireCooldown: 0.86, avoidance: { enabled: false }, bulletEvasion: { enabled: false } },
    enemyBullet: { speed: 220, life: 2.4, radius: 3 },
  };
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  g.state.ship.shield = 100;
  g.state.ship.invuln = 0;
  g.state.ship.x = 400; g.state.ship.y = 300;
  const ufo = createUfo('hunter', 430, 300, cfg, makeRng(3), 1, 1);
  const bullet = createEnemyBullet(ufo, { x: 400, y: 300 }, cfg, W, H);
  // The bullet is already on a collision course; manually override to ensure it
  // reaches the ship within one frame.
  bullet.x = 400 + g.state.ship.radius + bullet.radius;
  bullet.y = 300;
  bullet.vx = -300; bullet.vy = 0;
  bullet.radius = 3;
  g.state.enemyBullets.push(bullet);
  const livesBefore = g.state.lives;
  g.update(1/60, {});
  assert.equal(g.state.enemyBullets.length, 0, 'bullet consumed');
  assert.equal(g.state.lives, livesBefore, 'life preserved');
  assert.equal(
    g.state.ship.shield,
    cfg.ship.shield.max - cfg.ship.shield.damageBySource.enemyBullet,
  );
});

test('shield: simultaneous enemy bullets each deal damage', () => {
  const cfg = structuredClone(CONFIG);
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  Object.assign(g.state.ship, {
    x: 400, y: 300, vx: 0, vy: 0, invuln: 0,
    shield: cfg.ship.shield.max,
    shieldRegenDelay: 10,
  });
  const ufo = createUfo('hunter', 430, 300, cfg, makeRng(3), 1, 1);
  const bullets = [0, 1].map(() => {
    const bullet = createEnemyBullet(ufo, g.state.ship, cfg, W, H);
    Object.assign(bullet, {
      x: 400 + g.state.ship.radius + bullet.radius,
      y: 300,
      vx: -300,
      vy: 0,
      radius: 3,
    });
    return bullet;
  });
  g.state.enemyBullets = bullets;
  const livesBefore = g.state.lives;

  g.update(1/60, {});

  assert.equal(g.state.enemyBullets.length, 0, 'all hit bullets are consumed');
  assert.equal(g.state.lives, livesBefore, 'the shield still protects the hull');
  assert.equal(
    g.state.ship.shield,
    cfg.ship.shield.max - 2 * cfg.ship.shield.damageBySource.enemyBullet,
  );
  assert.equal(g.state.effects.filter(e => e.kind === 'shieldHit').length, 2);
});

test('shield: an armed mine is absorbed without costing a life', () => {
  const cfg = structuredClone(CONFIG);
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  Object.assign(g.state.ship, {
    x: 400, y: 300, vx: 0, vy: 0, invuln: 0,
    shield: cfg.ship.shield.max,
    shieldRegenDelay: 10,
  });
  const base = createUfo('base', 400, 300, cfg, makeRng(3), 1, 1);
  const mine = createMine(base, cfg);
  mine.armTime = 0;
  mine.armed = true;
  g.state.mines = [mine];
  const livesBefore = g.state.lives;

  g.update(0, {});

  assert.equal(g.state.mines.length, 0, 'mine detonates once');
  assert.equal(g.state.lives, livesBefore, 'shield preserves the hull');
  assert.equal(
    g.state.ship.shield,
    cfg.ship.shield.max - cfg.ship.shield.damageBySource.mine,
  );
});

test('shield: an immediate hit does not regenerate before taking damage', () => {
  const cfg = structuredClone(CONFIG);
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  Object.assign(g.state.ship, {
    x: 400, y: 300, vx: 0, vy: 0, invuln: 0,
    shield: 20,
    shieldRegenDelay: 0,
  });
  const ufo = createUfo('hunter', 430, 300, cfg, makeRng(3), 1, 1);
  const bullet = createEnemyBullet(ufo, g.state.ship, cfg, W, H);
  Object.assign(bullet, {
    x: 400 + g.state.ship.radius + bullet.radius,
    y: 300,
    vx: -300,
    vy: 0,
    radius: 3,
  });
  g.state.enemyBullets = [bullet];
  const livesBefore = g.state.lives;

  g.update(1, {});

  assert.equal(g.state.lives, livesBefore - 1);
  assert.equal(g.state.ship.shield, cfg.ship.shield.max, 'respawn restores the shield');
});

test('shield: regenerates after its full delay, uses remaining time, and caps', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  g.state.ship.shield = 10;
  g.state.ship.shieldRegenDelay = 2;
  g.update(3, {});
  assert.equal(g.state.ship.shieldRegenDelay, 0);
  assert.equal(g.state.ship.shield, 28, 'the final second regenerates at 18/s');
  g.state.asteroids = [];
  g.update(10, {});
  assert.equal(g.state.ship.shield, cfg.ship.shield.max, 'shield never exceeds its maximum');
});

test('shield: asteroid still bypasses shield and costs a life', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.shield = 100;
  g.state.ship.invuln = 0;
  g.state.ship.x = 400; g.state.ship.y = 300;
  g.state.asteroids.push(createAsteroid('large', 400, 300, cfg, makeRng(3)));
  g.update(1/60, {});
  assert.equal(g.state.lives, cfg.game.lives - 1);
  assert.equal(g.state.ship.shield, cfg.ship.shield.max, 'shield refilled on respawn');
});

// ---- Pause ----

test('pause: simulation and timers do not advance', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300; g.state.ship.vx = 100; g.state.ship.vy = 0;
  g.pause();
  const xBefore = g.state.ship.x;
  g.update(1/60, {});
  assert.equal(g.state.ship.x, xBefore, 'ship should not move while paused');
  assert.equal(g.state.status, 'paused');
});

// ---- Waves ----

test('wave: spawn respects safe distance from ship', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300;
  // All asteroids should be outside safeSpawnRadius
  for (const a of g.state.asteroids) {
    const dx = Math.min(Math.abs(a.x - 400), W - Math.abs(a.x - 400));
    const dy = Math.min(Math.abs(a.y - 300), H - Math.abs(a.y - 300));
    const dist = Math.hypot(dx, dy);
    assert.ok(dist >= cfg.asteroid.safeSpawnRadius, `asteroid at ${a.x},${a.y} too close to ship (dist=${dist})`);
  }
});

test('wave: clearing all asteroids creates exactly one new wave', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  const wave1 = g.state.wave;
  // Destroy all asteroids (set to empty)
  g.state.asteroids = [];
  g.update(1/60, {});
  assert.equal(g.state.wave, wave1 + 1);
  assert.ok(g.state.asteroids.length > 0, 'new wave should spawn asteroids');
});

// ---- Restart ----

test('restart: restores all state, preserves only session high score', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.score = 500;
  g.state.highScore = 500;
  g.state.lives = 1;
  g.state.wave = 5;
  g.state.ship.thrusting = true;
  g.state.bullets.push(createBullet(g.state.ship, cfg));
  g.restart();
  assert.equal(g.state.score, 0);
  assert.equal(g.state.lives, cfg.game.lives);
  assert.equal(g.state.wave, 1);
  assert.equal(g.state.bullets.length, 0);
  assert.equal(g.state.asteroids.length, cfg.asteroid.initialCount);
  assert.equal(g.state.highScore, 500, 'high score should persist');
  assert.equal(g.state.status, 'playing');
  assert.equal(g.state.ship.thrusting, false, 'restart should clear thrusting');
});

// ---- States ----

test('state: initial status is ready', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  assert.equal(g.state.status, 'ready');
});

test('state: start() transitions to playing', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  assert.equal(g.state.status, 'playing');
});

// ---- Spawn distance across wrap edges ----

test('spawn: safe distance works across wrap edges (toroidal)', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  // Move ship to corner BEFORE start so wave spawns respect this position
  g.state.ship.x = 0; g.state.ship.y = 0;
  g.start();
  // start() resets ship to center, so we need a different approach:
  // manually spawn wave with ship at corner
  g.state.ship.x = 0; g.state.ship.y = 0;
  g.state.asteroids = [];
  // Simulate wave spawn by calling update with no asteroids
  g.state.status = 'playing';
  g.update(1/60, {});
  for (const a of g.state.asteroids) {
    const dist = Math.hypot(
      Math.min(Math.abs(a.x), W - Math.abs(a.x)),
      Math.min(Math.abs(a.y), H - Math.abs(a.y))
    );
    assert.ok(dist >= cfg.asteroid.safeSpawnRadius, `toroidal dist=${dist} < safe`);
  }
});

// ---- P1-1: Resize updates the logical world ----

test('resize: game.resize updates world dimensions used by simulation', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  // Ship at (900,700) — outside the original 800x600 world.
  g.state.ship.x = 900; g.state.ship.y = 700;
  g.state.ship.vx = 0; g.state.ship.vy = 0;
  // Resize to 1200x900
  g.resize(1200, 900);
  // The ship should NOT be wrapped/relocated by the resize itself.
  assert.equal(g.state.ship.x, 900, 'ship x should not change on resize');
  assert.equal(g.state.ship.y, 700, 'ship y should not change on resize');
  // Now update — ship should stay in place (no wrap since 900 < 1200).
  g.update(1/60, {});
  assert.equal(g.state.ship.x, 900, 'ship should remain at 900 in new 1200-wide world');
  assert.equal(g.state.ship.y, 700, 'ship should remain at 700 in new 900-tall world');
});

test('resize: entities spawned after resize use new dimensions', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.resize(1200, 900);
  // Clear and trigger a new wave — all asteroids should be within new world.
  g.state.asteroids = [];
  g.update(1/60, {});
  for (const a of g.state.asteroids) {
    assert.ok(a.x >= 0 && a.x <= 1200, `asteroid x=${a.x} outside new world width 1200`);
    assert.ok(a.y >= 0 && a.y <= 900, `asteroid y=${a.y} outside new world height 900`);
  }
});

test('resize: strong shrink normalizes entities to canonical world', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 900;
  g.state.ship.y = 300;
  g.state.ship.vx = 0;
  g.state.ship.vy = 0;

  g.resize(200, 600);
  assert.equal(g.state.ship.x, 100, 'resize should canonicalize using plain wrap');
  g.update(0, {});
  assert.equal(g.state.ship.x, 100, 'the next update should keep the ship canonical');
});

test('resize: bullets are canonicalized after a strong shrink', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300;
  // Fire two bullets at different off-screen positions by moving ship between shots.
  g.update(0, { fire: true });
  g.state.bullets[0].x = 950;
  g.state.bullets[0].y = 750;
  g.state.bullets[0].vx = 0;
  g.state.bullets[0].vy = 0;

  g.resize(200, 600);
  assert.equal(g.state.bullets[0].x, 150, 'bullet x should canonicalize with wrap');
  assert.equal(g.state.bullets[0].y, 150, 'bullet y should canonicalize with wrap');
});

test('resize: asteroids are canonicalized after a strong shrink', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  const ast = createAsteroid('large', 950, 750, cfg, makeRng(3));
  ast.vx = 0; ast.vy = 0;
  g.state.asteroids.push(ast);

  g.resize(200, 600);
  assert.equal(ast.x, 150);
  assert.equal(ast.y, 150);
});

// ---- P1-2: Guaranteed safe spawn with constant RNG ----

test('spawn: safe distance guaranteed even with constant RNG landing on ship', () => {
  // Use a world large enough for the safe radius to be geometrically possible.
  // 400x400 with safeRadius=160: max toroidal distance = ~141 < 160, so use 500x500.
  const cfg = makeTestConfig();
  cfg.world.width = 500;
  cfg.world.height = 500;
  cfg.asteroid.safeSpawnRadius = 160;
  // RNG that always returns 0.5 → always picks (250,250) = world centre = ship centre.
  const centerRng = () => 0.5;
  const g = createGame(cfg, centerRng);
  g.start();
  // Ship is at centre (250,250). Every random attempt also lands on (250,250).
  // Distance = 0 < 160, so the fallback ring must kick in.
  for (const a of g.state.asteroids) {
    const dx = Math.min(Math.abs(a.x - 250), 500 - Math.abs(a.x - 250));
    const dy = Math.min(Math.abs(a.y - 250), 500 - Math.abs(a.y - 250));
    const dist = Math.hypot(dx, dy);
    assert.ok(dist >= 155, `asteroid spawned at dist=${dist} < 160 (safe radius), fallback ring failed`);
  }
});

test('spawn: fallback ring keeps one phase with an adversarial RNG', () => {
  const cfg = makeTestConfig();
  cfg.world.width = 250;
  cfg.world.height = 1000;
  cfg.asteroid.initialCount = 1;
  cfg.asteroid.maxInitial = 1;
  cfg.asteroid.safeSpawnRadius = 160;

  let calls = 0;
  const adversarialRng = () => {
    const call = calls++;
    if (call < 200) return 0.5; // 100 rejected samples at the ship
    const i = call - 200;
    if (i < 16) return i === 0 ? 0 : 1 - i / 16;
    return 0.5;
  };

  const g = createGame(cfg, adversarialRng);
  g.start();
  assert.equal(g.state.asteroids.length, 1);
  const asteroid = g.state.asteroids[0];
  const distance = torusDistance(
    asteroid.x, asteroid.y,
    g.state.ship.x, g.state.ship.y,
    cfg.world.width, cfg.world.height
  );
  assert.ok(Math.abs(distance - cfg.asteroid.safeSpawnRadius) < 1e-9,
    `ring returned distance ${distance}, expected ${cfg.asteroid.safeSpawnRadius}`);
});

// ---- P1-2: Safe respawn avoids asteroids ----

test('respawn: ship respawns away from nearby asteroids', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  // Place an asteroid right at the center where respawn normally happens.
  g.state.asteroids = [];
  const ast = createAsteroid('large', 400, 300, cfg, makeRng(3));
  ast.vx = 0; ast.vy = 0;
  g.state.asteroids.push(ast);
  // Force a collision to trigger respawn.
  g.state.ship.x = 400; g.state.ship.y = 300; g.state.ship.invuln = 0;
  g.update(1/60, {});
  // Ship should have lost a life and respawned.
  assert.equal(g.state.lives, cfg.game.lives - 1, 'should lose one life');
  // The respawned ship should NOT be at the center (where the asteroid is).
  const distToAsteroid = Math.hypot(
    Math.min(Math.abs(g.state.ship.x - 400), W - Math.abs(g.state.ship.x - 400)),
    Math.min(Math.abs(g.state.ship.y - 300), H - Math.abs(g.state.ship.y - 300))
  );
  assert.ok(distToAsteroid >= cfg.asteroid.safeSpawnRadius,
    `respawned at dist=${distToAsteroid} from asteroid, expected >= ${cfg.asteroid.safeSpawnRadius}`);
});

test('respawn: preserves the best ring candidate when full margin is impossible', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, () => 0.5);
  g.start();
  g.state.asteroids = [];

  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 8; column++) {
      const asteroid = createAsteroid(
        'small', column * 100, row * 120 + 60, cfg, makeRng(row * 8 + column + 1)
      );
      asteroid.vx = 0;
      asteroid.vy = 0;
      g.state.asteroids.push(asteroid);
    }
  }

  g.state.ship.x = 400;
  g.state.ship.y = 300;
  g.state.ship.invuln = 0;
  const livesBefore = g.state.lives;
  g.update(0, {});

  assert.equal(g.state.lives, livesBefore - 1);
  assert.equal(g.state.respawnPending, false, 'a physically clear fallback exists');
  const margins = g.state.asteroids.map(a =>
    torusDistance(g.state.ship.x, g.state.ship.y, a.x, a.y, W, H) - a.radius
  );
  const minimumMargin = Math.min(...margins);
  assert.ok(minimumMargin > g.state.ship.radius,
    `ship overlaps an asteroid: surface margin ${minimumMargin}`);
  assert.ok(minimumMargin > 60,
    `respawn did not preserve the best sampled candidate: margin ${minimumMargin}`);
  assert.ok(minimumMargin < cfg.asteroid.safeSpawnRadius,
    'the fixture should force the reduced-margin fallback');
});

test('respawn: never accepts physical overlap when configured margin is smaller', () => {
  const cfg = makeTestConfig();
  cfg.asteroid.safeSpawnRadius = 0;
  cfg.asteroid.initialCount = 0;
  cfg.asteroid.maxInitial = 0;
  let rngCall = 0;
  const overlappingRng = () => (rngCall++ % 2 === 0 ? 0.525 : 0.5);
  const g = createGame(cfg, overlappingRng);
  g.start();

  const blocker = createAsteroid('small', 400, 300, cfg, makeRng(1));
  blocker.vx = 0;
  blocker.vy = 0;
  g.state.asteroids = [blocker];
  g.state.ship.x = 400;
  g.state.ship.y = 300;
  g.state.ship.invuln = 0;

  g.update(0, {});
  assert.equal(g.state.respawnPending, true,
    'an overlapping preferred-margin candidate must leave respawn pending');
  assert.equal(g.state.lives, cfg.game.lives - 1);
});

test('respawn: waits without losing another life when no clear position exists', () => {
  const cfg = makeTestConfig();
  cfg.world.width = 80;
  cfg.world.height = 80;
  cfg.asteroid.initialCount = 0;
  cfg.asteroid.maxInitial = 0;
  cfg.asteroid.largeR = 50;
  const g = createGame(cfg, () => 0.5);
  g.start();

  const blocker = createAsteroid('large', 40, 40, cfg, makeRng(1));
  blocker.vx = 0;
  blocker.vy = 0;
  g.state.asteroids = [blocker];
  g.state.ship.x = 40;
  g.state.ship.y = 40;
  g.state.ship.invuln = 0;

  g.update(0, {});
  const livesAfterCollision = g.state.lives;
  assert.equal(g.state.respawnPending, true);
  assert.equal(livesAfterCollision, cfg.game.lives - 1);

  g.update(1 / 60, { thrust: true, fire: true });
  assert.equal(g.state.lives, livesAfterCollision, 'pending respawn must not drain lives');
  assert.equal(g.state.bullets.length, 0, 'pending ship must not fire');
  assert.equal(g.state.ship.thrusting, false);

  g.state.asteroids = [];
  g.update(0, {});
  assert.equal(g.state.respawnPending, false);
  assert.equal(g.state.ship.x, 40);
  assert.equal(g.state.ship.y, 40);
  assert.equal(g.state.ship.invuln, cfg.ship.respawnInvuln);
});

// ---- P1-3: Canonical wrap + visual edge copies ----

test('wrap: canonical coordinate stays inside [0, width)', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  const ship = g.state.ship;
  ship.x = -15; ship.y = 300; ship.vx = 0; ship.vy = 0;
  g.update(1/60, {});
  assert.equal(ship.x, W - 15);
  assert.ok(ship.x >= 0 && ship.x < W);
});

test('wrap: partially off-screen entity keeps canonical coordinate', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  const ship = g.state.ship;
  // Ship radius = 14. Centre at 5 means left tip at -9 (partially off).
  ship.x = 5; ship.y = 300; ship.vx = 0; ship.vy = 0;
  g.update(1/60, {});
  assert.equal(ship.x, 5, 'canonical coordinate should stay at 5');
});

test('wrap: asteroid partially past right edge keeps canonical coordinate', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  // Large asteroid, radius 48. Place at x = W - 5 = 795.
  const ast = createAsteroid('large', W - 5, 300, cfg, makeRng(3));
  ast.vx = 0; ast.vy = 0;
  g.state.asteroids.push(ast);
  g.update(1/60, {});
  assert.equal(ast.x, W - 5, 'canonical coordinate should stay at W - 5');
});

test('wrap: ship wraps across the top edge to canonical world', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400;
  g.state.ship.y = -15;
  g.state.ship.vx = 0;
  g.state.ship.vy = 0;
  g.update(0, {});
  assert.equal(g.state.ship.y, H - 15);
});

test('wrap: ship wraps across the bottom edge to canonical world', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400;
  g.state.ship.y = H + 15;
  g.state.ship.vx = 0;
  g.state.ship.vy = 0;
  g.update(0, {});
  assert.equal(g.state.ship.y, 15);
});

test('wrap: bullet crosses the right edge during update', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300;
  g.update(0, { fire: true });
  const b = g.state.bullets[0];
  b.x = W - 5;
  b.vx = 400; // reaches W+1.667 in 1/60 s
  g.update(1 / 60, {});
  assert.ok(b.x < 10, `bullet should wrap to left side, got x=${b.x}`);
  assert.equal(b.alive, true);
});

test('wrap: asteroid crosses the top edge during update', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  const ast = createAsteroid('large', 400, 1, cfg, makeRng(3));
  ast.vx = 0; ast.vy = -120; // reaches -1 in 1/60 s
  g.state.asteroids.push(ast);
  g.update(1 / 60, {});
  assert.ok(ast.y > H - 10, `asteroid should wrap to bottom, got y=${ast.y}`);
});

// ---- P2: Friction actually reduces velocity ----

test('friction: velocity decays over time without thrust', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  const ship = g.state.ship;
  ship.x = 400; ship.y = 300; ship.vx = 200; ship.vy = 0;
  const speedBefore = Math.hypot(ship.vx, ship.vy);
  // Update 1 second worth of frames with no thrust.
  for (let i = 0; i < 60; i++) g.update(1/60, {});
  const speedAfter = Math.hypot(ship.vx, ship.vy);
  assert.ok(speedAfter < speedBefore, `friction should reduce speed: ${speedBefore} → ${speedAfter}`);
  // With friction 0.992 per step, after 60 steps: 0.992^60 ≈ 0.62.
  // So speed should be roughly 200 * 0.62 ≈ 124.
  assert.ok(speedAfter < 150, `friction should be significant: speed=${speedAfter}, expected < 150`);
});

test('ship: brake reduces speed without reversing and overrides thrust', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  const ship = g.state.ship;
  ship.x = 400;
  ship.y = 300;
  ship.angle = 0;
  ship.vx = 200;
  ship.vy = 0;

  g.update(1 / 60, { thrust: true, brake: true });

  assert.equal(ship.thrusting, false, 'brake takes precedence over thrust');
  assert.ok(ship.vx > 0, 'braking must not reverse the ship');
  assert.ok(ship.vx < 200, `brake should reduce vx, got ${ship.vx}`);
  assert.ok(Math.hypot(ship.vx, ship.vy) < 200, 'brake should reduce total speed');
});

// ---- P1-4: input.clear() resets all pressed keys ----

test('input: clear() resets all pressed keys', () => {
  const fakeWindow = {
    handlers: {},
    addEventListener(ev, fn) { this.handlers[ev] = fn; },
    removeEventListener() {},
  };
  const actions = [];
  const input = createInputManager(fakeWindow, (a) => actions.push(a));

  // Simulate keydown for ArrowUp and Space.
  fakeWindow.handlers.keydown({ code: 'ArrowUp', repeat: false, preventDefault() {} });
  fakeWindow.handlers.keydown({ code: 'Space', repeat: false, preventDefault() {} });

  let state = input.getInput();
  assert.equal(state.thrust, true, 'thrust should be true after keydown');
  assert.equal(state.fire, true, 'fire should be true after keydown');

  // Clear should reset everything.
  input.clear();
  state = input.getInput();
  assert.equal(state.thrust, false, 'thrust should be false after clear');
  assert.equal(state.fire, false, 'fire should be false after clear');
});

test('input: S and ArrowDown both map to brake', () => {
  const fakeWindow = {
    handlers: {},
    addEventListener(ev, fn) { this.handlers[ev] = fn; },
    removeEventListener() {},
  };
  const input = createInputManager(fakeWindow);
  let prevented = 0;
  input.setActive(true);

  fakeWindow.handlers.keydown({
    code: 'KeyS', repeat: false, preventDefault() { prevented++; },
  });
  assert.equal(input.getInput().brake, true, 'S should activate brake');

  fakeWindow.handlers.keydown({
    code: 'ArrowDown', repeat: false, preventDefault() { prevented++; },
  });
  assert.equal(input.getInput().brake, true, 'ArrowDown should activate brake');
  assert.equal(prevented, 2, 'both brake keys suppress browser scrolling in-game');

  fakeWindow.handlers.keyup({ code: 'KeyS' });
  assert.equal(input.getInput().brake, true, 'other held brake key keeps braking');
  fakeWindow.handlers.keyup({ code: 'ArrowDown' });
  assert.equal(input.getInput().brake, false, 'brake releases only after both keys release');
});

test('input: ability presses stay queued until a simulation step consumes them', () => {
  const fakeWindow = {
    handlers: {},
    addEventListener(ev, fn) { this.handlers[ev] = fn; },
    removeEventListener() {},
  };
  const input = createInputManager(fakeWindow);
  const event = { code: 'ShiftLeft', repeat: false, preventDefault() {} };

  fakeWindow.handlers.keydown(event);
  assert.equal(input.getInput().dash, true);
  assert.equal(input.getInput().dash, true, 'render-only frames must not lose the press');

  input.consumePresses();
  assert.equal(input.getInput().dash, false);

  fakeWindow.handlers.keydown({ ...event, repeat: true });
  assert.equal(input.getInput().dash, false, 'keyboard repeat must not queue another dash');

  fakeWindow.handlers.keydown({ ...event, code: 'KeyE' });
  fakeWindow.handlers.keydown({ ...event, code: 'KeyQ' });
  let state = input.getInput();
  assert.equal(state.shieldBurst, true);
  assert.equal(state.hyperspace, true);
  input.clear();
  state = input.getInput();
  assert.equal(state.shieldBurst, false);
  assert.equal(state.hyperspace, false);
});

// ---- P1 regression: toroidal collision must use canonical world period ----

test('collision: ship hits asteroid approaching across a wrap seam (P1 regression)', () => {
  // Reprodução exata do parecer P1.
  // Mundo 800×600. Nave em (110,300), raio 14. Asteroide grande em (847,300), raio 48,
  // vx=80 (para a direita). Toroidalmente o asteroide aproxima-se pela borda
  // direita; após 1/60 s a distância contínua cai para ~61.667, menor que 62.
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  g.state.ship.x = 110;
  g.state.ship.y = 300;
  g.state.ship.vx = 0;
  g.state.ship.vy = 0;
  g.state.ship.invuln = 0;

  const asteroid = createAsteroid('large', 847, 300, cfg, makeRng(2));
  asteroid.vx = 80;
  asteroid.vy = 0;
  g.state.asteroids.push(asteroid);

  // Sanity: before update the canonical distance is 63 and radii sum to 62,
  // so the circles are separated by 1 px (not yet colliding).
  assert.equal(torusDistance(g.state.ship.x, g.state.ship.y, asteroid.x, asteroid.y, W, H), 63);
  assert.equal(g.state.ship.radius + asteroid.radius, 62);

  g.update(1 / 60, {});

  // A collision must have happened: life lost and ship respawned/pending.
  assert.equal(g.state.lives, cfg.game.lives - 1,
    `P1 regression: ship should collide with asteroid approaching across wrap seam (lives=${g.state.lives})`);
});

// ---- P2: hard limits and pause timers ----

test('bullet: hard limit is exactly 6 simultaneous bullets', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300;
  // Fire repeatedly with huge cooldown bypass to fill the world.
  for (let i = 0; i < 20; i++) {
    g.state.bulletCooldown = 0;
    g.update(0, { fire: true });
  }
  assert.equal(g.state.bullets.length, cfg.bullet.max,
    `expected exactly ${cfg.bullet.max} bullets, got ${g.state.bullets.length}`);
});

test('pause: bullet cooldown, bullet life and invulnerability do not advance', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.ship.x = 400; g.state.ship.y = 300;
  // Fire a bullet and start cooldown.
  g.update(1/60, { fire: true });
  assert.equal(g.state.bullets.length, 1);
  const b = g.state.bullets[0];
  const lifeBefore = b.life;
  const cdBefore = g.state.bulletCooldown;
  g.state.ship.invuln = 2.0;
  // Pause and advance time.
  g.pause();
  g.update(1, {});
  assert.equal(b.life, lifeBefore, 'bullet life should not advance while paused');
  assert.equal(g.state.bulletCooldown, cdBefore, 'bullet cooldown should not advance while paused');
  assert.equal(g.state.ship.invuln, 2.0, 'invulnerability should not advance while paused');
});

test('bullet: does not tunnel through moving small asteroid', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];
  const ship = g.state.ship;
  ship.x = 100; ship.y = 300; ship.angle = 0; ship.vx = 0; ship.vy = 0;
  // Asteroid moving perpendicular to bullet, still crossing the bullet path.
  const ast = createAsteroid('small', 200, 300, cfg, makeRng(2));
  ast.vx = -40; ast.vy = 30;
  g.state.asteroids.push(ast);
  g.update(1/60, { fire: true });
  let hit = false;
  for (let i = 0; i < 60; i++) {
    g.update(1/60, {});
    if (g.state.score >= 100) { hit = true; break; }
    if (g.state.asteroids.some(a => a.size === 'large')) break;
  }
  assert.ok(hit, 'bullet should have hit the moving small asteroid (no tunneling)');
});

test('bullet: swept collision catches maximum real relative speed', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];

  const ship = g.state.ship;
  ship.x = 275.8333333333333;
  ship.y = 300;
  ship.angle = 0;
  ship.vx = cfg.ship.maxSpeed;
  ship.vy = 0;

  const asteroid = createAsteroid('small', 300, 284.1, cfg, makeRng(2));
  asteroid.vx = -cfg.asteroid.smallSpeed[1] * cfg.asteroid.maxSpeedMult;
  asteroid.vy = 0;
  g.state.asteroids.push(asteroid);

  g.update(1 / 60, { fire: true });

  assert.equal(cfg.bullet.speed + cfg.ship.maxSpeed, 900);
  assert.equal(-asteroid.vx, 320);
  assert.equal(g.state.score, cfg.asteroid.smallPoints,
    'the swept paths approach to 15.9px for a combined radius of 16px');
  assert.equal(g.state.bullets.length, 0);
  assert.ok(!g.state.asteroids.includes(asteroid));
});

test('bullet: swept collision follows the relative path across a torus seam', () => {
  const cfg = makeTestConfig();
  const g = createGame(cfg, makeRng(1));
  g.start();
  g.state.asteroids = [];

  const ship = g.state.ship;
  ship.x = 780.8333333333334;
  ship.y = 300;
  ship.angle = 0;
  ship.vx = cfg.ship.maxSpeed;
  ship.vy = 0;

  const asteroid = createAsteroid('small', 5, 284.1, cfg, makeRng(2));
  asteroid.vx = -cfg.asteroid.smallSpeed[1] * cfg.asteroid.maxSpeedMult;
  asteroid.vy = 0;
  g.state.asteroids.push(asteroid);

  g.update(1 / 60, { fire: true });
  assert.equal(g.state.score, cfg.asteroid.smallPoints);
  assert.ok(!g.state.asteroids.includes(asteroid));
});

// ---- Helper: test config (smaller world for predictable tests) ----
function makeTestConfig() {
  return {
    world: { width: W, height: H },
    ship: {
      radius: 14,
      rotSpeed: 3.4,
      thrust: 320,
      brake: 900,
      maxSpeed: 380,
      friction: 0.992,
      respawnInvuln: 2.0,
      shield: {
        max: 100,
        regenPerSecond: 18,
        regenDelay: 2.0,
        damageBySource: { ufo: 34, enemyBullet: 34, mine: 34 },
      },
    },
    abilities: {
      dash: {
        speed: 820,
        duration: 0.18,
        invuln: 0.3,
        cooldown: 1.5,
      },
      shieldBurst: {
        maxEnergy: 100,
        cost: 45,
        regenPerSecond: 14,
        radius: 180,
        impulse: 360,
        maxAsteroidSpeed: 520,
        grace: 0.2,
        effectDuration: 0.38,
      },
      hyperspace: {
        cooldown: 6,
        arrivalInvuln: 0.12,
        minDistance: 160,
        maxDestinationAttempts: 16,
        bombFuse: 0.8,
        bombRadius: 125,
        bombEffectDuration: 0.45,
        arrivalEffectDuration: 0.32,
      },
    },
    powerUps: {
      types: ['spread', 'beam', 'homing', 'emp', 'drones'],
      weights: [26, 18, 22, 14, 20],
      nodeLife: 12,
      nodeRadius: 10,
      nodeSpeed: 24,
      guaranteedCarriersPerWave: 1,
      maxCarriersPerWave: 2,
      extraCarrierChance: 0.15,
      pickupEffectDuration: 0.32,
      spread: {
        duration: 9,
        angle: Math.PI / 15,
        count: 3,
        cooldown: 0.24,
        maxProjectiles: 12,
      },
      beam: {
        duration: 8,
        tickCooldown: 0.15,
        range: 520,
        radius: 3,
      },
      homing: {
        duration: 10,
        speed: 360,
        turnRate: 4.5,
        life: 2.2,
        radius: 4,
        cooldown: 0.48,
        maxMissiles: 5,
      },
      emp: { stunDuration: 2.5, effectDuration: 0.7 },
      drones: {
        duration: 10,
        count: 2,
        orbitRadius: 38,
        orbitSpeed: 2.4,
        range: 300,
        fireCooldown: 0.7,
        bulletSpeed: 460,
        bulletLife: 0.9,
        maxProjectiles: 6,
      },
    },
    bullet: {
      speed: 520,
      cooldown: 0.18,
      life: 1.0,
      max: 6,
      poweredMax: 12,
      radius: 2,
    },
    asteroid: {
      largeR: 48, mediumR: 26, smallR: 14,
      largePoints: 20, mediumPoints: 50, smallPoints: 100,
      childrenPerSplit: 2,
      largeSpeed: [40, 80],
      mediumSpeed: [60, 120],
      smallSpeed: [80, 160],
      rotSpeed: [-1.2, 1.2],
      initialCount: 4,
      maxInitial: 10,
      safeSpawnRadius: 160,
      waveSpeedMult: 0.12,
      maxSpeedMult: 2.0,
      collision: {
        enabled: true,
        restitution: 1.12,
        maxSpeed: 560,
        separationPadding: 0.5,
        maxEventsPerStep: 64,
      },
    },
    game: {
      lives: 3,
      maxLives: 6,
      extraLifeEvery: 10000,
      fixedStep: 1 / 60,
      maxFrameDelta: 0.1,
      maxSubSteps: 5,
    },
  };
}
