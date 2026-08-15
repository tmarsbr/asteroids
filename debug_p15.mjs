
import { CONFIG } from './src/config.js';
import { createAsteroid, createUfo } from './src/entities.js';

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

const ufo = makeUfo('hunter', 200, 300, { angle: 0 });
const rock = makeAsteroid('medium', 540, 300, 'normal', 1, -80, 0);

const speed = ufo.speed;
const lookAhead = cfg.ufo.hunter.avoidance.lookAhead;
const horizon = lookAhead / speed + 0.55;
console.log('ufo.speed', speed);
console.log('lookAhead', lookAhead);
console.log('horizon', horizon);
console.log('ufo distance covered in horizon', speed * horizon);
console.log('rock distance covered in horizon', 80 * horizon);
console.log('total closing in horizon', (speed+80)*horizon);
console.log('sumR', ufo.radius + rock.radius);
console.log('remaining at 540:', 540 - 200 - (speed+80)*horizon - (ufo.radius + rock.radius));

import { sweptCircleCollisionTime } from './src/math.js';
const t = sweptCircleCollisionTime(
  ufo.x, ufo.y, ufo.radius + 12 + 0, speed, 0,
  rock.x, rock.y, rock.radius, rock.vx, rock.vy,
  W, H, horizon,
);
console.log('collision time normal', t);
