# HANDOFF_HERMES.md

## 1. Resumo da implementação

O protótipo visual de `ideia.md` foi substituído por um jogo Asteroids completo, modular e testável. A implementação segue o `PLANO_IMPLEMENTACAO_HERMES.md` como fonte de verdade, com arquitetura separada em regras (sem DOM) e renderização (sem regras), loop de passo fixo (1/60 s) com acumulador, física em segundos (não frames), colisões toroidais, e zero dependências externas.

O MVP termina quando o jogador consegue iniciar uma partida, pilotar, atirar, destruir e fragmentar asteroides, avançar por ondas, perder as três vidas, chegar ao game over e reiniciar sem recarregar a página. Com as três extensões posteriores e o rebalanceamento de dificuldade, as regras estão verificadas por 127 testes automatizados; o escopo da validação de navegador é identificado separadamente.

## 2. Arquivos criados e alterados

| Arquivo | Finalidade |
|---|---|
| `src/config.js` | Balanceamento centralizado (vidas, velocidades, cooldowns, pontos, ondas). Unidades em segundos/pixels. |
| `src/math.js` | Funções puras: wrap, distância/colisão toroidal, tempo de impacto varrido e interseção raio–círculo toroidal. Sem DOM. |
| `src/entities.js` | Factory functions para nave, tiros, mísseis, Data Nodes, asteroides, anomalias, UFOs e minas. Física em segundos, homing toroidal e stun parcial. RNG injetável. |
| `src/game.js` | Máquina de estados, regras, ondas, pontuação, habilidades, carriers, power-ups, perigos ambientais e colisões varridas. Mundo dinâmico via `resize()`. Sem DOM. |
| `src/input.js` | Gerenciador de teclado: mapeia teclas para estado, previne default apenas em partida ativa, limpa no `blur`, dispara ações de borda (start/pause/restart). `clear()` usa `delete` para resetar corretamente. |
| `src/renderer.js` | Canvas 2D para nave, armas, asteroides elementais, carriers, Data Nodes, drones, anomalias, UFOs, minas, efeitos e cópias toroidais. Sem regras de jogo. |
| `src/main.js` | Bootstrap: loop fixo, DPR/HiDPI, resize, HUD de pilotagem e power-ups, anúncios acessíveis, overlays e botões. |
| `index.html` | HTML semântico com canvas, HUD, overlays e botões acessíveis. |
| `styles.css` | CSS local: tema dark, cores ciano/magenta, CRT overlay/scanline, `prefers-reduced-motion`. Botão de pausa reposicionado para não cobrir o HUD. |
| `package.json` | Scripts `dev` e `test`. Sem dependências. |
| `scripts/serve.mjs` | Servidor HTTP estático via `node:http`. Zero dependências externas. Escuta em `127.0.0.1`. Validação de caminho com `resolve` + prefixo. |
| `tests/math.test.js` | 25 testes de matemática toroidal, colisões varridas, raio toroidal e offsets visuais. |
| `tests/game.test.js` | 51 testes de regras base, input, colisão, spawn, respawn, resize e wrap canônico. |
| `tests/abilities.test.js` | 14 testes das mecânicas ativas de pilotagem. |
| `tests/powerups.test.js` | 25 testes de carriers, Data Nodes, armamentos, EMP, drones e integração. |
| `tests/hazards.test.js` | 9 testes de asteroides especiais, gravidade, UFOs, minas e ciclo de vida. |
| `tests/balance.test.js` | 3 testes do alcance de coleta e da progressão gradual de velocidade dos UFOs. |
| `README.md` | Instruções de execução, teste, controles e estrutura. |

**Arquivo de referência não alterado:** `ideia.md` (hash SHA-256 confirmado: `f8b7b97f18b2e5fe2458830793fcd0e8cee6a9959d00f64bf0129166e096d03f`). O plano recebeu apenas as seções de registro das extensões autorizadas.

## 3. Comandos de execução e teste

```bash
# Servidor de desenvolvimento
npm run dev
# → http://127.0.0.1:5173

# Testes automatizados
npm test
# → node --test tests/*.test.js
```

## 4. Resultado dos testes automatizados

```
# tests 71
# suites 0
# pass 71
# fail 0
# cancelled 0
# skipped 0
# duration_ms (varia por ambiente)
```

**Cobertura por categoria (seção 9 do plano):**

| Teste | Status |
|---|---|
| Wrap correto à esquerda, direita, topo e base, com coordenadas canônicas e cópias visuais | ✅ |
| Distância e colisão toroidais perto de bordas opostas | ✅ |
| Mesmo deslocamento lógico com diferentes divisões de `deltaTime` | ✅ |
| Velocidade da nave não ultrapassa o teto | ✅ |
| Tiro nasce na ponta da nave e herda sua velocidade (com vx=85) | ✅ |
| Cooldown e máximo de seis tiros são respeitados | ✅ |
| Tiro expira no tempo configurado | ✅ |
| Tiro não atravessa um asteroide pequeno na velocidade máxima configurada | ✅ |
| Spawn de onda respeita a distância segura | ✅ |
| Grande vira exatamente dois médios | ✅ |
| Médio vira exatamente dois pequenos | ✅ |
| Pequeno não gera filhos | ✅ |
| Pontuação correta para cada tamanho e nunca duplicada | ✅ |
| Um tiro sobrepondo dois alvos atinge somente um | ✅ |
| Colisão da nave remove somente uma vida durante a invulnerabilidade | ✅ |
| Última vida produz `gameOver` | ✅ |
| Pausa não avança simulação nem timers | ✅ |
| Limpar a onda cria exatamente uma nova onda | ✅ |
| Reinício restaura todo o estado, preservando apenas o recorde da sessão | ✅ |
| Spawn seguro funciona across wrap edges (toroidal) | ✅ |

**Testes novos (correções P1/P2):**

| Teste | Status |
|---|---|
| `game.resize()` atualiza dimensões do mundo lógico | ✅ |
| Entidades geradas após resize usam novas dimensões | ✅ |
| Tiros são canonicalizados após resize forte | ✅ |
| Asteroides são canonicalizados após resize forte | ✅ |
| Tiro cruza a borda direita durante update e permanece ativo | ✅ |
| Asteroide cruza a borda superior durante update e permanece ativo | ✅ |
| Spawn seguro garantido mesmo com RNG constante que cai na nave | ✅ |
| Respawn evita asteroides próximos | ✅ |
| Wrap canônico mantém coordenadas lógicas em `[0, width/height)` | ✅ |
| Cópias visuais nas bordas para nave, tiros e asteroides | ✅ |
| Cópias visuais cobrem cantos e raios visuais (trail, chama, pontas, sombras) | ✅ |
| Fricção reduz velocidade significativamente (200 → ~124 em 1s) | ✅ |
| `input.clear()` reseta todas as teclas pressionadas | ✅ |
| Limite rígido de 6 tiros simultâneos | ✅ |
| Pausa não avança cooldown, vida de tiro nem invulnerabilidade | ✅ |
| Tiro não atravessa asteroide pequeno em movimento | ✅ |
| Colisão varrida acerta com tiro a 900 px/s e asteroide a -320 px/s | ✅ |
| Colisão varrida considera o caminho relativo através da costura toroidal | ✅ |
| Colisão varrida cobre múltiplas larguras e rejeita quase-acerto | ✅ |
| Fase única do anel resiste ao RNG adversarial em mundo 250×1000 | ✅ |
| Respawn preserva o melhor candidato com 40 asteroides | ✅ |
| Respawn é adiado sem drenar vidas quando não há posição livre | ✅ |
| Respawn nunca aceita sobreposição mesmo com margem configurada menor | ✅ |
| Resize forte de 1200 para 200 normaliza imediatamente | ✅ |
| Wrap superior e inferior usa o domínio completo com margens | ✅ |

## 5. Escopo da validação desta rodada

- `npm test`: 71/71 testes passaram, incluindo reproduções determinísticas dos quatro P1.
- Smoke test do servidor local: resposta HTTP 200 em `http://127.0.0.1:5173/`.
- Nenhuma sessão de navegador, headless ou interativa, foi executada nesta rodada.

Assim, console/rede no navegador, controles DOM, blur, renderização/HiDPI, resize visual e o cenário “10 minutos ou 3 ondas” não foram revalidados. O registro anterior era de automação headless e não constitui evidência de dez minutos de jogo interativo.

## 6. Decisões técnicas e desvios do plano

| Decisão | Justificativa |
|---|---|
| `structuredClone(CONFIG)` em main.js | Cria uma cópia do config para modificar `world.width/height` em runtime sem afetar o objeto importado. |
| `game.resize(w, h)` em game.js | Atualiza o mundo lógico e normaliza imediatamente todas as entidades no novo domínio canônico, inclusive após reduções de múltiplas larguras. |
| Colisão varrida por tempo de impacto | Usa movimento relativo e enumera as imagens toroidais alcançáveis; impactos são resolvidos por tempo, com no máximo um alvo por tiro. |
| `safeSpawnPosition()` com fallback toroidal | Após 100 tentativas, usa uma única fase para 16 direções uniformes e testa também o antípoda, que garante a distância sempre que ela é geometricamente possível. |
| `findSafeRespawn()` com melhor candidato persistente | Centro, 24 anéis e 100 amostras competem pelo mesmo melhor resultado. Se não houver margem completa, aceita somente separação física estrita; sem posição livre, mantém `respawnPending` e tenta novamente. |
| Wrap canônico + cópias visuais | Coordenadas lógicas sempre em `[0, w/h)`. O renderer desenha cópias deslocadas por ±w/±h quando o raio visual ultrapassa a borda, cobrindo trail, chama, pontas e sombras. |
| Fricção: `friction^(dt/fixedStep)` | Converte retenção por passo fixo para dt arbitrário. Corrige a fórmula invertida anterior. |
| `input.setActive(bool)` | Input manager só previne default em teclas de movimento quando uma partida está ativa. Permite scroll normal nas telas de start/game-over. |
| `input.clear()` usa `delete keys[k]` | Garante que `getInput()` retorne `false` (não `undefined`) após clear, já que `!!undefined === false`. |
| Botão de pausa em `bottom: 12px; left: 12px` | Reposicionado para não cobrir o HUD de vidas no canto superior direito. |
| Servidor escuta em `127.0.0.1` | Restringe acesso ao localhost apenas. Validação de caminho com `resolve` + prefixo `ROOT + sep`. |
| `window.__game` debug hook | Expõe o estado do jogo para verificação no console durante desenvolvimento. Inofensivo em produção. |
| Cores: ciano (#00dddd), magenta (#ff44dd), branco | Segue a direção visual do protótipo (detalhes ciano/magenta, fundo escuro, atmosfera CRT). |
| `lives` exibido como "III"/"II"/"I"/"—" | Simples e legível. Não usa ícones externos. |
| Starfield estático no renderer | 80 estrelas fixas por padrão determinístico. Adiciona profundidade sem custo de animação. |

**Sem desvios do escopo.** Nenhum recurso fora da seção 4 foi implementado.

## 7. Limitações ou defeitos conhecidos

Nenhum P0 ou P1 detectado pela suíte Node. A validação atual de navegador permanece pendente.

- **P2:** O starfield é estático (não se move com a nave). Poderia ter parallax em uma versão futura.
- **P2:** O HUD de vidas usa texto ("III") em vez de ícones de nave. Funcional mas menos visual.
- **P2:** Em mundos onde a margem de respawn de 160 px é impossível, usa-se o melhor ponto fisicamente livre; se nem isso existir, a nave aguarda fora da simulação até surgir uma posição.

## 8. Confirmação de integridade

- `ideia.md` **não foi alterado.** Hash SHA-256 confirmado: `f8b7b97f18b2e5fe2458830793fcd0e8cee6a9959d00f64bf0129166e096d03f` (idêntico ao hash de referência no plano).
- **Não houve mudanças fora da pasta** `asteroids/`. Todos os arquivos criados estão dentro do diretório do projeto.
- `npm test` passa integralmente (127/127).
- `npm run dev` inicia o jogo conforme o README.

## 9. Atualização posterior — Mecânicas de pilotagem (31/07/2026)

Esta atualização implementa o bloco 1 de `ideia.md` como uma extensão ao MVP histórico documentado nas seções anteriores.

### Escopo entregue

- `Shift`: Impulso Fantasma a 820 px/s por 0,18 s, direção travada, 0,3 s de invulnerabilidade e cooldown de 1,5 s.
- `E`: Repulsor de raio 180 px. Consome 45 de uma carga ativa de 100, regenerada a 14/s; garante movimento radial para fora, limita asteroides a 520 px/s e não destrói nem pontua.
- `Q`: Hiperespaço cego quanto a asteroides, com salto mínimo, 16 tentativas e fallback antipodal. Zera a velocidade, oferece 0,12 s de proteção de chegada e deixa na origem uma bomba com fusível de 0,8 s e raio 125 px.
- A bomba usa geometria toroidal, fragmenta como um tiro e concede os pontos normais uma única vez.
- HUD responsivo com carga, cooldowns e estados; ondas, carga, teleporte, bomba e afterimages renderizados apenas com Canvas/CSS local.
- Input de borda enfileirado até o próximo passo fixo e consumido uma única vez, evitando perda em monitores de alta frequência e duplicação em frames com múltiplos substeps.

A carga de escudo é apenas o recurso ativo do repulsor. Ela não absorve dano passivamente, preservando a regra modular de uma colisão vulnerável remover uma vida.

### Arquivos alterados

- `src/config.js`: balanceamento das três habilidades.
- `src/entities.js`: estado e física do dash.
- `src/game.js`: energia, cooldowns, repulsão, destino de hiperespaço, bombas, efeitos, reset, pausa e resize.
- `src/input.js`: `Shift`, `E` e `Q` como ações de borda reconhecidas pelo passo de simulação.
- `src/renderer.js`: afterimages, ondas de choque, teleporte e carga de energia.
- `src/main.js`, `index.html`, `styles.css`: HUD, controles, acessibilidade e layout responsivo.
- `tests/game.test.js`: fixture de configuração e regressão da fila de input.
- `tests/abilities.test.js`: 14 testes determinísticos específicos das habilidades.
- `README.md` e `PLANO_IMPLEMENTACAO_HERMES.md`: controles, contrato e registro da ampliação de escopo.

### Evidências desta atualização

- `npm test`: **86/86 testes passaram**, sem falhas.
- `node --check` passou para todos os módulos em `src/`.
- `npm run dev` respondeu HTTP 200 em `http://127.0.0.1:5173/`.
- Chrome headless carregou a página em 1440×900, gerou screenshot e a tela inicial foi inspecionada visualmente; o artefato temporário foi removido após a inspeção.
- Revisão independente encontrou e levou à correção de dois casos-limite: salto quase nulo do hiperespaço e asteroide ainda se aproximando após o repulsor.
- Não foi executada uma sessão manual interativa de dez minutos/três ondas; portanto essa evidência histórica continua pendente.

### Integridade

`ideia.md` permaneceu intocado. SHA-256 verificado após a extensão:
`f8b7b97f18b2e5fe2458830793fcd0e8cee6a9959d00f64bf0129166e096d03f`.

## 10. Atualização posterior — Armamento e power-ups temporários (31/07/2026)

Esta atualização implementa integralmente o bloco 2 de `ideia.md`.

### Escopo entregue

- Cada onda recebe de um a dois carriers visualmente marcados; pelo menos um é garantido. Cada carrier destruído concede score/fragmentação normais e solta exatamente um Data Node.
- Data Nodes derivam seu movimento do carrier sem perturbar o RNG da física, atravessam as bordas e expiram após 12 segundos. O efeito ponderado só é escolhido na coleta.
- Slot primário exclusivo para Leque Triplo (9 s), Raio (8 s) ou Mísseis (10 s). Coleta igual renova; diferente substitui; tiros vivos não são apagados pela expiração.
- Leque atômico de três projéteis com cap de 12; raio contínuo com pulso de 0,15 s, alcance 520 px e primeiro impacto toroidal; até cinco mísseis a 360 px/s com busca e readquisição toroidal.
- EMP armazenado até `F`: destrói todos os pequenos e paralisa médios/grandes por 2,5 s. A colisão varrida divide corretamente o passo entre a fase congelada e a fase móvel.
- Dois drones em suporte independente, com órbita, aquisição automática até 300 px e cap próprio de seis projéteis.
- HUD responsivo e acessível para armamento, drones e EMP, com texto, barras, estado de expiração e anúncios de transição sem narrar o countdown a cada frame.
- Feedback Canvas distinto para carrier, Data Node, spread, míssil, raio, EMP, stun e drones; o raio mantém continuidade visual ao cruzar bordas.

### Decisões de integração

- Todas as mortes passam por `destroyAsteroids()`, incluindo tiro, raio, EMP e bomba do hiperespaço, garantindo score, fragmentação e drop únicos.
- A seleção de carrier não consome o RNG usado para formas e velocidades. Isso preserva a sequência determinística da física existente.
- O raio resolve no estado final do passo, depois de projéteis e bombas; um drop criado nesse instante conserva sua vida total e só pode ser coletado no passo seguinte.
- Timers temporários são processados em duas fases: o poder ainda funciona no último intervalo parcial e uma coleta feita no fim do passo recebe a duração integral.
- Projéteis simultâneos que chegam ao mesmo alvo no mesmo instante são consumidos juntos, mas o alvo só pontua, fragmenta e dropa uma vez.
- Drones usam slot e cap separados do armamento primário; a carga EMP não expira no inventário.

### Evidências desta atualização

- `npm test`: **115/115 testes passaram**, incluindo **25/25** testes específicos em `tests/powerups.test.js`.
- `node --check`: todos os módulos em `src/` passaram.
- Smoke HTTP: `http://127.0.0.1:5173/` respondeu **200** com `text/html; charset=utf-8`.
- Chrome headless carregou a tela inicial em 1440×900; o layout e a nova instrução de `F` foram inspecionados visualmente. Os artefatos temporários foram removidos.
- Revisões independentes de arquitetura, testes e UX encontraram casos-limite de raio atrás da origem, expiração no último passo, cap combinado, respawn dos drones, drops recém-criados e stun parcial; todos os P0/P1 e o P2 visual final foram corrigidos antes da última suíte.
- Não foi executada uma sessão manual interativa de dez minutos/três ondas. Essa evidência permanece pendente e não é inferida do smoke headless.

### Integridade

`ideia.md` permaneceu intocado. SHA-256 verificado após a extensão:
`f8b7b97f18b2e5fe2458830793fcd0e8cee6a9959d00f64bf0129166e096d03f`.

## 11. Atualização posterior — Asteroides e perigos ambientais (31/07/2026)

Esta atualização implementa o bloco 3 de `ideia.md` como terceira extensão do jogo.

### Escopo entregue

- Asteroides magma, crio e cristal são liberados nas ondas 2, 3 e 4, respectivamente; fragmentos herdam o material.
- Magma explode em área com reação em cadeia toroidal e pode remover uma vida da nave próxima.
- Crio cria uma nuvem temporária que reduz a velocidade de rotação da nave.
- Cristais usam HP por tamanho, feedback visual de dano e Data Node garantido sem drop duplo quando também são carriers.
- Anomalias gravitacionais surgem a partir da onda 4 e curvam nave, asteroides e projéteis usando a menor distância toroidal.
- UFO caçador surge na onda 5 com tiros direcionados; a base alterna a partir da onda 6 e instala minas estacionárias armáveis.
- Todos os novos estados respeitam pausa, reinício, resize e cópias visuais nas bordas.

### Decisões de integração

- Apenas disparos e pulsos do raio consomem HP cristalino; EMP, bomba e explosão magma continuam sendo efeitos letais de área.
- A fila de explosões magma elimina cada alvo, pontua, fragmenta e solta recompensa no máximo uma vez.
- UFOs, tiros inimigos, minas e anomalias pertencem à onda atual; nuvens de gelo podem terminar de dissipar depois da transição.
- A condição histórica de avanço continua sendo eliminar os asteroides. UFOs adicionam pressão, mas não bloqueiam a próxima onda.
- A gravidade não reduz artificialmente a velocidade de uma entidade que já entrou no campo acima do teto de aceleração configurado.

### Evidências desta atualização

- `npm test`: **124/124 testes passaram**, incluindo **9/9** em `tests/hazards.test.js`.
- `node --check`: todos os módulos em `src/` e a nova suíte passaram.
- Smoke HTTP: `/` e `/src/game.js` responderam **200** no servidor local.
- Smoke do renderer cobriu os quatro materiais, nuvem, anomalia, dois UFOs, mina, tiro inimigo e novos efeitos Canvas.

### Integridade

`ideia.md` permaneceu intocado. SHA-256 verificado após a terceira extensão:
`f8b7b97f18b2e5fe2458830793fcd0e8cee6a9959d00f64bf0129166e096d03f`.

## 12. Rebalanceamento de coleta e UFOs (31/07/2026)

- Data Nodes passaram de 10 para 18 px de raio e sua deriva caiu de 24 para 18 px/s. Com a nave de 14 px, o alcance combinado de coleta aumentou de 24 para 32 px.
- O caçador estreia a 125 px/s, a base a 52 px/s e o tiro inimigo a 220 px/s.
- Cada espécie de UFO começa em 1× e ganha 12% de velocidade a cada reaparição própria, com limite de 1,6×. Os projéteis do caçador acompanham o mesmo multiplicador.
- `tests/balance.test.js` confirma a coleta a 30 px, os baselines das ondas 5/6, a progressão nas ondas 7/8 e o teto em ondas avançadas.
- `npm test`: **127/127 testes passaram**; `node --check` também passou em todos os módulos e testes alterados.

## 13. Atualização posterior — Pontuação, multiplicador e high score (01/08/2026)

Esta atualização implementa o bloco 4 de `ideia.md`.

### Escopo entregue

- Disparos manuais aceitos criam tentativas de precisão. O primeiro impacto usa ×1,0 e arma ×1,5; acertos seguintes avançam de 0,5 em 0,5 até ×5,0.
- Acertos não precisam destruir o alvo. Uma salva de leque compartilha uma única tentativa: o primeiro laser que acerta resolve a salva, e o combo só quebra se todos expirarem sem impacto.
- Impactos e expirações são ordenados pelo tempo físico dentro do passo. Um acerto no instante exato do fim da vida do projétil vence o empate e não é classificado como erro.
- Raio, drones, EMP e bomba não alteram a precisão, mas suas destruições usam o multiplicador ativo.
- Cada raiz magma que elimina ao menos três vítimas indiretas únicas concede uma vez o bônus-base configurado de 500 pontos, multiplicado pelo valor ativo, e cria feedback `CHAIN REACTION!` com contagem e bônus.
- O recorde sobe ao vivo, é preservado entre reinícios, persiste em chave versionada do `localStorage` e nunca é sobrescrito por um valor menor. Storage ausente, corrompido ou bloqueado não interrompe o jogo.
- HUD mostra multiplicador/combo junto da pontuação, destaca novo recorde e oferece um anúncio acessível separado para reações em cadeia. O feedback Canvas usa o relógio da simulação e congela durante a pausa.

### Decisões de integração

- O prêmio de um impacto usa o multiplicador que já estava armado; o próprio acerto só eleva o multiplicador do próximo prêmio.
- Disparo bloqueado por cooldown ou cap não cria tentativa. Perder vida ou trocar de onda não apaga o combo; apenas um erro real ou uma nova partida o faz.
- A fila de magma carrega a raiz causal e separa alvos diretos de vítimas da explosão. EMP e bomba não transformam seus alvos iniciais em uma cadeia artificial.
- `game.js` continua sem DOM. A persistência fica em `high-score.js`/`main.js`, com sincronização monotônica entre abas.

### Arquivos alterados

- `src/config.js`, `src/entities.js`, `src/game.js`: balanceamento, identidade de salva, combo, multiplicador, pontuação central, cadeia causal e recorde vivo.
- `src/high-score.js`: normalização e persistência monotônica tolerante a falhas.
- `src/main.js`, `index.html`, `styles.css`: hidratação/persistência do recorde, HUD, badge e anúncios acessíveis.
- `src/renderer.js`: passe final de `CHAIN REACTION!`, com suporte a movimento reduzido.
- `tests/scoring.test.js`: 8 testes determinísticos do novo contrato.
- `tests/high-score.test.js`: 6 testes de validação e storage.
- `README.md`: regras, estrutura e cobertura atualizadas.

### Evidências desta atualização

- `npm test`: **141/141 testes passaram**, sem falhas.
- `node --check`: **16/16 arquivos JavaScript** de `src/` e `tests/` passaram.
- Smoke HTTP: `/` e `/src/high-score.js` responderam **200** com charset UTF-8.
- Edge headless carregou a aplicação e gerou capturas de revisão em desktop e viewport estreito; os artefatos e perfis temporários foram removidos após a inspeção.

### Integridade

`ideia.md` permaneceu intocado. SHA-256 verificado após a quarta extensão:
`f8b7b97f18b2e5fe2458830793fcd0e8cee6a9959d00f64bf0129166e096d03f`.
