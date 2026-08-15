# Arquitetura — explosão, gelo e radiação afetam inimigos

Status: especificação fechada e pronta para implementação.

Escopo: item 2 da Fase 1 de `ideias_combate_inimigos.md` — explosões de asteroides magma causam dano em UFOs, nuvens crio reduzem seu movimento e sua cadência de ataque, e campos radioativos causam dano ao longo do tempo.

Baseline antes da implementação: `npm test` passa com 188 testes.

## 1. Objetivo de gameplay

Os UFOs devem habitar o mesmo campo tático que o jogador. Depois desta entrega, o jogador poderá:

- destruir um asteroide magma perto de um UFO para causar dano em área;
- quebrar um asteroide crio e conduzir o UFO pela nuvem para reduzir sua perseguição e seus ataques;
- destruir um novo asteroide radioativo e usar o campo residual como uma zona de dano prolongado;
- combinar esses efeitos com a colisão física do item 1 sem duplicar dano, score ou estados.

Os três efeitos precisam ser legíveis, toroidais, determinísticos e independentes do FPS de renderização. Eles não formam um sistema genérico de buffs/debuffs: são três regras pequenas integradas à arquitetura atual.

## 2. Lacuna real encontrada no repositório

O texto de ideias está à frente da implementação em um ponto importante:

| Efeito | Existe para o jogador? | Existe para UFOs? | Fonte atual |
|---|---:|---:|---|
| Explosão magma | Sim | Não | `destroyAsteroids()` |
| Nuvem crio | Sim, reduz rotação | Não | `iceClouds` |
| Radiação/veneno | Não | Não | Inexistente |

Hoje só existem os materiais `magma`, `cryo` e `crystal`. Cristal é um material resistente que solta Data Node; gravidade é uma anomalia física. Nenhum dos dois deve ser renomeado ou reinterpretado como radiação.

Para que o item 2 seja alcançável no jogo, esta entrega também introduz:

- o material de asteroide `radioactive`;
- um campo radioativo estacionário criado quando esse asteroide é destruído;
- o estado de exposição e o DoT dos UFOs;
- a apresentação visual mínima dessa nova fonte.

A frase “mesmo veneno do player” em `ideias_combate_inimigos.md` é aspiracional, não uma descrição do código atual. Radiação na nave fica fora desta entrega: a nave usa vidas e respawn, não HP, e adaptar ticks de veneno a esse modelo exige uma decisão própria de balanceamento e spawn seguro. Esta fase não deve fingir essa paridade nem alterar silenciosamente as vidas do jogador.

## 3. Decisões fechadas

1. “Inimigos” significa somente os UFOs vivos de `state.ufos`: hunter e base.
2. Tiros inimigos e minas já lançados não recebem slow, dano ou desvio nesta fase.
3. “Explosão” significa exclusivamente a explosão de um asteroide `magma`. Bomba de hiperespaço, EMP e mina inimiga não causam dano **direto** a UFOs; bomba/EMP/beam ainda podem destruir um magma e causar dano indireto pela regra normal desse material.
4. Cada explosão magma distinta causa 2 de dano a cada UFO dentro do raio. Um hunter morre; uma base perde metade do HP.
5. Explosões distintas de uma mesma cascata podem atingir o mesmo sobrevivente. O mesmo blast nunca o atinge duas vezes.
6. A explosão não aplica knockback. Empurrar tudo ao redor pertence ao item “Battlefield Dinâmico”, não a esta fase.
7. O slow crio reduz somente a velocidade de drive da IA e a taxa de avanço do relógio de ataque. Não reduz `turnRate`, knockback, damping, velocidade de projéteis nem velocidade de minas já existentes.
8. O hunter dispara mais devagar; a base instala minas mais devagar. Um ataque que já estava pronto ainda pode ocorrer.
9. Nuvens crio sobrepostas renovam a duração pelo maior valor; não multiplicam o slow.
10. O novo asteroide `radioactive` deixa um campo quando é destruído. Colidir com seu casco ainda usa apenas a regra física por tamanho do item 1.
11. O campo radioativo contamina por contato. A exposição continua depois da saída e causa 1 de dano a cada 0,8 s.
12. Campos radioativos sobrepostos não acumulam DPS. Renovar a exposição não reinicia o relógio do próximo tick.
13. Um contato novo nunca causa dano instantâneo; o primeiro tick exige um intervalo completo.
14. Ofensivas do jogador continuam tendo prioridade dentro do fixed step. Depois delas vêm ticks antigos, a colisão sólida UFO–asteroide e, por fim, novos contatos varridos sobre os segmentos físicos realmente resolvidos.
15. Todos os danos usam `damageUfo()`. Mortes ambientais concedem os pontos normais do UFO, respeitam o multiplicador já armado e não alteram a precisão.
16. Campos criados durante um step só passam a afetar entidades no próximo step e começam com sua vida configurada completa.
17. Nuvens de gelo e campos radioativos podem persistir na troca de onda. O spawn do UFO não evita esses campos; uma zona residual pode ser usada taticamente contra o próximo inimigo.
18. Pausa congela timers, campos e DoT. Restart remove tudo. Resize apenas canonicaliza posições.
19. Configurações de teste antigas sem as novas propriedades recebem fallback neutro e não produzem `NaN`.

## 4. Diagnóstico da arquitetura atual

O projeto usa factories e objetos mutáveis dentro do closure de `createGame()`. A divisão deve ser preservada:

| Responsabilidade | Local atual | Mudança desta fase |
|---|---|---|
| Balanceamento | `src/config.js` | dano magma, slow crio e material radioativo |
| Estado/movimento das entidades | `src/entities.js` | timers do UFO e factory/update do campo radioativo |
| Dano, cascatas, ordem e lifecycle | `src/game.js` | aplicar os três efeitos e manter snapshots temporais |
| Geometria toroidal | `src/math.js` | reutilizar; nenhuma alteração necessária |
| Feedback visual | `src/renderer.js` | material/campo radioativo e overlays de status no UFO |

Pontos relevantes no baseline:

- `unlockedAsteroidKinds()`: `src/game.js:355` — lista de materiais hard-coded.
- `updateUfoThreats()`: `src/game.js:1036` — movimento e relógios de tiro/mina.
- `destroyAsteroids()`: `src/game.js:1075` — única rota de destruição, fragmentação, magma e crio.
- `damageUfo()`: `src/game.js:1209` — única rota correta de HP, score e remoção.
- `handleIceCloudContact()`: `src/game.js:1431` — hoje considera apenas a nave.
- `handleUfoAsteroidCollisions()`: região iniciada em `src/game.js:1507`.
- `createIceCloud()`: `src/entities.js:267`.
- `createUfo()` e `updateUfo()`: `src/entities.js:325` e `src/entities.js:363`.
- desenho dos UFOs: `src/renderer.js:645`.
- lista/paletas de asteroides: `src/renderer.js:906`.

O fluxo atual que importa é:

```text
updateUfoThreats move o UFO e permite tiro/mina
        ↓
projéteis do jogador → bomba → beam
        ↓
colisão UFO–asteroide
        ↓
contato da nave com gelo
```

Essa ordem impede aplicar retroativamente um slow ao movimento que já aconteceu. Um contato ambiental detectado neste step começa a influenciar movimento e ataque no step seguinte.

## 5. Contrato de configuração

### 5.1 Materiais

Alterar `CONFIG.asteroid`:

```js
typeUnlockWave: {
  magma: 2,
  cryo: 3,
  crystal: 4,
  radioactive: 5,
},

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
    // contrato atual, sem mudança
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
```

Interpretação dos valores:

- `ufoDamage: 2` faz um único magma eliminar um hunter e exige dois blasts para eliminar uma base intacta.
- `ufoDriveMultiplier: 0.55` afeta apenas o drive comandado pela IA. Nos valores-base, uma base passa de 52 para 28,6 px/s e um hunter de 125 para 68,75 px/s; o multiplicador de aparição já embutido em `ufo.speed` continua valendo antes do slow.
- `ufoActionRateMultiplier: 0.50` faz os relógios de tiro e mina avançarem à metade da taxa enquanto o efeito estiver ativo.
- uma exposição radioativa breve pode gerar ticks em 0,8 s, 1,6 s e 2,4 s; ela mata um hunter, mas deixa uma base intacta com 1 HP;
- permanência contínua no campo mata uma base no quarto tick, após 3,2 s;
- o quarto material estreia na onda 5, junto do primeiro hunter, para que a mecânica seja demonstrável assim que existem alvos.

Os nomes são explícitos sobre o alvo porque radiação na nave não faz parte deste incremento. Não reutilizar `rotationMultiplier` para UFO: rotação da nave e velocidade linear do inimigo são grandezas diferentes.

### 5.2 Invariantes defensivos

- multiplicadores ausentes ou não finitos usam `1`;
- multiplicadores válidos são limitados ao intervalo `[0, 1]`;
- danos ausentes ou não finitos usam `0`;
- somente `tickInterval` finito e maior que zero habilita ticks; qualquer outro valor desabilita dano sem entrar em loop;
- durações e raios são tratados como não negativos;
- não espalhar esses números como literais por `game.js` ou `renderer.js`.

Resolver esses valores com pequenos normalizadores (`finiteUnitMultiplier`, `finiteNonNegative` ou equivalentes) antes dos cálculos. Não confiar apenas em `??`: `NaN ?? fallback` continua sendo `NaN`. Os pseudocódigos abaixo usam nomes como `driveMultiplier`, `actionRateMultiplier`, `slowDuration`, `tickInterval` e `damagePerTick` já sanitizados.

## 6. Modelo das entidades

### 6.1 Estado novo em todo UFO

Adicionar em `createUfo()`:

```js
cryoSlowTime: 0,
radiationTime: 0,
radiationTickAccumulator: 0,
```

Esses campos pertencem à entidade porque persistem entre fixed steps, precisam congelar durante pausa, são úteis ao renderer e desaparecem naturalmente quando o UFO é removido.

Não guardar referências aos campos ambientais no UFO. Contato apenas renova estado temporal; assim a destruição/expiração de um campo não exige cleanup de referências.

### 6.2 Campo radioativo

Adicionar em `src/entities.js`:

```js
createRadiationField(asteroid, cfg)
updateRadiationField(field, dt)
```

Contrato da factory:

```js
{
  kind: 'radiationField',
  x: asteroid.x,
  y: asteroid.y,
  vx: 0,
  vy: 0,
  radius: radioactive.fieldRadius,
  visualRadius: radioactive.fieldRadius + 16,
  life: radioactive.fieldLife,
  lifeTotal: radioactive.fieldLife,
  exposureDuration: radioactive.exposureDuration,
  angle: asteroid.angle ?? 0,
  alive: true,
}
```

O update gira lentamente para apresentação, subtrai `dt` de `life` e marca `alive = false` ao expirar. O campo não se move, não colide como sólido, não bloqueia tiros e não recebe dano.

A factory grava apenas raio, vida e duração de exposição finitos/não negativos. Valor inválido vira zero; um campo com vida zero pode ser criado para manter a rota determinística de efeitos, mas nunca é elegível para contato e é removido no update ambiental.

### 6.3 Slow crio no movimento

Não alterar `ufo.speed`. Esse campo continua sendo a velocidade-base já escalada pela aparição da wave.

Fechar o ownership em uma única rota: dentro de `src/entities.js`, um helper privado como `resolveUfoCryoStep(ufo, dt, cfg)` calcula uma vez os dois multiplicadores e o tempo residual. `updateUfo()` chama esse helper, aplica o drive, grava `remainingTime` e retorna `{ actionRateMultiplier }`. Callers antigos podem ignorar o retorno; `updateUfoThreats()` deve consumi-lo para os relógios de ataque. Não recalcular nem reduzir o timer em `game.js`.

Para evitar que uma expiração no meio de um `dt` grande aplique slow durante tempo demais, o helper calcula a fração efetivamente lenta do step:

```js
const timeAtStart = finiteNonNegative(ufo.cryoSlowTime, 0);
const duration = finiteNonNegative(dt, 0);
const slowFraction = duration > 0
  ? Math.min(timeAtStart, duration) / duration
  : (timeAtStart > 0 ? 1 : 0);

const driveMultiplier = 1
  - slowFraction * (1 - resolvedDriveMultiplier);
const actionRateMultiplier = 1
  - slowFraction * (1 - resolvedActionMultiplier);

return {
  driveMultiplier,
  actionRateMultiplier,
  remainingTime: Math.max(0, timeAtStart - duration),
};
```

`updateUfo()` usa `driveMultiplier` somente no canal da IA:

```text
drive = direção × ufo.speed × driveMultiplier
total = drive + knockback
```

O knockback do item 1 não é multiplicado. Damping e `asteroidHitCooldown` continuam com a ordem atual. A velocidade total gravada em `ufo.vx/vy` continua sendo exatamente a velocidade usada na integração e no snapshot de colisão.

Depois da integração, `updateUfo()` grava uma única vez:

```js
ufo.cryoSlowTime = cryoStep.remainingTime;
return { actionRateMultiplier: cryoStep.actionRateMultiplier };
```

Em `updateUfoThreats()`:

```js
const { actionRateMultiplier = 1 } = updateUfo(
  ufo, dt, state.ship, cfg, worldW, worldH,
) ?? {};
```

Assim, movimento e ação necessariamente usam a mesma amostra temporal, e `cryoSlowTime` nunca é consumido duas vezes.

Aplicação aos relógios:

```js
ufo.fireTimer = Math.max(
  0,
  ufo.fireTimer - dt * actionRateMultiplier,
);

ufo.mineTimer = Math.max(
  0,
  ufo.mineTimer - dt * actionRateMultiplier,
);
```

Se o timer já era zero no começo do step, o UFO ainda age. Depois da ação, rearmar com o cooldown normal da configuração. Não multiplicar o cooldown ao gravá-lo; a taxa reduzida já produz o intervalo real maior.

## 7. Explosão magma contra UFOs

### 7.1 Helper radial privado

Criar dentro de `createGame()` um helper privado conceitual:

```js
damageUfosInRadius(x, y, radius, amount, impactTime = null)
```

Regras:

1. iterar uma cópia estável e deduplicada por identidade de `state.ufos`, por exemplo `[...new Set(state.ufos)]`;
2. considerar somente UFO vivo e ainda presente no array;
3. usar `torusDistance(...) <= radius + ufo.radius`;
4. tangência conta como hit;
5. chamar `damageUfo()` no máximo uma vez por UFO nessa invocação;
6. não alterar diretamente HP, `alive`, arrays, score ou precisão;
7. não consumir RNG;
8. retornar opcionalmente o conjunto atingido apenas se isso ajudar testes/legibilidade.

Normalizar dentro do helper, não apenas no chamador:

- `amount` precisa ser finito e estritamente positivo; caso contrário, retornar sem consultar alvos nem chamar `damageUfo()`;
- `radius` precisa ser finito e não negativo; valor inválido retorna sem atingir ninguém;
- `radius === 0` continua sendo um blast pontual e usa a extensão do círculo do UFO.

A implementação atual de `damageUfo()` produz feedback de hit mesmo para dano zero e pode propagar `NaN`, portanto usar `magma.ufoDamage ?? 0` como único guard não é suficiente.

Não criar um `Set` global de UFOs atingidos pela cascata. Cada asteroide magma processado é um blast físico distinto e pode atingir novamente uma base sobrevivente.

### 7.2 Integração em `destroyAsteroids()`

No ramo já existente de `asteroid.kind === 'magma'`, chamar o helper uma vez, com o mesmo centro e raio usados pelo efeito visual e pela nave:

```js
damageUfosInRadius(
  asteroid.x,
  asteroid.y,
  magma.explosionRadius,
  magma.ufoDamage,
  destructionTime,
);
```

Usar as posições canônicas atuais, como a explosão já faz para nave e asteroides. Não introduzir sweep para uma explosão instantânea e não refatorar nesta fase a posição histórica do impacto.

Consequências intencionais:

- um magma destruído por tiro, drone, beam, EMP, bomba ou outra explosão atinge UFOs;
- fragmentos criados por essa destruição não participam da cascata atual;
- quando um fragmento magma for destruído depois, ele produzirá seu próprio blast;
- UFOs nunca entram em `chainVictims` e não contam para o bônus `CHAIN REACTION!`;
- dano no UFO não altera fragmentação, drops, HP cristalino ou score dos asteroides;
- a explosão ainda cobra no máximo uma vida da nave por invocação/fila de `destroyAsteroids()`, conforme o booleano agregado do contrato existente. Uma chamada com várias raízes diretas também cobra no máximo uma.

Se a mesma fila também causar `GAME_OVER`, os efeitos pertencentes à própria fila de explosão são resolvidos antes do `damageShip()` final, como acontece hoje com score, fragmentação e drops. Depois disso, somente os novos handlers de tick/contato e `handleUfoAsteroidCollisions()` têm garantia de no-op por status. Não afirmar que todo o restante do update é abortado: o loop atual ainda pode terminar eventos de projéteis, bomba ou beam sem barreiras globais entre todas as fases.

## 8. Snapshots de campos e contato

### 8.1 Por que snapshots são obrigatórios

Hoje um asteroide crio destruído durante o step adiciona sua nuvem imediatamente a `state.iceClouds`. Varrer o caminho completo do UFO contra essa nuvem nova permitiria um contato retroativo: o UFO poderia ter cruzado o ponto antes de a nuvem nascer.

No começo de `update()`, antes de EMP e demais habilidades, capturar:

```js
const iceCloudStarts = state.iceClouds.map(entity => ({
  entity,
  x: entity.x,
  y: entity.y,
  radius: entity.radius,
  life: entity.life,
  alive: entity.alive,
  slowDuration: entity.slowDuration,
}));

const radiationFieldStarts = state.radiationFields.map(entity => ({
  entity,
  x: entity.x,
  y: entity.y,
  radius: entity.radius,
  life: entity.life,
  alive: entity.alive,
  exposureDuration: entity.exposureDuration,
}));
```

Somente entidades desses snapshots:

- envelhecem durante o step;
- podem aplicar contato durante o step.

Assim, campos criados por EMP no começo ou por tiros/bomba/beam depois não envelhecem imediatamente e conservam sua vida cheia para o próximo step.

### 8.2 Janela de contato

Um snapshot é elegível somente quando `fieldStart.alive === true` e sua `life` sanitizada é estritamente maior que zero. Para cada snapshot elegível:

```js
const startLife = finiteNonNegative(fieldStart.life, 0);
if (fieldStart.alive !== true || startLife <= 0) continue;
const availableTime = Math.min(finiteNonNegative(dt, 0), startLife);
```

Não varrer `ufoStarts.vx/vy` pelo `dt` inteiro antes da física sólida. O handler do item 1 pode encontrar uma colisão em `hitTime`, descartar o trecho originalmente integrado depois dela e reintegrar o UFO com novo knockback. A reta irrestrita produziria contatos com zonas que o UFO nunca alcançou e perderia zonas alcançadas depois do rebote.

Fazer `handleUfoAsteroidCollisions()` produzir um trace local por UFO sobrevivente, sem colocá-lo em `state`:

```js
{
  segments: [
    { startTime, duration, x, y, vx, vy },
    // zero, um ou dois segmentos lineares
  ],
  endpoint: { x: ufo.x, y: ufo.y, time: dt },
}
```

Contrato do trace:

- sem colisão sólida: um segmento de `t = 0` a `t = dt` com o movimento integrado;
- com colisão e sobrevivência: primeiro segmento do início até `hitTime`; segundo segmento da posição separada de contato até `dt`, usando `drive + knockback` pós-impacto;
- a pequena separação instantânea pertence ao início do segundo segmento;
- o endpoint é capturado depois de `geometricEndpointCleanup()`;
- projeções da limpeza não são uma trajetória varrida; apenas seu endpoint final conta em `t = dt`;
- UFO morto por ofensiva, tick ou impacto não possui trace elegível e não recebe status;
- quando não há configuração de colisão do item 1, o trace simples de um segmento continua sendo produzido.

Para evitar reconstrução duplicada, alterar o retorno privado de `resolveUfoAsteroidImpact()` de booleano para um resultado como `{ killed, contactX, contactY, postVx, postVy }`. `handleUfoAsteroidCollisions()` usa esses valores já resolvidos para montar o segundo segmento; nenhum deles entra no estado público.

Para cada segmento, intersectar sua janela `[startTime, startTime + duration]` com `[0, availableTime]`. Recalcular a posição no começo da interseção e então usar `sweptCircleCollisionTime()` contra o campo estacionário apenas pela duração recortada. Testar também o `endpoint` quando `availableTime >= dt`.

A função de sweep cobre:

- sobreposição inicial;
- `dt === 0`;
- tangência;
- travessia rápida;
- seams e múltiplos wraps.

Com `dt === 0`, um snapshot de vida positiva ainda pode armar status por sobreposição em `t = 0`. Um snapshot com `life <= 0` nunca arma status, mesmo que sua geometria sobreponha o UFO.

Usar exclusivamente `fieldStart.x/y/radius/life` na geometria. Não exigir que `fieldStart.entity.alive` ainda seja verdadeiro nem que a entidade continue no array depois de `updateEnvironmentalHazards()`: um campo que expirou no meio do step continua válido até `availableTime`.

Executar o contato **depois** de `handleUfoAsteroidCollisions()`, consumindo o trace retornado. Isso preserva a trajetória física do item 1 sem dar efeito retroativo: contato novo continua apenas armando status para steps futuros.

### 8.3 Aplicação dos estados

Crio:

```js
ufo.cryoSlowTime = Math.max(
  finiteNonNegative(ufo.cryoSlowTime, 0),
  resolvedSlowDurationFromSnapshot,
);
```

Radiação:

```js
const currentRadiationTime = finiteNonNegative(ufo.radiationTime, 0);
const wasExposed = currentRadiationTime > 0;
ufo.radiationTime = Math.max(
  currentRadiationTime,
  resolvedExposureDurationFromSnapshot,
);
if (!wasExposed && ufo.radiationTime > 0) {
  ufo.radiationTickAccumulator = 0;
}
```

`resolvedSlowDurationFromSnapshot` e `resolvedExposureDurationFromSnapshot` usam os valores congelados do snapshot, com fallback configurado e sanitização finita/não negativa; não leem a entidade mutada depois do aging. Mais de um campo no mesmo step apenas toma o maior tempo. Se o UFO já estava exposto, preservar o acumulador; contato contínuo não adia artificialmente o próximo tick.

Filtrar UFOs mortos ou removidos por uma fase anterior. Não criar `ufoHit` ao armar um status.

O refresh é deliberadamente pós-movimento. Se um teste chamar `update()` com um `dt` maior que todo o status restante, estar dentro do campo não estende retroativamente a porção lenta daquele mesmo step; o contato rearma o próximo. Essa causalidade é estável no runtime de fixed steps, mas um step grande com contato contínuo não precisa ser equivalente a vários steps pequenos. Não adicionar uma pré-passagem de overlap nem prometer invariância de partição para esse caso.

### 8.4 Ajuste no contato crio da nave

Alterar `handleIceCloudContact()` para consumir `iceCloudStarts` e a mesma `availableTime`. Isso preserva a regra atual da nave, elimina contato retroativo com nuvens recém-criadas e permite detectar contato com uma nuvem que expirou durante o step.

O balanceamento da nave não muda: continua sendo `rotationMultiplier: 0.42` e `slowDuration: 1.8`.

## 9. Dano radioativo ao longo do tempo

Criar um handler privado, por exemplo:

```js
handleUfoRadiationTicks(dt)
```

Ele processa apenas a exposição que já existia no começo do step. Novos contatos são armados depois e não podem gerar tick imediato.

Para cada UFO vivo:

1. capturar `timeAtStart = finiteNonNegative(radiationTime, 0)`;
2. calcular `duration = finiteNonNegative(dt, 0)` e `activeTime = min(duration, timeAtStart)`;
3. somar `activeTime` ao acumulador em segmentos até cada fronteira de `tickInterval`;
4. em cada fronteira, chamar `damageUfo(ufo, ufoDamagePerTick, hitTime)`;
5. parar imediatamente se o UFO morrer;
6. gravar `radiationTime = max(0, timeAtStart - dt)`;
7. quando o tempo chegar a zero, zerar qualquer acumulador parcial;
8. só depois o handler de contato pode iniciar/renovar uma exposição.

Pseudocódigo conceitual:

```js
let remaining = activeTime;
let elapsed = 0;
let accumulator = finiteNonNegative(ufo.radiationTickAccumulator, 0);

while (ufo.alive && accumulator + remaining + EPSILON >= tickInterval) {
  const untilTick = Math.max(0, tickInterval - accumulator);
  elapsed += untilTick;
  remaining = Math.max(0, remaining - untilTick);
  accumulator = 0;
  damageUfo(ufo, damagePerTick, elapsed);
}

if (ufo.alive) {
  accumulator += remaining;
  ufo.radiationTime = Math.max(0, timeAtStart - duration);
  ufo.radiationTickAccumulator = ufo.radiationTime > 0
    ? Math.min(accumulator, tickInterval)
    : 0;
}
```

A implementação real precisa validar antes do `while`:

```js
const validTickInterval = Number.isFinite(rawTickInterval)
  && rawTickInterval > 0;
const validDamage = Number.isFinite(rawDamage) && rawDamage > 0;
```

Se qualquer condição falhar, não chamar `damageUfo()`: reduzir `radiationTime` pelo `dt` sanitizado, zerar `radiationTickAccumulator` e encerrar de forma finita. Isso também evita `ufoHit` falso com dano zero. `undefined` e `NaN` não podem chegar a `Math.min()` nem ser persistidos. Usar epsilon somente na comparação de fronteira; nunca somá-lo ao acumulador persistente.

Esse contrato garante:

- primeiro tick somente após 0,8 s acumulados;
- nenhum tick perdido em `dt` grande;
- para uma exposição já armada e sem contato/refresh durante a janela, resultado equivalente entre um update grande e vários menores;
- tick exatamente na expiração é válido;
- uma exposição encerrada descarta fração parcial;
- recontaminação posterior começa um relógio novo;
- nenhum dano pós-morte.

## 10. Ordem no loop do jogo

Ordem proposta:

```js
// No começo do step, antes das habilidades:
const iceCloudStarts = snapshotIceClouds();
const radiationFieldStarts = snapshotRadiationFields();

// Ordem existente de input, movimento e ameaças:
activateAbilities();
integratePlayerProjectilesAndAsteroids();
updateEnvironmentalHazards(iceCloudStarts, radiationFieldStarts, dt);
updateUfoThreats(dt);
captureRealUfoVelocities();

// Resolução:
handlePlayerProjectileCollisions(...);
updateBombs(dt);
if (beamFiring) updateBeam(true);

// Novo bloco ambiental do inimigo:
handleUfoRadiationTicks(dt);

// A física sólida reconstrói e devolve os segmentos reais:
const ufoMotionTraces = handleUfoAsteroidCollisions(
  ufoStarts,
  asteroidStarts,
  dt,
);

// Contato novo só arma status para o futuro:
handleUfoEnvironmentalFieldContacts(
  ufoMotionTraces,
  iceCloudStarts,
  radiationFieldStarts,
  dt,
);

// Demais contatos:
handleDataNodePickups(...);
handleIceCloudContact(iceCloudStarts, shipStart, dt);
handleEnemyBulletCollisions(...);
handleMineCollisions();
handleShipSolidCollisions();
```

`updateEnvironmentalHazards()` pode continuar atualizando anomalias normalmente. Para nuvens/campos, deve iterar os snapshots iniciais, não as coleções atuais que podem conter entidades recém-criadas.

Consequências intencionais:

- ticks radioativos e explosões disparadas por projétil, bomba ou beam acontecem depois de `updateUfoThreats()`, portanto o UFO pode ter se movido e agido antes de morrer;
- uma cascata magma iniciada pelo EMP acontece na fase antecipada de habilidades e pode matar o UFO antes do movimento/ataque; essa diferença já pertence à ordem atual das fontes e não deve ser escondida;
- um projétil/beam que mata o UFO impede tick, contato e colisão posteriores;
- um hit manual não letal pode armar o multiplicador usado por uma morte radioativa posterior no mesmo step;
- magma é aplicado dentro de `destroyAsteroids()`, portanto acontece na fase que destruiu a rocha;
- radiação antiga vence a colisão sólida se ambas seriam letais no mesmo step;
- uma colisão sólida letal impede armar gelo/radiação; um sobrevivente testa somente os segmentos pré-impacto e pós-knockback realmente resolvidos;
- contato novo apenas arma o estado para o futuro;
- se uma fase anterior mudar `state.status`, `handleUfoRadiationTicks()`, o novo handler de contatos e `handleUfoAsteroidCollisions()` usam guard e não mutam estado; isso não promete abortar outros handlers antigos sem guard.

Matriz causal do magma:

| Gatilho que destrói a raiz | Momento em relação ao UFO | Magmas encadeados |
|---|---|---|
| EMP | Antes de movimento e ataque | Resolvidos sincronamente na mesma fila antecipada |
| Projétil do jogador | Depois de movimento e ataque | Resolvidos sincronamente na fila daquele impacto |
| Bomba de hiperespaço | Depois de movimento e ataque | Resolvidos sincronamente na fila da bomba |
| Beam | Depois de movimento e ataque | Resolvidos sincronamente na fila do pulso |
| Outro magma | Herda o momento da raiz acima | Continua na mesma fila, sem nova fase |

## 11. Score, precisão e causalidade

Reutilizar `damageUfo()` é obrigatório.

Política:

- morte por magma ou radiação concede `ufo.points` uma vez;
- o multiplicador vigente no instante da chamada é aplicado;
- combo, `bestCombo` e multiplicador não são alterados por dano ambiental;
- dano não letal cria um `ufoHit` normal;
- morte cria um único `ufoDestroy` e atualiza high score pela rota existente;
- slow crio não pontua;
- um UFO atingido por explosão nunca conta como vítima da reação magma;
- um UFO morto não recebe ticks, impactos ou status posteriores.

Caso de ordem que deve permanecer:

- quando um projétil manual destrói um magma, `destroyAsteroids()` resolve score, cascata e dano do blast antes de `resolveAccuracyHit()` daquele projétil. A cascata respeita o multiplicador vigente naquele evento — que pode ter sido armado por um evento anterior — e não o multiplicador que o próprio projétil destruidor só armará depois;
- quando um tiro manual acerta o próprio UFO sem matar, `resolveAccuracyHit()` termina antes do handler radioativo; uma morte por DoT depois usa o multiplicador recém-armado.

Não adicionar `cause`, `owner` ou um sistema de assistências a `damageUfo()` nesta fase.

## 12. Material radioativo e waves

Atualizar a lista de `unlockedAsteroidKinds()` para:

```js
['magma', 'cryo', 'crystal', 'radioactive']
```

A fórmula determinística atual já introduz o novo quarto material na onda 5 quando `guaranteedSpecialsPerWave >= 1`. Não consumir RNG adicional para escolher material.

Em `destroyAsteroids()`:

```js
if (asteroid.kind === 'radioactive' && radioactiveCfg) {
  state.radiationFields.push(createRadiationField(asteroid, cfg));
  addEffect(
    'radiationBurst',
    asteroid.x,
    asteroid.y,
    radioactiveCfg.effectDuration,
    radioactiveCfg.fieldRadius,
  );
}
```

Como `createAsteroid()` já obtém HP por material e os filhos já herdam `asteroid.kind`, não duplicar lógica de fragmentação. Cada membro da família radioativa cria seu próprio campo apenas quando for destruído.

Uma explosão magma pode destruir um radioativo e criar o campo; o campo não contamina ninguém até o fixed step seguinte.

## 13. Lifecycle

### Estado público

Adicionar `radiationFields: []` ao estado inicial.

### Pausa

O guard já existente de `update()` garante que não avançam:

- `cryoSlowTime` do UFO;
- `radiationTime`;
- `radiationTickAccumulator`;
- `life`/`angle` das nuvens e campos;
- relógios de ataque.

### Resize

Canonicalizar `x/y` de todos os `radiationFields`, como já ocorre com `iceClouds`. Não alterar vida, exposição dos UFOs, acumuladores ou raios.

### Restart/start

`resetThreatSystems()` deve limpar `radiationFields`; UFOs novos começam com todos os timers zerados. High score continua preservado pelo contrato atual.

### Troca de wave

`spawnWave()` não limpa `iceClouds` nem `radiationFields`. Ambos terminam de dissipar naturalmente. UFO, tiros inimigos, minas e anomalias continuam restritos à wave conforme a regra atual.

Um UFO novo pode nascer dentro de um campo residual. Isso não é falha de spawn: no primeiro update elegível o contato arma exposição/slow, sem dano instantâneo.

## 14. Feedback visual mínimo

### Asteroide radioativo

Adicionar `radioactive` à lista reconhecida por `drawAsteroid()`:

- contorno verde-limão;
- preenchimento verde escuro translúcido;
- brilho esverdeado;
- detalhe interno com três lóbulos/riscos de radiação, distinto das facetas do cristal.

Não transformar cristal em verde e não reutilizar sua paleta.

### Campo radioativo

Desenhar antes dos asteroides, junto das nuvens ambientais, usando `drawWithEdgeCopies()`:

- disco/névoa verde de baixa opacidade;
- borda pulsante;
- leitura visual do raio inteiro;
- fade baseado em `life / lifeTotal`;
- sem estado mutado pelo renderer.

`visualRadius` precisa cobrir o halo para gerar cópias corretas nas bordas.

Fazer `drawEffect()` reconhecer `radiationBurst` com a mesma família verde, em vez de cair na paleta ciano genérica. O efeito continua usando o lifecycle comum de `state.effects`.

### Status no UFO

Dentro de `drawUfo()`:

- `cryoSlowTime > 0`: halo ou pequenos cristais ciano;
- `radiationTime > 0`: anel/pontos verdes pulsantes;
- os dois podem aparecer juntos;
- manter a barra de HP legível;
- não criar um novo `effect` a cada frame.

O blast magma e `ufoDestroy` existentes bastam. Morte especial, estilhaçamento e debris pertencem à fase de polish.

## 15. Arquivos afetados

### Obrigatórios

- `src/config.js`
  - adicionar balance dos três efeitos e material `radioactive`.
- `src/entities.js`
  - inicializar estados no UFO;
  - aplicar o multiplicador de drive sem tocar no knockback;
  - criar/atualizar campo radioativo.
- `src/game.js`
  - incluir o novo material nas waves;
  - manter `radiationFields` e lifecycle;
  - aplicar dano radial magma;
  - snapshotar e resolver campos;
  - avançar cadência de ataque sob slow;
  - processar ticks pela rota central de dano;
  - fazer a colisão sólida devolver traces locais do movimento resolvido para os contatos ambientais;
  - preservar a ordem definida.
- `src/renderer.js`
  - desenhar material, campo e estados do UFO.
- `tests/enemy-effects.test.js`
  - cobrir o contrato isoladamente.
- `tests/hazards.test.js`
  - atualizar regressões de waves e lifecycle ambiental já existentes.
- `tests/enemy-collisions.test.js`
  - estender P0-27 para colisão com `radioactive` intacto.
- `README.md`
  - documentar o novo material e os efeitos nos inimigos depois da aprovação.

### Sem alteração esperada

- `src/math.js`;
- `src/input.js`;
- `src/main.js`;
- `index.html`;
- `styles.css`.

## 16. Plano de testes

Criar `tests/enemy-effects.test.js`. Usar um asteroide sentinela distante nas fixtures que destroem alvos, para impedir que `checkWaveClear()` troque a wave e remova o UFO sob teste.

### P0 — contrato obrigatório

1. A configuração expõe exatamente os valores propostos e a onda 5 contém ao menos um `radioactive` e um hunter.
2. Destruir um radioativo cria exatamente um `radiationField` e um `radiationBurst`; o campo nasce com vida completa e não envelhece nem contamina no step de criação.
3. Fragmentos herdam `radioactive`, mas só criam seus próprios campos quando destruídos posteriormente.
4. Um blast magma causa exatamente 2 de dano: mata hunter e deixa base com 2 HP.
5. Blast magma funciona por tangência e seam toroidal; um UFO imediatamente fora do raio permanece intacto.
6. Um blast atinge cada UFO no máximo uma vez, inclusive se a mesma referência aparecer duplicada no array; dois magmas distintos podem somar 4 de dano e matar uma base. Na fixture de cascata, destruir somente a raiz diretamente e deixar o segundo magma entrar exclusivamente pelo raio da primeira explosão.
7. UFOs não alteram o conjunto de `chainVictims`, a contagem/bonificação da cadeia, fragmentos, drops ou score dos asteroides.
8. Morte por magma acionada por uma fonte não manual concede os pontos do UFO uma vez, atualiza high score e não altera combo/multiplicador, isolando o efeito ambiental do gatilho.
9. Numa fixture com um único projétil manual e nenhum evento de precisão anterior no step, destruir magma usa para toda a cascata o multiplicador anterior à resolução daquele projétil. Uma segunda fixture confirma que um evento anterior já resolvido continua sendo respeitado.
10. Bomba de hiperespaço, EMP sem magma e mina inimiga não causam dano direto a UFOs. Fixtures positivas separadas comprovam `EMP → magma → UFO`, `bomba → magma → UFO` e `beam → magma → UFO`; a de EMP também prova morte antes de movimento/ataque.
11. `createUfo()` inicializa os três campos de status em zero para hunter e base.
12. Contato crio estático, travessia rápida, tangência e seam armam exatamente `slowDuration`, inclusive com `dt === 0`.
13. Enquanto lento, o drive usa exatamente `ufoDriveMultiplier`; `ufo.speed` e `turnRate` não mudam. Comparado a um controle idêntico, o knockback decai em ambos por `exp(-damping * dt)` e nunca recebe o multiplicador crio; `ufoStarts.driveV = totalV - knockbackV` contém o drive reduzido e a colisão do item 1 ainda alcança sua saída relativa configurada.
14. Expiração parcial num `dt` maior usa a média temporal definida por `slowFraction`, termina com timer zero e avança também o relógio de ação por `slowActive * ufoActionRateMultiplier + normalActive`.
15. O relógio do hunter avança pela taxa crio e o da base também; cooldowns rearmados mantêm os valores-base.
16. Hunter/base com ação já pronta ainda disparam/plantam uma vez; projéteis e minas já existentes não mudam de velocidade/lifetime.
17. Duas nuvens ou contato contínuo renovam pelo maior tempo sem somar duração ou multiplicadores. Numa chamada deliberadamente grande em que o timer curto expira enquanto o UFO começa dentro da nuvem, somente `slowFraction` daquele estado antigo afeta o step e o contato rearma ao final, sem slow retroativo.
18. Nuvem criada no step não afeta UFO/nave nem perde vida; uma nuvem que expira no meio do step ainda detecta contato ocorrido antes de expirar. Snapshot com `life <= 0` é inelegível até em `dt === 0`, e a geometria usa apenas valores congelados.
19. Contato radioativo novo arma exposição com acumulador zero e não causa dano imediato.
20. Campo radioativo detecta sobreposição, travessia rápida, tangência e seam toroidal.
21. O primeiro tick ocorre exatamente em `tickInterval`, inclusive na fronteira com epsilon; um instante anterior não causa dano.
22. Uma exposição breve gera no máximo três ticks configurados: mata hunter no segundo e deixa base com 1 HP no terceiro.
23. Uma base continuamente dentro do campo morre no quarto tick; refresh preserva o acumulador.
24. Campos sobrepostos não somam DPS nem reiniciam o relógio. Depois de exposição expirar, reentrada começa em zero.
25. Com exposição já pré-armada e sem contato/refresh de campo durante a janela, um `dt` grande e a mesma duração dividida em passos produzem HP, timer e acumulador equivalentes e não perdem múltiplos ticks. Não generalizar essa equivalência ao primeiro contato pós-movimento.
26. Cada tick não letal cria um `ufoHit`; a morte cria apenas um `ufoDestroy`, concede score uma vez e para os ticks restantes.
27. Morte radioativa respeita multiplicador/high score sem alterar precisão. Um tiro manual não letal anterior no mesmo step pode armar o multiplicador usado pelo tick.
28. UFO morto por projétil, beam ou magma não recebe tick, status ou colisão posterior.
29. Radiação pronta para matar vence a colisão sólida posterior; não há knockback/cooldown de asteroide depois da morte. Em fixtures sobreviventes, um campo colocado apenas no trecho irrestrito descartado após `hitTime` não arma status, um campo no segmento pós-knockback arma, e o endpoint pós-cleanup conta somente em `t = dt`.
30. Colisão direta com `magma`, `cryo`, `crystal` ou `radioactive` vivo continua usando apenas tamanho; não cria blast, nuvem, campo ou status.
31. A regressão da nave conserva slow de rotação, agora com a mesma política de snapshot para nuvens novas/expirando.
32. Config de teste sem `ufoDamage`, multiplicadores crio ou `radioactive` mantém comportamento neutro, finito e sem exceção. Para dano/raio magma ausente, zero, negativo, `NaN` e infinito, verificar HP, score, arrays e efeitos de UFO bit a bit inalterados. Para `tickInterval` ausente/zero/negativo/`NaN`/infinito e `ufoDamagePerTick` zero/`NaN`, o update termina, o timer envelhece, o acumulador fica finito em zero e não há HP, score ou `ufoHit`.

### P1 — lifecycle e combinações

33. Pausa preserva campos, status, acumulador e relógios de ataque bit a bit.
34. Resize canonicaliza nuvens/campos/UFOs sem alterar timers, raios ou acumulador.
35. Restart limpa campos e substitui UFOs por entidades sem status.
36. Troca de wave preserva nuvem/campo; um UFO novo dentro da área só recebe o status no update seguinte e nunca dano instantâneo.
37. Destruir o último radioativo cria um campo de vida completa que sobrevive à troca de wave.
38. Uma cascata magma pode destruir um radioativo e criar campo, mas esse campo não contamina na mesma cascata/step.
39. Magma, crio e radiação simultâneos não duplicam score nem efeitos e mantêm todos os números finitos.
40. Se uma fila magma causar `GAME_OVER`, os novos handlers posteriores de DoT/contato e a colisão sólida são no-op; os efeitos pertencentes à própria fila permanecem resolvidos uma vez, sem prometer aborto dos demais handlers antigos.
41. Spawn dentro de campo residual é determinístico e não consome RNG adicional nem ativa `spawnCollisionProtected`.

### Regressão obrigatória

Ao fim:

```bash
npm test
```

Os 188 testes anteriores devem continuar passando, além dos novos. Não relaxar asserts existentes para acomodar a feature.

## 17. Sequência sugerida de implementação

### Checkpoint A — contrato vermelho

1. Criar `tests/enemy-effects.test.js` com helpers determinísticos locais.
2. Escrever primeiro magma, slow de drive/ação e fronteiras de tick.
3. Confirmar que os testes novos falham pela ausência da feature e os 188 antigos continuam verdes.

### Checkpoint B — entidade e configuração

1. Adicionar os valores em `CONFIG`.
2. Inicializar status do UFO.
3. Implementar `createRadiationField()`/`updateRadiationField()`.
4. Adicionar estado, reset e resize do novo campo.

### Checkpoint C — efeitos isolados

1. Implementar helper radial e integrar magma.
2. Implementar slow apenas no drive e nos relógios de ação.
3. Implementar snapshots de nuvens/campos.
4. Fazer a colisão sólida produzir traces locais e implementar contatos toroidais sobre seus segmentos recortados.
5. Implementar o relógio de ticks e usar `damageUfo()`.

### Checkpoint D — ordem e regressão

1. Inserir handlers na ordem fechada.
2. Cobrir prioridade de ofensivas e interação com o item 1.
3. Atualizar os testes de hazards/waves/lifecycle.
4. Rodar a suíte completa.

### Checkpoint E — apresentação e dogfood

1. Adicionar material, campo e overlays ao renderer.
2. Atualizar README.
3. Jogar principalmente nas ondas 5 e 6.

## 18. Dogfood manual

Validar no navegador:

- matar um magma ao lado do hunter e confirmar morte imediata visualmente atribuível ao blast;
- atingir uma base com um magma e conferir metade da barra de HP;
- produzir dois blasts em cadeia próximos da base e conferir uma única morte;
- conduzir hunter e base por nuvem crio e perceber redução de movimento e cadência, sem “frear” o knockback;
- observar que tiros já disparados continuam normais;
- tocar rapidamente um campo radioativo com um hunter e observar ticks espaçados, não dano instantâneo;
- manter uma base no campo e confirmar morte após cerca de 3,2 s de exposição contínua;
- testar os três efeitos perto das quatro bordas;
- destruir o último radioativo de uma wave e usar o campo restante contra o UFO seguinte;
- confirmar que a nave não recebe radiação nesta fase, conforme a decisão explícita de escopo;
- procurar status invisível, halos sem cópia na seam, dano serrilhado e score duplicado.

Somente depois do dogfood ajustar números em `CONFIG`. Se o efeito estiver correto mas forte/fraco, mudar balanceamento, não a ordem causal.

## 19. Critérios de aceitação

- [ ] Cada blast magma distinto atinge cada UFO no raio uma vez e causa exatamente 2 de dano.
- [ ] Magma funciona toroidalmente e não altera as regras de cascata/fragmentação/drop.
- [ ] Slow crio afeta drive e cadência, mas não turn, knockback nem ameaças já criadas.
- [ ] Nuvens sobrepostas renovam sem empilhar.
- [ ] `radioactive` é um material próprio, desbloqueado e visualmente distinto.
- [ ] Sua destruição cria um campo de vida cheia, elegível apenas no step seguinte.
- [ ] Radiação tem primeiro tick atrasado, múltiplos ticks corretos e DPS não cumulativo.
- [ ] Todos os danos passam por `damageUfo()` e morte/score acontecem uma vez.
- [ ] Precisão manual não é alterada por efeitos ambientais.
- [ ] Ofensivas, DoT, colisão sólida e contato novo respeitam a ordem documentada.
- [ ] Contato usa sweep toroidal somente sobre traces físicos resolvidos e respeita a vida disponível do campo.
- [ ] Nuvem/campo recém-criado nunca afeta retroativamente nem envelhece no mesmo step.
- [ ] Pausa, resize, restart e wave preservam seus contratos.
- [ ] Configurações antigas permanecem compatíveis e finitas.
- [ ] O renderer comunica fonte, campo e status nas seams.
- [ ] Todos os testes novos passam.
- [ ] Os 188 testes anteriores continuam passando.

## 20. Fora do escopo

Não aproveitar esta entrega para adicionar:

- radiação ou veneno na nave;
- asteroide metálico ou magnético;
- desvio magnético de tiros;
- gravidade afetando UFOs;
- knockback de explosão;
- dano direto da bomba de hiperespaço em UFOs;
- friendly fire de minas, tiros ou bombers;
- efeito elemental por simples colisão com o casco do asteroide;
- redução de turn rate do UFO;
- congelamento de projéteis/minas existentes;
- morte especial congelada, debris ou kill chain de UFOs;
- obstacle avoidance ou novas personalidades de IA;
- classes, ECS ou um motor genérico de status.

## 21. O que enviar para revisão

Quando terminar, informar:

1. arquivos alterados;
2. resultado completo de `npm test`;
3. cenários manuais executados;
4. qualquer valor de balanceamento diferente do contrato e o motivo;
5. qualquer decisão temporal diferente para campos novos, slow parcial ou ticks.

Na revisão serão verificados primeiro ordem causal, não duplicação de dano/score e fronteiras temporais; depois lifecycle, cobertura de testes, legibilidade e sensação de combate.
