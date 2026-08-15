import { visualEdgeOffsets } from './math.js';

const reducedMotionQuery = typeof globalThis.matchMedia === 'function'
  ? globalThis.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

// renderer.js — Canvas 2D drawing. No game rules, no state mutation.
// draw(state, ctx, w, h) renders everything. HiDPI handled by main.js.

export function draw(state, ctx, w, h) {
  // Clear
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, w, h);

  // Draw starfield (static, deterministic)
  drawStars(ctx, w, h);

  // Environmental hazards sit behind entities, but still wrap visually.
  for (const cloud of state.iceClouds ?? []) {
    drawWithEdgeCopies(ctx, cloud, w, h, drawIceCloud);
  }
  for (const field of state.radiationFields ?? []) {
    drawWithEdgeCopies(ctx, field, w, h, drawRadiationField);
  }
  for (const anomaly of state.anomalies ?? []) {
    drawWithEdgeCopies(ctx, anomaly, w, h, drawGravityAnomaly);
  }

  // Expanding tactical effects sit behind solid entities.
  for (const effect of state.effects ?? []) {
    if (effect.kind === 'chainReaction') continue;
    if (effect.kind === 'emp') drawEffect(ctx, effect);
    else drawWithEdgeCopies(ctx, effect, w, h, drawEffect);
  }

  // Asteroids
  for (const a of state.asteroids) {
    const baseVisualRadius = finiteNumber(
      a.visualRadius,
      finiteNumber(a.radius, 0)
    );
    const indicatorRadius = finiteNumber(a.radius, 0)
      + (a.dataCarrier ? 16 : (a.stun ?? 0) > 0 ? 10 : 0);
    drawWithEdgeCopies(
      ctx, a, w, h, drawAsteroid,
      Math.max(baseVisualRadius, indicatorRadius)
    );
  }

  // Stationary traps and hostile craft are solid world entities.
  for (const mine of state.mines ?? []) {
    drawWithEdgeCopies(ctx, mine, w, h, drawMine);
  }
  for (const ufo of state.ufos ?? []) {
    drawWithEdgeCopies(ctx, ufo, w, h, drawUfo);
  }

  // Mystery Data Nodes dropped by marked carrier asteroids.
  for (const node of state.dataNodes ?? []) {
    drawWithEdgeCopies(ctx, node, w, h, drawDataNode);
  }

  // Hyperspace charges
  for (const bomb of state.bombs ?? []) {
    drawWithEdgeCopies(ctx, bomb, w, h, drawBomb);
  }

  // Autonomous support drones orbit independently from the primary weapon.
  for (const drone of state.drones ?? []) {
    drawWithEdgeCopies(ctx, drone, w, h, drawDrone);
  }

  // Bullets
  for (const b of state.bullets) {
    drawWithEdgeCopies(ctx, b, w, h, drawBullet);
  }

  for (const b of state.enemyBullets ?? []) {
    const projectileRadius = finiteNumber(b.radius, 3);
    drawWithEdgeCopies(
      ctx, b, w, h, drawEnemyBullet,
      Math.max(finiteNumber(b.visualRadius, 0), projectileRadius + 18)
    );
  }

  if (state.beam?.active) drawBeam(ctx, state.beam, w, h);

  // Ship
  if (!state.respawnPending) drawWithEdgeCopies(ctx, state.ship, w, h, drawShip);

  // Scoring feedback is a final, screen-readable pass so solid entities cannot
  // cover it. Its age belongs to simulation state, therefore pausing freezes it.
  for (const effect of state.effects ?? []) {
    if (effect.kind === 'chainReaction') {
      drawChainReaction(ctx, effect, w, h);
    }
  }
}

/**
 * Draw an entity at its canonical position and, if any part of its visual
 * bounds straddles a world edge, draw overlapping copies on the opposite side.
 */
function drawWithEdgeCopies(ctx, entity, w, h, drawFn, radiusOverride) {
  const x = finiteNumber(entity.x, 0);
  const y = finiteNumber(entity.y, 0);
  const entityRadius = finiteNumber(
    entity.visualRadius,
    finiteNumber(entity.radius, finiteNumber(entity.maxRadius, 0))
  );
  const r = Math.max(0, finiteNumber(radiusOverride, entityRadius));
  for (const { dx, dy } of visualEdgeOffsets(x, y, r, w, h)) {
    ctx.save();
    ctx.translate(dx, dy);
    drawFn(ctx, entity);
    ctx.restore();
  }
}

function drawStars(ctx, w, h) {
  // Simple static starfield — drawn once per frame, no animation needed
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  // Use a fixed seed pattern for stars
  for (let i = 0; i < 80; i++) {
    const x = (i * 73 + 17) % w;
    const y = (i * 41 + 29) % h;
    const size = (i % 3 === 0) ? 1.5 : 0.8;
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

function drawIceCloud(ctx, cloud) {
  const r = Math.max(4, finiteNumber(cloud.radius, 34));
  const lifeTotal = finiteNumber(cloud.lifeTotal, 0);
  const life = finiteNumber(cloud.life, lifeTotal);
  const fade = lifeTotal > 0
    ? Math.min(1, Math.max(0, life) / Math.min(1, lifeTotal))
    : 1;
  const phase = finiteNumber(cloud.angle, lifeTotal > 0 ? lifeTotal - life : 0);
  const shimmer = 0.82 + Math.sin(phase * 2.4) * 0.08;

  ctx.save();
  ctx.translate(finiteNumber(cloud.x, 0), finiteNumber(cloud.y, 0));
  ctx.globalAlpha = fade;
  ctx.fillStyle = `rgba(76, 166, 255, ${0.08 * shimmer})`;
  ctx.strokeStyle = `rgba(134, 218, 255, ${0.34 * shimmer})`;
  ctx.shadowColor = 'rgba(55, 160, 255, 0.42)';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 1.2;

  // Overlapping lobes keep the cloud readable without using a costly gradient.
  const lobes = [
    [0, 0, 0.72],
    [-0.52, -0.08, 0.48],
    [0.48, -0.16, 0.53],
    [-0.25, 0.4, 0.44],
    [0.34, 0.38, 0.42],
  ];
  for (const [ox, oy, scale] of lobes) {
    ctx.beginPath();
    ctx.arc(ox * r, oy * r, r * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = fade * 0.7;
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // A few crystalline glints communicate the slowing/frost effect.
  ctx.globalAlpha = fade * 0.45;
  ctx.strokeStyle = '#d8f7ff';
  ctx.shadowBlur = 4;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const angle = phase * 0.35 + i * Math.PI * 2 / 3;
    const x = Math.cos(angle) * r * 0.38;
    const y = Math.sin(angle) * r * 0.38;
    const size = r * 0.13;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRadiationField(ctx, field) {
  const r = Math.max(4, finiteNumber(field.radius, 90));
  const lifeTotal = finiteNumber(field.lifeTotal, 0);
  const life = finiteNumber(field.life, lifeTotal);
  const fade = lifeTotal > 0
    ? Math.min(1, Math.max(0, life) / Math.min(1, lifeTotal))
    : 1;
  const phase = finiteNumber(field.angle, lifeTotal > 0 ? lifeTotal - life : 0);
  const pulse = 0.82 + Math.sin(phase * 3.2) * 0.12;

  ctx.save();
  ctx.translate(finiteNumber(field.x, 0), finiteNumber(field.y, 0));
  ctx.globalAlpha = fade;

  // Low-opacity green haze disc.
  ctx.fillStyle = `rgba(80, 255, 64, ${0.07 * pulse})`;
  ctx.strokeStyle = `rgba(140, 255, 96, ${0.30 * pulse})`;
  ctx.shadowColor = 'rgba(70, 255, 50, 0.40)';
  ctx.shadowBlur = 14;
  ctx.lineWidth = 1.4;

  const lobes = [
    [0, 0, 0.68],
    [-0.38, -0.22, 0.42],
    [0.42, -0.12, 0.46],
    [-0.18, 0.36, 0.38],
    [0.28, 0.30, 0.40],
  ];
  for (const [ox, oy, scale] of lobes) {
    ctx.beginPath();
    ctx.arc(ox * r, oy * r, r * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pulsing border to communicate the hazard radius.
  ctx.globalAlpha = fade * 0.7;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Radiation trefoil detail.
  ctx.globalAlpha = fade * 0.5;
  ctx.strokeStyle = '#b8ff8e';
  ctx.shadowBlur = 5;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    const angle = phase * 0.4 + i * Math.PI * 2 / 3;
    const cx = Math.cos(angle) * r * 0.34;
    const cy = Math.sin(angle) * r * 0.34;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGravityAnomaly(ctx, anomaly) {
  const r = Math.max(6, finiteNumber(anomaly.radius, 42));
  const coreRadius = Math.max(3, Math.min(r * 0.62,
    finiteNumber(anomaly.coreRadius, r * 0.24)));
  const lifeTotal = finiteNumber(anomaly.lifeTotal, 0);
  const life = finiteNumber(anomaly.life, lifeTotal);
  const fade = lifeTotal > 0
    ? Math.min(1, Math.max(0, life) / Math.min(1, lifeTotal))
    : 1;
  const phase = finiteNumber(
    anomaly.angle,
    lifeTotal > 0 ? (lifeTotal - life) * 0.9 : 0
  );

  ctx.save();
  ctx.translate(finiteNumber(anomaly.x, 0), finiteNumber(anomaly.y, 0));
  ctx.globalAlpha = fade;

  // Nearly black core first, with a compact violet event-horizon rim.
  ctx.fillStyle = '#010107';
  ctx.shadowColor = 'rgba(125, 52, 255, 0.8)';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#9a58ff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Counter-coloured orbital rings make the pull field visible at a glance.
  ctx.rotate(phase);
  ctx.shadowBlur = 8;
  ctx.strokeStyle = 'rgba(174, 86, 255, 0.82)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, -0.25, Math.PI * 1.25);
  ctx.stroke();

  ctx.rotate(-phase * 1.75);
  ctx.strokeStyle = 'rgba(55, 238, 255, 0.78)';
  ctx.shadowColor = 'rgba(55, 238, 255, 0.62)';
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.9, Math.PI * 0.25, Math.PI * 1.82);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = fade * 0.5;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * coreRadius * 1.25, Math.sin(angle) * coreRadius * 1.25);
    ctx.lineTo(Math.cos(angle + 0.28) * r * 0.78, Math.sin(angle + 0.28) * r * 0.78);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShip(ctx, ship) {
  const shieldMax = finiteNumber(ship.shieldMax, 100);
  const shieldPercent = shieldMax > 0
    ? Math.max(0, Math.min(1, finiteNumber(ship.shield, 0) / shieldMax))
    : 0;
  const shieldLow = shieldPercent <= 0.33;

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  // Draw shield bubble behind the hull so it reads as protection.
  if (shieldPercent > 0 && ship.invuln <= 0) {
    ctx.save();
    ctx.globalAlpha = 0.18 + shieldPercent * 0.22;
    ctx.strokeStyle = shieldLow
      ? `rgba(255, 69, 56, ${0.5 + shieldPercent * 0.4})`
      : `rgba(68, 170, 255, ${0.5 + shieldPercent * 0.4})`;
    ctx.lineWidth = 2;
    ctx.shadowColor = shieldLow
      ? 'rgba(255, 69, 56, 0.7)'
      : 'rgba(68, 170, 255, 0.6)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(0, 0, ship.radius * 1.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Invulnerability blink
  if (ship.invuln > 0) {
    const blink = Math.floor(ship.invuln * 10) % 2;
    if (blink) ctx.globalAlpha = 0.3;
  }

  ctx.strokeStyle = '#00dddd';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(0, 221, 221, 0.5)';
  ctx.shadowBlur = 6;

  const r = ship.radius;

  // Ghost silhouettes make the fixed-direction dash readable at a glance.
  if (ship.dashing) {
    ctx.save();
    ctx.strokeStyle = '#ff44dd';
    ctx.shadowColor = 'rgba(255, 68, 221, 0.7)';
    for (let i = 3; i >= 1; i--) {
      ctx.save();
      ctx.translate(-i * r * 0.9, 0);
      ctx.globalAlpha = 0.1 + (3 - i) * 0.09;
      traceShipPath(ctx, r);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, 0);
    ctx.lineTo(-r * 3.7, 0);
    ctx.stroke();
    ctx.restore();
  }

  traceShipPath(ctx, r);
  ctx.stroke();

  // Engine flame
  if (ship.thrusting && !ship.dashing) {
    ctx.strokeStyle = '#ff44dd';
    ctx.shadowColor = 'rgba(255, 68, 221, 0.6)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, 0);
    ctx.lineTo(-r * 1.6 - Math.random() * 4, 0);
    ctx.stroke();
  }

  ctx.restore();
}

function traceShipPath(ctx, r) {
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r * 0.8, r * 0.7);
  ctx.lineTo(-r * 0.5, 0);
  ctx.lineTo(-r * 0.8, -r * 0.7);
  ctx.closePath();
}

function drawEffect(ctx, effect) {
  if (effect.kind === 'squadWarning') {
    const duration = Math.max(0.0001, finiteNumber(effect.duration, 1.5));
    const progress = Math.min(1, Math.max(0, finiteNumber(effect.age, 0) / duration));
    const fadeIn = Math.min(1, progress / 0.15);
    const fadeOut = Math.min(1, (1 - progress) / 0.25);
    const alpha = Math.min(fadeIn, fadeOut) * (0.8 + Math.sin(effect.age * 12) * 0.2);
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ff4d4d';
    ctx.shadowColor = 'rgba(255, 77, 77, 0.9)';
    ctx.shadowBlur = 12;
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚠️ SQUADRON INCOMING ⚠️', effect.x, Math.max(50, effect.y - 120));
    ctx.restore();
    return;
  }

  const duration = Math.max(0.0001, finiteNumber(effect.duration, 1));
  const progress = Math.min(1, Math.max(0, finiteNumber(effect.age, 0) / duration));
  const eased = 1 - Math.pow(1 - progress, 2);
  const radius = Math.max(2, finiteNumber(
    effect.maxRadius,
    finiteNumber(effect.radius, 18)
  ) * eased);
  const isBomb = effect.kind === 'bomb';
  const isTeleport = effect.kind === 'teleport';
  const isEmp = effect.kind === 'emp';
  const isPickup = effect.kind === 'pickup';
  const isMagma = effect.kind === 'magmaExplosion';
  const isCryo = effect.kind === 'cryoBurst';
  const isCrystal = effect.kind === 'crystalHit';
  const isUfoHit = effect.kind === 'ufoHit';
  const isUfoDestroy = effect.kind === 'ufoDestroy';
  const isMine = effect.kind === 'mineExplosion';
  const isRadiation = effect.kind === 'radiationBurst';
  const isShieldHit = effect.kind === 'shieldHit';
  const isExtraLife = effect.kind === 'extraLife';

  let stroke = '#00dddd';
  let shadow = 'rgba(0, 221, 221, 0.8)';
  if (isBomb || isPickup) {
    stroke = '#ff44dd';
    shadow = 'rgba(255, 68, 221, 0.8)';
  } else if (isEmp) {
    stroke = '#fff27a';
    shadow = 'rgba(255, 242, 122, 0.9)';
  } else if (isMagma) {
    stroke = '#ff6a2f';
    shadow = 'rgba(255, 74, 25, 0.9)';
  } else if (isCryo) {
    stroke = '#83dcff';
    shadow = 'rgba(70, 180, 255, 0.9)';
  } else if (isCrystal) {
    stroke = '#67fff4';
    shadow = 'rgba(60, 255, 241, 0.9)';
  } else if (isUfoHit) {
    stroke = '#ff557f';
    shadow = 'rgba(255, 65, 116, 0.9)';
  } else if (isUfoDestroy) {
    stroke = '#c568ff';
    shadow = 'rgba(203, 76, 255, 0.92)';
  } else if (isMine) {
    stroke = '#ff3b2f';
    shadow = 'rgba(255, 48, 32, 0.95)';
  } else if (isRadiation) {
    stroke = '#8eff5e';
    shadow = 'rgba(80, 255, 50, 0.9)';
  } else if (isShieldHit) {
    stroke = '#44aaff';
    shadow = 'rgba(68, 170, 255, 0.95)';
  } else if (isExtraLife) {
    stroke = '#67fff4';
    shadow = 'rgba(103, 255, 244, 0.95)';
  }

  ctx.save();
  ctx.translate(finiteNumber(effect.x, 0), finiteNumber(effect.y, 0));
  const alphaBase = (() => {
    if (isExtraLife) return 0.9;
    if (isShieldHit) return 0.75;
    if (isTeleport || isPickup || isCrystal || isUfoHit) return 0.8;
    return 0.65;
  })();
  ctx.globalAlpha = (1 - progress) * alphaBase;
  ctx.strokeStyle = stroke;
  ctx.shadowColor = shadow;
  ctx.shadowBlur = 10;
  ctx.lineWidth = isTeleport || isPickup || isCrystal || isUfoHit ? 1.5 : 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (isEmp) {
    ctx.globalAlpha *= 0.58;
    ctx.setLineDash([8, 10]);
    for (const scale of [0.78, 0.52]) {
      ctx.beginPath();
      ctx.arc(0, 0, radius * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  } else if (isBomb) {
    ctx.globalAlpha *= 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isPickup) {
    ctx.rotate(progress * Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(radius, 0);
    ctx.lineTo(0, radius);
    ctx.lineTo(-radius, 0);
    ctx.closePath();
    ctx.stroke();
  } else if (isTeleport) {
    ctx.rotate(progress * Math.PI);
    ctx.beginPath();
    ctx.moveTo(-radius, 0);
    ctx.lineTo(radius, 0);
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, radius);
    ctx.stroke();
  } else if (isMagma) {
    ctx.globalAlpha *= 0.78;
    ctx.strokeStyle = '#ffb13b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    drawRadialBurst(ctx, radius * 0.35, radius, 8, progress * 0.8);
  } else if (isCryo) {
    ctx.globalAlpha *= 0.72;
    ctx.strokeStyle = '#d9f8ff';
    ctx.lineWidth = 1.4;
    ctx.rotate(progress * 0.45);
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(cos * radius * 0.18, sin * radius * 0.18);
      ctx.lineTo(cos * radius, sin * radius);
      ctx.stroke();
    }
  } else if (isCrystal) {
    ctx.rotate(progress * Math.PI * 0.8);
    ctx.globalAlpha *= 0.9;
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      const shard = radius * (0.35 + (i % 2) * 0.12);
      ctx.beginPath();
      ctx.moveTo(0, -radius * 0.12);
      ctx.lineTo(shard * 0.2, -shard * 0.62);
      ctx.lineTo(0, -shard);
      ctx.lineTo(-shard * 0.2, -shard * 0.62);
      ctx.closePath();
      ctx.stroke();
    }
  } else if (isUfoHit) {
    ctx.rotate(progress * Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(-radius, -radius * 0.35);
    ctx.lineTo(radius, radius * 0.35);
    ctx.moveTo(-radius, radius * 0.35);
    ctx.lineTo(radius, -radius * 0.35);
    ctx.stroke();
  } else if (isUfoDestroy) {
    ctx.globalAlpha *= 0.78;
    ctx.strokeStyle = '#ff668c';
    ctx.lineWidth = 1.8;
    drawRadialBurst(ctx, radius * 0.28, radius, 10, progress * Math.PI);
    ctx.strokeStyle = '#67fff4';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isShieldHit) {
    ctx.globalAlpha *= 0.85;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (isExtraLife) {
    ctx.globalAlpha *= 0.9;
    ctx.font = `bold ${Math.max(12, Math.round(radius * 0.55))}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = stroke;
    ctx.shadowColor = shadow;
    ctx.shadowBlur = 12;
    ctx.fillText(effect.label || '+1 VIDA', 0, 0);
  } else if (isMine) {
    ctx.globalAlpha *= 0.84;
    ctx.strokeStyle = '#ffb13b';
    ctx.lineWidth = 2;
    drawRadialBurst(ctx, radius * 0.22, radius, 12, progress * 0.7);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.48, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isRadiation) {
    ctx.globalAlpha *= 0.78;
    ctx.strokeStyle = '#b8ff8e';
    ctx.lineWidth = 1.6;
    drawRadialBurst(ctx, radius * 0.25, radius, 6, progress * 0.6);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.52, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawChainReaction(ctx, effect, w, h) {
  const duration = Math.max(0.0001, finiteNumber(effect.duration, 1));
  const progress = Math.min(1, Math.max(0, finiteNumber(effect.age, 0) / duration));
  const fadeIn = Math.min(1, progress / 0.12);
  const fadeOut = Math.min(1, (1 - progress) / 0.28);
  const alpha = Math.min(fadeIn, fadeOut);
  if (alpha <= 0) return;

  const viewportW = Math.max(1, finiteNumber(w, 1));
  const viewportH = Math.max(1, finiteNumber(h, 1));
  const headlineSize = Math.round(Math.max(14, Math.min(22, viewportW * 0.045)));
  const detailSize = Math.max(9, Math.round(headlineSize * 0.58));
  const label = typeof effect.label === 'string' && effect.label.trim()
    ? effect.label.trim().slice(0, 40)
    : 'CHAIN REACTION!';
  const chainCount = Math.max(0, Math.floor(finiteNumber(
    effect.chainCount ?? effect.count ?? effect.destroyedCount,
    0
  )));
  const awardedPoints = Math.max(0, Math.round(finiteNumber(
    effect.awardedPoints ?? effect.bonusPoints ?? effect.bonus ?? effect.points,
    0
  )));
  const details = [
    chainCount > 0 ? `${chainCount} DESTRUÍDOS` : '',
    awardedPoints > 0 ? `+${formatArcadeNumber(awardedPoints)} PTS` : '',
  ].filter(Boolean).join('  ·  ');
  const reducedMotion = effect.reducedMotion ?? reducedMotionQuery?.matches ?? false;
  const eased = 1 - Math.pow(1 - progress, 2);
  const lift = reducedMotion ? 0 : eased * Math.min(24, viewportH * 0.04);
  const scale = reducedMotion ? 1 : 0.92 + Math.min(1, progress / 0.18) * 0.08;

  ctx.save();
  ctx.font = `bold ${headlineSize}px "Courier New", monospace`;
  const headlineWidth = ctx.measureText(label).width;
  ctx.font = `bold ${detailSize}px "Courier New", monospace`;
  const detailWidth = details ? ctx.measureText(details).width : 0;
  const halfWidth = Math.min(
    Math.max(headlineWidth, detailWidth) / 2 + 10,
    Math.max(0, viewportW / 2 - 8)
  );
  const minX = halfWidth + 8;
  const maxX = Math.max(minX, viewportW - halfWidth - 8);
  const minY = Math.min(viewportH / 2, headlineSize + detailSize + 66);
  const maxY = Math.max(minY, viewportH - headlineSize - detailSize - 18);
  const x = Math.min(maxX, Math.max(minX, finiteNumber(effect.x, viewportW / 2)));
  const y = Math.min(maxY, Math.max(minY, finiteNumber(effect.y, viewportH / 2))) - lift;

  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255, 68, 221, 0.9)';
  ctx.shadowBlur = reducedMotion ? 5 : 10;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(5, 5, 8, 0.92)';
  ctx.font = `bold ${headlineSize}px "Courier New", monospace`;
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = '#fff27a';
  ctx.fillText(label, 0, 0);

  if (details) {
    ctx.shadowColor = 'rgba(0, 221, 221, 0.75)';
    ctx.shadowBlur = reducedMotion ? 3 : 6;
    ctx.lineWidth = 3;
    ctx.font = `bold ${detailSize}px "Courier New", monospace`;
    ctx.strokeText(details, 0, headlineSize * 0.9);
    ctx.fillStyle = '#00dddd';
    ctx.fillText(details, 0, headlineSize * 0.9);
  }
  ctx.restore();
}

function formatArcadeNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function drawBomb(ctx, bomb) {
  const charge = 1 - Math.max(0, bomb.fuse) / bomb.fuseTotal;
  const r = bomb.radius + charge * 4;

  ctx.save();
  ctx.translate(bomb.x, bomb.y);
  ctx.rotate(charge * Math.PI * 1.5);
  ctx.strokeStyle = '#ff44dd';
  ctx.shadowColor = 'rgba(255, 68, 221, 0.9)';
  ctx.shadowBlur = 8 + charge * 8;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.55 + charge * 0.45;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawMine(ctx, mine) {
  const r = Math.max(4, finiteNumber(mine.radius, 9));
  const armTime = finiteNumber(mine.armTime, 0);
  const armed = typeof mine.armed === 'boolean' ? mine.armed : armTime <= 0;
  const lifeTotal = finiteNumber(mine.lifeTotal, 0);
  const life = finiteNumber(mine.life, lifeTotal);
  const fade = lifeTotal > 0
    ? Math.min(1, Math.max(0, life) / Math.min(0.8, lifeTotal))
    : 1;
  const pulse = armed ? 0.82 + Math.sin(life * 9) * 0.18 : 0.62;

  ctx.save();
  ctx.translate(finiteNumber(mine.x, 0), finiteNumber(mine.y, 0));
  ctx.rotate(finiteNumber(mine.angle, 0));
  ctx.globalAlpha = fade;
  ctx.strokeStyle = armed ? '#ff4538' : '#d58a50';
  ctx.fillStyle = armed ? 'rgba(112, 12, 14, 0.45)' : 'rgba(82, 54, 36, 0.35)';
  ctx.shadowColor = armed
    ? `rgba(255, 46, 34, ${0.55 + pulse * 0.3})`
    : 'rgba(213, 138, 80, 0.35)';
  ctx.shadowBlur = armed ? 7 + pulse * 5 : 3;
  ctx.lineWidth = 1.6;

  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 8;
    const pointRadius = i % 2 === 0 ? r * 1.45 : r * 0.72;
    const x = Math.cos(angle) * pointRadius;
    const y = Math.sin(angle) * pointRadius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = armed ? '#ff3b2f' : '#6f5544';
  ctx.globalAlpha = fade * (armed ? pulse : 0.62);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  ctx.fill();

  if (armed) {
    ctx.globalAlpha = fade * 0.26;
    ctx.strokeStyle = '#ff7568';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(r * 1.8, Math.min(
      finiteNumber(mine.triggerRadius, r * 2.3),
      r * 3
    )), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Incomplete ring signals the short arming delay.
    const armDuration = Math.max(0.0001,
      finiteNumber(mine.armDuration, Math.max(armTime, 1)));
    const armProgress = Math.min(1, Math.max(0, 1 - armTime / armDuration));
    ctx.globalAlpha = fade * 0.72;
    ctx.strokeStyle = '#ffb25c';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.58, -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * armProgress);
    ctx.stroke();
  }
  ctx.restore();
}

function drawUfo(ctx, ufo) {
  const r = Math.max(7, finiteNumber(ufo.radius, 18));
  const kind = ufo.kind ?? 'hunter';
  const isBase = kind === 'base';
  const isBomber = kind === 'bomber';
  const isScout = kind === 'scout';
  const isFighter = kind === 'fighter';
  const isDart = isScout || isFighter || kind === 'hunter';
  const fireTimer = finiteNumber(ufo.fireTimer, finiteNumber(ufo.cooldown, 1));
  const mineTimer = finiteNumber(ufo.mineTimer, 1);

  ctx.save();
  ctx.translate(finiteNumber(ufo.x, 0), finiteNumber(ufo.y, 0));
  ctx.save();
  ctx.rotate(finiteNumber(ufo.angle, 0));
  ctx.lineJoin = 'round';
  ctx.lineWidth = isBase || isBomber ? 2.1 : 1.7;

  if (isBase) {
    ctx.strokeStyle = '#c56cff';
    ctx.fillStyle = 'rgba(91, 31, 119, 0.34)';
    ctx.shadowColor = 'rgba(197, 108, 255, 0.72)';
    ctx.shadowBlur = 9;

    // Wide command saucer with a cyan glass canopy and lower mine bay.
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(-r * 0.58, -r * 0.3);
    ctx.lineTo(-r * 0.28, -r * 0.68);
    ctx.lineTo(r * 0.28, -r * 0.68);
    ctx.lineTo(r * 0.58, -r * 0.3);
    ctx.lineTo(r, 0);
    ctx.lineTo(r * 0.55, r * 0.34);
    ctx.lineTo(-r * 0.55, r * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#63f6ff';
    ctx.shadowColor = 'rgba(64, 239, 255, 0.74)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-r * 0.26, -r * 0.62);
    ctx.lineTo(-r * 0.12, -r * 0.28);
    ctx.lineTo(r * 0.12, -r * 0.28);
    ctx.lineTo(r * 0.26, -r * 0.62);
    ctx.stroke();
    ctx.globalAlpha = mineTimer <= 0 ? 1 : 0.42;
    ctx.beginPath();
    ctx.moveTo(-r * 0.22, r * 0.34);
    ctx.lineTo(0, r * 0.58);
    ctx.lineTo(r * 0.22, r * 0.34);
    ctx.stroke();
  } else if (isBomber) {
    ctx.strokeStyle = '#c56cff';
    ctx.fillStyle = 'rgba(91, 31, 119, 0.34)';
    ctx.shadowColor = 'rgba(197, 108, 255, 0.72)';
    ctx.shadowBlur = 9;

    // Bomber: broad hex frame with a central bombardment core.
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(r * 0.55, -r * 0.55);
    ctx.lineTo(-r * 0.55, -r * 0.55);
    ctx.lineTo(-r, 0);
    ctx.lineTo(-r * 0.55, r * 0.55);
    ctx.lineTo(r * 0.55, r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#ff9a37';
    ctx.shadowColor = 'rgba(255, 154, 55, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = fireTimer <= 0 ? 1 : 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isScout) {
    ctx.strokeStyle = '#69ff69';
    ctx.fillStyle = 'rgba(18, 116, 49, 0.3)';
    ctx.shadowColor = 'rgba(105, 255, 105, 0.76)';
    ctx.shadowBlur = 8;

    // Scout: small, sleek winged dart.
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.2, r * 0.6);
    ctx.lineTo(-r * 0.65, r * 0.3);
    ctx.lineTo(-r * 0.65, -r * 0.3);
    ctx.lineTo(-r * 0.2, -r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#b8ffb8';
    ctx.shadowColor = 'rgba(184, 255, 184, 0.8)';
    ctx.globalAlpha = fireTimer <= 0 ? 1 : 0.5;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(r * 0.25, 0);
    ctx.lineTo(-r * 0.35, r * 0.2);
    ctx.lineTo(-r * 0.35, -r * 0.2);
    ctx.closePath();
    ctx.stroke();
  } else if (isFighter) {
    ctx.strokeStyle = '#ff4d4d';
    ctx.fillStyle = 'rgba(116, 18, 18, 0.3)';
    ctx.shadowColor = 'rgba(255, 77, 77, 0.76)';
    ctx.shadowBlur = 8;

    // Fighter: aggressive arrow with swept wings.
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.3, r * 0.62);
    ctx.lineTo(-r * 0.55, r * 0.3);
    ctx.lineTo(-r * 0.9, r * 0.4);
    ctx.lineTo(-r * 0.75, 0);
    ctx.lineTo(-r * 0.9, -r * 0.4);
    ctx.lineTo(-r * 0.55, -r * 0.3);
    ctx.lineTo(-r * 0.3, -r * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#ffb04f';
    ctx.shadowColor = 'rgba(255, 154, 55, 0.8)';
    ctx.globalAlpha = fireTimer <= 0 ? 1 : 0.5;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(r * 0.25, 0);
    ctx.lineTo(-r * 0.45, r * 0.22);
    ctx.lineTo(-r * 0.45, -r * 0.22);
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#ff587d';
    ctx.fillStyle = 'rgba(116, 18, 49, 0.3)';
    ctx.shadowColor = 'rgba(255, 64, 112, 0.76)';
    ctx.shadowBlur = 8;

    // Hunter is a forward-pointing dart, unlike the base's broad saucer.
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.3, r * 0.38);
    ctx.lineTo(-r * 0.9, r * 0.72);
    ctx.lineTo(-r * 0.58, 0);
    ctx.lineTo(-r * 0.9, -r * 0.72);
    ctx.lineTo(-r * 0.3, -r * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#ffb04f';
    ctx.shadowColor = 'rgba(255, 154, 55, 0.8)';
    ctx.globalAlpha = fireTimer <= 0 ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(r * 0.22, 0);
    ctx.lineTo(-r * 0.36, r * 0.24);
    ctx.lineTo(-r * 0.36, -r * 0.24);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();

  drawHealthBar(
    ctx,
    r * (isBase || isBomber ? 0.78 : 0.62),
    -r - 7,
    ufo.hp,
    ufo.maxHp,
    isBase || isBomber ? '#c56cff' : isScout ? '#69ff69' : isFighter ? '#ff4d4d' : '#ff587d'
  );

  // Status overlays for cryo slow and radiation exposure.
  const cryoTime = finiteNumber(ufo.cryoSlowTime, 0);
  const radTime = finiteNumber(ufo.radiationTime, 0);
  if (cryoTime > 0) {
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = '#83dcff';
    ctx.shadowColor = 'rgba(70, 180, 255, 0.7)';
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2 / 3) + (isBase || isBomber ? 0.3 : 0);
      const cx = Math.cos(angle) * r * 0.5;
      const cy = Math.sin(angle) * r * 0.5;
      const size = r * 0.12;
      ctx.beginPath();
      ctx.moveTo(cx - size, cy);
      ctx.lineTo(cx + size, cy);
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx, cy + size);
      ctx.stroke();
    }
  }
  if (radTime > 0) {
    const pulse = 0.6 + Math.sin(radTime * 8) * 0.2;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#8eff5e';
    ctx.shadowColor = 'rgba(80, 255, 50, 0.8)';
    ctx.shadowBlur = 7;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = pulse * 0.8;
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      const cx = Math.cos(angle) * r * 0.55;
      const cy = Math.sin(angle) * r * 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.08, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const warpTime = finiteNumber(ufo.warpInTimer, 0);
  if (warpTime > 0) {
    ctx.globalAlpha = 0.5 + Math.sin(warpTime * 20) * 0.3;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = '#63f6ff';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * (1 + warpTime), 0, Math.PI * 2);
    ctx.stroke();
  }

  if (ufo.isLastSurvivor) {
    const fleeTime = finiteNumber(ufo.fleeTimer, 0);
    const pulse = 0.5 + Math.sin(fleeTime * 12) * 0.35;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ff3b3b';
    ctx.shadowColor = 'rgba(255, 59, 59, 0.9)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBullet(ctx, b) {
  const isMissile = b.kind === 'missile';
  const isDrone = b.source === 'drone';
  const isSpread = b.kind === 'spread';
  const color = isMissile
    ? '#ff44dd'
    : isDrone ? '#00dddd' : isSpread ? '#fff27a' : '#ffffff';
  const glow = isMissile
    ? 'rgba(255, 68, 221, 0.8)'
    : isDrone ? 'rgba(0, 221, 221, 0.75)'
      : isSpread ? 'rgba(255, 242, 122, 0.7)' : 'rgba(255, 255, 255, 0.6)';
  const angle = Math.atan2(b.vy, b.vx);
  const trailLen = isMissile ? 14 : isDrone ? 8 : 6;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = isMissile ? 2.5 : isDrone ? 1.5 : 2;
  ctx.shadowColor = glow;
  ctx.shadowBlur = isMissile ? 9 : 4;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - Math.cos(angle) * trailLen, b.y - Math.sin(angle) * trailLen);
  ctx.stroke();

  if (isMissile) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, Math.max(2, b.radius), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEnemyBullet(ctx, b) {
  const vx = finiteNumber(b.vx, 0);
  const vy = finiteNumber(b.vy, 0);
  const angle = Math.hypot(vx, vy) > 0
    ? Math.atan2(vy, vx)
    : finiteNumber(b.angle, 0);
  const r = Math.max(1.5, finiteNumber(b.radius, 3));
  const x = finiteNumber(b.x, 0);
  const y = finiteNumber(b.y, 0);

  ctx.save();
  ctx.strokeStyle = '#ff3b45';
  ctx.fillStyle = '#ff6a58';
  ctx.shadowColor = 'rgba(255, 36, 48, 0.95)';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 2.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - Math.cos(angle) * Math.max(9, r * 3.2),
    y - Math.sin(angle) * Math.max(9, r * 3.2)
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDataNode(ctx, node) {
  const lifeRatio = Math.max(0, Math.min(1, node.life / node.lifeTotal));
  const pulse = 1 + Math.sin(node.angle * 3) * 0.12;
  const r = node.radius * pulse;

  ctx.save();
  ctx.translate(node.x, node.y);
  ctx.rotate(node.angle);
  ctx.globalAlpha = Math.min(1, lifeRatio * 2.5);
  ctx.strokeStyle = '#fff27a';
  ctx.fillStyle = 'rgba(255, 68, 221, 0.12)';
  ctx.shadowColor = 'rgba(255, 242, 122, 0.85)';
  ctx.shadowBlur = 10;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 3;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.rotate(-node.angle);
  ctx.fillStyle = '#fff27a';
  ctx.font = `bold ${Math.max(10, Math.round(node.radius * 0.85))}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 0, 1);
  ctx.restore();
}

function drawDrone(ctx, drone) {
  ctx.save();
  ctx.translate(drone.x, drone.y);
  ctx.rotate(drone.angle);
  ctx.strokeStyle = '#ff44dd';
  ctx.fillStyle = 'rgba(255, 68, 221, 0.14)';
  ctx.shadowColor = 'rgba(255, 68, 221, 0.8)';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, 5);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-5, -5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawBeam(ctx, beam, w, h) {
  const dx = Math.cos(beam.angle) * beam.length;
  const dy = Math.sin(beam.angle) * beam.length;
  const copiesX = Math.ceil(Math.abs(dx) / Math.max(1, w)) + 1;
  const copiesY = Math.ceil(Math.abs(dy) / Math.max(1, h)) + 1;
  const endX = beam.x + dx;
  const endY = beam.y + dy;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let ix = -copiesX; ix <= copiesX; ix++) {
    for (let iy = -copiesY; iy <= copiesY; iy++) {
      const offsetX = ix * w;
      const offsetY = iy * h;
      const startX = beam.x + offsetX;
      const startY = beam.y + offsetY;
      const copyEndX = endX + offsetX;
      const copyEndY = endY + offsetY;

      ctx.strokeStyle = 'rgba(255, 68, 221, 0.32)';
      ctx.shadowColor = 'rgba(255, 68, 221, 0.9)';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(copyEndX, copyEndY);
      ctx.stroke();

      ctx.strokeStyle = '#fff6ff';
      ctx.shadowBlur = 5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(copyEndX, copyEndY);
      ctx.stroke();

      if (
        copyEndX >= -8 && copyEndX <= w + 8
        && copyEndY >= -8 && copyEndY <= h + 8
      ) {
        ctx.strokeStyle = '#fff27a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(copyEndX, copyEndY, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawAsteroid(ctx, a) {
  const stunned = (a.stun ?? 0) > 0;
  const asteroidRadius = Math.max(3, finiteNumber(a.radius, 12));
  const kind = ['magma', 'cryo', 'crystal', 'radioactive'].includes(a.kind)
    ? a.kind
    : 'normal';
  const palette = {
    normal: {
      stroke: '#789b9b',
      fill: 'rgba(72, 91, 94, 0.2)',
      shadow: 'rgba(88, 150, 150, 0.28)',
      detail: '#a7bbbb',
    },
    magma: {
      stroke: '#ff5a36',
      fill: 'rgba(112, 27, 15, 0.34)',
      shadow: 'rgba(255, 70, 28, 0.55)',
      detail: '#ffb13b',
    },
    cryo: {
      stroke: '#65bfff',
      fill: 'rgba(31, 87, 145, 0.27)',
      shadow: 'rgba(62, 166, 255, 0.48)',
      detail: '#d7f5ff',
    },
    crystal: {
      stroke: '#5ffff1',
      fill: 'rgba(25, 190, 190, 0.2)',
      shadow: 'rgba(57, 255, 241, 0.62)',
      detail: '#c9ffff',
    },
    radioactive: {
      stroke: '#8eff5e',
      fill: 'rgba(20, 80, 18, 0.3)',
      shadow: 'rgba(80, 255, 50, 0.55)',
      detail: '#b8ff8e',
    },
  }[kind];

  ctx.save();
  ctx.translate(finiteNumber(a.x, 0), finiteNumber(a.y, 0));
  ctx.rotate(finiteNumber(a.angle, 0));
  ctx.strokeStyle = palette.stroke;
  ctx.fillStyle = palette.fill;
  ctx.lineWidth = kind === 'crystal' ? 2 : 1.6;
  ctx.shadowColor = palette.shadow;
  ctx.shadowBlur = kind === 'normal' ? 3 : 6;

  traceAsteroidPath(ctx, a);
  ctx.fill();
  ctx.stroke();

  // Subtle inner glow
  ctx.globalAlpha = kind === 'normal' ? 0.13 : 0.2;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = palette.detail;
  ctx.shadowBlur = kind === 'normal' ? 0 : 4;
  ctx.lineWidth = 1.1;
  drawAsteroidDetails(ctx, a, kind);

  drawHealthArc(ctx, asteroidRadius, a.hp, a.maxHp, palette.stroke);

  if (a.dataCarrier) {
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = '#ff44dd';
    ctx.shadowColor = 'rgba(255, 68, 221, 0.8)';
    ctx.shadowBlur = 7;
    ctx.lineWidth = 2;
    const markerRadius = asteroidRadius + 7;
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      ctx.beginPath();
      ctx.arc(0, 0, markerRadius, angle - 0.12, angle + 0.12);
      ctx.stroke();
    }
    const core = Math.max(4, asteroidRadius * 0.13);
    ctx.beginPath();
    ctx.moveTo(0, -core);
    ctx.lineTo(core, 0);
    ctx.lineTo(0, core);
    ctx.lineTo(-core, 0);
    ctx.closePath();
    ctx.stroke();
  }

  if (stunned) {
    // Keep the original yellow freeze cue on top of the kind-specific shell.
    ctx.globalAlpha = 0.88;
    ctx.strokeStyle = '#fff27a';
    ctx.shadowColor = 'rgba(255, 242, 122, 0.55)';
    ctx.shadowBlur = 7;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    traceAsteroidPath(ctx, a);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = '#fff27a';
    ctx.lineWidth = 1.5;
    const spark = Math.max(5, asteroidRadius * 0.2);
    ctx.beginPath();
    ctx.moveTo(-spark, -spark);
    ctx.lineTo(spark, spark);
    ctx.moveTo(spark, -spark);
    ctx.lineTo(-spark, spark);
    ctx.stroke();
  }

  ctx.restore();
}

function traceAsteroidPath(ctx, asteroid) {
  const points = Array.isArray(asteroid.points) ? asteroid.points : [];
  ctx.beginPath();
  if (points.length > 0) {
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
  } else {
    const r = Math.max(3, finiteNumber(asteroid.radius, 12));
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const pointRadius = r * (i % 2 === 0 ? 1 : 0.84);
      const x = Math.cos(angle) * pointRadius;
      const y = Math.sin(angle) * pointRadius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

function drawAsteroidDetails(ctx, asteroid, kind) {
  const r = Math.max(3, finiteNumber(asteroid.radius, 12));
  const points = Array.isArray(asteroid.points) ? asteroid.points : [];

  if (kind === 'magma') {
    // Branching hot seams distinguish magma even when its outline is stunned.
    for (let i = 0; i < 3; i++) {
      const angle = -0.7 + i * Math.PI * 2 / 3;
      const innerX = Math.cos(angle + 0.35) * r * 0.12;
      const innerY = Math.sin(angle + 0.35) * r * 0.12;
      const middleX = Math.cos(angle - 0.18) * r * 0.48;
      const middleY = Math.sin(angle - 0.18) * r * 0.48;
      ctx.beginPath();
      ctx.moveTo(innerX, innerY);
      ctx.lineTo(middleX, middleY);
      ctx.lineTo(Math.cos(angle) * r * 0.82, Math.sin(angle) * r * 0.82);
      ctx.stroke();
    }
    return;
  }

  if (kind === 'cryo') {
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * r * 0.58, Math.sin(angle) * r * 0.58);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  if (kind === 'crystal') {
    // Radiating facets give crystals a hard, angular interior.
    const facetPoints = points.length > 0 ? points : [
      { x: r, y: 0 }, { x: 0, y: r },
      { x: -r, y: 0 }, { x: 0, y: -r },
    ];
    for (let i = 0; i < facetPoints.length; i += 2) {
      const point = facetPoints[i];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.42);
    ctx.lineTo(r * 0.34, 0);
    ctx.lineTo(0, r * 0.42);
    ctx.lineTo(-r * 0.34, 0);
    ctx.closePath();
    ctx.stroke();
    return;
  }

  if (kind === 'radioactive') {
    // Three radiation lobes/risks distinguish the radioactive shell.
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      const innerX = Math.cos(angle) * r * 0.1;
      const innerY = Math.sin(angle) * r * 0.1;
      const outerX = Math.cos(angle) * r * 0.72;
      const outerY = Math.sin(angle) * r * 0.72;
      ctx.beginPath();
      ctx.moveTo(innerX, innerY);
      ctx.lineTo(outerX, outerY);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  // Normal rocks stay understated: two offset crater arcs in muted grey-teal.
  ctx.globalAlpha *= 0.55;
  ctx.beginPath();
  ctx.arc(-r * 0.22, -r * 0.12, r * 0.17, 0, Math.PI * 1.75);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r * 0.28, r * 0.2, r * 0.11, 0, Math.PI * 1.6);
  ctx.stroke();
}

function drawRadialBurst(ctx, innerRadius, outerRadius, count, phase = 0) {
  const rays = Math.max(1, Math.floor(count));
  for (let i = 0; i < rays; i++) {
    const angle = phase + i * Math.PI * 2 / rays;
    ctx.beginPath();
    ctx.moveTo(
      Math.cos(angle) * innerRadius,
      Math.sin(angle) * innerRadius
    );
    ctx.lineTo(
      Math.cos(angle) * outerRadius,
      Math.sin(angle) * outerRadius
    );
    ctx.stroke();
  }
}

function drawHealthArc(ctx, radius, hpValue, maxHpValue, color) {
  const maxHp = finiteNumber(maxHpValue, 1);
  if (maxHp <= 1) return;
  const hp = Math.min(maxHp, Math.max(0, finiteNumber(hpValue, maxHp)));
  const ratio = hp / maxHp;
  const arcRadius = Math.max(4, finiteNumber(radius, 10) + 3);

  ctx.save();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = '#071012';
  ctx.beginPath();
  ctx.arc(0, 0, arcRadius, -Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  if (ratio > 0) {
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, arcRadius, -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHealthBar(ctx, halfWidth, y, hpValue, maxHpValue, color) {
  const maxHp = finiteNumber(maxHpValue, 1);
  if (maxHp <= 1) return;
  const hp = Math.min(maxHp, Math.max(0, finiteNumber(hpValue, maxHp)));
  const ratio = hp / maxHp;
  const width = Math.max(10, halfWidth * 2);
  const height = 2.5;

  ctx.save();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#07080d';
  ctx.fillRect(-width / 2, y, width, height);
  if (ratio > 0) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.fillRect(-width / 2, y, width * ratio, height);
  }
  ctx.restore();
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
