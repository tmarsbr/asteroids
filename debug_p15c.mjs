
import { CONFIG } from './src/config.js';
import { createAsteroid, createUfo, updateUfo } from './src/entities.js';

const cfg = structuredClone(CONFIG);
const W = cfg.world.width;
const H = cfg.world.height;
const DT = cfg.game.fixedStep;

function makeRng(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function makeAsteroid(size, x, y, kind, seed, vx, vy) {
  const a = createAsteroid(size, x, y, cfg, makeRng(seed), 1, kind);
  a.vx = vx; a.vy = vy; a.rotSpeed = 0;
  return a;
}
function makeUfo(kind, x, y, opts = {}) {
  const u = createUfo(kind, x, y, cfg, makeRng(opts.seed ?? 1), opts.speedMult ?? 1);
  u.angle = opts.angle ?? 0;
  return u;
}

const ship = { x: 400, y: 300, radius: cfg.ship.radius };
const ufo = makeUfo('hunter', 200, 300, { angle: 0 });
const rock = makeAsteroid('medium', 740, 300, 'radioactive', 2, -80, 0);
const result = updateUfo(ufo, DT, ship, cfg, W, H, [rock]);
console.log('ufo.angle after 1 step:', ufo.angle);
console.log('asteroidTarget:', result.asteroidTarget === rock);

// Rodar vários steps
ufo.x = 200; ufo.y = 300; ufo.angle = 0;
ufo.avoidanceTarget = null; ufo.avoidanceSide = 0;
let maxAngle = 0;
for (let i = 0; i < 60; i++) {
  updateUfo(ufo, DT, ship, cfg, W, H, [rock]);
  maxAngle = Math.max(maxAngle, Math.abs(ufo.angle));
}
console.log('max angle over 60 steps:', maxAngle);
