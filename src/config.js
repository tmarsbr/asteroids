// config.js — centralized balance values for the MVP.
// Adjust only after dogfood. All units in seconds or pixels/sec.

export const CONFIG = {
  // World
  world: {
    // width/height are dynamic (viewport); these are fallbacks for tests
    width: 800,
    height: 600,
  },

  // Ship
  ship: {
    radius: 14,
    rotSpeed: 3.4,        // rad/sec
    thrust: 320,          // px/sec^2
    brake: 900,           // px/sec^2 removed while S/down is held
    maxSpeed: 380,        // px/sec
    friction: 0.992,      // per-step (1/60 s) velocity retention
    respawnInvuln: 2.0,   // seconds
    // Shield / hull plating used against hostile craft. Asteroids bypass it.
    shield: {
      max: 100,
      regenPerSecond: 18,
      regenDelay: 2.0,    // seconds after damage before regen resumes
      damageBySource: {
        ufo: 34,
        enemyBullet: 34,
        mine: 34,
      },
    },
  },

  // Active piloting / survival abilities
  abilities: {
    dash: {
      speed: 820,         // px/sec while the impulse is active
      duration: 0.18,     // seconds of forced forward movement
      invuln: 0.3,        // dodge window requested by the design
      cooldown: 1.5,
    },
    shieldBurst: {
      maxEnergy: 100,
      cost: 45,
      regenPerSecond: 14,
      radius: 180,
      impulse: 360,       // velocity added to nearby asteroids
      maxAsteroidSpeed: 520,
      grace: 0.2,         // lets the repulsor clear an existing near-hit
      effectDuration: 0.38,
    },
    hyperspace: {
      cooldown: 6.0,
      arrivalInvuln: 0.12,
      minDistance: 160,
      maxDestinationAttempts: 16,
      bombFuse: 0.8,
      bombRadius: 125,
      bombEffectDuration: 0.45,
      arrivalEffectDuration: 0.32,
    },
  },

  // Temporary weapons and collectible Data Nodes
  powerUps: {
    types: ['spread', 'beam', 'homing', 'emp', 'drones'],
    weights: [26, 18, 22, 14, 20],
    nodeLife: 12.0,
    nodeRadius: 18,
    nodeSpeed: 18,
    guaranteedCarriersPerWave: 1,
    maxCarriersPerWave: 2,
    extraCarrierChance: 0.15,
    pickupEffectDuration: 0.32,
    spread: {
      duration: 9.0,
      angle: Math.PI / 15, // 12 degrees to each side
      count: 3,
      cooldown: 0.24,
      maxProjectiles: 12,
    },
    beam: {
      duration: 8.0,
      tickCooldown: 0.15,
      range: 520,
      radius: 3,
    },
    homing: {
      duration: 10.0,
      speed: 360,
      turnRate: 4.5,      // rad/sec
      life: 2.2,
      radius: 4,
      cooldown: 0.48,
      maxMissiles: 5,
    },
    emp: {
      stunDuration: 2.5,
      effectDuration: 0.7,
    },
    drones: {
      duration: 10.0,
      count: 2,
      orbitRadius: 38,
      orbitSpeed: 2.4,    // rad/sec
      range: 300,
      fireCooldown: 0.7,
      bulletSpeed: 460,
      bulletLife: 0.9,
      maxProjectiles: 6,
    },
  },

  // Bullets
  bullet: {
    speed: 520,           // px/sec
    cooldown: 0.18,       // seconds between shots
    life: 1.0,            // seconds before expiry
    max: 6,               // max simultaneous bullets
    poweredMax: 12,
    radius: 2,
  },

  // Score escalation rewards deliberate manual shots. The multiplier armed by
  // an impact applies to the next point award, so the first hit still scores
  // at the classic x1 baseline.
  scoring: {
    multiplier: {
      initial: 1,
      increment: 0.5,
      max: 5,
    },
    chainReaction: {
      minIndirectKills: 3,
      bonusPoints: 500,
      effectDuration: 0.9,
      effectRadius: 150,
    },
  },

  // Asteroids
  asteroid: {
    // radii (collision circles)
    largeR: 48,
    mediumR: 26,
    smallR: 14,
    // points
    largePoints: 20,
    mediumPoints: 50,
    smallPoints: 100,
    // fragmentation
    childrenPerSplit: 2,
    // speed ranges (px/sec) per size
    largeSpeed: [40, 80],
    mediumSpeed: [60, 120],
    smallSpeed: [80, 160],
    // rotation speed range (rad/sec)
    rotSpeed: [-1.2, 1.2],
    // wave config
    initialCount: 4,
    maxInitial: 10,
    safeSpawnRadius: 160, // min distance from ship for new asteroids
    // per-wave speed multiplier increment (capped)
    waveSpeedMult: 0.12,
    maxSpeedMult: 2.0,
    // Solid asteroid contacts use a slightly super-elastic rebound so each
    // impact makes the field progressively more frantic, without runaway
    // speeds.
    collision: {
      enabled: true,
      restitution: 1.12,
      maxSpeed: 560,
      // Small fragments remain dangerous, but lose 40% of their post-impact
      // speed so high waves do not turn into an unreadable pinball field.
      smallReboundSpeedMultiplier: 0.60,
      separationPadding: 0.5,
      maxEventsPerStep: 64,
    },
    // Special asteroid variants become available gradually. At least one
    // special is selected once a wave has an unlocked type; the remaining
    // rocks use the capped per-wave chance.
    typeUnlockWave: {
      magma: 2,
      cryo: 3,
      crystal: 4,
      radioactive: 5,
    },
    guaranteedSpecialsPerWave: 1,
    specialChancePerWave: 0.12,
    maxSpecialChance: 0.55,
    types: {
      magma: {
        hp: { large: 1, medium: 1, small: 1 },
        explosionRadius: 115,
        ufoDamage: 2,
        effectDuration: 0.55,
      },
      cryo: {
        hp: { large: 1, medium: 1, small: 1 },
        cloudRadius: 96,
        cloudLife: 4.0,
        slowDuration: 1.8,
        rotationMultiplier: 0.42,
        ufoDriveMultiplier: 0.55,
        ufoActionRateMultiplier: 0.50,
        effectDuration: 0.5,
      },
      crystal: {
        hp: { large: 3, medium: 2, small: 2 },
        hitEffectDuration: 0.18,
      },
      radioactive: {
        hp: { large: 1, medium: 1, small: 1 },
        fieldRadius: 90,
        fieldLife: 5.0,
        exposureDuration: 2.4,
        tickInterval: 0.8,
        ufoDamagePerTick: 1,
        effectDuration: 0.5,
      },
    },
  },

  // Environmental hazards
  hazards: {
    gravity: {
      unlockWave: 4,
      chance: 0.24,
      radius: 190,
      coreRadius: 20,
      // Used as an inverse-distance pull and capped to avoid tunnelling.
      strength: 16000,
      maxAcceleration: 260,
      duration: 10.0,
      safeSpawnRadius: 220,
      maxShipSpeed: 440,
      maxAsteroidSpeed: 500,
      maxBulletSpeed: 720,
    },
  },

  // Enemy vector craft and their projectiles
  ufo: {
    unlockWave: 5,
    safeSpawnRadius: 220,
    // Each kind appears every other wave. The first encounter uses the base
    // speed; later encounters ramp up gradually until this multiplier cap.
    speedGrowthPerAppearance: 0.12,
    // Spawn escalation — multiple UFOs per wave
    squadSize: {
      base: 1,            // UFOs on the unlock wave
      growthPerWave: 0.4, // fractional increment per wave past unlock
      max: 3,             // simultaneous UFO cap
      lateGameMax: 4,     // cap from lateGameWave onward
      lateGameWave: 20,
    },
    // HP scaling per wave
    hpScaling: {
      startWave: 8,       // wave from which HP starts scaling
      bonusPerWave: 0.5,  // fractional HP bonus per wave past startWave
      maxBonusHp: 3,      // cap on bonus HP
    },
    // Squad tactics and dramatic events
    squad: {
      escortRadius: 80,
      lastSurvivorFleeTime: 5.0,
      lastSurvivorBonusMultiplier: 2.0,
      warpInDuration: 0.6,
      warningDuration: 1.5,
    },
    maxSpeedMultiplier: 1.6,
    interceptor: {
      radius: 16,
      speed: 320,
      turnRate: 3.8,
      hp: 4,
      points: 450,
      fireCooldown: 0.78,
      behavior: 'intercept',
      predictionLead: 0.55,
      avoidance: {
        enabled: true,
        lookAhead: 200,
        coneAngle: 2.094395102, // 2π/3 ≈ 120°
        sizeWeightBySize: { small: 0.6, medium: 1, large: 1.4 },
        maxDeflectionAngle: 1.05,
        evasionDriveMultiplier: 0.25,
        evasionSpeedThreshold: 40,
        pressureThreshold: 2.0,
        imperfectionDrop: 0.35,
        panicDistance: 60,
        panicMultiplier: 0.55,
      },
      bulletEvasion: {
        enabled: true,
        detectionRange: 180,
        reactionConeAngle: 3.14159265, // ~180°
        maxDodgeAngle: 0.8,
      },
    },
    hunter: {
      radius: 18,
      speed: 254,
      turnRate: 3.2,
      hp: 4,
      points: 400,
      fireCooldown: 0.86,
      avoidance: {
        enabled: true,
        lookAhead: 220,
        coneAngle: 2.094395102, // 2π/3 ≈ 120°
        sizeWeightBySize: { small: 0.6, medium: 1, large: 1.4 },
        maxDeflectionAngle: 1.15,
        // Brake while committed to an escape route. This gives the turn and a
        // defensive shot time to work against a recently rebounded rock.
        evasionDriveMultiplier: 0.25,
        evasionSpeedThreshold: 40,
        pressureThreshold: 2.2,
        imperfectionDrop: 0.35,
        panicDistance: 60,
        panicMultiplier: 0.55,
      },
      bulletEvasion: {
        enabled: true,
        detectionRange: 180,
        reactionConeAngle: 3.14159265, // ~180°
        maxDodgeAngle: 0.5,
      },
    },
    base: {
      radius: 30,
      speed: 92,
      turnRate: 0.7,
      hp: 6,
      points: 750,
      mineCooldown: 2.8,
      maxMines: 4,
      avoidance: {
        enabled: true,
        lookAhead: 120,
        coneAngle: 1.570796327, // π/2 = 90°
        sizeWeightBySize: { small: 0.7, medium: 1, large: 1.3 },
        maxDeflectionAngle: 0.55,
        evasionDriveMultiplier: 0.25,
        evasionSpeedThreshold: 40,
        pressureThreshold: 1.4,
        imperfectionDrop: 0.6,
        panicDistance: 80,
        panicMultiplier: 0.45,
      },
      bulletEvasion: {
        enabled: true,
        detectionRange: 120,
        reactionConeAngle: 1.5707963, // ~90°
        maxDodgeAngle: 0.2,
      },
    },
    scout: {
      radius: 14,
      speed: 283,
      turnRate: 4.0,
      hp: 4,
      points: 300,
      fireCooldown: 0.64,
      behavior: 'orbit',
      orbitRange: 170,
      preferredRange: 170,
      predictionLead: 0,
      maxPredictionLead: 0,
      avoidance: {
        enabled: true,
        lookAhead: 200,
        coneAngle: 2.094395102, // 2π/3 ≈ 120°
        sizeWeightBySize: { small: 0.6, medium: 1, large: 1.4 },
        maxDeflectionAngle: 1.0,
        evasionDriveMultiplier: 0.25,
        evasionSpeedThreshold: 40,
        pressureThreshold: 2.0,
        imperfectionDrop: 0.4,
        panicDistance: 50,
        panicMultiplier: 0.5,
      },
      bulletEvasion: {
        enabled: true,
        detectionRange: 200,
        reactionConeAngle: 3.14159265, // ~180°
        maxDodgeAngle: 0.9,
      },
    },
    fighter: {
      radius: 18,
      speed: 238,
      turnRate: 3.5,
      hp: 4,
      points: 450,
      fireCooldown: 0.42,
      burstCount: 3,
      burstInterval: 0.18,
      behavior: 'approachRetreat',
      approachRange: 220,
      retreatRange: 320,
      phaseDuration: 2.2,
      preferredRange: 260,
      predictionLead: 0.35,
      maxPredictionLead: 0.6,
      avoidance: {
        enabled: true,
        lookAhead: 220,
        coneAngle: 2.094395102, // 2π/3 ≈ 120°
        sizeWeightBySize: { small: 0.6, medium: 1, large: 1.4 },
        maxDeflectionAngle: 1.15,
        evasionDriveMultiplier: 0.25,
        evasionSpeedThreshold: 40,
        pressureThreshold: 2.2,
        imperfectionDrop: 0.35,
        panicDistance: 60,
        panicMultiplier: 0.55,
      },
      bulletEvasion: {
        enabled: true,
        detectionRange: 180,
        reactionConeAngle: 3.14159265, // ~180°
        maxDodgeAngle: 0.7,
      },
    },
    bomber: {
      radius: 28,
      speed: 114,
      turnRate: 1.4,
      hp: 7,
      points: 900,
      fireCooldown: 1.2,
      behavior: 'keepDistance',
      preferredRange: 380,
      minRange: 250,
      predictionLead: 0.55,
      maxPredictionLead: 0.9,
      avoidance: {
        enabled: true,
        lookAhead: 140,
        coneAngle: 1.570796327, // π/2 = 90°
        sizeWeightBySize: { small: 0.7, medium: 1, large: 1.3 },
        maxDeflectionAngle: 0.5,
        evasionDriveMultiplier: 0.25,
        evasionSpeedThreshold: 40,
        pressureThreshold: 1.6,
        imperfectionDrop: 0.55,
        panicDistance: 90,
        panicMultiplier: 0.4,
      },
      bulletEvasion: {
        enabled: true,
        detectionRange: 140,
        reactionConeAngle: 2.0943951, // ~120°
        maxDodgeAngle: 0.3,
      },
    },
    enemyBullet: {
      speed: 220,
      life: 2.4,
      radius: 3,
    },
    // A short, independent reaction window lets a gunship clear a normal rock
    // that is genuinely about to hit it. It does not change its normal combat
    // cadence, and special/material asteroids still use their safety logic.
    asteroidDefense: {
      enabled: true,
      triggerTime: 1.30,
      cooldown: 0.20,
    },
    mine: {
      radius: 11,
      triggerRadius: 44,
      explosionRadius: 86,
      life: 12.0,
      armDelay: 0.65,
      effectDuration: 0.5,
    },
    asteroidCollision: {
      damageBySize: {
        small: 1,
        medium: 1,
        large: 2,
      },
      knockbackSpeedBySize: {
        small: 70,
        medium: 150,
        large: 280,
      },
      // Avoid a rapid rebound plus its fragments counting as several full
      // impacts before the knocked-back UFO has space to react.
      hitCooldown: 1.00,
      knockbackDamping: 8,
      maxKnockbackSpeed: 1280,
      separationPadding: 0.5,
      contactReleasePadding: 2,
      spawnClearance: 16,
      spawnAttempts: 24,
    },
  },

  // Game
  game: {
    lives: 3,
    maxLives: 6,          // hard cap from score rewards
    extraLifeEvery: 10000, // score threshold spacing
    fixedStep: 1 / 60,    // seconds
    maxFrameDelta: 0.1,   // clamp deltaTime to avoid spiral of death
    maxSubSteps: 5,       // max fixed steps per frame
  },
};
