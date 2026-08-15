# Arquitetura — desvio imperfeito de asteroides por UFO

Status: especificação histórica. A implementação atual foi revisada para usar
previsão de colisão, escolha persistente do lado de fuga e tiro defensivo em
asteroides que bloqueiam a rota. Os detalhes abaixo descrevem o primeiro
protótipo de desvio por cone e não devem substituir o comportamento em
`src/entities.js` e `src/game.js`.

Escopo: item 3 da Fase 1 de `ideias_combate_inimigos.md` — UFOs antecipam asteroides à frente e desviam, com eficácia variável por arquétipo e deterioração sob pressão.

Baseline antes da implementação: `npm test` passa com 218 testes.

## 1. Objetivo de gameplay

O campo de asteroides deve influenciar o movimento dos inimigos antes do impacto. O jogador ainda pode conduzir um perseguidor contra uma rocha, mas os UFOs agora reagem a rochas à frente:

- caçadores ágeis desviam com antecedência e mantêm a pressão;
- bases pesadas enxergam menos longe, viram mais devagar e erram o desvio quando há muitas rochas;
- a imperfeição é maior quando o UFO está cercado ou muito próximo de uma rocha;
- asteroides atrás ou muito laterais não provocam desvio;
- knockback físico e slow crio continuam funcionando normalmente.

Isso não é pathfinding completo, nem IA de cobertura: é apenas uma rotação aditiva sobre o heading normal do UFO.

## 2. Decisões fechadas

1. "Desvio" significa alterar o ângulo desejado da IA antes de aplicar o `turnRate`. A entidade física continua obedecendo ao mesmo limite de rotação, velocidade e knockback.
2. Apenas asteroides vivos e dentro de um cone frontal e de um raio `lookAhead` são considerados.
3. A ameaça de cada asteroide depende da distância toroidal, do tamanho da rocha e de quão alinhada ela está com o heading.
4. A direção de desvio preferida é perpendicular ao vetor UFO→asteroide, escolhendo o lado que maximiza a distância futura de miss considerando a velocidade relativa.
5. A magnitude total do desvio é limitada por `maxDeflectionAngle` por tipo.
6. Quando a pressão acumulada (soma das ameaças) passa de `pressureThreshold`, o desvio efetivo é reduzido por `(1 - imperfectionDrop)`.
7. Se a rocha mais próxima estiver abaixo de `panicDistance`, aplica-se uma segunda penalidade de `panicMultiplier` sobre o desvio residual.
8. O resultado é determinístico: não consome RNG, não usa timers por entidade e não armazena estado novo no UFO.
9. Bases têm `lookAhead`, `maxDeflectionAngle` e `pressureThreshold` menores, e `imperfectionDrop`/`panicMultiplier` maiores.
10. O desvio acontece em `updateUfo()`, depois do damping de knockback e antes da composição do drive. O snapshot de colisão física continua capturando a velocidade real integrada.
11. A função de desvio é pura sobre o estado atual; não altera asteroides, não gera efeitos, não pontua.
12. Sem configuração de avoidance (testes antigos), o desvio é zero e o comportamento é idêntico ao baseline.

## 3. Mudanças de configuração

Adicionar dentro de `CONFIG.ufo.hunter` e `CONFIG.ufo.base`:

```js
avoidance: {
  enabled: true,
  lookAhead: 220,
  coneAngle: Math.PI * 2 / 3, // 120° total
  sizeWeightBySize: { small: 0.6, medium: 1.0, large: 1.4 },
  maxDeflectionAngle: 1.15,   // rad
  pressureThreshold: 2.2,
  imperfectionDrop: 0.35,
  panicDistance: 60,
  panicMultiplier: 0.55,
},
```

Para a base:

```js
avoidance: {
  enabled: true,
  lookAhead: 120,
  coneAngle: Math.PI / 2,     // 90° total
  sizeWeightBySize: { small: 0.7, medium: 1.0, large: 1.3 },
  maxDeflectionAngle: 0.55,
  pressureThreshold: 1.4,
  imperfectionDrop: 0.60,
  panicDistance: 80,
  panicMultiplier: 0.45,
},
```

Interpretação:

- `lookAhead` é o raio de sensoriamento à frente do UFO.
- `coneAngle` limita o arco frontal; ângulos fora do cone não geram ameaça.
- `sizeWeightBySize` aumenta a ameaça de rochas grandes sem multiplicar a deflexão angular.
- `maxDeflectionAngle` é o teto absoluto do desvio, mesmo com várias ameaças.
- `pressureThreshold` é o ponto em que a imperfeição começa a reduzir o desvio.
- `imperfectionDrop` é a fração de redução quando a pressão supera o threshold.
- `panicDistance` e `panicMultiplier` penalizam ainda mais quando uma rocha está muito perto.

## 4. Mudança em `updateUfo()`

Após o damping de knockback e antes de compor `driveVx/driveVy`:

```js
const avoidanceOffset = computeAvoidanceOffset(ufo, cfg, w, h);
const desiredAngle = Math.atan2(dy, dx) + avoidanceOffset;
const delta = normalizeAngle(desiredAngle - ufo.angle);
const maxTurn = turnRate * dt;
ufo.angle += Math.max(-maxTurn, Math.min(maxTurn, delta));
```

O `computeAvoidanceOffset` retorna um único número (rad) e é implementado como helper privado em `entities.js`.

## 5. Algoritmo de desvio

Pseudocódigo do helper:

```js
function computeAvoidanceOffset(ufo, cfg, w, h) {
  const balance = cfg.ufo[ufo.kind] ?? cfg.ufo.hunter;
  const avoidance = balance.avoidance;
  if (!avoidance?.enabled) return 0;

  const lookAhead = finiteNonNegative(avoidance.lookAhead, 0);
  const coneHalf = finiteNonNegative(avoidance.coneAngle, 0) / 2;
  const maxDeflection = finiteNonNegative(avoidance.maxDeflectionAngle, 0);
  if (lookAhead <= 0 || maxDeflection <= 0 || coneHalf <= 0) return 0;

  const sizeWeights = avoidance.sizeWeightBySize ?? {};
  let totalThreat = 0;
  let deflectX = 0;
  let deflectY = 0;
  let minSurfaceDistance = Infinity;

  const headingX = Math.cos(ufo.angle);
  const headingY = Math.sin(ufo.angle);

  for (const a of cfg.asteroids ?? []) {  // recebido como parâmetro, não lido de state
    if (!a?.alive) continue;
    const dx = torusDelta(ufo.x, a.x, w);
    const dy = torusDelta(ufo.y, a.y, h);
    const dist = Math.hypot(dx, dy);
    if (dist > lookAhead + a.radius) continue;

    const angleToAsteroid = Math.atan2(dy, dx);
    const angleDiff = normalizeAngle(angleToAsteroid - ufo.angle);
    if (Math.abs(angleDiff) > coneHalf) continue;

    const surfaceDist = Math.max(0, dist - ufo.radius - a.radius);
    if (surfaceDist < minSurfaceDistance) minSurfaceDistance = surfaceDist;

    const sizeWeight = sizeWeights[a.size] ?? 1;
    const coneFactor = Math.max(0, 1 - Math.abs(angleDiff) / coneHalf);
    const distanceFactor = Math.max(0, 1 - dist / lookAhead);
    const threat = sizeWeight * coneFactor * distanceFactor;
    if (threat <= 0) continue;

    totalThreat += threat;

    // Choose perpendicular side that improves future miss distance.
    const relVx = a.vx - ufo.vx;
    const relVy = a.vy - ufo.vy;
    const perpRightX = -dy;
    const perpRightY = dx;
    const perpLeftX = dy;
    const perpLeftY = -dx;
    const dotRight = perpRightX * relVx + perpRightY * relVy;
    const dotLeft = perpLeftX * relVx + perpLeftY * relVy;
    const side = dotRight <= dotLeft ? 1 : -1;
    const perpX = side === 1 ? perpRightX : perpLeftX;
    const perpY = side === 1 ? perpRightY : perpLeftY;
    const len = Math.hypot(perpX, perpY);
    if (len > 0) {
      deflectX += (perpX / len) * threat;
      deflectY += (perpY / len) * threat;
    }
  }

  if (totalThreat <= 0) return 0;
  const deflectLen = Math.hypot(deflectX, deflectY);
  if (deflectLen <= 0) return 0;

  deflectX /= deflectLen;
  deflectY /= deflectLen;

  const targetDeflection = Math.min(maxDeflection, totalThreat * 0.35);
  let effectiveDeflection = targetDeflection;

  const threshold = finiteNonNegative(avoidance.pressureThreshold, Infinity);
  if (totalThreat > threshold) {
    const drop = finiteUnitMultiplier(avoidance.imperfectionDrop);
    effectiveDeflection *= (1 - drop);
  }

  const panicDistance = finiteNonNegative(avoidance.panicDistance, 0);
  const panicMultiplier = finiteUnitMultiplier(avoidance.panicMultiplier);
  if (panicDistance > 0 && minSurfaceDistance < panicDistance) {
    effectiveDeflection *= panicMultiplier;
  }

  const deflectionAngle = Math.atan2(deflectY, deflectX);
  const signedDiff = normalizeAngle(deflectionAngle - ufo.angle);
  const clampedDiff = Math.max(-effectiveDeflection, Math.min(effectiveDeflection, signedDiff));
  return clampedDiff;
}
```

Observações:

- `normalizeAngle` já existe em `entities.js`.
- `finiteNonNegative` e `finiteUnitMultiplier` já existem em `entities.js`.
- `cfg.asteroids` no pseudocódigo será o array passado como argumento (state.asteroids do jogo).

## 6. Chamada em `updateUfoThreats()`

`updateUfo()` passa a receber também o array de asteroides vivos. A assinatura muda de:

```js
export function updateUfo(ufo, dt, ship, cfg, w, h)
```

para:

```js
export function updateUfo(ufo, dt, ship, cfg, w, h, asteroids = [])
```

O parâmetro opcional preserva compatibilidade com testes antigos. O jogo passará `state.asteroids`.

`updateUfoThreats()` chama:

```js
updateUfo(ufo, dt, state.ship, cfg, worldW, worldH, state.asteroids)
```

## 7. Contrato de testes

Criar `tests/enemy-avoidance.test.js`.

### P0 — contrato obrigatório

1. Sem configuração `avoidance`, `updateUfo()` mantém o heading exatamente como no baseline.
2. Um asteroide diretamente à frente de um hunter faz o UFO girar para um lado (direção de maior miss distance) dentro do step.
3. Um asteroide atrás do UFO não altera o heading.
4. Um asteroide fora do cone frontal não altera o heading.
5. A base desvia menos que o hunter para a mesma ameaça.
6. A pressão de três rochas pequenas alinhadas reduz o desvio efetivo (imperfeição sob pressão).
7. Uma rocha dentro de `panicDistance` reduz ainda mais o desvio.
8. O desvio nunca excede `maxDeflectionAngle` configurado.
9. Knockback e slow crio continuam aplicados normalmente sobre o drive resultante.
10. A colisão física ainda funciona: um UFO sem espaço para desviar colide e toma dano.
11. Asteroides mortos ou removidos não influenciam.
12. O snapshot `ufoStarts.driveVx/driveVy` captura o drive exato usado na integração, inclusive com avoidance.

### P1 — robustez

13. Mundo pequeno ou lookAhead grande: rochas do outro lado da seam dentro do cone são consideradas.
14. `turnRate` ainda limita a rotação; o desvio é um alvo, não um salto.
15. A nave como obstáculo nunca entra no cálculo.
16. Configuração ausente/parcial não gera `NaN`.

### Regressão obrigatória

Ao fim:

```bash
npm test
```

Os 218 testes anteriores devem continuar passando, além dos novos.

## 8. Arquivos afetados

- `src/config.js`: adicionar `avoidance` em `ufo.hunter` e `ufo.base`.
- `src/entities.js`: implementar `computeAvoidanceOffset`; alterar `updateUfo` para receber asteroids e aplicar o desvio.
- `src/game.js`: passar `state.asteroids` para `updateUfo`.
- `tests/enemy-avoidance.test.js`: novo arquivo.
- `README.md`: atualizar descrição de IA inimiga após aprovação.

## 9. Critérios de aceitação

- [ ] Hunter desvia mais e mais cedo que a base.
- [ ] Asteroides atrás ou fora do cone não afetam o movimento.
- [ ] Pressão alta reduz a eficácia do desvio.
- [ ] Proximidade extrema (`panicDistance`) reduz ainda mais.
- [ ] Knockback, slow e colisão física permanecem inalterados.
- [ ] Determinístico e sem RNG adicional.
- [ ] Testes antigos continuam passando.
- [ ] Novos testes cobrem contrato P0 e P1.
