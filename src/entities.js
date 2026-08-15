// entities.js — factory functions for game entities + their update logic.
// No DOM access. All physics in seconds (velocity in px/sec, etc.).
// RNG is injectable for deterministic tests.

import {
  wrap, torusDelta, torusDistance, sweptCircleCollisionTime,
} from './math.js';

/**
 * Create the player ship at center of world.
 */
export function createShip(cfg, w, h) {
  return {
    x: w / 2,
    y: h / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2, // pointing up
    radius: cfg.ship.radius,
    visualRadius: cfg.ship.radius + 58, // cover engine flame, dash trail + shadow
    invuln: 0,           // seconds of invulnerability remaining
    thrusting: false,
    dashing: false,
    dashTime: 0,
    dashVx: 0,
    dashVy: 0,
    cryoSlowTime: 0,
    shield: cfg.ship.shield?.max ?? 100,
    shieldMax: cfg.ship.shield?.max ?? 100,
    shieldRegenDelay: 0,
  };
}

export function resetShipShield(ship, cfg) {
  ship.shield = cfg.ship.shield?.max ?? 100;
  ship.shieldMax = cfg.ship.shield?.max ?? 100;
  ship.shieldRegenDelay = 0;
}

/**
 * Update ship physics: rotation, thrust, brake, friction, velocity cap, wrap.
 * `input` = { thrust, brake, rotLeft, rotRight }
 */
export function updateShip(ship, dt, input, cfg, w, h) {
  let remaining = Math.max(0, dt);

  // A dash has a fixed direction captured on activation. Splitting the update
  // at the dash boundary keeps large test deltaTimes physically consistent.
  if (ship.dashTime > 0 && remaining > 0) {
    const dashDt = Math.min(remaining, ship.dashTime);
    ship.dashing = true;
    ship.thrusting = false;
    ship.vx = ship.dashVx;
    ship.vy = ship.dashVy;
    ship.x += ship.vx * dashDt;
    ship.y += ship.vy * dashDt;
    ship.dashTime = Math.max(0, ship.dashTime - dashDt);
    remaining -= dashDt;

    if (ship.dashTime === 0) {
      ship.dashing = false;
      capVelocity(ship, cfg.ship.maxSpeed);
    }
  } else if (ship.dashTime <= 0) {
    ship.dashing = false;
    ship.thrusting = !!input.thrust && !input.brake;
  }

  if (remaining > 0) {
    // Rotation is locked during the short impulse, then resumes normally.
    // The game owns the cryo timer countdown; physics only consumes its state.
    const cryoRotationMultiplier = ship.cryoSlowTime > 0
      ? (cfg.asteroid?.types?.cryo?.rotationMultiplier ?? 1)
      : 1;
    if (input.rotLeft) {
      ship.angle -= cfg.ship.rotSpeed * cryoRotationMultiplier * remaining;
    }
    if (input.rotRight) {
      ship.angle += cfg.ship.rotSpeed * cryoRotationMultiplier * remaining;
    }

    // Braking has priority over thrust so a held brake never adds forward
    // acceleration. It decelerates without reversing the ship.
    const braking = !!input.brake;
    ship.thrusting = !!input.thrust && !braking;
    if (ship.thrusting) {
      ship.vx += Math.cos(ship.angle) * cfg.ship.thrust * remaining;
      ship.vy += Math.sin(ship.angle) * cfg.ship.thrust * remaining;
    }

    // cfg.ship.friction is the per-fixed-step velocity retention.
    const stepsPerDt = remaining / cfg.game.fixedStep;
    const fr = Math.pow(cfg.ship.friction, stepsPerDt);
    ship.vx *= fr;
    ship.vy *= fr;

    if (braking) {
      const speed = Math.hypot(ship.vx, ship.vy);
      const brakeRate = Number.isFinite(cfg.ship.brake)
        ? Math.max(0, cfg.ship.brake)
        : Math.max(0, cfg.ship.thrust * 3);
      const brakedSpeed = Math.max(0, speed - brakeRate * remaining);
      if (speed > 0) {
        const ratio = brakedSpeed / speed;
        ship.vx *= ratio;
        ship.vy *= ratio;
      }
    }

    capVelocity(ship, cfg.ship.maxSpeed);

    ship.x += ship.vx * remaining;
    ship.y += ship.vy * remaining;
  }

  // Wrap into canonical [0, w/h). Visual edge copies are handled by renderer.
  ship.x = wrap(ship.x, w);
  ship.y = wrap(ship.y, h);

  // Invulnerability countdown
  if (ship.invuln > 0) ship.invuln = Math.max(0, ship.invuln - dt);
}

function capVelocity(entity, maxSpeed) {
  const speed = Math.hypot(entity.vx, entity.vy);
  if (speed > maxSpeed) {
    const ratio = maxSpeed / speed;
    entity.vx *= ratio;
    entity.vy *= ratio;
  }
}

/**
 * Create a bullet at the ship's nose, inheriting ship velocity.
 */
export function createBullet(ship, cfg, options = {}) {
  const angle = options.angle ?? ship.angle;
  const speed = options.speed ?? cfg.bullet.speed;
  const originRadius = options.originRadius ?? ship.radius;
  const inheritVelocity = options.inheritVelocity !== false;
  const noseX = ship.x + Math.cos(angle) * originRadius;
  const noseY = ship.y + Math.sin(angle) * originRadius;
  const inheritedVx = inheritVelocity ? ship.vx : 0;
  const inheritedVy = inheritVelocity ? ship.vy : 0;
  const bvx = Math.cos(angle) * speed + inheritedVx;
  const bvy = Math.sin(angle) * speed + inheritedVy;
  const radius = options.radius ?? cfg.bullet.radius;
  return {
    x: noseX,
    y: noseY,
    vx: bvx,
    vy: bvy,
    speed,
    life: options.life ?? cfg.bullet.life,
    radius,
    visualRadius: radius + (options.kind === 'missile' ? 16 : 10),
    kind: options.kind ?? 'bullet',
    source: options.source ?? 'player',
    // Manual projectiles that belong to the same trigger pull share this id.
    // It is intentionally null for drones and externally-created projectiles.
    accuracyShotId: options.accuracyShotId ?? null,
    turnRate: options.turnRate ?? 0,
    alive: true,
  };
}

/**
 * Update a bullet: move, wrap, decay life.
 */
export function steerHomingBullet(b, dt, asteroids, w, h) {
  if (b.kind === 'missile' && asteroids.length > 0) {
    let target = null;
    let bestDistanceSq = Infinity;
    let targetDx = 0;
    let targetDy = 0;

    for (const asteroid of asteroids) {
      if (!asteroid.alive) continue;
      const dx = torusDelta(b.x, asteroid.x, w);
      const dy = torusDelta(b.y, asteroid.y, h);
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        target = asteroid;
        targetDx = dx;
        targetDy = dy;
      }
    }

    if (target) {
      const currentAngle = Math.atan2(b.vy, b.vx);
      const desiredAngle = Math.atan2(targetDy, targetDx);
      const delta = normalizeAngle(desiredAngle - currentAngle);
      const turn = Math.max(-b.turnRate * dt, Math.min(b.turnRate * dt, delta));
      const nextAngle = currentAngle + turn;
      b.vx = Math.cos(nextAngle) * b.speed;
      b.vy = Math.sin(nextAngle) * b.speed;
    }
  }
}

export function updateBullet(b, dt, w, h) {
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.x = wrap(b.x, w);
  b.y = wrap(b.y, h);
  b.life -= dt;
  if (b.life <= 0) b.alive = false;
}

function normalizeAngle(angle) {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  if (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

export function createDataNode(asteroid, cfg) {
  // Data-node drift is derived from the carrier itself so loot never perturbs
  // the injected RNG stream used by asteroid physics.
  const direction = (asteroid.angle ?? 0) + Math.PI / 4;
  return {
    x: asteroid.x,
    y: asteroid.y,
    vx: Math.cos(direction) * cfg.powerUps.nodeSpeed,
    vy: Math.sin(direction) * cfg.powerUps.nodeSpeed,
    radius: cfg.powerUps.nodeRadius,
    visualRadius: cfg.powerUps.nodeRadius + 12,
    life: cfg.powerUps.nodeLife,
    lifeTotal: cfg.powerUps.nodeLife,
    angle: 0,
    rotSpeed: 2.2,
    alive: true,
  };
}

export function updateDataNode(node, dt, w, h) {
  node.x = wrap(node.x + node.vx * dt, w);
  node.y = wrap(node.y + node.vy * dt, h);
  node.angle += node.rotSpeed * dt;
  node.life -= dt;
  if (node.life <= 0) node.alive = false;
}

/**
 * Create an asteroid of given size at (x,y). If x/y are null, random position.
 * Shape is deterministic per entity via the injected rng.
 */
export function createAsteroid(size, x, y, cfg, rng, speedMult = 1, kind = 'normal') {
  const radiusMap = { large: cfg.asteroid.largeR, medium: cfg.asteroid.mediumR, small: cfg.asteroid.smallR };
  const speedMap = { large: cfg.asteroid.largeSpeed, medium: cfg.asteroid.mediumSpeed, small: cfg.asteroid.smallSpeed };

  const radius = radiusMap[size];
  const [smin, smax] = speedMap[size];
  const speed = (smin + (smax - smin) * rng()) * speedMult;
  const dir = rng() * Math.PI * 2;

  // Deterministic irregular silhouette
  const sides = 7 + Math.floor(rng() * 4); // 7-10
  const points = [];
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    const r = radius * (0.78 + rng() * 0.34);
    points.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r });
  }

  const [rmin, rmax] = cfg.asteroid.rotSpeed;
  const rotSpeed = rmin + (rmax - rmin) * rng();
  const hp = cfg.asteroid.types?.[kind]?.hp?.[size] ?? 1;

  return {
    x: x ?? 0,
    y: y ?? 0,
    vx: Math.cos(dir) * speed,
    vy: Math.sin(dir) * speed,
    radius,
    visualRadius: radius * 1.25 + 6, // cover irregular tips + shadow
    size,
    kind,
    hp,
    maxHp: hp,
    angle: rng() * Math.PI * 2,
    rotSpeed,
    points,
    stun: 0,
    dataCarrier: false,
    alive: true,
  };
}

/**
 * Create the stationary slowing cloud left behind by a cryo asteroid.
 */
export function createIceCloud(asteroid, cfg) {
  const cryo = cfg.asteroid.types.cryo;
  return {
    kind: 'iceCloud',
    x: asteroid.x,
    y: asteroid.y,
    vx: 0,
    vy: 0,
    radius: cryo.cloudRadius,
    visualRadius: cryo.cloudRadius + 16,
    life: cryo.cloudLife,
    lifeTotal: cryo.cloudLife,
    slowDuration: cryo.slowDuration,
    angle: asteroid.angle ?? 0,
    alive: true,
  };
}

export function updateIceCloud(cloud, dt) {
  cloud.angle += dt * 0.35;
  cloud.life -= dt;
  if (cloud.life <= 0) cloud.alive = false;
}

/**
 * Create a stationary gravity anomaly. Applying its force is a game rule;
 * this entity owns only presentation/lifetime state.
 */
export function createGravityAnomaly(x, y, cfg) {
  const gravity = cfg.hazards.gravity;
  return {
    kind: 'gravity',
    x,
    y,
    vx: 0,
    vy: 0,
    radius: gravity.radius,
    coreRadius: gravity.coreRadius,
    visualRadius: gravity.radius + 20,
    strength: gravity.strength,
    maxAcceleration: gravity.maxAcceleration,
    life: gravity.duration,
    lifeTotal: gravity.duration,
    angle: 0,
    rotSpeed: 0.65,
    alive: true,
  };
}

export function updateGravityAnomaly(anomaly, dt) {
  anomaly.angle += anomaly.rotSpeed * dt;
  anomaly.life -= dt;
  if (anomaly.life <= 0) anomaly.alive = false;
}

/**
 * Create the stationary radiation field left behind by a radioactive asteroid.
 * The field does not move, collide as a solid, block shots or receive damage.
 */
export function createRadiationField(asteroid, cfg) {
  const radioactive = cfg.asteroid.types.radioactive;
  const fieldRadius = finiteNonNegative(radioactive?.fieldRadius, 0);
  const fieldLife = finiteNonNegative(radioactive?.fieldLife, 0);
  const exposureDuration = finiteNonNegative(radioactive?.exposureDuration, 0);
  return {
    kind: 'radiationField',
    x: asteroid.x,
    y: asteroid.y,
    vx: 0,
    vy: 0,
    radius: fieldRadius,
    visualRadius: fieldRadius + 16,
    life: fieldLife,
    lifeTotal: fieldLife,
    exposureDuration,
    angle: asteroid.angle ?? 0,
    alive: true,
  };
}

export function updateRadiationField(field, dt) {
  field.angle += dt * 0.5;
  field.life -= dt;
  if (field.life <= 0) field.alive = false;
}

/**
 * Resolve the cryo slow fraction for this step. Returns drive/action multipliers
 * and the remaining slow time, so the caller does not need to recalculate them.
 */
function resolveUfoCryoStep(ufo, dt, cfg) {
  const cryo = cfg.asteroid?.types?.cryo;
  const rawDrive = cryo?.ufoDriveMultiplier;
  const rawAction = cryo?.ufoActionRateMultiplier;
  const resolvedDriveMultiplier = finiteUnitMultiplier(rawDrive);
  const resolvedActionMultiplier = finiteUnitMultiplier(rawAction);

  const timeAtStart = finiteNonNegative(ufo.cryoSlowTime, 0);
  const duration = finiteNonNegative(dt, 0);
  const slowFraction = duration > 0
    ? Math.min(timeAtStart, duration) / duration
    : (timeAtStart > 0 ? 1 : 0);

  const driveMultiplier = 1 - slowFraction * (1 - resolvedDriveMultiplier);
  const actionRateMultiplier = 1 - slowFraction * (1 - resolvedActionMultiplier);

  return {
    driveMultiplier,
    actionRateMultiplier,
    remainingTime: Math.max(0, timeAtStart - duration),
  };
}

function finiteNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function finiteUnitMultiplier(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/**
 * Resolve the per-craft identifier used for deterministic strafe/orbit sides.
 *
 * The game passes a monotonically increasing id owned by its own state.  The
 * fallback deliberately does not use a module counter or RNG: direct factory
 * callers therefore remain reproducible and two games with the same seed do
 * not influence one another just by being created in the same process.
 */
function resolveUfoId(kind, x, y, id) {
  if (Number.isSafeInteger(id)) return id;

  const kindCode = {
    hunter: 11,
    base: 23,
    scout: 37,
    fighter: 47,
    bomber: 59,
  }[kind] ?? 71;
  const xCode = Number.isFinite(x) ? Math.round(x * 32) : 0;
  const yCode = Number.isFinite(y) ? Math.round(y * 32) : 0;

  let hash = 2166136261;
  hash = Math.imul(hash ^ kindCode, 16777619);
  hash = Math.imul(hash ^ xCode, 16777619);
  hash = Math.imul(hash ^ yCode, 16777619);
  return hash >>> 0;
}

function strafeDirection(ufo) {
  const id = Number.isFinite(ufo.id)
    ? Math.trunc(ufo.id)
    : resolveUfoId(ufo.kind, ufo.x, ufo.y);
  return Math.abs(id) % 2 === 0 ? 1 : -1;
}

/**
 * Return the shortest future collision time against an asteroid, including a
 * small safety margin. `sweptCircleCollisionTime` is seam-aware, so a rock
 * crossing a toroidal edge cannot slip through the UFO's perception.
 */
function asteroidCollisionTime(
  ufo, asteroid, ufoVx, ufoVy, safetyMargin, horizon, w, h,
) {
  return sweptCircleCollisionTime(
    ufo.x, ufo.y, ufo.radius + safetyMargin, ufoVx, ufoVy,
    asteroid.x, asteroid.y, asteroid.radius, asteroid.vx, asteroid.vy,
    w, h, horizon,
  );
}

/**
 * Score the clearance obtained by instantly choosing one tangent direction.
 * This is only used to select a stable side; normal turn-rate limits still
 * control the actual craft movement.
 */
function escapeSideClearance(ufo, asteroid, side, driveSpeed, w, h, horizon) {
  const dx = torusDelta(ufo.x, asteroid.x, w);
  const dy = torusDelta(ufo.y, asteroid.y, h);
  const toAsteroid = Math.atan2(dy, dx);
  const heading = toAsteroid + side * Math.PI / 2;
  const ufoVx = Math.cos(heading) * driveSpeed + (ufo.knockbackVx ?? 0);
  const ufoVy = Math.sin(heading) * driveSpeed + (ufo.knockbackVy ?? 0);
  const relVx = (asteroid.vx ?? 0) - ufoVx;
  const relVy = (asteroid.vy ?? 0) - ufoVy;
  const relSpeedSq = relVx * relVx + relVy * relVy;
  if (relSpeedSq <= 1e-9) return Math.hypot(dx, dy);

  const closestTime = Math.max(
    0,
    Math.min(horizon, -(dx * relVx + dy * relVy) / relSpeedSq),
  );
  return Math.hypot(dx + relVx * closestTime, dy + relVy * closestTime);
}

function chooseEscapeSide(ufo, asteroid, driveSpeed, w, h, horizon) {
  const positiveClearance = escapeSideClearance(
    ufo, asteroid, 1, driveSpeed, w, h, horizon,
  );
  const negativeClearance = escapeSideClearance(
    ufo, asteroid, -1, driveSpeed, w, h, horizon,
  );
  if (Math.abs(positiveClearance - negativeClearance) <= 1e-6) {
    return strafeDirection(ufo);
  }
  return positiveClearance > negativeClearance ? 1 : -1;
}

function clearAvoidanceState(ufo) {
  ufo.avoidanceTarget = null;
  ufo.avoidanceSide = 0;
  ufo.avoidanceCommitTime = 0;
}

/**
 * High-threat asteroid kinds are dangerous even at a distance. Radioactive
 * fields, cryo clouds and magma blasts can kill a UFO that merely passes nearby,
 * so the avoidance system expands their effective radius and prioritises them
 * when several rocks are predicted at similar times.
 */
function getAsteroidThreatWeight(kind) {
  switch (kind) {
    case 'radioactive': return 4;
    case 'magma': return 3;
    case 'cryo': return 2;
    case 'crystal': return 1;
    case 'normal':
    default: return 0;
  }
}

function getAsteroidHazardRadius(asteroid, cfg) {
  const baseR = finiteNonNegative(asteroid?.radius, 0);
  if (!cfg?.asteroid?.types) return baseR;
  switch (asteroid.kind) {
    case 'radioactive':
      return Math.max(
        baseR,
        finiteNonNegative(cfg.asteroid.types.radioactive?.fieldRadius, 90),
      );
    case 'cryo':
      return Math.max(
        baseR,
        finiteNonNegative(cfg.asteroid.types.cryo?.cloudRadius, 96),
      );
    case 'magma':
      // A magma blast is instantaneous and lethal, so detection must use its
      // full gameplay radius rather than a discounted visual proxy.
      return Math.max(
        baseR,
        finiteNonNegative(cfg.asteroid.types.magma?.explosionRadius, 115),
      );
    default:
      return baseR;
  }
}

function weightedAsteroidCollisionTime(
  ufo, asteroid, ufoVx, ufoVy, safetyMargin, horizon, w, h, cfg,
) {
  const hazardR = getAsteroidHazardRadius(asteroid, cfg);
  // The swept test uses ufo.radius + safetyMargin against asteroid.radius. We
  // want to react as if the asteroid were as large as its hazard radius, so we
  // add the extra amount to the asteroid radius.
  const extra = Math.max(0, hazardR - asteroid.radius);
  return sweptCircleCollisionTime(
    ufo.x, ufo.y, ufo.radius + safetyMargin, ufoVx, ufoVy,
    asteroid.x, asteroid.y, asteroid.radius + extra, asteroid.vx, asteroid.vy,
    w, h, horizon,
  );
}

/**
 * Predict asteroid impacts instead of reacting only to rocks in the current
 * frontal cone. A selected escape side is committed for a short time, which
 * prevents the left/right ping-pong that made UFOs steer into a rock.
 */
function computeAsteroidAvoidance(
  ufo, asteroids, cfg, w, h, dt, driveSpeed, predictionAngle = ufo.angle,
) {
  const balance = cfg.ufo[ufo.kind] ?? cfg.ufo.hunter;
  const avoidance = balance.avoidance;
  if (!avoidance?.enabled || !asteroids || asteroids.length === 0) {
    clearAvoidanceState(ufo);
    return { active: false, asteroid: null, timeToCollision: null };
  }

  const lookAhead = finiteNonNegative(avoidance.lookAhead, 0);
  const maxDeflection = finiteNonNegative(avoidance.maxDeflectionAngle, 0);
  if (lookAhead <= 0 || maxDeflection <= 0 || driveSpeed <= 0) {
    clearAvoidanceState(ufo);
    return { active: false, asteroid: null, timeToCollision: null };
  }

  const horizon = finiteNonNegative(
    avoidance.predictionHorizon,
    lookAhead / Math.max(1, driveSpeed) + 0.55,
  );
  const baseSafetyMargin = finiteNonNegative(
    avoidance.safetyMargin,
    Math.max(12, ufo.radius * 0.7),
  );
  const commitDuration = finiteNonNegative(avoidance.commitDuration, 0.55);
  const switchTolerance = finiteNonNegative(avoidance.targetSwitchTolerance, 0.12);
  const threatTieTolerance = finiteNonNegative(avoidance.threatTieTolerance, 0.15);
  if (horizon <= 0) {
    clearAvoidanceState(ufo);
    return { active: false, asteroid: null, timeToCollision: null };
  }

  // Look along the route the UFO is about to take. Using only its previous
  // heading makes a rock in the new pursuit direction invisible until the
  // craft has already turned into it.
  const plannedAngle = Number.isFinite(predictionAngle)
    ? predictionAngle
    : (ufo.angle ?? 0);
  const ufoVx = Math.cos(plannedAngle) * driveSpeed + (ufo.knockbackVx ?? 0);
  const ufoVy = Math.sin(plannedAngle) * driveSpeed + (ufo.knockbackVy ?? 0);
  const threats = [];
  for (let index = 0; index < asteroids.length; index++) {
    const asteroid = asteroids[index];
    if (!asteroid?.alive) continue;
    const threatWeight = getAsteroidThreatWeight(asteroid.kind);
    // High-threat rocks get a small extra safety buffer so the UFO starts
    // steering clear before it is inside the actual effect radius.
    const safetyMargin = baseSafetyMargin + (threatWeight > 0 ? 8 : 0);
    const timeToCollision = weightedAsteroidCollisionTime(
      ufo, asteroid, ufoVx, ufoVy, safetyMargin, horizon, w, h, cfg,
    );
    if (timeToCollision === null) continue;
    threats.push({ asteroid, timeToCollision, threatWeight, index });
  }
  // First define the simultaneous-impact window from the truly earliest hit.
  // A pairwise tolerance comparator is non-transitive, which made the target
  // depend on the array order when three asteroids formed a tolerance chain.
  // Within that one window, danger wins; exact ties remain deterministic.
  let selected = null;
  if (threats.length > 0) {
    const earliestTime = Math.min(...threats.map(threat => threat.timeToCollision));
    const simultaneousThreats = threats.filter(threat =>
      threat.timeToCollision <= earliestTime + threatTieTolerance + 1e-9
    );
    simultaneousThreats.sort((a, b) =>
      b.threatWeight - a.threatWeight
      || a.timeToCollision - b.timeToCollision
      || a.index - b.index
    );
    [selected] = simultaneousThreats;
  }
  const committedTarget = ufo.avoidanceTarget;
  const committedThreat = threats.find(threat => threat.asteroid === committedTarget);
  const committedLosesThreatTie = committedThreat
    && selected
    && selected.threatWeight > committedThreat.threatWeight
    && Math.abs(selected.timeToCollision - committedThreat.timeToCollision)
      <= threatTieTolerance + 1e-9;
  if (
    committedThreat
    && !committedLosesThreatTie
    && (!selected || committedThreat.timeToCollision <= selected.timeToCollision + switchTolerance)
  ) {
    selected = committedThreat;
  } else if (
    !selected
    && committedTarget?.alive
    && asteroids.includes(committedTarget)
    && (ufo.avoidanceCommitTime ?? 0) > 0
  ) {
    selected = { asteroid: committedTarget, timeToCollision: null, threatWeight: 0 };
  }

  if (!selected) {
    clearAvoidanceState(ufo);
    return { active: false, asteroid: null, timeToCollision: null };
  }

  if (ufo.avoidanceTarget !== selected.asteroid || ![-1, 1].includes(ufo.avoidanceSide)) {
    ufo.avoidanceTarget = selected.asteroid;
    ufo.avoidanceSide = chooseEscapeSide(
      ufo, selected.asteroid, driveSpeed, w, h, horizon,
    );
  }

  if (selected.timeToCollision === null) {
    ufo.avoidanceCommitTime = Math.max(0, (ufo.avoidanceCommitTime ?? 0) - dt);
  } else {
    ufo.avoidanceCommitTime = commitDuration;
  }

  const dx = torusDelta(ufo.x, selected.asteroid.x, w);
  const dy = torusDelta(ufo.y, selected.asteroid.y, h);
  const tangentAngle = Math.atan2(dy, dx) + ufo.avoidanceSide * Math.PI / 2;
  return {
    active: true,
    asteroid: selected.asteroid,
    timeToCollision: selected.timeToCollision,
    tangentAngle: normalizeAngle(tangentAngle),
    maxDeflectionAngle: maxDeflection,
  };
}

/**
 * When no immediate collision is predicted, still target high-threat asteroids
 * (radioactive / magma / cryo) that sit within weapon range.  This lets UFOs
 * proactively destroy environmental hazards before they drift into the craft,
 * instead of only reacting once a crash course is unavoidable.
 */
function computeHighThreatShootTarget(ufo, asteroids, cfg, w, h) {
  const balance = cfg.ufo[ufo.kind] ?? cfg.ufo.hunter;
  const reactionRange = finiteNonNegative(
    balance.highThreatShootRange,
    balance.avoidance?.lookAhead ?? 180,
  );
  const shootCone = finiteNonNegative(balance.highThreatShootCone, Math.PI / 2);
  if (reactionRange <= 0 || !asteroids?.length) return null;

  const ufoAngle = ufo.angle ?? 0;
  let best = null;
  let bestScore = -Infinity;

  for (const asteroid of asteroids) {
    if (!asteroid?.alive) continue;
    const weight = getAsteroidThreatWeight(asteroid.kind);
    if (weight <= 0) continue;
    const dx = torusDelta(ufo.x, asteroid.x, w);
    const dy = torusDelta(ufo.y, asteroid.y, h);
    const dist = Math.hypot(dx, dy);
    if (dist > reactionRange + getAsteroidHazardRadius(asteroid, cfg)) continue;

    const angleToAsteroid = Math.atan2(dy, dx);
    const angleDiff = Math.abs(normalizeAngle(angleToAsteroid - ufoAngle));
    if (angleDiff > shootCone / 2) continue;
    // A detection-range match is not necessarily a viable shot: a fast
    // asteroid can outrun the projectile before its lifetime expires.
    if (enemyBulletImpactTime(ufo, asteroid, cfg, w, h) === null) continue;

    // Prefer dangerous kinds, then frontal shots, then closer targets.
    // Distance penalty is mild so a nearby medium radioactive still wins over a
    // far small magma.
    const score = weight * 50 - angleDiff * 30 - dist * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = asteroid;
    }
  }
  return best;
}

/**
 * Return the physical hit time for a shot fired at an asteroid, or null when
 * the target cannot be reached during the projectile lifetime.  This mirrors
 * the actual enemy-bullet trajectory, including lead and toroidal wrapping.
 */
function enemyBulletImpactTime(ufo, asteroid, cfg, w, h) {
  if (!ufo || !asteroid?.alive || !cfg?.ufo?.enemyBullet) return null;

  const bullet = createEnemyBullet(ufo, asteroid, cfg, w, h);
  const life = finiteNonNegative(bullet?.life, 0);
  if (life <= 0) return null;

  return sweptCircleCollisionTime(
    bullet.x, bullet.y, finiteNonNegative(bullet.radius, 0), bullet.vx, bullet.vy,
    asteroid.x, asteroid.y, finiteNonNegative(asteroid.radius, 0),
    Number.isFinite(asteroid.vx) ? asteroid.vx : 0,
    Number.isFinite(asteroid.vy) ? asteroid.vy : 0,
    w, h, life,
  );
}

function asteroidEffectRadius(asteroid, cfg) {
  switch (asteroid?.kind) {
    case 'magma':
      return finiteNonNegative(cfg?.asteroid?.types?.magma?.explosionRadius, 0);
    case 'radioactive':
      return finiteNonNegative(cfg?.asteroid?.types?.radioactive?.fieldRadius, 0);
    case 'cryo':
      return finiteNonNegative(cfg?.asteroid?.types?.cryo?.cloudRadius, 0);
    default:
      return 0;
  }
}

/**
 * A destroyed special asteroid creates its effect at bullet impact time. Do
 * not fire if the UFO is or will still be inside the real effect buffer. This
 * prevents immediate magma self-damage and avoids leaving the shooter in its
 * own radioactive field or cryo cloud.
 */
function canSafelyShootAsteroid(
  ufo, asteroid, cfg, w, h, plannedUfoVx = null, plannedUfoVy = null,
) {
  const hitTime = enemyBulletImpactTime(ufo, asteroid, cfg, w, h);
  if (hitTime === null) return false;
  const effectRadius = asteroidEffectRadius(asteroid, cfg);
  if (effectRadius <= 0) return true;

  const balance = cfg?.ufo?.[ufo.kind] ?? cfg?.ufo?.hunter;
  const safetyMargin = finiteNonNegative(
    balance?.avoidance?.safetyMargin,
    Math.max(12, finiteNonNegative(ufo.radius, 0) * 0.7),
  );
  const safeDistance = effectRadius + finiteNonNegative(ufo.radius, 0) + safetyMargin;
  const currentDistance = torusDistance(
    ufo.x, ufo.y, asteroid.x, asteroid.y, w, h,
  );
  // Curved escape paths cannot be safely extrapolated from one velocity
  // sample. Never fire while the UFO is already inside the real effect buffer.
  if (currentDistance <= safeDistance) return false;
  const ufoVx = Number.isFinite(plannedUfoVx)
    ? plannedUfoVx
    : (Number.isFinite(ufo.vx) ? ufo.vx : 0);
  const ufoVy = Number.isFinite(plannedUfoVy)
    ? plannedUfoVy
    : (Number.isFinite(ufo.vy) ? ufo.vy : 0);
  const asteroidVx = Number.isFinite(asteroid.vx) ? asteroid.vx : 0;
  const asteroidVy = Number.isFinite(asteroid.vy) ? asteroid.vy : 0;
  const futureUfoX = wrap(ufo.x + ufoVx * hitTime, w);
  const futureUfoY = wrap(ufo.y + ufoVy * hitTime, h);
  const futureAsteroidX = wrap(asteroid.x + asteroidVx * hitTime, w);
  const futureAsteroidY = wrap(asteroid.y + asteroidVy * hitTime, h);

  return torusDistance(
    futureUfoX, futureUfoY, futureAsteroidX, futureAsteroidY, w, h,
  ) > safeDistance;
}

/**
 * Environmental fields already exist in the world after a special asteroid is
 * destroyed. Treat them as navigation hazards too; otherwise a UFO can escape
 * the rock, fire safely, then immediately chase back through its own field.
 */
function computeEnvironmentalHazardAvoidance(ufo, hazards, cfg, w, h, driveSpeed) {
  if (!hazards?.length || driveSpeed <= 0) return null;

  const balance = cfg.ufo[ufo.kind] ?? cfg.ufo.hunter;
  const avoidance = balance.avoidance;
  if (!avoidance?.enabled) return null;

  const lookAhead = finiteNonNegative(avoidance.lookAhead, 0);
  const safetyMargin = finiteNonNegative(
    avoidance.safetyMargin,
    Math.max(12, finiteNonNegative(ufo.radius, 0) * 0.7),
  );
  const horizon = finiteNonNegative(
    avoidance.predictionHorizon,
    lookAhead / Math.max(1, driveSpeed) + 0.55,
  );
  if (lookAhead <= 0 || horizon <= 0) return null;

  const ufoVx = Math.cos(ufo.angle) * driveSpeed + (ufo.knockbackVx ?? 0);
  const ufoVy = Math.sin(ufo.angle) * driveSpeed + (ufo.knockbackVy ?? 0);
  let selected = null;

  for (const hazard of hazards) {
    if (!hazard?.alive) continue;
    const hazardRadius = finiteNonNegative(hazard.radius, 0);
    if (hazardRadius <= 0) continue;
    const isRadiation = hazard.kind === 'radiationField';
    const isCryo = hazard.kind === 'iceCloud';
    if (!isRadiation && !isCryo) continue;

    const timeToCollision = sweptCircleCollisionTime(
      ufo.x, ufo.y, finiteNonNegative(ufo.radius, 0) + safetyMargin,
      ufoVx, ufoVy,
      hazard.x, hazard.y, hazardRadius, 0, 0,
      w, h, horizon,
    );
    if (timeToCollision === null) continue;

    const weight = isRadiation ? 2 : 1;
    if (
      !selected
      || timeToCollision < selected.timeToCollision - 1e-9
      || (
        Math.abs(timeToCollision - selected.timeToCollision) <= 1e-9
        && weight > selected.weight
      )
    ) {
      selected = { hazard, timeToCollision, weight };
    }
  }

  if (!selected) return null;

  const dx = torusDelta(ufo.x, selected.hazard.x, w);
  const dy = torusDelta(ufo.y, selected.hazard.y, h);
  const distance = Math.hypot(dx, dy);
  const clearance = finiteNonNegative(ufo.radius, 0)
    + finiteNonNegative(selected.hazard.radius, 0)
    + safetyMargin;
  const desiredAngle = distance <= clearance
    ? (distance > 1e-6
      ? Math.atan2(-dy, -dx)
      : ufo.angle + strafeDirection(ufo) * Math.PI / 2)
    : Math.atan2(dy, dx) + chooseEscapeSide(
      ufo,
      { ...selected.hazard, vx: 0, vy: 0 },
      driveSpeed,
      w,
      h,
      horizon,
    ) * Math.PI / 2;

  return { desiredAngle: normalizeAngle(desiredAngle) };
}

/**
 * Compute an additive heading offset for player bullets on a collision course.
 *
 * Distance and a frontal cone alone create false positives: a projectile can
 * be close while moving away, or pass safely beside a UFO.  For each bullet we
 * instead compute time to closest approach under the current relative velocity
 * and dodge only when that future miss distance overlaps the two radii.
 */
function computeBulletEvasionOffset(ufo, bullets, cfg, w, h) {
  const balance = cfg.ufo[ufo.kind] ?? cfg.ufo.hunter;
  const evasion = balance.bulletEvasion;
  if (!evasion?.enabled || !bullets || bullets.length === 0) return 0;

  const detectionRange = finiteNonNegative(evasion.detectionRange, 0);
  const maxDodgeAngle = finiteNonNegative(evasion.maxDodgeAngle, 0);
  if (detectionRange <= 0 || maxDodgeAngle <= 0) return 0;

  let totalThreat = 0;
  let deflectX = 0;
  let deflectY = 0;
  const ufoRadius = finiteNonNegative(ufo.radius, 0);
  const ufoVx = Number.isFinite(ufo.vx) ? ufo.vx : 0;
  const ufoVy = Number.isFinite(ufo.vy) ? ufo.vy : 0;
  const epsilon = 1e-9;

  for (const b of bullets) {
    if (!b?.alive || b.source !== 'player') continue;
    const dx = torusDelta(ufo.x, b.x, w);
    const dy = torusDelta(ufo.y, b.y, h);
    const dist = Math.hypot(dx, dy);
    const bulletRadius = finiteNonNegative(b.radius, 2);
    const collisionRadius = ufoRadius + bulletRadius;
    if (dist > detectionRange + collisionRadius) continue;

    // r is bullet position relative to the UFO; v is bullet velocity relative
    // to the UFO.  Minimise |r + v*t| over future t to find closest approach.
    const relVx = (Number.isFinite(b.vx) ? b.vx : 0) - ufoVx;
    const relVy = (Number.isFinite(b.vy) ? b.vy : 0) - ufoVy;
    const relSpeedSq = relVx * relVx + relVy * relVy;
    if (relSpeedSq <= epsilon) continue;

    const timeToClosest = -(dx * relVx + dy * relVy) / relSpeedSq;
    // Zero/negative means the bullet is already at, or moving away from, its
    // closest point.  Do not dodge an outgoing projectile.
    if (timeToClosest <= epsilon) continue;

    const bulletLife = Number.isFinite(b.life) ? Math.max(0, b.life) : Infinity;
    if (timeToClosest > bulletLife + epsilon) continue;

    const closestX = dx + relVx * timeToClosest;
    const closestY = dy + relVy * timeToClosest;
    const missDistance = Math.hypot(closestX, closestY);
    if (missDistance > collisionRadius) continue;

    const relSpeed = Math.sqrt(relSpeedSq);
    const reactionHorizon = Math.min(
      bulletLife,
      (detectionRange + collisionRadius) / relSpeed,
    );
    if (timeToClosest > reactionHorizon + epsilon) continue;

    const distanceFactor = Math.max(
      0,
      1 - dist / (detectionRange + collisionRadius),
    );
    const timeFactor = reactionHorizon > epsilon
      ? Math.max(0, 1 - timeToClosest / reactionHorizon)
      : 0;
    const collisionFactor = collisionRadius > epsilon
      ? Math.max(0, 1 - missDistance / collisionRadius)
      : 1;
    // Keep a small response at the edge of the detection range once a real
    // collision course is established, then increase it as impact approaches.
    const threat = collisionFactor
      * (0.2 + 0.8 * Math.max(distanceFactor, timeFactor));
    if (threat <= 0) continue;

    totalThreat += threat;

    let evadeX = -closestX;
    let evadeY = -closestY;
    const closestLength = Math.hypot(evadeX, evadeY);
    if (closestLength > epsilon) {
      evadeX /= closestLength;
      evadeY /= closestLength;
    } else {
      // A direct hit has no miss-side to move away from.  Choose one of the
      // two perpendicular sides deterministically, so identical simulations
      // remain repeatable while different UFO ids do not all dodge together.
      evadeX = (-relVy / relSpeed) * strafeDirection(ufo);
      evadeY = (relVx / relSpeed) * strafeDirection(ufo);
    }

    deflectX += evadeX * threat;
    deflectY += evadeY * threat;
  }

  if (totalThreat <= 0) return 0;
  const deflectLen = Math.hypot(deflectX, deflectY);
  if (deflectLen <= 0) return 0;

  deflectX /= deflectLen;
  deflectY /= deflectLen;

  const targetDeflection = Math.min(maxDodgeAngle, totalThreat * maxDodgeAngle);
  const deflectionAngle = Math.atan2(deflectY, deflectX);
  const signedDiff = normalizeAngle(deflectionAngle - ufo.angle);
  return Math.max(-targetDeflection, Math.min(targetDeflection, signedDiff));
}

/**
 * Create an enemy craft. The RNG is injectable so its initial heading is
 * reproducible; firing and mine timers are advanced by the game layer.  `id`
 * is optional for backwards compatibility, but game-owned spawns should pass
 * their per-game id so formation/strafe choices are unique and deterministic.
 */
export function createUfo(kind, x, y, cfg, rng, speedMultiplier = 1, id = null) {
  const resolvedKind = cfg.ufo[kind] ? kind : 'hunter';
  const balance = cfg.ufo[resolvedKind];
  const angle = rng() * Math.PI * 2;
  const hp = balance.hp ?? 1;
  const resolvedSpeedMultiplier = Number.isFinite(speedMultiplier)
    ? Math.max(0.1, speedMultiplier)
    : 1;
  const speed = balance.speed * resolvedSpeedMultiplier;
  return {
    id: resolveUfoId(resolvedKind, x, y, id),
    kind: resolvedKind,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: balance.radius,
    visualRadius: balance.radius + 18,
    angle,
    speed,
    speedMultiplier: resolvedSpeedMultiplier,
    turnRate: balance.turnRate,
    hp,
    maxHp: hp,
    points: balance.points ?? 0,
    fireTimer: resolvedKind === 'hunter' || resolvedKind === 'scout' || resolvedKind === 'fighter' || resolvedKind === 'bomber'
      ? (balance.fireCooldown ?? 0)
      : 0,
    mineTimer: resolvedKind === 'base' ? (balance.mineCooldown ?? 0) : 0,
    orbitDirection: undefined,
    approachRetreatPhase: resolvedKind === 'fighter' ? 'approach' : null,
    approachRetreatTimer: resolvedKind === 'fighter' ? (balance.phaseDuration ?? 0) : 0,
    // Number of follow-up shots still pending in the current Fighter burst.
    // It starts at zero: the game layer must first wait fireCooldown, fire the
    // lead shot, then schedule burstCount - 1 follow-ups at burstInterval.
    burstRemaining: 0,
    burstTimer: 0,
    knockbackVx: 0,
    knockbackVy: 0,
    asteroidHitCooldown: 0,
    spawnCollisionProtected: false,
    cryoSlowTime: 0,
    radiationTime: 0,
    radiationTickAccumulator: 0,
    squadRole: null,
    squadTarget: null,
    isLastSurvivor: false,
    fleeTimer: 0,
    warpInTimer: 0,
    // Short-lived navigation memory. It keeps the chosen escape side stable
    // while an asteroid is still dangerous or immediately after it clears.
    avoidanceTarget: null,
    avoidanceSide: 0,
    avoidanceCommitTime: 0,
    // Remembers a special asteroid while the UFO creates a safe firing lane.
    // It lets the craft finish its escape before aiming back at the hazard.
    specialShotTarget: null,
    // Separate from the ordinary weapon cooldown: this only limits a brief
    // emergency shot at a normal asteroid on a collision course.
    asteroidDefenseTimer: 0,
    alive: true,
  };
}

function computeEscortAngle(ufo, escortTarget, cfg, w, h) {
  const dx = torusDelta(ufo.x, escortTarget.x, w);
  const dy = torusDelta(ufo.y, escortTarget.y, h);
  const dist = Math.hypot(dx, dy);
  const escortRadius = cfg.ufo.squad?.escortRadius ?? 80;
  if (dist > escortRadius + 20) {
    return Math.atan2(dy, dx);
  }
  const dir = strafeDirection(ufo);
  return Math.atan2(dy, dx) + dir * Math.PI / 2;
}

/**
 * Turn toward the ship along the shortest toroidal path, then move and wrap.
 * Hunter/base behaviour differs through their configured speed and turn rate.
 */
export function updateUfo(
  ufo, dt, ship, cfg, w, h, asteroids = [], bullets = [], environmentalHazards = [],
) {
  const balance = cfg.ufo[ufo.kind] ?? cfg.ufo.hunter;
  const speed = ufo.speed ?? balance.speed;
  const turnRate = ufo.turnRate ?? balance.turnRate;
  const collisionCfg = cfg.ufo.asteroidCollision;
  const dx = torusDelta(ufo.x, ship.x, w);
  const dy = torusDelta(ufo.y, ship.y, h);

  ufo.warpInTimer = Math.max(0, (ufo.warpInTimer ?? 0) - dt);

  if (ufo.isLastSurvivor) {
    ufo.fleeTimer = Math.max(0, (ufo.fleeTimer ?? 0) - dt);
    if (ufo.fleeTimer === 0) {
      ufo.alive = false;
      return { actionRateMultiplier: 0 };
    }
  }

  // Cooldown and knockback damping happen before the drive composition so that
  // vx/vy always represents the total velocity used for this step's integration.
  ufo.asteroidHitCooldown = Math.max(0, (ufo.asteroidHitCooldown ?? 0) - dt);
  if (collisionCfg) {
    const damping = Math.exp(-collisionCfg.knockbackDamping * dt);
    ufo.knockbackVx = (ufo.knockbackVx ?? 0) * damping;
    ufo.knockbackVy = (ufo.knockbackVy ?? 0) * damping;
    if (Math.abs(ufo.knockbackVx) < 1e-6) ufo.knockbackVx = 0;
    if (Math.abs(ufo.knockbackVy) < 1e-6) ufo.knockbackVy = 0;
  }

  const cryoStep = resolveUfoCryoStep(ufo, dt, cfg);
  const driveMultiplier = cryoStep.driveMultiplier;
  const evasionSpeedThreshold = finiteNonNegative(
    balance.avoidance?.evasionSpeedThreshold,
    Infinity,
  );
  const priorEvasionDriveMultiplier = ufo.avoidanceTarget?.alive
    && (ufo.avoidanceCommitTime ?? 0) > 0
    && Math.hypot(
      ufo.avoidanceTarget.vx ?? 0,
      ufo.avoidanceTarget.vy ?? 0,
    ) >= evasionSpeedThreshold
    ? finiteUnitMultiplier(balance.avoidance?.evasionDriveMultiplier)
    : 1;
  const plannedDriveSpeed = speed * driveMultiplier * priorEvasionDriveMultiplier;

  // First establish the normal route. Asteroid prediction must use this
  // intended pursuit/orbit route, rather than the heading from the preceding
  // frame, so a UFO does not begin turning into a rock before it reacts.
  let desiredAngle;
  if (ufo.isLastSurvivor) {
    desiredAngle = Math.atan2(-dy, -dx);
  } else if (ufo.squadRole === 'escort' && ufo.squadTarget?.alive) {
    desiredAngle = computeEscortAngle(ufo, ufo.squadTarget, cfg, w, h);
  } else if (dx === 0 && dy === 0) {
    desiredAngle = ufo.angle;
  } else {
    const behavior = balance.behavior ?? 'chase';
    const range = torusDistance(ufo.x, ufo.y, ship.x, ship.y, w, h);

    if (behavior === 'orbit') {
      const orbitDir = ufo.orbitDirection === undefined
        ? strafeDirection(ufo)
        : ufo.orbitDirection;
      desiredAngle = computeOrbitAngle(ufo, ship, range, balance.orbitRange ?? range, orbitDir, w, h);
    } else if (behavior === 'approachRetreat') {
      desiredAngle = computeApproachRetreatAngle(ufo, ship, range, balance, dt, w, h);
    } else if (behavior === 'keepDistance') {
      desiredAngle = computeKeepDistanceAngle(ufo, ship, range, balance, w, h);
    } else if (behavior === 'intercept') {
      desiredAngle = computeInterceptAngle(ufo, ship, balance, w, h);
    } else {
      desiredAngle = Math.atan2(dy, dx);
    }
  }

  // Predict asteroid impacts on the route the UFO intends to take. An imminent
  // collision then owns the heading for this step; chase/orbit resumes only
  // after the committed escape route is clear.
  const asteroidAvoidance = computeAsteroidAvoidance(
    ufo, asteroids, cfg, w, h, dt, plannedDriveSpeed, desiredAngle,
  );
  const environmentalAvoidance = computeEnvironmentalHazardAvoidance(
    ufo, environmentalHazards, cfg, w, h, plannedDriveSpeed,
  );

  // Even when no crash course is predicted, target high-threat environmental
  // hazards within weapon range so the UFO shoots them proactively.
  const highThreatTarget = asteroidAvoidance.timeToCollision === null
    ? computeHighThreatShootTarget(ufo, asteroids, cfg, w, h)
    : null;
  const immediateSpecialTarget = [asteroidAvoidance.asteroid, highThreatTarget]
    .find(target => getAsteroidThreatWeight(target?.kind) > 0) ?? null;
  if (immediateSpecialTarget) {
    ufo.specialShotTarget = immediateSpecialTarget;
  } else if (
    ufo.specialShotTarget
    && (!ufo.specialShotTarget.alive || !asteroids?.includes(ufo.specialShotTarget))
  ) {
    ufo.specialShotTarget = null;
  }

  // Compose the selected escape route over the normal heading. The maximum
  // deflection and turn rate still preserve each archetype's personality.
  if (asteroidAvoidance.active) {
    const rawDeflection = normalizeAngle(
      asteroidAvoidance.tangentAngle - desiredAngle,
    );
    const limit = asteroidAvoidance.maxDeflectionAngle;
    const boundedDeflection = Math.max(-limit, Math.min(limit, rawDeflection));
    desiredAngle = normalizeAngle(desiredAngle + boundedDeflection);
  } else if (environmentalAvoidance) {
    // Existing fields take priority over normal route-following once there is
    // no immediate solid-asteroid collision to resolve.
    desiredAngle = environmentalAvoidance.desiredAngle;
  }

  // A rebound can turn a harmless rock into a near-instant impact between
  // frames. While clearing that route, ease off the drive rather than keeping
  // full pursuit thrust into the field. Knockback still applies unchanged, so
  // an actual hit remains dangerous and visibly pushes the craft away.
  const evasionDriveMultiplier = asteroidAvoidance.active
    && Math.hypot(
      asteroidAvoidance.asteroid?.vx ?? 0,
      asteroidAvoidance.asteroid?.vy ?? 0,
    ) >= evasionSpeedThreshold
    ? finiteUnitMultiplier(balance.avoidance?.evasionDriveMultiplier)
    : 1;
  const effectiveDriveSpeed = speed * driveMultiplier * evasionDriveMultiplier;

  const bulletEvasionOffset = computeBulletEvasionOffset(ufo, bullets, cfg, w, h);
  desiredAngle = normalizeAngle(desiredAngle + bulletEvasionOffset);
  // Safety checks for special-asteroid shots must account for the course the
  // UFO is trying to take, not just this frame's turn-rate-limited velocity.
  const plannedSafetyVx = Math.cos(desiredAngle) * effectiveDriveSpeed
    + (ufo.knockbackVx ?? 0);
  const plannedSafetyVy = Math.sin(desiredAngle) * effectiveDriveSpeed
    + (ufo.knockbackVy ?? 0);
  const delta = normalizeAngle(desiredAngle - ufo.angle);
  const maxTurn = turnRate * dt;
  ufo.angle += Math.max(-maxTurn, Math.min(maxTurn, delta));

  const driveVx = Math.cos(ufo.angle) * effectiveDriveSpeed;
  const driveVy = Math.sin(ufo.angle) * effectiveDriveSpeed;

  ufo.vx = driveVx + (ufo.knockbackVx ?? 0);
  ufo.vy = driveVy + (ufo.knockbackVy ?? 0);
  ufo.x = wrap(ufo.x + ufo.vx * dt, w);
  ufo.y = wrap(ufo.y + ufo.vy * dt, h);
  ufo.cryoSlowTime = cryoStep.remainingTime;

  const imminentAsteroidTarget = asteroidAvoidance.timeToCollision !== null
    ? asteroidAvoidance.asteroid
    : null;
  // A successful first turn often makes the collision predictor return null
  // while the craft is still committed to clearing the same rock. Keep that
  // normal asteroid as the defensive fire target until the escape commitment
  // expires, instead of immediately resuming fire at the player.
  const committedAsteroidTarget = asteroidAvoidance.active
    && asteroidAvoidance.timeToCollision === null
    && asteroidAvoidance.asteroid?.alive
    && asteroids?.includes(asteroidAvoidance.asteroid)
    && enemyBulletImpactTime(ufo, asteroidAvoidance.asteroid, cfg, w, h) !== null
    ? asteroidAvoidance.asteroid
    : null;
  const rememberedSpecialTarget = ufo.specialShotTarget?.alive
    && asteroids?.includes(ufo.specialShotTarget)
    ? ufo.specialShotTarget
    : null;
  const preferredAsteroidTarget = imminentAsteroidTarget
    ?? highThreatTarget
    ?? committedAsteroidTarget
    ?? rememberedSpecialTarget;
  const preferredEffectRadius = asteroidEffectRadius(preferredAsteroidTarget, cfg);
  const specialTargetReachable = preferredEffectRadius <= 0
    || enemyBulletImpactTime(ufo, preferredAsteroidTarget, cfg, w, h) !== null;
  if (
    preferredAsteroidTarget === rememberedSpecialTarget
    && preferredEffectRadius > 0
    && !specialTargetReachable
  ) {
    ufo.specialShotTarget = null;
  }
  // A collision can stop being predicted as soon as the first evasive turn
  // changes the projected path, while the committed escape route is still in
  // progress.  Keep special-asteroid shots suppressed for that full route;
  // otherwise a radioactive field can be created just ahead of the UFO before
  // it has actually cleared the danger area.
  const escapingEffectHazard = preferredEffectRadius > 0
    && asteroidAvoidance.active
    && asteroidAvoidance.asteroid === preferredAsteroidTarget;
  const canShootPreferredTarget = !escapingEffectHazard && (!preferredAsteroidTarget
    || canSafelyShootAsteroid(
      ufo,
      preferredAsteroidTarget,
      cfg,
      w,
      h,
      plannedSafetyVx,
      plannedSafetyVy,
    )
  );
  // Falling back to the ship while an unsafe special target sits directly in
  // front of the UFO would still trigger that effect en route. Hold the shot
  // until the escape path makes the effect safe instead.
  const suppressFire = preferredEffectRadius > 0
    && specialTargetReachable
    && !canShootPreferredTarget;
  const defense = cfg.ufo?.asteroidDefense;
  const defenseTriggerTime = finiteNonNegative(defense?.triggerTime, 0);
  const collisionTarget = asteroidAvoidance.timeToCollision !== null
    ? asteroidAvoidance.asteroid
    : null;
  // Emergency interception is deliberately narrow. Normal one-hit rocks can
  // be cleared before a rebound becomes fatal; material rocks may create a
  // field/explosion and therefore remain under the conservative safety rules
  // above. The normal weapon's reachability check also prevents futile shots
  // at a rock the projectile cannot catch.
  const defensiveAsteroidTarget = defense?.enabled !== false
    && defenseTriggerTime > 0
    && asteroidAvoidance.timeToCollision <= defenseTriggerTime
    && collisionTarget?.kind === 'normal'
    && finiteNonNegative(collisionTarget.hp, 1) <= 1
    && enemyBulletImpactTime(ufo, collisionTarget, cfg, w, h) !== null
    ? collisionTarget
    : null;

  return {
    actionRateMultiplier: cryoStep.actionRateMultiplier,
    // Prefer a predicted crash-course target for both evasion and fire.
    // If no collision is imminent but a dangerous asteroid is within weapon
    // range, target it proactively to keep environmental hazards from killing
    // the UFO while it is focused on the player.
    asteroidTarget: preferredEffectRadius > 0 && !specialTargetReachable
      ? null
      : preferredAsteroidTarget,
    defensiveAsteroidTarget,
    suppressFire,
  };
}

/**
 * Orbit the ship at the configured range. The desired heading is the tangent
 * direction that keeps the UFO at roughly orbitRange while still closing when
 * far outside the orbit band.
 */
function computeOrbitAngle(ufo, ship, range, orbitRange, orbitDir, w, h) {
  const dx = torusDelta(ufo.x, ship.x, w);
  const dy = torusDelta(ufo.y, ship.y, h);
  const toShip = Math.atan2(dy, dx);
  if (range <= 0) return toShip;

  const band = orbitRange * 0.35;
  const inner = orbitRange - band;
  const outer = orbitRange + band;

  const tangentAngle = toShip + orbitDir * Math.PI / 2;

  if (range < inner) {
    // Very close to the ship: mostly flee, but keep a tangent component near the
    // inner boundary so the scout can settle into orbit instead of bouncing.
    const k = Math.min(1, (inner - range) / band);
    const fleeAngle = normalizeAngle(toShip + Math.PI);
    return blendAngles(tangentAngle, fleeAngle, k);
  }
  if (range > outer) {
    // Far from the ship: mostly approach, but keep a tangent component near the
    // outer boundary.
    const k = Math.min(1, (range - outer) / band);
    return blendAngles(tangentAngle, toShip, k);
  }
  return tangentAngle;
}

function blendAngles(a, b, t) {
  const s = Math.max(0, Math.min(1, t));
  return Math.atan2(
    (1 - s) * Math.sin(a) + s * Math.sin(b),
    (1 - s) * Math.cos(a) + s * Math.cos(b),
  );
}

/**
 * Approach-and-retreat pattern: close to approachRange, then flip to retreat
 * until retreatRange, and repeat. The phase flips when crossing the boundary.
 */
function computeApproachRetreatAngle(ufo, ship, range, balance, dt, w, h) {
  const dx = torusDelta(ufo.x, ship.x, w);
  const dy = torusDelta(ufo.y, ship.y, h);
  const toShip = Math.atan2(dy, dx);
  if (range <= 0) return toShip;

  const approachRange = balance.approachRange ?? 220;
  const retreatRange = balance.retreatRange ?? 320;

  // Count down the phase timer; when it expires, flip phase to create a
  // cadence independent of exact range noise.
  let phase = ufo.approachRetreatPhase ?? 'approach';
  let timer = Math.max(0, (ufo.approachRetreatTimer ?? 0) - dt);
  if (timer <= 0) {
    phase = phase === 'approach' ? 'retreat' : 'approach';
    timer = balance.phaseDuration ?? 2.2;
  }
  ufo.approachRetreatPhase = phase;
  ufo.approachRetreatTimer = timer;

  // Hard guards: if extremely far, approach; if extremely close, retreat.
  if (range > retreatRange * 1.25) {
    phase = 'approach';
  } else if (range < approachRange * 0.6) {
    phase = 'retreat';
  }

  return phase === 'approach' ? toShip : normalizeAngle(toShip + Math.PI);
}

/**
 * Keep the ship near preferredRange. Move toward the ship when farther than
 * preferredRange + margin, and away when closer than minRange. Between the
 * two, drift tangentially to maintain the engagement without ramming.
 */
function computeKeepDistanceAngle(ufo, ship, range, balance, w, h) {
  const dx = torusDelta(ufo.x, ship.x, w);
  const dy = torusDelta(ufo.y, ship.y, h);
  const toShip = Math.atan2(dy, dx);
  if (range <= 0) return toShip;

  const preferredRange = balance.preferredRange ?? 380;
  const minRange = balance.minRange ?? preferredRange * 0.6;
  const margin = (preferredRange - minRange) * 0.35;

  if (range > preferredRange + margin) return toShip;
  if (range < minRange) return normalizeAngle(toShip + Math.PI);

  // Inside the engagement band: drift sideways (clockwise or counter-clockwise
  // based on deterministic id) to keep the ship in sights while preserving range.
  const dir = strafeDirection(ufo);
  return normalizeAngle(toShip + dir * Math.PI / 2);
}

/**
 * Intercept the ship by aiming at its predicted future position. The lead uses
 * the ship velocity relative to the UFO so the cut feels responsive even when
 * the interceptor itself is already moving.
 */
function computeInterceptAngle(ufo, ship, balance, w, h) {
  const dx = torusDelta(ufo.x, ship.x, w);
  const dy = torusDelta(ufo.y, ship.y, h);
  const lead = finiteNonNegative(balance.predictionLead, 0.5);
  if (lead <= 0) return Math.atan2(dy, dx);

  const relVx = (ship.vx ?? 0) - (ufo.vx ?? 0);
  const relVy = (ship.vy ?? 0) - (ufo.vy ?? 0);
  const predictedX = wrap(ship.x + relVx * lead, w);
  const predictedY = wrap(ship.y + relVy * lead, h);
  const pdx = torusDelta(ufo.x, predictedX, w);
  const pdy = torusDelta(ufo.y, predictedY, h);
  return Math.atan2(pdy, pdx);
}

/**
 * Fire toward a target, with optional predictive lead for fighter/bomber.
 * The target can be the player ship or an asteroid that blocks the UFO's
 * escape path. Prediction uses the shortest toroidal path and is capped by
 * maxPredictionLead.
 */
export function createEnemyBullet(ufo, target, cfg, w, h) {
  const balance = cfg.ufo.enemyBullet;
  const archetype = cfg.ufo[ufo.kind] ?? cfg.ufo.hunter;
  const lead = Math.min(
    finiteNonNegative(archetype.maxPredictionLead, 0),
    finiteNonNegative(archetype.predictionLead, 0),
  );

  let targetX = target.x;
  let targetY = target.y;
  if (lead > 0) {
    targetX = wrap((target.vx ?? 0) * lead + target.x, w);
    targetY = wrap((target.vy ?? 0) * lead + target.y, h);
  }

  const dx = torusDelta(ufo.x, targetX, w);
  const dy = torusDelta(ufo.y, targetY, h);
  const angle = Math.atan2(dy, dx);
  const radius = balance.radius;
  const originRadius = ufo.radius + radius + 2;
  const speedMultiplier = Number.isFinite(ufo.speedMultiplier)
    ? Math.max(0.1, ufo.speedMultiplier)
    : 1;
  const speed = balance.speed * speedMultiplier;
  return {
    x: wrap(ufo.x + Math.cos(angle) * originRadius, w),
    y: wrap(ufo.y + Math.sin(angle) * originRadius, h),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    speed,
    speedMultiplier,
    angle,
    life: balance.life,
    lifeTotal: balance.life,
    radius,
    visualRadius: radius + 10,
    kind: 'enemyBullet',
    source: 'enemy',
    turnRate: 0,
    alive: true,
  };
}

export function updateEnemyBullet(bullet, dt, w, h) {
  updateBullet(bullet, dt, w, h);
}

/**
 * Create a mine at the base UFO's current position. It deliberately does not
 * inherit velocity: mines remain fixed in world space until they expire.
 */
export function createMine(ufo, cfg) {
  const balance = cfg.ufo.mine;
  return {
    kind: 'mine',
    source: 'enemy',
    x: ufo.x,
    y: ufo.y,
    vx: 0,
    vy: 0,
    radius: balance.radius,
    visualRadius: Math.max(balance.triggerRadius, balance.explosionRadius) + 10,
    triggerRadius: balance.triggerRadius,
    explosionRadius: balance.explosionRadius,
    effectDuration: balance.effectDuration,
    life: balance.life,
    lifeTotal: balance.life,
    armTime: balance.armDelay,
    armDuration: balance.armDelay,
    armed: balance.armDelay <= 0,
    angle: ufo.angle ?? 0,
    rotSpeed: 1.4,
    alive: true,
  };
}

export function updateMine(mine, dt) {
  mine.angle += mine.rotSpeed * dt;
  mine.armTime = Math.max(0, mine.armTime - dt);
  mine.armed = mine.armTime === 0;
  mine.life -= dt;
  if (mine.life <= 0) mine.alive = false;
}

/**
 * Update asteroid: move, rotate, wrap.
 */
export function updateAsteroid(a, dt, w, h) {
  const frozenTime = Math.min(Math.max(0, a.stun ?? 0), Math.max(0, dt));
  if (a.stun > 0) a.stun = Math.max(0, a.stun - dt);
  const movingTime = Math.max(0, dt - frozenTime);
  a.x += a.vx * movingTime;
  a.y += a.vy * movingTime;
  a.x = wrap(a.x, w);
  a.y = wrap(a.y, h);
  a.angle += a.rotSpeed * movingTime;
}

/**
 * Get the child size for fragmentation. Returns null if small (no children).
 */
export function childSize(size) {
  if (size === 'large') return 'medium';
  if (size === 'medium') return 'small';
  return null;
}

/**
 * Get the point value for a given asteroid size.
 */
export function asteroidPoints(size, cfg) {
  if (size === 'large') return cfg.asteroid.largePoints;
  if (size === 'medium') return cfg.asteroid.mediumPoints;
  return cfg.asteroid.smallPoints;
}
