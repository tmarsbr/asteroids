# Arquitetura — personalidade dos UFOs (Fase 2)

Status: especificação fechada e pronta para implementação.

Escopo: itens 5, 6 e 7 da Fase 2 de `ideias_combate_inimigos.md`:
- **Scout** flanqueia e orbita o player;
- **Fighter** alterna aproximação e recuo (approach-and-retreat);
- **Bomber** mantém distância e ataca de longe.

Baseline: `npm test` passa com 234 testes após a entrega do desvio de asteroides.

## 1. Objetivo de gameplay

Os UFOs deixam de ser mísseis guiados que só voam na direção do player. Cada tipo adota uma postura de combate distinta, legível e previsível o suficiente para o player contra-jogar:

- **Scout** (verde) — rápido, frágil, orbita em torno do player atirando de flanco. Nunca tenta colisão frontal.
- **Fighter** (vermelho) — médio, entra para disparar uma rajada e recua, reaparecendo em outro ângulo.
- **Bomber** (roxo) — lento, blindado, mantém distância longa e dispara projéteis de área (tiro preditivo).

Os tipos existentes **hunter** e **base** continuam funcionando como antes: hunter voa reto e atira; base voa devagar e planta minas. Eles servem como formas simples que aparecem nas primeiras ondas, enquanto os três novos arquétipos entram gradativamente.

## 2. Decisões fechadas

1. Um novo arquétipo é definido por uma configuração `ufo[kind]` completa, incluindo `preferredRange`, `behavior`, `predictionLead`, `retreatRange`, `orbitRange`, `strafeAngle` e `attackCooldown`.
2. `updateUfo()` continua centralizando o movimento. Após o damping de knockback, calcula a **direção desejada** de acordo com o `behavior` do arquétipo e com a distância toroidal até a nave.
3. A velocidade final é o vetor desejado normalizado multiplicado por `speed * driveMultiplier`, respeitando o `turnRate` e o `preferredRange`.
4. Tiro preditivo é um ajuste no `createEnemyBullet`: para arquétipos com `predictionLead > 0`, o ângulo de disparo é calculado sobre a posição futura da nave (`ship.x + ship.vx * lead`, `ship.y + ship.vy * lead`), truncado pelo `maxPredictionLead`.
5. O Bomber mantém distância: se estiver muito perto, o vetor desejado aponta para longe da nave; se estiver muito longe, aponta para perto, mas nunca dentro do `minRange`.
6. O Fighter alterna aproximação e recuo usando um ciclo interno `approachRetreatPhase` com duração configurada. Na fase de aproximação, voa na direção da nave; na fase de recuo, voa na direção oposta até atingir `retreatRange`.
7. O Scout orbita em um círculo em torno da nave: a direção desejada é tangente à órbita, com sentido determinístico baseado no `id` do UFO (sempre o mesmo durante a vida da entidade), para evitar oscilação.
8. Todos os novos arquétipos herdam as regras existentes: knockback, colisão com asteroides, lentidão por crio, dano por radiação e desvio de asteroides.
9. O spawn continua acontecendo uma vez por onda (a partir da onda de desbloqueio), mas agora escolhe o tipo entre os disponíveis ciclando a lista: hunter, base, scout, fighter, bomber.
10. O renderer desenha cada novo arquétipo com uma silhueta distinta e cores coerentes com o documento de ideias (verde, vermelho, roxo).

## 3. Mudanças de configuração

Adicionar em `CONFIG.ufo`:

```js
scout: {
  radius: 14,
  speed: 155,
  turnRate: 4.0,
  hp: 1,
  points: 300,
  fireCooldown: 0.85,
  behavior: 'orbit',
  orbitRange: 170,
  strafeAngle: Math.PI / 2,
  preferredRange: 170,
  attackCooldown: 0.85,
  predictionLead: 0,
  avoidance: { /* mesma família do hunter, com lookAhead 200 e maxDeflection 1.0 */ },
},
fighter: {
  radius: 18,
  speed: 125,
  turnRate: 3.5,
  hp: 2,
  points: 450,
  fireCooldown: 0.55,
  burstCount: 3,
  burstInterval: 0.18,
  behavior: 'approachRetreat',
  approachRange: 220,
  retreatRange: 320,
  phaseDuration: 2.2,
  preferredRange: 260,
  predictionLead: 0.35,
  maxPredictionLead: 0.6,
  avoidance: { /* igual ao hunter */ },
},
bomber: {
  radius: 28,
  speed: 60,
  turnRate: 1.0,
  hp: 5,
  points: 900,
  fireCooldown: 1.6,
  behavior: 'keepDistance',
  preferredRange: 380,
  minRange: 250,
  predictionLead: 0.55,
  maxPredictionLead: 0.9,
  avoidance: { /* igual à base */ },
},
```

## 4. Mudança em `updateUfo()`

Antes de calcular o heading para a nave, determina a **intenção de movimento** baseada no `behavior`:

```js
const behavior = balance.behavior ?? 'chase';
const range = torusDistance(ufo.x, ufo.y, ship.x, ship.y, w, h);
let desiredAngle;

if (behavior === 'orbit') {
  const orbitDir = (ufo.orbitDirection ?? (ufo.id % 2 === 0 ? 1 : -1));
  desiredAngle = computeOrbitAngle(ufo, ship, range, balance.orbitRange, orbitDir, w, h);
} else if (behavior === 'approachRetreat') {
  desiredAngle = computeApproachRetreatAngle(ufo, ship, range, balance, w, h, dt);
} else if (behavior === 'keepDistance') {
  desiredAngle = computeKeepDistanceAngle(ufo, ship, range, balance, w, h);
} else {
  desiredAngle = Math.atan2(dy, dx);
}

const avoidanceOffset = computeAvoidanceOffset(ufo, asteroids, cfg, w, h);
desiredAngle += avoidanceOffset;
```

Depois aplica o `turnRate` e integra a posição como hoje.

## 5. Tiro preditivo

Em `createEnemyBullet`:

```js
const lead = Math.min(
  balance.maxPredictionLead ?? 0,
  balance.predictionLead ?? 0,
);
let targetX = ship.x;
let targetY = ship.y;
if (lead > 0) {
  targetX = wrap(ship.x + (ship.vx ?? 0) * lead, w);
  targetY = wrap(ship.y + (ship.vy ?? 0) * lead, h);
}
const dx = torusDelta(ufo.x, targetX, w);
const dy = torusDelta(ufo.y, targetY, h);
```

## 6. Spawn

O spawn mantém `unlockWave: 5`, mas escolhe o tipo dentre os cinco disponíveis:

```js
const kinds = ['hunter', 'base', 'scout', 'fighter', 'bomber'];
const kindIndex = (wave - ufoCfg.unlockWave) % kinds.length;
const kind = kinds[kindIndex];
```

O multiplicador de velocidade continua baseado no `appearanceIndex` (quantas vezes qualquer UFO já apareceu), preservando a progressão monotônica dos testes.

## 7. Renderer

- **Scout:** forma pequena e alongada, cor verde (`#69ff69`), glow verde.
- **Fighter:** caçador em formato de seta vermelha (`#ff4d4d`), semelhante ao hunter mas mais angular.
- **Bomber:** disco roxo (`#c56cff`) com detalhes em laranja, parecido com a base mas maior e com marca de bombardeio.

## 8. Testes

Criar `tests/enemy-personality.test.js` com:
- Scout orbita e mantém distância aproximada.
- Fighter alterna aproximação e recuo.
- Bomber mantém `preferredRange`.
- Fighter e Bomber usam tiro preditivo (lead > 0).
- Todos respeitam `turnRate` e knockback.
- Spawn inclui os novos tipos nas ondas esperadas.
