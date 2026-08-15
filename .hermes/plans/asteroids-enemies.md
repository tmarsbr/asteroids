# Asteroids — Novos Inimigos e Esquadrões

> **Backlog guardado como checklist.** Cada item vira implementação incremental com testes.

**Goal:** expandir a IA hostil com inimigos que mudam a **tomada de decisão do jogador**, reaproveitando previsão física, campos de efeito e spawn seguro já existentes.

**Architecture:** novos comportamentos (`behavior`) e tipos (`kind`) são adicionados a `src/entities.js`; regras de dano/efeitos especiais vivem em `src/game.js`; balanceamento em `src/config.js`; esquadrões em `DEFAULT_SQUAD_TEMPLATES` em `src/game.js`.

**Tech Stack:** Canvas 2D, ES modules, Node `--test` nativo.

---

## Checklist / Backlog

- [ ] **1 — Interceptor**: behavior `intercept` que calcula ponto de encontro `player.position + player.velocity * t` e vira para lá em alta velocidade.
- [ ] **2 — Interceptor Elite**: dash curto quando `computeBulletEvasionOffset` detecta tiro iminente.
- [ ] **3 — Novos esquadrões com tipos existentes**: Muralha, Caçadores, Cerco, Caos, Enxame.
- [ ] **4 — Shieldbearer**: posiciona-se entre jogador e aliado mais próximo; escudo frontal reduz 80% do dano; tiros por trás causam dano normal.
- [ ] **5 — Splitter**: ao atingir 50% HP, marca `splitPending` e no próximo passo substitui por 2 `splitterSmall` com velocidade herdada.
- [ ] **6 — Disruptor**: emite pulso expansivo a cada poucos segundos; empurra nave, gira levemente sua velocidade e desvia projéteis próximos.
- [ ] **7 — Gravity Drone**: anomalia gravitacional móvel; reusa força de `createGravityAnomaly` e afeta projéteis e asteroides.
- [ ] **8 — Leech**: contato com a nave aplica `leechDrainTime`; durante o efeito reduz cadência de tiro e/ou drena escudo.
- [ ] **9 — Engineer**: repara `base` próxima ou constrói torreta imóvel (mira lenta, tiro a cada 2s).
- [ ] **10 — Phantom**: alpha baixo quando distante; revela brilho ao atacar; reutiliza lógica de proximidade.
- [ ] **11 — Reflector**: reflete tiros do jogador dentro de pequeno ângulo frontal; não reflete tiros aliados.
- [ ] **12 — Chefe modular**: entidade `boss` com módulos independentes (motores, canhões, escudos, núcleo); destruir módulo altera comportamento.

---

## Task 1: Interceptor

**Objective:** adicionar um inimigo que corta a trajetória do jogador em vez de perseguir.

**Files:**
- Modify: `src/config.js` — adicionar entrada `ufo.interceptor`.
- Modify: `src/entities.js` — adicionar `computeInterceptAngle` e roteamento em `updateUfo`.
- Create: `tests/interceptor.test.js` — testa que o interceptor aponta para o ponto de encontro previsto.

**Step 1 — Write failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUfo, updateUfo } from '../src/entities.js';
import { CONFIG } from '../src/config.js';

function rngSeq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('interceptor aims at predicted player position', () => {
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  cfg.ufo.interceptor = {
    radius: 14,
    speed: 300,
    turnRate: 4,
    hp: 4,
    points: 500,
    fireCooldown: 0.8,
    behavior: 'intercept',
    predictionLead: 0.6,
    avoidance: { enabled: false },
    bulletEvasion: { enabled: false },
  };

  const ufo = createUfo('interceptor', 100, 100, cfg, rngSeq([0.5]), 1, 1);
  const ship = { x: 200, y: 100, vx: 100, vy: 0, radius: 14 };

  // one fixed step
  updateUfo(ufo, 1 / 60, ship, cfg, 800, 600, [], [], []);

  const predictedX = ship.x + ship.vx * cfg.ufo.interceptor.predictionLead;
  const expectedAngle = Math.atan2(ship.y - ufo.y, predictedX - ufo.x);
  const diff = Math.abs(expectedAngle - ufo.angle);
  assert.ok(diff < 0.15 || Math.abs(diff - Math.PI * 2) < 0.15, `angle ${ufo.angle} far from ${expectedAngle}`);
});
```

**Step 2 — Run to verify failure**

```bash
cd /tmp/asteroids && npm test -- tests/interceptor.test.js
```
Expected: FAIL — `interceptor` desconhecido ou `behavior` não roteado.

**Step 3 — Write minimal implementation**

Em `src/entities.js`, após `computeKeepDistanceAngle`:

```javascript
function computeInterceptAngle(ufo, ship, balance, w, h) {
  const dx = torusDelta(ufo.x, ship.x, w);
  const dy = torusDelta(ufo.y, ship.y, h);
  const relVx = ship.vx - (ufo.vx ?? 0);
  const relVy = ship.vy - (ufo.vy ?? 0);
  const lead = finiteNonNegative(balance.predictionLead, 0.5);
  const predictedX = wrap(ship.x + relVx * lead, w);
  const predictedY = wrap(ship.y + relVy * lead, h);
  const pdx = torusDelta(ufo.x, predictedX, w);
  const pdy = torusDelta(ufo.y, predictedY, h);
  return Math.atan2(pdy, pdx);
}
```

No roteamento de `updateUfo`, adicionar:

```javascript
} else if (behavior === 'intercept') {
  desiredAngle = computeInterceptAngle(ufo, ship, balance, w, h);
}
```

**Step 4 — Run to verify pass**

```bash
cd /tmp/asteroids && npm test -- tests/interceptor.test.js
```
Expected: PASS.

---

## Task 2: Interceptor Elite

**Objective:** extender `computeBulletEvasionOffset` para dar um pequeno dash lateral quando o tiro é iminente.

**Files:**
- Modify: `src/config.js` — adicionar `ufo.interceptorElite.dash`.
- Modify: `src/entities.js` — detectar janela de dash e aplicar impulso lateral.
- Create: `tests/interceptor-elite.test.js`.

**Step 1 — Write failing test**

```javascript
test('interceptor elite dashes when a bullet is on collision course', () => {
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  cfg.ufo.interceptorElite = {
    radius: 14, speed: 300, turnRate: 4, hp: 4, points: 700,
    fireCooldown: 0.8, behavior: 'intercept',
    predictionLead: 0.5,
    dash: { speed: 420, duration: 0.12, cooldown: 1.0, triggerTime: 0.25 },
    avoidance: { enabled: false },
    bulletEvasion: { enabled: true, detectionRange: 200, maxDodgeAngle: 0.9 },
  };

  const ufo = createUfo('interceptorElite', 100, 100, cfg, () => 0.5, 1, 1);
  const ship = { x: 300, y: 100, vx: 0, vy: 0, radius: 14 };
  const bullet = {
    x: 80, y: 100, vx: 300, vy: 0, radius: 2, life: 1, alive: true, source: 'player',
  };

  const beforeSpeed = Math.hypot(ufo.vx, ufo.vy);
  updateUfo(ufo, 1 / 60, ship, cfg, 800, 600, [], [bullet], []);
  const afterSpeed = Math.hypot(ufo.vx, ufo.vy);

  assert.ok(afterSpeed > beforeSpeed * 1.3, 'dash did not boost speed');
});
```

**Step 2 — Run to verify failure**
Expected: FAIL — nenhum dash implementado.

**Step 3 — Write minimal implementation**

Adicionar a `updateUfo` um campo `dashTime` e, quando a evasão detectar `timeToClosest <= dash.triggerTime`, aplicar impulso perpendicular à ameaça por `dash.duration`.

**Step 4 — Run to verify pass**

---

## Task 3: Novos Esquadrões

**Objective:** adicionar templates `muralha`, `cacadores`, `cerco`, `caos`, `enxame` usando os tipos já existentes e o interceptor recém-criado.

**Files:**
- Modify: `src/game.js` — `DEFAULT_SQUAD_TEMPLATES` para incluir os novos grupos.
- Modify: `src/config.js` — se necessário ajustar spawn de `interceptor`.
- Create: `tests/enemy-squads-new.test.js` — verifica que templates geram a composição esperada.

**Step 1 — Write failing test**

```javascript
test('new squad templates are selectable', () => {
  const game = createGame(CONFIG, () => 0);
  // access internal template via reflection or helper
  const templates = getSquadTemplates(game);
  const names = templates.flatMap(t => t.id);
  assert.ok(names.includes('muralha'));
  assert.ok(names.includes('cacadores'));
});
```

**Step 2 — Run to verify failure**
Expected: FAIL — templates ainda não existem.

**Step 3 — Write minimal implementation**

Adicionar a `DEFAULT_SQUAD_TEMPLATES`:

```javascript
3: [
  ...existing,
  Object.freeze({ id: 'muralha', members: Object.freeze(['shieldbearer', 'bomber', 'bomber']) }),
  Object.freeze({ id: 'cacadores', members: Object.freeze(['interceptor', 'interceptor', 'scout', 'scout']) }),
  Object.freeze({ id: 'cerco', members: Object.freeze(['base', 'engineer', 'engineer', 'fighter']) }),
  Object.freeze({ id: 'caos', members: Object.freeze(['disruptor', 'fighter', 'fighter']) }),
  Object.freeze({ id: 'enxame', members: Object.freeze(['splitter', 'scout', 'scout', 'scout']) }),
],
```

**Step 4 — Run to verify pass**

---

## Task 4: Shieldbearer

**Objective:** criar escudo frontal que protege aliados e exige flanqueamento.

**Files:**
- Modify: `src/config.js` — `ufo.shieldbearer`.
- Modify: `src/entities.js` — IA `moveBetween(player, ally)` e orientação do escudo.
- Modify: `src/game.js` — redução de dano baseada em ângulo frontal.
- Create: `tests/shieldbearer.test.js`.

---

## Task 5: Splitter

**Objective:** dividir em dois inimigos menores ao atingir 50% HP.

**Files:**
- Modify: `src/config.js` — `ufo.splitter` e `ufo.splitterSmall`.
- Modify: `src/entities.js` — estado `splitPending` e função `splitUfo`.
- Modify: `src/game.js` — no dano, verificar limiar e gerar filhos.
- Create: `tests/splitter.test.js`.

---

## Task 6: Disruptor

**Objective:** pulso expansivo que empurra nave, gira velocidade e desvia projéteis.

**Files:**
- Modify: `src/config.js` — `ufo.disruptor`.
- Modify: `src/entities.js` — spawn de `pulse`.
- Modify: `src/game.js` — aplica força radial + torque em projéteis e nave.
- Create: `tests/disruptor.test.js`.

---

## Task 7: Gravity Drone

**Objective:** anomalia gravitacional móvel.

**Files:**
- Modify: `src/config.js` — `ufo.gravityDrone`.
- Modify: `src/entities.js` — entidade `gravityDrone` que se move lentamente.
- Modify: `src/game.js` — reutilizar `applyGravityForce` em projéteis, asteroides e nave.
- Create: `tests/gravity-drone.test.js`.

---

## Task 8: Leech

**Objective:** contato aplica debuff de cadência/escudo.

**Files:**
- Modify: `src/config.js` — `ufo.leech`.
- Modify: `src/entities.js` — IA de perseguir e colar no jogador.
- Modify: `src/game.js` — aplica `leechDrainTime` ao contato; reduz cadência de tiro.
- Create: `tests/leech.test.js`.

---

## Task 9: Engineer

**Objective:** repara bases ou constrói torretas.

**Files:**
- Modify: `src/config.js` — `ufo.engineer`, `ufo.turret`.
- Modify: `src/entities.js` — lógica de repair/build e entidade `turret`.
- Modify: `src/game.js` — gerenciamento de torretas, tiros e reparo.
- Create: `tests/engineer.test.js`.

---

## Task 10: Phantom

**Objective:** invisível quando distante, revela ao atacar.

**Files:**
- Modify: `src/config.js` — `ufo.phantom`.
- Modify: `src/entities.js` — estados de proximidade/ataque.
- Modify: `src/renderer.js` — renderização com alpha variável.
- Create: `tests/phantom.test.js`.

---

## Task 11: Reflector

**Objective:** reflete tiros dentro de pequeno ângulo frontal.

**Files:**
- Modify: `src/config.js` — `ufo.reflector`.
- Modify: `src/game.js` — colisão bullet-UFO calcula ângulo de incidência; inverte velocidade se dentro do cone.
- Create: `tests/reflector.test.js`.

---

## Task 12: Chefe Modular

**Objective:** chefe composto por módulos independentes.

**Files:**
- Modify: `src/config.js` — `ufo.boss`, `ufo.bossModule`.
- Modify: `src/entities.js` — entidade `boss` com sub-módulos e transições de fase.
- Modify: `src/game.js` — dano por módulo, destruição condicional e alteração de comportamento.
- Modify: `src/renderer.js` — desenha módulos vivos.
- Create: `tests/boss.test.js`.

---

## Verificação final

```bash
cd /tmp/asteroids && npm test
```

Expected: todos os testes passam, incluindo os novos.

---

## Riscos e tradeoffs

- `Shieldbearer`, `Reflector` e `Splitter` tocam no pipeline de dano: precisam de testes de colisão cuidadosos para não quebrar os inimigos existentes.
- `Disruptor`, `Gravity Drone` e `Leech` introduzem efeitos de status na nave: devem respeitar `ship.invuln` e `ship.cryoSlowTime`.
- `Engineer` e `Chefe` aumentam a complexidade de gerenciamento de entidades; prefira subsistemas pequenos a generalizações antecipadas.
