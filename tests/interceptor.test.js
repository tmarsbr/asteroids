import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUfo, updateUfo } from '../src/entities.js';
import { CONFIG } from '../src/config.js';

function deepCopyCfg() {
  return JSON.parse(JSON.stringify(CONFIG));
}
test('interceptor aims at predicted player position', () => {
  const cfg = deepCopyCfg();
  cfg.ufo.interceptor = {
    radius: 16,
    speed: 100,
    turnRate: 4,
    hp: 4,
    points: 500,
    fireCooldown: 0.8,
    behavior: 'intercept',
    predictionLead: 0.6,
    avoidance: { enabled: false },
    bulletEvasion: { enabled: false },
  };

  // UFO starts pointing right (rng = 0 gives angle = 0).
  const ufo = createUfo('interceptor', 500, 500, cfg, () => 0, 1, 1);
  const ship = { x: 600, y: 500, vx: 0, vy: 100, radius: 14 };

  for (let i = 0; i < 60; i++) {
    updateUfo(ufo, 1 / 60, ship, cfg, 1000, 1000, [], [], []);
  }

  // Predicted position is (600, 560); angle from (500,500) is atan2(60,100) ≈ 0.537 rad.
  const predictedX = wrap(ship.x + ship.vx * cfg.ufo.interceptor.predictionLead, 1000);
  const predictedY = wrap(ship.y + ship.vy * cfg.ufo.interceptor.predictionLead, 1000);
  const expectedAngle = Math.atan2(predictedY - ufo.y, predictedX - ufo.x);
  const diff = Math.abs(normalizeAngle(expectedAngle - ufo.angle));
  assert.ok(diff < 0.15, `angle ${ufo.angle} far from ${expectedAngle}`);
});

test('interceptor ignores player velocity when predictionLead is zero', () => {
  const cfg = deepCopyCfg();
  cfg.ufo.interceptor = {
    radius: 16,
    speed: 100,
    turnRate: 4,
    hp: 4,
    points: 500,
    fireCooldown: 0.8,
    behavior: 'intercept',
    predictionLead: 0,
    avoidance: { enabled: false },
    bulletEvasion: { enabled: false },
  };

  const ufo = createUfo('interceptor', 500, 500, cfg, () => 0, 1, 1);
  const ship = { x: 600, y: 500, vx: 0, vy: 100, radius: 14 };

  for (let i = 0; i < 60; i++) {
    updateUfo(ufo, 1 / 60, ship, cfg, 1000, 1000, [], [], []);
  }

  const expectedAngle = Math.atan2(ship.y - ufo.y, ship.x - ufo.x);
  const diff = Math.abs(normalizeAngle(expectedAngle - ufo.angle));
  assert.ok(diff < 0.15, `angle ${ufo.angle} far from ${expectedAngle}`);
});

function normalizeAngle(angle) {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  if (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function wrap(value, max) {
  if (max <= 0) return 0;
  let v = value % max;
  if (v < 0) v += max;
  return v;
}
