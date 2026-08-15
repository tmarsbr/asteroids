# Plano de implementação — Asteroids para navegador

## 1. Missão

Transformar o protótipo visual de `ideia.md` em um jogo pequeno, completo e divertido, inspirado no Asteroids clássico. A entrega deve rodar localmente no navegador, sem backend e sem depender de internet em tempo de execução.

O MVP termina quando o jogador consegue iniciar uma partida, pilotar, atirar, destruir e fragmentar asteroides, avançar por ondas, perder as três vidas, chegar ao game over e reiniciar sem recarregar a página.

## 2. Fonte de verdade e decisões já tomadas

- `ideia.md` é uma **referência visual**. Apesar da extensão, hoje ele contém um HTML monolítico de aproximadamente 646 linhas.
- Não modificar nem apagar `ideia.md`; ele deve permitir comparação com a ideia original.
- Hash SHA-256 de referência de `ideia.md`: `F8B7B97F18B2E5FE2458830793FCD0E8CEE6A9959D00F64BF0129166E096D03F`.
- Stack do MVP: HTML semântico, CSS e JavaScript moderno com Canvas 2D.
- Sem framework, bundler ou biblioteca de jogo. Não introduzir p5.js, Tailwind, React ou dependências npm sem uma necessidade demonstrável.
- A aplicação final não deve carregar Tailwind, Google Fonts, ícones ou outros recursos por CDN. Usar CSS local, fontes do sistema e desenhos vetoriais próprios.
- A direção visual do protótipo deve permanecer: fundo escuro, formas vetoriais, detalhes ciano/magenta e atmosfera de terminal/CRT. Os textos funcionais devem ser compreensíveis em português.
- Teclado e desktop são o alvo do MVP. Touch, gamepad e mobile jogável ficam para uma versão futura.
- Não copiar código, sprites, nomes de telas ou sons de uma versão comercial. O projeto é inspirado na mecânica clássica e usa arte própria gerada por código.

## 3. Avaliação do ponto de partida

O protótipo já demonstra Canvas, nave, tiros, asteroides, wrap, pontuação, vidas, escudo, overlays e HUD. Ele não é ainda a implementação aceita porque:

- todo o HTML, CSS e JavaScript está acoplado em um único arquivo com extensão incorreta;
- há dependências externas por CDN;
- a física é baseada em frames e muda conforme o FPS;
- o botão de pausa não está conectado, o reinício recarrega a página e o estado das teclas não é limpo ao perder foco;
- não existe progressão formal de ondas, testes automatizados ou documentação de execução;
- o Canvas não trata corretamente telas HiDPI;
- colisões próximas a bordas opostas e projéteis rápidos precisam de tratamento consistente;
- `drawHUDOverlay()` está sem uso e coordenadas iguais a zero são substituídas por valores aleatórios no construtor atual de asteroides.

O Hermes pode reaproveitar ideias visuais ou pequenos trechos, mas deve construir uma base verificável em vez de apenas renomear o arquivo.

## 4. Escopo fechado do MVP

### Incluído

- Tela inicial com controles e início por botão ou `Enter`.
- Nave triangular com rotação, propulsão, inércia, limite de velocidade e wrap nas quatro bordas.
- Disparos que saem da ponta da nave, herdam a velocidade da nave, têm cooldown, limite simultâneo e tempo de vida.
- Asteroides grandes, médios e pequenos, com silhuetas irregulares, movimento, rotação e wrap.
- Grande atingido gera dois médios; médio atingido gera dois pequenos; pequeno é removido.
- Colisões tiro–asteroide e nave–asteroide sem dupla contagem.
- Pontuação de 20, 50 e 100 pontos para asteroides grandes, médios e pequenos.
- Três vidas. Uma colisão custa uma vida; o respawn tem dois segundos de invulnerabilidade visualmente indicada.
- Ondas progressivas. A primeira começa com quatro asteroides grandes; cada onda aumenta a quantidade inicial até o limite de dez e aumenta a velocidade dentro de um teto seguro.
- HUD com pontos, recorde da sessão, vidas, onda e estado de pausa.
- Pausa real: a simulação e os timers de jogo não avançam enquanto pausados.
- Game over e reinício completo sem `location.reload()`.
- Redimensionamento sem deformar o Canvas e renderização nítida em HiDPI.
- Pausa automática e limpeza das teclas pressionadas quando a janela perde foco.
- Testes automatizados das regras puras e validação manual no navegador.
- Instruções de execução em `README.md`.

### Fora do MVP

- Multiplayer, login, backend ou ranking online.
- Controles touch/gamepad.
- UFO, chefes, power-ups, escudo, multiplicador ou hiperespaço.
- Música, efeitos sonoros e imagens externas.
- Sistema de partículas elaborado, conquistas ou campanha.

Se algo fora do MVP parecer útil, registrar em “Ideias futuras” no README; não implementar nesta entrega.

## 5. Controles

| Entrada | Ação |
|---|---|
| `←` / `A` | Girar à esquerda |
| `→` / `D` | Girar à direita |
| `↑` / `W` | Acionar propulsão |
| `Espaço` | Atirar |
| `P` / `Esc` | Pausar ou continuar |
| `Enter` | Iniciar na tela inicial |
| `R` | Reiniciar depois do game over |

Setas e espaço devem ter o comportamento padrão do navegador bloqueado somente enquanto forem controles ativos do jogo.

## 6. Estrutura-alvo

```text
asteroids/
├── ideia.md                    # referência original, intocada
├── index.html
├── styles.css
├── package.json                # apenas scripts; sem dependências obrigatórias
├── README.md
├── src/
│   ├── config.js               # balanceamento centralizado
│   ├── math.js                 # wrap, distância toroidal e colisões
│   ├── entities.js             # criação/atualização de nave, tiros e asteroides
│   ├── game.js                 # estado, regras, ondas, pontuação e transições
│   ├── input.js                # teclado, blur e ações de borda
│   ├── renderer.js             # Canvas e desenho; sem regras de jogo
│   └── main.js                 # bootstrap e loop principal
├── scripts/
│   └── serve.mjs               # servidor HTTP local sem pacote externo
├── tests/
│   ├── math.test.js
│   └── game.test.js
└── HANDOFF_HERMES.md           # criado somente no fim da implementação
```

Arquivos podem ser combinados quando isso deixar a solução mais simples, mas as fronteiras devem permanecer: regras não dependem do DOM e renderização não decide pontuação, vidas ou colisões.

## 7. Requisitos técnicos

### Loop e tempo

- Renderizar com `requestAnimationFrame`.
- Atualizar a simulação com passo fixo de `1/60 s` e acumulador.
- Limitar o delta recebido depois de aba inativa e limitar atualizações por frame para evitar “spiral of death”.
- Todas as velocidades e durações devem usar segundos, não contagem de frames.
- Estados explícitos: `ready`, `playing`, `paused` e `gameOver`.

### Mundo e colisões

- Usar coordenadas em pixels CSS; escalar somente o backing store pelo `devicePixelRatio`.
- O wrap deve considerar o raio da entidade e funcionar nos quatro lados.
- A distância para colisões deve ser toroidal, inclusive perto de bordas opostas.
- Usar círculos como aproximação de colisão no MVP.
- Cada tiro pode atingir no máximo um asteroide em uma atualização.
- Remover entidades em uma etapa segura, sem alterar arrays durante iterações que causem itens pulados ou dupla pontuação.
- Asteroides iniciais e de novas ondas devem nascer fora de um raio seguro da nave.
- O gerador aleatório deve poder ser injetado ou substituído nos testes.
- A velocidade configurada do tiro e o passo fixo devem impedir que ele atravesse o menor asteroide entre duas atualizações; cobrir esse caso com teste.

### Estado e entrada

- Disparo deve reconhecer intenção controlada: manter espaço pressionado respeita cooldown e o máximo de seis tiros ativos.
- `blur` limpa todas as teclas e pausa uma partida em andamento.
- Pausar/continuar deve ocorrer uma vez por pressionamento, não a cada frame.
- Reiniciar restaura pontos, vidas, onda, timers, teclas e entidades.
- O recorde da sessão deve sobreviver apenas aos reinícios dentro da mesma página; `localStorage` não é necessário.

### Apresentação e acessibilidade

- Canvas ocupa a área disponível sem cobrir HUD e controles importantes.
- Botões devem funcionar com mouse e teclado, ter rótulos acessíveis e foco visível.
- Overlays devem refletir o estado real do jogo.
- Respeitar `prefers-reduced-motion`, desabilitando scanline animada ou efeitos intensos.
- Não pode haver erro relevante no console nem requisição de rede necessária para jogar.

### Balanceamento inicial

Centralizar estes valores em `config.js` e ajustar somente após dogfood:

| Regra | Valor inicial |
|---|---:|
| Vidas | 3 |
| Asteroides grandes na onda 1 | 4 |
| Máximo inicial por onda | 10 |
| Cooldown do tiro | 0,18 s |
| Vida do tiro | 1,0 s |
| Máximo de tiros | 6 |
| Invulnerabilidade | 2,0 s |
| Pontos grande / médio / pequeno | 20 / 50 / 100 |
| Filhos por fragmentação | 2 |

## 8. Plano executável para o Hermes

Cada fase termina em um checkpoint verde. Não iniciar a próxima fase com testes quebrados.

### Fase 0 — Inventário e contrato

Skills: `plan`, `codebase-inspection`.

1. Ler integralmente este plano e `ideia.md`.
2. Confirmar em uma nota de trabalho que só existe o protótipo e que não há repositório Git, build ou testes preexistentes.
3. Manter o escopo acima como fonte de verdade; não redesenhar o produto.
4. Definir as interfaces mínimas entre estado, entidades, input e renderer antes de delegar.

Checkpoint: lista de arquivos a criar e nenhuma alteração fora desta pasta.

### Fase 1 — Base executável e primeiro teste

Skills: `codebase-editing-tools`, `test-driven-development`.

1. Criar a estrutura local, `package.json`, servidor sem dependências e README inicial.
2. Configurar `npm run dev` e `npm test` com `node --test`.
3. Escrever testes para wrap, distância toroidal e colisão circular antes da implementação de `math.js`.
4. Criar `index.html`, CSS local e um Canvas que redimensiona com DPR correto.

Checkpoint: servidor abre a tela-base, sem rede externa, e testes de matemática passam.

### Fase 2 — Nave, entrada e loop

Skills: `test-driven-development`, `codebase-editing-tools`.

1. Testar e implementar movimento independente de FPS, limite de velocidade e wrap.
2. Implementar loop fixo, estados `ready`/`playing`/`paused`/`gameOver` e entrada por ações.
3. Implementar controles, prevenção seletiva de teclas, limpeza no `blur` e pausa automática.
4. Renderizar nave, chama de propulsão e indicador de invulnerabilidade.

Checkpoint: nave controlável, pausa correta e nenhum salto após perder/recuperar foco.

### Fase 3 — Tiros, asteroides e colisões

Skills: `test-driven-development`, `codebase-editing-tools`.

1. Escrever testes para cooldown, limite/expiração de tiros e spawn seguro.
2. Implementar asteroides nos três tamanhos e silhuetas determinísticas por entidade.
3. Escrever testes de fragmentação, pontuação e garantia de um único acerto por tiro.
4. Implementar colisões toroidais e remoção segura de entidades.

Checkpoint: é possível destruir um grande em dois médios, depois em quatro pequenos, com pontuação exata.

### Fase 4 — Ciclo completo da partida

Skills: `test-driven-development`, `codebase-editing-tools`.

1. Testar e implementar três vidas, respawn seguro e invulnerabilidade.
2. Testar e implementar ondas, aumento limitado de dificuldade e transição única de onda.
3. Implementar HUD, tela inicial, pausa, game over e reinício sem reload.
4. Garantir que reinício e transições limpem todos os timers e entidades.

Checkpoint: fluxo completo do início ao game over e a uma nova partida.

### Fase 5 — Validação visual e sensação do jogo

Skills: `frontend-no-bundler-testing`, `computer-use`, `dogfood`, `feedback-loop-audit`.

1. Abrir a aplicação pelo comando documentado e inspecionar o console.
2. Jogar por pelo menos dez minutos, passando por no mínimo três ondas.
3. Exercitar teclado alternativo, pausa, perda de foco, resize, game over e reinício.
4. Conferir legibilidade em viewport de notebook e desktop, inclusive DPR alto quando possível.
5. Ajustar somente constantes de `config.js` para eliminar controles lentos, tiro com atraso ou dificuldade injusta.

Checkpoint: cenário manual completo aprovado e nenhuma falha funcional conhecida.

### Fase 6 — Auditoria e handoff

Skills: `implementation-gap-audit`, `simplify-code`, `requesting-code-review`.

1. Comparar item por item com as seções 4, 5, 7 e 10 deste plano.
2. Remover código morto, duplicação e complexidade desnecessária sem alterar o comportamento.
3. Rodar novamente todos os testes e a validação de navegador.
4. Completar o README.
5. Criar `HANDOFF_HERMES.md` usando o contrato da seção 11.

Checkpoint: entrega pronta para revisão independente do Codex.

### Divisão entre agentes do Hermes

Se usar subagentes, limitar a dois workers além do integrador:

- Worker de núcleo: `config.js`, `math.js`, `entities.js`, `game.js` e testes.
- Worker de interface: `index.html`, `styles.css`, `input.js` e `renderer.js`.
- Hermes integrador: `main.js`, interfaces compartilhadas, integração, dogfood e handoff.

O Hermes deve definir contratos antes da delegação. Dois agentes não devem editar o mesmo arquivo ao mesmo tempo. Se não houver isolamento confiável, executar as fases sequencialmente.

`systematic-debugging` deve ser acionada quando existir falha reproduzível. `frontend-build-validation`, `p5js`, skills de GitHub e `git-repository-hygiene` não fazem parte deste fluxo.

## 9. Testes automatizados mínimos

- Wrap correto à esquerda, direita, topo e base, considerando raio.
- Distância e colisão toroidais perto de bordas opostas.
- Mesmo deslocamento lógico com diferentes divisões de `deltaTime`.
- Velocidade da nave não ultrapassa o teto.
- Tiro nasce na ponta da nave e herda sua velocidade.
- Cooldown e máximo de seis tiros são respeitados.
- Tiro expira no tempo configurado.
- Tiro não atravessa um asteroide pequeno na velocidade máxima configurada.
- Spawn de onda respeita a distância segura.
- Grande vira exatamente dois médios.
- Médio vira exatamente dois pequenos.
- Pequeno não gera filhos.
- Pontuação correta para cada tamanho e nunca duplicada.
- Um tiro sobrepondo dois alvos atinge somente um.
- Colisão da nave remove somente uma vida durante a invulnerabilidade.
- Última vida produz `gameOver`.
- Pausa não avança simulação nem timers.
- Limpar a onda cria exatamente uma nova onda.
- Reinício restaura todo o estado, preservando apenas o recorde da sessão.

## 10. Cenário de aceite manual e Definition of Done

Executar em navegador real:

1. Iniciar com botão e, em outra tentativa, com `Enter`.
2. Testar as duas famílias de controles e atravessar as quatro bordas.
3. Manter tiro pressionado e confirmar cooldown, limite e expiração.
4. Destruir um grande e conferir dois médios; destruir todos e conferir pontuação.
5. Limpar uma onda e confirmar uma única transição e dificuldade crescente.
6. Colidir, conferir perda de uma vida, respawn seguro e dois segundos de proteção.
7. Pausar por teclado e botão; confirmar que nada se move ou expira.
8. Trocar de aba com tecla pressionada e retornar sem input preso ou salto de física.
9. Redimensionar várias vezes, sem distorção, borrado excessivo ou entidades perdidas.
10. Perder todas as vidas, reiniciar por botão e por `R`, e jogar novamente.
11. Permanecer em jogo por dez minutos ou três ondas, o que for mais longo.
12. Confirmar ausência de erros relevantes no console e de dependências de rede.

A entrega está pronta somente quando:

- `npm test` passa integralmente;
- `npm run dev` inicia o jogo conforme o README;
- todos os itens incluídos no MVP funcionam;
- o cenário manual foi executado e documentado;
- não há P0/P1 conhecido, código morto evidente ou alteração fora do escopo;
- `ideia.md` permanece intacto;
- `HANDOFF_HERMES.md` está completo.

## 11. Contrato de handoff do Hermes

`HANDOFF_HERMES.md` deve informar:

1. Resumo da implementação.
2. Arquivos criados e alterados, com a finalidade de cada um.
3. Comandos exatos de execução e teste.
4. Resultado dos testes automatizados, incluindo quantidade de testes.
5. Evidência da validação manual: navegador, cenários e duração jogada.
6. Decisões técnicas e qualquer desvio deste plano, com justificativa.
7. Limitações ou defeitos conhecidos.
8. Confirmação de que `ideia.md` não foi alterado e de que não houve mudanças fora da pasta.

Não declarar algo como testado quando não foi executado.

## 12. Como o Codex avaliará a implementação

Após o handoff, o Codex fará uma revisão independente:

1. Comparará o estado entregue com este plano e com a referência visual.
2. Inspecionará todos os arquivos, procurando bugs, acoplamento desnecessário, código morto e alterações fora do escopo.
3. Executará os comandos documentados e os testes, sem confiar apenas no relato do Hermes.
4. Testará no navegador o cenário completo da seção 10, incluindo console, perda de foco, resize, pausa e reinício.
5. Verificará especialmente tempo independente de FPS, colisões nas bordas, contagem única, limites de entidades e limpeza de estado.
6. Classificará achados como:
   - **P0 — bloqueador:** não abre, trava, perde dados do projeto ou impede uma partida completa;
   - **P1 — importante:** regra central incorreta, controle quebrado, colisão/pontuação/vidas/onda errada ou teste crítico ausente;
   - **P2 — melhoria:** polimento, legibilidade, manutenção ou experiência sem impedir o MVP.
7. Só aprovará quando não restarem P0 ou P1. P2 pode formar um backlog posterior.

O resultado da revisão será: **aprovado**, **aprovado com melhorias P2** ou **reprovado com correções solicitadas**. Depois de correções, os testes afetados e o cenário manual serão repetidos.

## 13. Prompt de execução para copiar ao Hermes

```text
Implemente integralmente o arquivo PLANO_IMPLEMENTACAO_HERMES.md desta pasta.

Leia primeiro o plano inteiro e o arquivo ideia.md. Trate ideia.md apenas como referência visual e não o modifique. O plano é a fonte de verdade do MVP; não acrescente recursos fora do escopo.

Use as skills nesta ordem quando aplicáveis: plan, codebase-inspection, codebase-editing-tools, test-driven-development, frontend-no-bundler-testing, computer-use/dogfood, feedback-loop-audit, implementation-gap-audit, simplify-code e requesting-code-review. Use systematic-debugging somente diante de uma falha reproduzível.

Implemente em fases, mantendo os checkpoints verdes. Não adicione dependências sem necessidade. No fim, execute todos os testes e o cenário manual, complete README.md e crie HANDOFF_HERMES.md exatamente com as evidências pedidas na seção 11. Não afirme que executou uma validação que não executou.
```

## 14. Extensão posterior — Mecânicas de pilotagem

Em 31/07/2026, o bloco 1 de `ideia.md` foi autorizado como uma extensão posterior ao MVP descrito acima. Esta seção substitui, apenas para essa rodada, a exclusão original de escudo e hiperespaço; as seções anteriores permanecem como registro do escopo do primeiro MVP.

Escopo da extensão:

1. Impulso Fantasma acionado por `Shift`, com direção capturada, deslocamento rápido, 0,3 s de invulnerabilidade e cooldown.
2. Repulsor acionado por `E`, usando uma carga ativa recarregável para garantir velocidade radial para fora em asteroides próximos, sem dano ou pontos.
3. Hiperespaço acionado por `Q`, com destino aleatório sem teste de segurança contra asteroides, distância mínima de salto e bomba de energia deixada na origem.
4. HUD de carga e cooldowns, feedback Canvas, controles de borda sem repetição e documentação correspondente.
5. Testes determinísticos para timers, pausa, reinício, resize, geometria toroidal, fragmentação e pontuação única.

A carga de escudo desta extensão é exclusivamente o recurso do repulsor; ela não funciona como barra de vida passiva. Essa decisão preserva a regra consolidada de colisões do MVP modular.

## 15. Extensão posterior — Armamento e power-ups temporários

Em 31/07/2026, o bloco 2 de `ideia.md` foi autorizado como nova extensão. Esta seção substitui, para essa rodada, a exclusão histórica de power-ups no primeiro MVP.

Escopo da extensão:

1. Pelo menos um asteroide carrier visualmente marcado por onda, com no máximo dois; cada carrier solta exatamente um Data Node ao ser destruído.
2. Data Nodes genéricos, móveis e toroidais, com 12 segundos de vida e seleção ponderada do efeito somente na coleta.
3. Um slot de armamento primário temporário para Leque Triplo, Raio ou Mísseis. Coletar o mesmo tipo renova o timer; outro tipo substitui o anterior; projéteis já disparados sobrevivem à expiração.
4. Leque atômico de três tiros; raio contínuo que atinge o primeiro alvo da linha por pulso; mísseis lentos que buscam e readquirem o alvo toroidal mais próximo.
5. Uma carga EMP armazenável, acionada por `F`, que destrói asteroides pequenos e paralisa médios e grandes por 2,5 segundos.
6. Dois drones de suporte em slot independente, orbitando a nave e disparando automaticamente contra alvos próximos.
7. HUD estável para armamento, suporte e EMP, com timers, barras, estados textuais e anúncio acessível de transições; feedback Canvas distinto para carriers, Nodes, armas, stun e drones.
8. Testes determinísticos para garantia/cap de carriers, drop e score únicos, coleta varrida, slots/timers, limites de projéteis, geometria toroidal, pausa, reinício, resize, stun bifásico e input de borda.

Todas as destruições continuam usando a mesma regra central de fragmentação e pontuação, evitando score ou drop duplicado. Drones não ocupam o slot primário, e o EMP não expira enquanto estiver armazenado.
