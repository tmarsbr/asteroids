
import { CONFIG } from './src/config.js';
import { createGame } from './src/game.js';
import { createAsteroid, createUfo } from './src/entities.js';
import { sweptCircleCollisionTime } from './src/math.js';

const W = CONFIG.world.width;
const H = CONFIG.world.height;
const DT = CONFIG.game.fixedStep;

function makeRng(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function cloneConfig() { const c = structuredClone(CONFIG); c.ufo.hunter.speed = 125; return c; }
function makeAsteroid(cfg, size, x, y, kind = 'normal', seed = 1, vx = 0, vy = 0) {
  const asteroid = createAsteroid(size, x, y, cfg, makeRng(seed), 1, kind);
  asteroid.vx = vx; asteroid.vy = vy; asteroid.rotSpeed = 0;
  return asteroid;
}
function makeUfo(cfg, kind, x, y, opts = {}) {
  const ufo = createUfo(kind, x, y, cfg, makeRng(opts.seed ?? 1), opts.speedMult ?? 1);
  if (opts.angle !== undefined) ufo.angle = opts.angle;
  if (opts.hp !== undefined) ufo.hp = opts.hp;
  return ufo;
}
function setupGame(seed = 1, opts = {}) {
  const cfg = cloneConfig();
  if (cfg.ufo.hunter) cfg.ufo.hunter.hp = 2;
  const game = createGame(cfg, makeRng(seed));
  game.start();
  game.state.ship.invuln = 0;
  game.state.asteroids = [];
  game.state.ufos = [];
  game.state.ship.x = opts.shipX ?? 0;
  game.state.ship.y = opts.shipY ?? 0;
  game.state.ship.vx = 0;
  game.state.ship.vy = 0;
  return { cfg, game };
}

const thawTime = 0.005;
const { cfg, game } = setupGame(211, { shipX: 799, shipY: 300 });
const ufo = makeUfo(cfg, 'hunter', 400, 300, { angle: 0, vx: 0, vy: 0 });
game.state.ufos.push(ufo);
const boundaryX = 400 + ufo.speed * thawTime + (ufo.radius + 26);
const asteroid = makeAsteroid(cfg, 'medium', boundaryX, 300, 'cryo', 211, 100, 0);
asteroid.stun = thawTime;
game.state.asteroids.push(asteroid);

game.update(DT, {});
console.log('OLD speed 125:');
console.log('ufo.knockbackVx', ufo.knockbackVx);
console.log('ufo.vx', ufo.vx);
console.log('asteroid.vx', asteroid.vx);
console.log('ufo.x', ufo.x);
