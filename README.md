# ASTEROIDS

Asteroids para navegador em Canvas 2D, sem dependências externas. O jogo usa física toroidal, ondas progressivas, três sistemas ativos de pilotagem, armamentos e power-ups temporários, asteroides elementais, anomalias gravitacionais e UFOs hostis.

## Como executar

```bash
npm run dev
```

Abra `http://127.0.0.1:5173` no navegador.

## Como testar

```bash
npm test
```

A suíte usa `node:test` e cobre matemática toroidal, colisão varrida, movimento, tiros, fragmentação, pontuação, combo de precisão, reação em cadeia, recorde persistente, vidas, ondas, pausa, reinício, resize, spawn seguro, habilidades de pilotagem, Data Nodes, power-ups, asteroides especiais, anomalias gravitacionais e UFOs.

## Controles

| Tecla | Ação |
|---|---|
| S / seta para baixo | Frear sem dar ré |
| ← / A | Girar à esquerda |
| → / D | Girar à direita |
| ↑ / W | Acionar propulsão |
| Espaço | Atirar |
| Shift | Impulso Fantasma (dash) |
| E | Sobrecarga de Escudo (repulsor) |
| Q | Hiperespaço com bomba de energia |
| F | Detonar uma carga EMP armazenada |
| P / Esc | Pausar ou continuar |
| Enter | Iniciar na tela inicial |
| R | Reiniciar depois do fim de jogo |

## Sistemas de pilotagem

- **Impulso Fantasma:** avanço de 0,18 s na direção atual, com 0,3 s de invulnerabilidade e recarga de 1,5 s. A direção fica travada durante o impulso.
- **Repulsor:** consome 45% da carga e empurra asteroides próximos sem destruí-los nem conceder pontos. A carga regenera continuamente.
- **Escudo regenerativo:** começa com 100 pontos, volta a regenerar dois segundos após o último impacto e protege contra UFOs, tiros inimigos e minas. Asteroides ainda removem uma vida diretamente. Cada contato com um UFO conta apenas uma vez até a separação.
- **Hiperespaço:** teleporta a nave para uma posição aleatória a pelo menos 160 px (ou 35% da menor dimensão em telas pequenas), sem procurar um local seguro, zera sua velocidade e deixa uma bomba na origem. Após 0,8 s, a bomba destrói ou fragmenta asteroides no raio da explosão e concede a pontuação normal. Recarga de 6 s.

O HUD inferior mostra disponibilidade e recargas; as barras superiores mostram a carga do repulsor, a integridade do escudo e as vidas. A cada 10.000 pontos, até o máximo de seis vidas, a nave recebe uma vida extra.

## 3. ☄️ Tipos de Asteroides & Perigos Ambientais

Os novos materiais aparecem conforme as ondas avançam, e seus fragmentos sempre herdam o material e o efeito do asteroide original:

- **Magma (onda 2):** asteroides vermelhos que, ao serem destruídos, explodem em área. A explosão pode iniciar uma reação em cadeia com outros magmas e causa dano à nave próxima.
- **Crio (onda 3):** asteroides azuis que deixam uma nuvem por 4 s. Ao atravessá-la, a nave fica com 42% da velocidade normal de rotação por 1,8 s, e os UFOs ficam mais lentos e atiram/montam minas com menos frequência.
- **Cristal (onda 4):** asteroides ciano brilhante com resistência extra: grandes têm 3 HP, e médios e pequenos têm 2 HP. Sempre deixam um Data Node; se o cristal também for um carrier, ele ainda solta apenas um Node.
- **Radioativo (onda 5):** asteroides verde-limão que deixam um campo residual por 5 s. O campo não afeta a nave nesta versão, mas contamina UFOs: após um intervalo de segurança, cada 0,8 s dentro ou depois da exposição causa 1 de dano.

Também a partir da onda 4, **anomalias gravitacionais** podem surgir esporadicamente. Sua atração usa a menor distância toroidal e afeta a nave, os asteroides e os disparos do jogador, inclusive através das bordas do cenário.

Os **UFOs** são ameaças opcionais restritas à onda atual. O caçador estreia na onda 5 a 125 px/s e mira disparos que começam em 220 px/s; na onda 6 surge a primeira base, a 52 px/s, que instala até quatro minas estacionárias e armadas. Cada tipo fica 12% mais rápido quando reaparece, até o limite de 1,6×, em vez de já começar na velocidade máxima. Ambos enxergam asteroides à frente e desviam com eficácia variável: o caçador é ágil e reage cedo, enquanto a base enxerga menos longe, vira mais devagar e erra mais quando está cercada ou muito próxima de uma rocha. Destruir todos os asteroides continua sendo a condição para avançar de onda — eliminar o UFO não é obrigatório.

## Armamento e power-ups temporários

Asteroides marcados com sinais magenta são **carriers**. Cada onda contém pelo menos um carrier; ao destruí-lo, ele solta um **Data Node** amarelo. Os Nodes têm raio de 18 px e derivam lentamente a 18 px/s, deixando a coleta mais fácil. Encoste no Node antes que ele desapareça para receber um efeito sorteado:

- **Leque triplo:** dispara três lasers de uma vez durante 9 segundos.
- **Raio:** mantém um feixe contínuo enquanto `Espaço` estiver pressionado. O alvo mais próximo na linha é cortado a cada pulso, inclusive através das bordas do mundo, durante 8 segundos.
- **Mísseis:** projéteis mais lentos que se curvam para o asteroide mais próximo e readquirem outro alvo automaticamente durante 10 segundos.
- **EMP:** uma carga de uso único fica guardada até `F` ser pressionado. Ela destrói todos os fragmentos pequenos e paralisa asteroides médios e grandes por 2,5 segundos.
- **Drones:** dois orbiters acompanham a nave e atiram automaticamente em alvos próximos durante 10 segundos. Funcionam em paralelo com o armamento principal.

Leque, raio e mísseis compartilham um único slot: coletar outro armamento substitui o atual, enquanto coletar o mesmo renova sua duração. Drones ocupam um slot de suporte independente e o EMP permanece guardado até o uso. O HUD central exibe os três slots, seus estados e os tempos restantes.

## 4. 🎯 Pontuação, multiplicador e recorde

- Cada disparo manual aceito começa como uma tentativa de precisão. O primeiro impacto pontua em **×1,0** e prepara **×1,5** para o próximo prêmio; novos acertos avançam de 0,5 em 0,5 até **×5,0**.
- Um impacto conta mesmo quando não destrói um cristal ou UFO resistente. O leque triplo é uma única tentativa: basta um dos três lasers acertar, e os outros dois não quebram o combo quando expiram.
- Se todos os projéteis de uma tentativa desaparecerem sem impacto, o combo volta a **×1,0**. Disparos bloqueados por cooldown ou limite não contam como erro.
- Raio, drones, EMP e bomba não alteram a precisão do piloto. As destruições que causam ainda recebem o multiplicador já conquistado.
- Uma explosão magma que elimina pelo menos três outros asteroides, inclusive por cascata, concede **500 pontos-base** extras uma vez por reação e mostra `CHAIN REACTION!`. O bônus também recebe o multiplicador ativo.
- O recorde é atualizado assim que a pontuação o supera e salvo no `localStorage` com validação defensiva. Reiniciar zera combo e multiplicador, mas nunca reduz o recorde.

O HUD mantém multiplicador e combo junto dos pontos, destaca um novo recorde e oferece anúncio acessível separado para reações em cadeia.

## Estrutura

```text
asteroids/
├── ideia.md                  # protótipo e referência de ideias (intocado)
├── index.html                # HTML semântico e HUD
├── styles.css                # tema dark, CRT e HUD responsivo
├── package.json              # scripts dev/test
├── src/
│   ├── config.js             # balanceamento centralizado
│   ├── math.js               # wrap, distâncias e colisões toroidais
│   ├── entities.js           # nave, tiros, asteroides, UFOs, Data Nodes e física
│   ├── game.js               # estado, habilidades, perigos, regras e ondas
│   ├── high-score.js         # persistência defensiva e monotônica do recorde
│   ├── input.js              # teclado contínuo e ações de borda
│   ├── renderer.js           # Canvas 2D, efeitos e cópias nas bordas
│   └── main.js               # bootstrap, loop fixo, resize e HUD
├── scripts/
│   └── serve.mjs             # servidor HTTP local sem dependências
└── tests/
    ├── math.test.js          # primitivas matemáticas
    ├── balance.test.js       # tamanho dos Nodes e progressão de velocidade dos UFOs
    ├── game.test.js          # regras base e input
    ├── abilities.test.js     # mecânicas de pilotagem
    ├── hazards.test.js       # asteroides especiais, anomalias e UFOs
    ├── enemy-collisions.test.js  # colisão física UFO–asteroide
    ├── enemy-effects.test.js     # magma, crio e radiação contra UFOs
    ├── enemy-avoidance.test.js   # evasão preditiva de asteroides por UFO
    ├── powerups.test.js      # armamentos, Data Nodes, EMP e drones
    ├── scoring.test.js       # multiplicador, precisão e reação em cadeia
    └── high-score.test.js    # validação e persistência monotônica do recorde
```

## Stack

- HTML, CSS e JavaScript ES modules
- Canvas 2D com `requestAnimationFrame` e passo fixo de 1/60 s
- `node:test` para testes automatizados
- Sem framework, bundler, biblioteca ou serviço externo

Todos os valores de balanceamento ficam em `src/config.js` e usam segundos, pixels ou pixels por segundo.

## Próximas ideias

- Controles touch e gamepad
- Novos power-ups e chefes de setor
- Música, efeitos sonoros e partículas mais elaboradas
- Modos de jogo adicionais
