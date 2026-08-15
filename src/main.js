// main.js — bootstrap, fixed-step loop, DPR, resize, HUD, overlays.

import { CONFIG } from './config.js';
import { createGame } from './game.js';
import {
  HIGH_SCORE_STORAGE_KEY,
  loadHighScore,
  normalizeHighScore,
  saveHighScore,
} from './high-score.js';
import { createInputManager } from './input.js';
import { draw } from './renderer.js';

// ---- DOM refs ----
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elHighScore = document.getElementById('high-score');
const elScoreMultiplier = document.getElementById('score-multiplier');
const elAccuracyCombo = document.getElementById('accuracy-combo');
const elWave = document.getElementById('wave');
const elLives = document.getElementById('lives');
const elShieldMeter = document.getElementById('shield-meter');
const elShieldFill = document.getElementById('shield-fill');
const elShieldValue = document.getElementById('shield-value');
const elShipShieldMeter = document.getElementById('ship-shield-meter');
const elShipShieldFill = document.getElementById('ship-shield-fill');
const elShipShieldValue = document.getElementById('ship-shield-value');
const abilityHud = document.getElementById('ability-hud');
const abilityDash = document.getElementById('ability-dash');
const abilityShield = document.getElementById('ability-shield');
const abilityHyperspace = document.getElementById('ability-hyperspace');
const elDashStatus = document.getElementById('dash-status');
const elShieldStatus = document.getElementById('shield-status');
const elHyperspaceStatus = document.getElementById('hyperspace-status');
const powerUpHud = document.getElementById('powerup-hud');
const powerWeapon = document.getElementById('power-weapon');
const powerDrones = document.getElementById('power-drones');
const powerEmp = document.getElementById('power-emp');
const elWeaponName = document.getElementById('weapon-name');
const elWeaponTime = document.getElementById('weapon-time');
const elWeaponMeter = document.getElementById('weapon-meter');
const elWeaponFill = document.getElementById('weapon-fill');
const elDronesTime = document.getElementById('drones-time');
const elDronesMeter = document.getElementById('drones-meter');
const elDronesFill = document.getElementById('drones-fill');
const elEmpStatus = document.getElementById('emp-status');
const elPowerUpAnnouncer = document.getElementById('powerup-announcer');
const elScoringAnnouncer = document.getElementById('scoring-announcer');
const elFinalScore = document.getElementById('final-score');
const elNewHighScore = document.getElementById('new-high-score');
const overlayStart = document.getElementById('overlay-start');
const overlayPause = document.getElementById('overlay-pause');
const overlayGameOver = document.getElementById('overlay-gameover');
const btnStart = document.getElementById('btn-start');
const btnResume = document.getElementById('btn-resume');
const btnRestart = document.getElementById('btn-restart');
const btnPause = document.getElementById('btn-pause');

// ---- World dimensions (CSS pixels) ----
let worldW = window.innerWidth;
let worldH = window.innerHeight;

// ---- Game instance ----
const cfg = structuredClone(CONFIG);
cfg.world.width = worldW;
cfg.world.height = worldH;

const storedHighScore = loadHighScore();
const game = createGame(cfg, Math.random, { highScore: storedHighScore });
window.__game = game; // debug hook

// ---- Input ----
const input = createInputManager(window, handleAction);
let announcedPowerState = { weapon: null, drones: false, emp: false };
let announcedChainReactions = 0;
let announcedExtraLives = game.state.extraLivesAwarded ?? 0;
let displayedMultiplier = game.state.scoring.multiplier;
let lastPersistedHighScore = storedHighScore;

function resetScoringAnnouncements() {
  announcedChainReactions = 0;
  announcedExtraLives = game.state.extraLivesAwarded ?? 0;
  elScoringAnnouncer.textContent = '';
}

function handleAction(action) {
  switch (action) {
    case 'start':
      if (game.state.status === 'ready' || game.state.status === 'gameOver') {
        input.clear();
        game.start();
        resetScoringAnnouncements();
      }
      break;
    case 'pause':
      if (game.state.status === 'playing' || game.state.status === 'paused') {
        input.consumePresses();
        game.togglePause();
      }
      break;
    case 'restart':
      if (game.state.status === 'gameOver') doRestart();
      break;
    case 'blur':
      if (game.state.status === 'playing') game.pause();
      break;
  }
}

function doRestart() {
  input.clear();
  game.restart();
  resetScoringAnnouncements();
}

// ---- Overlays ----
function updateOverlays() {
  const status = game.state.status;
  overlayStart.hidden = status !== 'ready';
  overlayPause.hidden = status !== 'paused';
  overlayGameOver.hidden = status !== 'gameOver';
  btnPause.hidden = status !== 'playing';
  abilityHud.hidden = status === 'ready' || status === 'gameOver';
  powerUpHud.hidden = status === 'ready' || status === 'gameOver';
}

// ---- HUD ----
function updateHUD() {
  const s = game.state;
  elScore.textContent = String(s.score).padStart(6, '0');
  elHighScore.textContent = String(s.highScore).padStart(6, '0');
  const multiplier = s.scoring?.multiplier ?? 1;
  const combo = s.scoring?.combo ?? 0;
  elScoreMultiplier.textContent = `×${multiplier.toFixed(1)}`;
  elScoreMultiplier.setAttribute(
    'aria-label', `Multiplicador de pontos ${multiplier.toFixed(1)}`
  );
  elScoreMultiplier.classList.toggle('is-active', multiplier > 1);
  elScoreMultiplier.classList.toggle(
    'is-max', multiplier >= (cfg.scoring?.multiplier.max ?? 5)
  );
  elAccuracyCombo.textContent = `COMBO ${combo}`;
  elAccuracyCombo.classList.toggle('is-active', combo > 0);
  if (multiplier !== displayedMultiplier) {
    elScoreMultiplier.classList.remove('is-pulse');
    // Reflow is intentional and happens only on a multiplier transition, so
    // consecutive precision hits can retrigger the short CSS pulse.
    void elScoreMultiplier.offsetWidth;
    elScoreMultiplier.classList.add('is-pulse');
    displayedMultiplier = multiplier;
  }

  if (s.highScore > lastPersistedHighScore) {
    const persistedHighScore = saveHighScore(s.highScore);
    lastPersistedHighScore = game.setHighScore(persistedHighScore);
  }
  const newRecord = Boolean(s.scoring?.newHighScore);
  elHighScore.classList.toggle('is-new-record', newRecord);
  elNewHighScore.hidden = !(newRecord && s.status === 'gameOver');

  const chainReactions = s.scoring?.chainReactions ?? 0;
  if (chainReactions < announcedChainReactions) {
    announcedChainReactions = chainReactions;
  }
  if (chainReactions > announcedChainReactions) {
    const chain = [...s.effects]
      .reverse()
      .find(effect => effect.kind === 'chainReaction');
    const count = chain?.chainCount ?? 0;
    const bonus = chain?.awardedPoints ?? 0;
    elScoringAnnouncer.textContent = [
      'Reação em cadeia!',
      count > 0 ? `${count} asteroides destruídos.` : '',
      bonus > 0 ? `${bonus} pontos de bônus.` : '',
    ].filter(Boolean).join(' ');
    announcedChainReactions = chainReactions;
  }
  elWave.textContent = s.wave;
  elLives.textContent = s.lives > 0 ? 'I'.repeat(s.lives) : '—';

  const shieldCfg = cfg.abilities.shieldBurst;
  const shieldPercent = Math.round(
    (s.abilities.shieldEnergy / shieldCfg.maxEnergy) * 100
  );
  elShieldFill.style.width = `${shieldPercent}%`;
  elShieldFill.classList.toggle('is-low', s.abilities.shieldEnergy < shieldCfg.cost);
  elShieldValue.textContent = `${shieldPercent}%`;
  elShieldMeter.setAttribute('aria-valuenow', String(shieldPercent));

  const shipShieldMax = s.ship.shieldMax || cfg.ship.shield?.max || 100;
  const shipShieldPercent = Math.max(
    0, Math.min(100, Math.round((s.ship.shield / shipShieldMax) * 100))
  );
  elShipShieldFill.style.width = `${shipShieldPercent}%`;
  elShipShieldFill.classList.toggle('is-low', shipShieldPercent <= 33);
  elShipShieldValue.textContent = `${shipShieldPercent}%`;
  elShipShieldMeter.setAttribute('aria-valuenow', String(shipShieldPercent));

  const unavailable = s.respawnPending || s.status !== 'playing';
  const dashActive = s.ship.dashing;
  const dashReady = !unavailable && s.abilities.dashCooldown <= 0;
  setAbilityState(
    abilityDash,
    elDashStatus,
    dashReady,
    dashActive,
    dashActive ? 'ATIVO' : dashReady ? 'PRONTO' : formatCooldown(s.abilities.dashCooldown)
  );

  const shieldActive = s.effects.some(effect => effect.kind === 'shield');
  const shieldReady = !unavailable && s.abilities.shieldEnergy >= shieldCfg.cost;
  setAbilityState(
    abilityShield,
    elShieldStatus,
    shieldReady,
    shieldActive,
    shieldActive ? 'PULSO ATIVO' : shieldReady ? 'PRONTO' : `CARGA ${shieldPercent}%`
  );

  const bombArmed = s.bombs.length > 0;
  const hyperspaceReady = !unavailable && s.abilities.hyperspaceCooldown <= 0;
  setAbilityState(
    abilityHyperspace,
    elHyperspaceStatus,
    hyperspaceReady,
    bombArmed,
    bombArmed
      ? 'CARGA ARMADA'
      : hyperspaceReady
        ? 'PRONTO'
        : formatCooldown(s.abilities.hyperspaceCooldown)
  );

  const weaponNames = {
    spread: 'LEQUE TRIPLO',
    beam: 'RAIO',
    homing: 'MÍSSEIS',
  };
  const weaponActive = Boolean(s.powerUps.weapon && s.powerUps.weaponTime > 0);
  powerWeapon.classList.toggle('is-active', weaponActive);
  powerWeapon.classList.toggle('is-expiring', weaponActive && s.powerUps.weaponTime <= 3);
  elWeaponName.textContent = weaponActive
    ? weaponNames[s.powerUps.weapon]
    : 'PADRÃO';
  elWeaponTime.textContent = weaponActive
    ? formatCooldown(s.powerUps.weaponTime)
    : 'SEM BÔNUS';
  const weaponDuration = weaponActive ? cfg.powerUps[s.powerUps.weapon].duration : 0;
  updatePowerMeter(
    elWeaponMeter, elWeaponFill, s.powerUps.weaponTime, weaponDuration
  );

  const dronesActive = s.powerUps.dronesTime > 0;
  powerDrones.classList.toggle('is-active', dronesActive);
  powerDrones.classList.toggle('is-expiring', dronesActive && s.powerUps.dronesTime <= 3);
  elDronesTime.textContent = dronesActive
    ? `${s.drones.length} ATIVOS · ${formatCooldown(s.powerUps.dronesTime)}`
    : 'INATIVOS';
  updatePowerMeter(
    elDronesMeter, elDronesFill,
    s.powerUps.dronesTime, cfg.powerUps.drones.duration
  );

  const empTriggered = s.effects.some(effect => effect.kind === 'emp');
  powerEmp.classList.toggle('is-ready', s.powerUps.empStored);
  powerEmp.classList.toggle('is-triggered', empTriggered);
  elEmpStatus.textContent = s.powerUps.empStored
    ? 'ARMADO · USE F'
    : empTriggered ? 'DETONADO' : 'VAZIO';
  announcePowerTransitions(s, weaponNames, dronesActive, empTriggered);

  if (s.status === 'gameOver') {
    elFinalScore.textContent = String(s.score).padStart(6, '0');
  }
}

function formatCooldown(seconds) {
  return `${Math.max(0, seconds).toFixed(1)} s`;
}

function updatePowerMeter(meter, fill, seconds, duration) {
  const safeDuration = Math.max(0, duration);
  const remaining = Math.max(0, Math.min(seconds, safeDuration));
  const percent = safeDuration > 0 ? (remaining / safeDuration) * 100 : 0;
  fill.style.width = `${percent}%`;
  meter.setAttribute('aria-valuemax', String(safeDuration));
  meter.setAttribute('aria-valuenow', remaining.toFixed(1));
  meter.setAttribute('aria-valuetext', `${remaining.toFixed(1)} segundos restantes`);
}

function announcePowerTransitions(state, weaponNames, dronesActive, empTriggered) {
  let message = '';
  if (state.powerUps.weapon !== announcedPowerState.weapon) {
    message = state.powerUps.weapon
      ? `Armamento temporário adquirido: ${weaponNames[state.powerUps.weapon]}.`
      : announcedPowerState.weapon ? 'Armamento temporário expirou.' : '';
  } else if (dronesActive !== announcedPowerState.drones) {
    message = dronesActive ? 'Drones de suporte ativados.' : 'Drones de suporte expiraram.';
  } else if (state.powerUps.empStored !== announcedPowerState.emp) {
    message = state.powerUps.empStored
      ? 'Carga EMP adquirida. Pressione F para usar.'
      : empTriggered ? 'EMP detonado.' : '';
  }
  // Effects are aged before the HUD runs, so track the durable award counter
  // instead of relying on an effect whose age is exactly zero.
  const extraLivesAwarded = state.extraLivesAwarded ?? 0;
  if (extraLivesAwarded < announcedExtraLives) {
    announcedExtraLives = extraLivesAwarded;
  }
  if (extraLivesAwarded > announcedExtraLives) {
    const gained = extraLivesAwarded - announcedExtraLives;
    message = gained === 1
      ? 'Vida extra! +1 VIDA'
      : `${gained} vidas extras! +${gained} VIDAS`;
    announcedExtraLives = extraLivesAwarded;
  }
  if (message) elPowerUpAnnouncer.textContent = message;
  announcedPowerState = {
    weapon: state.powerUps.weapon,
    drones: dronesActive,
    emp: state.powerUps.empStored,
  };
}

function setAbilityState(card, status, ready, active, text) {
  card.classList.toggle('is-ready', ready && !active);
  card.classList.toggle('is-active', active);
  status.textContent = text;
}

// ---- Canvas sizing with DPR ----
function resize() {
  worldW = window.innerWidth;
  worldH = window.innerHeight;
  cfg.world.width = worldW;
  cfg.world.height = worldH;
  game.resize(worldW, worldH);

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(worldW * dpr);
  canvas.height = Math.floor(worldH * dpr);
  canvas.style.width = worldW + 'px';
  canvas.style.height = worldH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

let invincibleMode = false;

function toggleInvincibleMode() {
  invincibleMode = !invincibleMode;
  game.state.ship.invuln = invincibleMode ? Infinity : 0;
  // Keep shield topped up while invincible so the HUD looks good.
  game.state.ship.shield = invincibleMode ? (cfg.ship.shield?.max ?? 100) : (cfg.ship.shield?.max ?? 100);
  // eslint-disable-next-line no-console
  console.log('Invincible mode:', invincibleMode ? 'ON' : 'OFF');
}

window.addEventListener('keydown', event => {
  if (event.key === 'i' || event.key === 'I') toggleInvincibleMode();
}, { capture: true });

window.addEventListener('resize', resize);
window.addEventListener('storage', event => {
  if (event.key !== HIGH_SCORE_STORAGE_KEY) return;
  const remoteHighScore = normalizeHighScore(event.newValue);
  const localHighScore = game.state.highScore;
  if (remoteHighScore < localHighScore) {
    // localStorage has no atomic max operation. If a slower tab wins a
    // read/modify/write race with a lower value, the tab that knows the higher
    // record repairs storage. The resulting higher event converges other tabs
    // without a write loop.
    const reconciledHighScore = saveHighScore(localHighScore);
    game.setHighScore(reconciledHighScore);
    lastPersistedHighScore = Math.max(
      lastPersistedHighScore, reconciledHighScore
    );
    return;
  }
  game.setHighScore(remoteHighScore);
  lastPersistedHighScore = Math.max(
    lastPersistedHighScore, remoteHighScore
  );
});
resize();

// ---- Button listeners ----
btnStart.addEventListener('click', () => handleAction('start'));
btnResume.addEventListener('click', () => handleAction('pause'));
btnRestart.addEventListener('click', () => doRestart());
btnPause.addEventListener('click', () => handleAction('pause'));

// ---- Main loop: fixed timestep with accumulator ----
let lastTime = performance.now();
let accumulator = 0;

function loop(now) {
  let frameTime = (now - lastTime) / 1000;
  lastTime = now;

  if (frameTime > cfg.game.maxFrameDelta) frameTime = cfg.game.maxFrameDelta;

  const inputState = input.getInput();
  const status = game.state.status;

  if (status === 'playing') {
    accumulator += frameTime;
    let steps = 0;
    while (accumulator >= cfg.game.fixedStep && steps < cfg.game.maxSubSteps) {
      game.update(cfg.game.fixedStep, inputState);

      // Edge presses apply to exactly one fixed step even when a slow frame
      // requires several substeps. If there is no step, they stay queued.
      if (steps === 0) {
        input.consumePresses();
        inputState.dash = false;
        inputState.shieldBurst = false;
        inputState.hyperspace = false;
        inputState.emp = false;
        inputState.nuke = false;
      }

      accumulator -= cfg.game.fixedStep;
      steps++;
    }
    if (steps >= cfg.game.maxSubSteps) accumulator = 0;
  } else {
    input.consumePresses();
    if (status === 'ready' || status === 'gameOver') accumulator = 0;
  }

  draw(game.state, ctx, worldW, worldH);
  updateOverlays();
  updateHUD();
  input.setActive(game.state.status === 'playing');
  requestAnimationFrame(loop);
}

updateOverlays();
updateHUD();
requestAnimationFrame(loop);
