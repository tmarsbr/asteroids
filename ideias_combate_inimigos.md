# 🎮 Ideias para Melhorar o Combate Inimigo

## Diagnóstico Atual

Hoje os inimigos são **fantasmas no ambiente** — eles atravessam asteroids, não sofrem efeitos especiais, e só fazem uma coisa: **voar na sua direção atirando**. Isso cria uma sensação de "kamikaze burro" e não de batalha real.

O player sofre com gelo, explosão, radiação, magnéticos... mas os inimigos? Nada. Zero. Eles vivem num mundo paralelo onde o campo de asteroids não existe.

---

## 🧠 Pilar 1: Inimigos Sofrem os Mesmos Desafios do Ambiente

> A ideia central: **se o player sofre, o inimigo também sofre.**

### 1.1 Colisão Inimigo ↔ Asteroids
- Inimigos **colidem e tomam dano** de asteroids (podem morrer pra um asteroid!)
- O player pode usar isso tátaticamente — atrair inimigos pra dentro de campos densos de asteroids
- Asteroids grandes empurram inimigos pra trás no impacto

### 1.2 Efeitos Especiais nos Inimigos
| Tipo de Asteroid | Efeito no Inimigo |
|---|---|
| 🔴 **Explosivo** | Inimigo morre/toma dano da explosão em cadeia |
| 🔵 **Gelo** | Inimigo fica lento (reduz velocidade e taxa de tiro) |
| ⚪ **Metálico** | Inimigo quica/toma mais knockback |
| 🟢 **Radioativo** | Dano over time no inimigo (mesmo veneno do player) |
| 🟡 **Magnético** | Tiros do inimigo também são desviados! |

### 1.3 Friendly Fire dos Inimigos
- Tiros inimigos podem destruir asteroids (criando caos no campo)
- Tiros de um bomber podem acidentalmente acertar outro inimigo
- Explosões em cadeia de asteroids explosivos causadas por tiros inimigos

> [!TIP]
> Isso sozinho já muda MUITO o gameplay. O campo de asteroids vira uma arena de batalha, não só um obstáculo pro player.

---

## 🧠 Pilar 2: IA com Personalidade

> Cada tipo de inimigo deve ter um **comportamento distinto e reconhecível.**

### 2.1 Scout (🟢 Verde) — O Flanqueador
**Comportamento atual:** Voa em direção ao player e atira.
**Comportamento novo:**
- **Órbita o player** a uma distância média, circulando em volta dele
- Faz **strafing** (movimenta-se lateralmente enquanto atira)
- Quando está em baixa HP, **foge e tenta se reagrupar** com outros scouts
- **Ataque em pinça:** quando há 2+ scouts, eles se posicionam em lados opostos do player
- Move rápido mas atira com menos precisão (tiros têm spread)

### 2.2 Fighter (🔴 Vermelho) — O Caçador Tático
**Comportamento atual:** Voa em direção ao player e atira (mais forte).
**Comportamento novo:**
- **Approach-and-retreat:** avança, dispara uma rajada de 3 tiros, recua
- **Usa asteroids como cobertura** — se posiciona atrás de asteroids grandes
- **Prevê a posição do player** (tiro preditivo baseado na velocidade do player, não onde ele está agora)
- **Evasão reativa:** desvia quando vê um tiro do player vindo na direção dele
- Pode entrar em modo **"berserk"** quando em baixa HP (fica mais rápido e agressivo)

### 2.3 Bomber (🟣 Roxo) — O Estrategista de Área
**Comportamento atual:** Voa em direção ao player e atira projéteis explosivos.
**Comportamento novo:**
- **Mantém distância longa** — nunca quer ficar perto do player
- **Atira em área:** mira onde o player VAI estar, não onde ele está
- **Mina o campo:** pode plantar "bombas" em asteroids (que explodem quando o player se aproxima)
- **Detona asteroids explosivos de propósito** para criar reações em cadeia perto do player
- Movimento lento mas com **blindagem pesada** (mais HP, reduz dano recebido)
- Se o player chega muito perto, faz um **dash de emergência** pra longe

> [!IMPORTANT]
> A diferenciação comportamental faz o player ter que **pensar diferente** pra cada tipo de inimigo. Não é mais "atira em tudo que se move".

---

## 🧠 Pilar 3: Inteligência de Navegação

> Inimigos que sabem navegar são mais desafiadores E mais imersivos.

### 3.1 Desvio de Asteroids (Obstacle Avoidance)
- Inimigos projetam **raios à frente** (raycasting simples) e desviam de obstáculos
- Níveis de habilidade por tipo:
  - **Scout:** desvia bem (ágil)
  - **Fighter:** desvia razoavelmente
  - **Bomber:** desvia mal (pesado, colide mais)
- Asteroids magnéticos atrapalham a navegação dos inimigos

### 3.2 Pathfinding Tático
- Fighters tentam **usar gaps entre asteroids** pra se aproximar
- Scouts **contornam campos densos** em vez de atravessar
- Bombers ficam **fora do campo** e atiram de longe

### 3.3 Consciência Espacial
- Inimigos sabem onde estão os asteroids explosivos e **evitam ficar perto**
- Inimigos sabem onde estão asteroids de gelo e **tentam empurrar o player** na direção deles
- Se um inimigo está congelado (por gelo), outros inimigos **ajustam posição** pra compensar

---

## 🧠 Pilar 4: Comportamento de Esquadrão

> Inimigos que trabalham juntos são exponencialmente mais perigosos.

### 4.1 Formações
- **V-Formation:** scouts entram em V quando são 3+
- **Escolta:** scouts protegem um bomber, voando ao redor dele
- **Pincer Attack:** dois groups atacam o player de lados opostos

### 4.2 Roles Dinâmicos
- Se o scout-flanqueador morre, um fighter pode assumir papel de flanqueamento
- Se o bomber morre, fighters ficam mais agressivos (modo "vingança")
- Quando só resta 1 inimigo, ele fica mais imprevisível (desespero)

### 4.3 Comunicação
- Quando um inimigo avista o player, outros inimigos **convergem pra posição**
- Inimigos podem "chamar reforços" (trigger de spawn antecipado)
- Um inimigo atingido "avisa" os outros da direção do ataque

---

## 🧠 Pilar 5: Momentos Cinematográficos

> O que faz o jogador lembrar de uma batalha não é a dificuldade — é o **drama.**

### 5.1 Entradas Épicas
- Inimigos não aparecem do nada — eles **entram de warp/hyperspace** com efeito visual
- Waves maiores chegam em **formação** com uma animação de chegada
- Boss waves com **warning na tela** ("⚠️ SQUADRON INCOMING")

### 5.2 Mortes Interessantes
- Inimigo congelado **estilhaça** ao ser destruído (fragmentos de gelo)
- Inimigo explodido por asteroid explosivo tem **morte especial** com debris
- Kill chain: matar 3+ inimigos em rápida sequência mostra um combo counter
- Último inimigo da wave tenta **fugir** (bônus de score se você pegá-lo)

### 5.3 Battlefield Dinâmico
- Tiros perdidos (do player E de inimigos) **movem asteroids** no impacto
- Explosões empurram tudo ao redor (inimigos, asteroids, debris)
- Campos de gelo criados por asteroids de gelo destruídos (zona de slow temporária)

---

## 📋 Priorização Sugerida

### ⭐ Fase 1 — Impacto Imediato (Muda tudo com pouco esforço)
1. **Colisão inimigo ↔ asteroids** (eles tomam dano e morrem pra asteroids)
2. **Efeitos especiais nos inimigos** (gelo, explosão, radioativo)
3. **Desvio básico de asteroids** (obstacle avoidance simples)
4. **Tiros inimigos destroem asteroids** (friendly fire ambiental)

### ⭐ Fase 2 — Personalidade (Cada inimigo é único)
5. **Scout com órbita/strafing** em vez de voo direto
6. **Fighter com approach-retreat** e tiro preditivo
7. **Bomber mantendo distância** e atacando área
8. **Evasão de tiros** (fighters desviam de balas do player)

### ⭐ Fase 3 — Táticas de Grupo (Trabalho em equipe)
9. **Formações básicas** (V, escolta de bomber)
10. **Pincer attacks** (ataques de dois flancos)
11. **Modo vingança** (quando aliado morre)

### ⭐ Fase 4 — Polish & Drama (Cereja do bolo)
12. **Entrada de warp** dos inimigos
13. **Warning de wave** na tela
14. **Último inimigo foge**
15. **Kill combos e efeitos de morte especiais**

---

## 🎯 Resumo Visual

```
ANTES:                          DEPOIS:
                                
  👾→→→→→→🚀                    👾↗ ← desvio de asteroid
  👾→→→→→→🚀                 ☄️   ↙
  👾→→→→→→🚀               👾→→💥→→ ← morreu pro explosive!
                              🟢👾...  ← tomou veneno
(kamikaze burro)         👾←←←🚀→→→ ← fighter recuando
                           ↕        
                         👾⟳🚀  ← scout orbitando
                                
                        (BATALHA DE VERDADE)
```

> [!NOTE]
> Não precisa implementar tudo de uma vez! A **Fase 1 sozinha** já transforma completamente a sensação de combate. O segredo é que quando os inimigos sofrem as mesmas regras do ambiente, o campo de asteroids vira uma **arena tática** — e não um cenário de fundo.
