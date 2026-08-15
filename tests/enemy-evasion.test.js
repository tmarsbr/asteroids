import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { createUfo, updateUfo } from '../src/entities.js';

const W = 800;
const H = 600;
const DT = 0.05;
const EPSILON = 1e-9;

function normalizeAngle(angle) {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  if (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function angleDifference(a, b) {
  return Math.abs(normalizeAngle(a - b));
}

function makeUfo(cfg, kind = 'hunter', options = {}) {
  const ufo = createUfo(kind, 400, 300, cfg, () => 0, 1, options.id ?? 2);
  ufo.angle = options.angle ?? 0;
  ufo.vx = options.vx ?? Math.cos(ufo.angle) * ufo.speed;
  ufo.vy = options.vy ?? Math.sin(ufo.angle) * ufo.speed;
  return ufo;
}

function playerBullet(options = {}) {
  return {
    x: options.x ?? 500,
    y: options.y ?? 300,
    vx: options.vx ?? -300,
    vy: options.vy ?? 0,
    radius: options.radius ?? 2,
    life: options.life ?? 4,
    source: options.source ?? 'player',
    alive: true,
  };
}

function compareWithBaseline({
  kind = 'hunter',
  bullet,
  ship = { x: 600, y: 300 },
  setupUfo = () => {},
  configure = () => {},
}) {
  const dodgeCfg = structuredClone(CONFIG);
  configure(dodgeCfg);
  const baselineCfg = structuredClone(dodgeCfg);
  baselineCfg.ufo[kind].bulletEvasion = {
    ...baselineCfg.ufo[kind].bulletEvasion,
    enabled: false,
  };

  const dodging = makeUfo(dodgeCfg, kind);
  const baseline = makeUfo(baselineCfg, kind);
  setupUfo(dodging);
  setupUfo(baseline);

  updateUfo(dodging, DT, ship, dodgeCfg, W, H, [], [bullet]);
  updateUfo(baseline, DT, ship, baselineCfg, W, H, [], []);
  return { dodging, baseline };
}

test('bullet evasion: a real future collision course changes heading beyond baseline behaviour', () => {
  const { dodging, baseline } = compareWithBaseline({
    bullet: playerBullet({ x: 500, y: 300, vx: -300 }),
  });

  // The ship is directly ahead, so chase behaviour alone keeps the baseline at
  // zero.  Any measured difference is therefore caused by the dodge layer.
  assert.ok(angleDifference(dodging.angle, baseline.angle) > 0.05,
    `incoming collision course should dodge; got ${dodging.angle} vs ${baseline.angle}`);
});

test('bullet evasion: ignores a nearby player bullet that is already moving away', () => {
  const { dodging, baseline } = compareWithBaseline({
    bullet: playerBullet({ x: 500, y: 300, vx: 300 }),
  });

  assert.ok(angleDifference(dodging.angle, baseline.angle) <= EPSILON,
    'negative time-to-closest-approach must not trigger a dodge');
});

test('bullet evasion: ignores a nearby lateral near-miss', () => {
  const { dodging, baseline } = compareWithBaseline({
    // This projectile crosses the UFO x-coordinate, but 40px away from its
    // centre; the 20px combined collision radius leaves a safe miss.
    bullet: playerBullet({ x: 500, y: 340, vx: -300 }),
  });

  assert.ok(angleDifference(dodging.angle, baseline.angle) <= EPSILON,
    'a miss outside the combined radii must not trigger a dodge');
});

test('bullet evasion: uses relative velocity instead of distance and cone alone', () => {
  const catching = compareWithBaseline({
    // The UFO is faster than this forward-moving bullet, so it will catch the
    // projectile despite both travelling in the same direction.
    bullet: playerBullet({ x: 500, y: 300, vx: 150 }),
    setupUfo(ufo) {
      ufo.vx = 200;
      ufo.vy = 0;
    },
  });
  const escaping = compareWithBaseline({
    // Same location and heading, but this one pulls away from the UFO.
    bullet: playerBullet({ x: 500, y: 300, vx: 250 }),
    setupUfo(ufo) {
      ufo.vx = 200;
      ufo.vy = 0;
    },
  });

  assert.ok(angleDifference(catching.dodging.angle, catching.baseline.angle) > 0.05,
    'closing relative velocity should produce a dodge');
  assert.ok(angleDifference(escaping.dodging.angle, escaping.baseline.angle) <= EPSILON,
    'separating relative velocity should not produce a dodge');
});

test('bullet evasion: scouts make a stronger isolated dodge than bombers', () => {
  const configureAsChase = cfg => {
    // Personality steering would otherwise consume the same turn-rate budget
    // and hide the dodge difference.  Chase straight ahead isolates evasion.
    cfg.ufo.scout.behavior = 'chase';
    cfg.ufo.bomber.behavior = 'chase';
  };
  const bullet = playerBullet({ x: 500, y: 300, vx: -300 });
  const scout = compareWithBaseline({ kind: 'scout', bullet, configure: configureAsChase });
  const bomber = compareWithBaseline({ kind: 'bomber', bullet, configure: configureAsChase });
  const scoutDodge = angleDifference(scout.dodging.angle, scout.baseline.angle);
  const bomberDodge = angleDifference(bomber.dodging.angle, bomber.baseline.angle);

  assert.ok(scoutDodge > bomberDodge,
    `scout dodge ${scoutDodge} should exceed bomber dodge ${bomberDodge}`);
});

test('bullet evasion: is composed on top of escort and fleeing behaviours', () => {
  const bullet = playerBullet({ x: 500, y: 300, vx: -300 });
  const escort = compareWithBaseline({
    kind: 'scout',
    bullet,
    setupUfo(ufo) {
      ufo.squadRole = 'escort';
      ufo.squadTarget = { x: 600, y: 300, alive: true };
    },
  });
  const fleeing = compareWithBaseline({
    kind: 'hunter',
    bullet,
    ship: { x: 200, y: 300 },
    setupUfo(ufo) {
      ufo.isLastSurvivor = true;
      ufo.fleeTimer = 5;
    },
  });

  assert.ok(angleDifference(escort.dodging.angle, escort.baseline.angle) > 0.05,
    'escort heading should include the bullet dodge');
  assert.ok(angleDifference(fleeing.dodging.angle, fleeing.baseline.angle) > 0.05,
    'fleeing heading should include the bullet dodge');
});

test('bullet evasion: ignores enemy bullets', () => {
  const { dodging, baseline } = compareWithBaseline({
    bullet: playerBullet({ source: 'enemy' }),
  });

  assert.ok(angleDifference(dodging.angle, baseline.angle) <= EPSILON,
    'enemy projectiles are not a player-bullet dodge threat');
});
