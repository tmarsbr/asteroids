
import { CONFIG } from './src/config.js';
import { createAsteroid, createUfo } from './src/entities.js';
import { sweptCircleCollisionTime } from './src/math.js';

const cfg = structuredClone(CONFIG);
const W = cfg.world.width;
const H = cfg.world.height;

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

const ufo = makeUfo('hunter', 200, 300, { angle: 0 });
const speed = ufo.speed;
const horizon = 220 / speed + 0.55;
const baseSM = 12;

for (const x of [540, 700, 740, 750, 760]) {
  const normal = makeAsteroid('medium', x, 300, 'normal', 1, -80, 0);
  const radio = makeAsteroid('medium', x, 300, 'radioactive', 2, -80, 0);
  const hazardR = Math.max(radio.radius, cfg.asteroid.types.radioactive.fieldRadius * 0.55);
  const tNormal = sweptCircleCollisionTime(
    ufo.x, ufo.y, ufo.radius + baseSM, speed, 0,
    normal.x, normal.y, normal.radius, normal.vx, normal.vy,
    W, H, horizon,
  );
  const tRadio = sweptCircleCollisionTime(
    ufo.x, ufo.y, ufo.radius + baseSM + 8, speed, 0,
    radio.x, radio.y, radio.radius + Math.max(0, hazardR - radio.radius), radio.vx, radio.vy,
    W, H, horizon,
  );
  console.log(`x=${x}: normal=${tNormal}, radio=${tRadio}, hazardR=${hazardR.toFixed(1)}`);
}
