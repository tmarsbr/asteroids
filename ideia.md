<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>ASTEROID_COMMAND // VECT_OS</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..900&family=Space+Mono:wght@100..900&display=swap" rel="stylesheet"/>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        body {
            background-color: #131313;
            overflow: hidden;
            margin: 0;
            cursor: crosshair;
        }
        canvas {
            display: block;
            image-rendering: pixelated;
        }
        .vector-glow {
            filter: drop-shadow(0 0 4px rgba(0, 221, 221, 0.6));
        }
        .scanline {
            width: 100%;
            height: 2px;
            background: rgba(0, 221, 221, 0.1);
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            animation: scanline 8s linear infinite;
        }
        @keyframes scanline {
            0% { top: 0; }
            100% { top: 100%; }
        }
        .crt-overlay {
            background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), 
                        linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03));
            background-size: 100% 3px, 3px 100%;
            pointer-events: none;
        }
        .blink { animation: blink-animation 1s steps(2, start) infinite; }
        @keyframes blink-animation { to { visibility: hidden; } }
    </style>
<script id="tailwind-config">
        tailwind.config = {
          darkMode: "class",
          theme: {
            extend: {
              "colors": {
                      "on-secondary-fixed-variant": "#810081",
                      "on-primary-container": "#007070",
                      "outline-variant": "#3a4a49",
                      "surface-bright": "#393939",
                      "inverse-primary": "#006a6a",
                      "surface-tint": "#00dddd",
                      "surface-container-highest": "#353535",
                      "surface-variant": "#353535",
                      "on-tertiary-fixed": "#1a1c1c",
                      "on-secondary": "#5b005b",
                      "primary": "#ffffff",
                      "error-container": "#93000a",
                      "on-error-container": "#ffdad6",
                      "surface-container-lowest": "#0e0e0e",
                      "surface-container-low": "#1b1b1b",
                      "surface-container-high": "#2a2a2a",
                      "on-tertiary-fixed-variant": "#454747",
                      "outline": "#839493",
                      "on-tertiary-container": "#636565",
                      "primary-fixed-dim": "#00dddd",
                      "surface": "#131313",
                      "secondary-fixed": "#ffd7f5",
                      "on-primary": "#003737",
                      "secondary-fixed-dim": "#ffabf3",
                      "on-tertiary": "#2f3131",
                      "on-primary-fixed": "#002020",
                      "primary-container": "#00fbfb",
                      "tertiary-fixed": "#e2e2e2",
                      "on-surface": "#e2e2e2",
                      "background": "#131313",
                      "inverse-surface": "#e2e2e2",
                      "tertiary-fixed-dim": "#c6c6c7",
                      "primary-fixed": "#00fbfb",
                      "on-primary-fixed-variant": "#004f4f",
                      "secondary-container": "#fe00fe",
                      "on-surface-variant": "#b9cac9",
                      "error": "#ffb4ab",
                      "on-background": "#e2e2e2",
                      "surface-dim": "#131313",
                      "tertiary": "#ffffff",
                      "on-secondary-fixed": "#380038",
                      "secondary": "#ffabf3",
                      "tertiary-container": "#e2e2e2",
                      "on-error": "#690005",
                      "inverse-on-surface": "#303030",
                      "on-secondary-container": "#500050",
                      "surface-container": "#1f1f1f"
              },
              "borderRadius": {
                      "DEFAULT": "0.25rem",
                      "lg": "0.5rem",
                      "xl": "0.75rem",
                      "full": "9999px"
              },
              "spacing": {
                      "margin-safe": "32px",
                      "unit": "4px",
                      "gutter": "16px",
                      "arcade-tight": "8px"
              },
              "fontFamily": {
                      "headline-lg": ["Space Mono"],
                      "label-caps": ["JetBrains Mono"],
                      "body-md": ["JetBrains Mono"],
                      "headline-sm": ["Space Mono"],
                      "display-arcade": ["Space Mono"],
                      "headline-lg-mobile": ["Space Mono"]
              },
              "fontSize": {
                      "headline-lg": ["32px", {"lineHeight": "40px", "letterSpacing": "0.1em", "fontWeight": "700"}],
                      "label-caps": ["12px", {"lineHeight": "16px", "letterSpacing": "0.2em", "fontWeight": "700"}],
                      "body-md": ["16px", {"lineHeight": "24px", "letterSpacing": "0.02em", "fontWeight": "400"}],
                      "headline-sm": ["20px", {"lineHeight": "24px", "letterSpacing": "0.15em", "fontWeight": "700"}],
                      "display-arcade": ["72px", {"lineHeight": "80px", "letterSpacing": "-0.05em", "fontWeight": "700"}],
                      "headline-lg-mobile": ["24px", {"lineHeight": "32px", "fontWeight": "700"}]
              }
            },
          },
        }
    </script>
</head>
<body class="bg-background text-on-background font-body-md">
<!-- CRT Visual Atmosphere -->
<div class="fixed inset-0 crt-overlay pointer-events-none z-[100]"></div>
<div class="scanline z-[101]"></div>
<!-- Background Grid -->
<div class="fixed inset-0 pointer-events-none opacity-10" style="background-image: radial-gradient(#00dddd 1px, transparent 1px); background-size: 64px 64px;"></div>
<!-- Top App Bar -->
<header class="fixed top-0 w-full flex justify-between items-center px-margin-safe py-arcade-tight border-b border-primary/20 bg-transparent z-50">
<div class="flex items-center gap-unit">
<span class="material-symbols-outlined text-primary" style="font-variation-settings: 'FILL' 1;">radar</span>
<span class="font-display-arcade text-headline-sm text-primary uppercase">ASTEROID_COMMAND</span>
</div>
<div class="flex gap-gutter">
<button class="text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1">
<span class="material-symbols-outlined">pause</span>
<span class="font-label-caps text-label-caps">PAUSE</span>
</button>
<button class="text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined">settings</span>
</button>
</div>
</header>
<!-- Side HUD Stats -->
<div class="fixed left-margin-safe top-1/2 -translate-y-1/2 flex flex-col gap-gutter z-40">
<div class="flex flex-col gap-unit">
<span class="font-label-caps text-label-caps text-primary opacity-60">SCORE</span>
<span class="font-headline-lg text-headline-lg text-primary tabular-nums" id="scoreVal">000000</span>
</div>
<div class="flex flex-col gap-unit">
<span class="font-label-caps text-label-caps text-primary opacity-60">MULTIPLIER</span>
<span class="font-headline-sm text-headline-sm text-secondary">x1.0</span>
</div>
</div>
<!-- Right HUD Status -->
<div class="fixed right-margin-safe top-1/2 -translate-y-1/2 flex flex-col items-end gap-gutter z-40">
<div class="flex flex-col items-end gap-unit">
<span class="font-label-caps text-label-caps text-primary opacity-60">LIVES</span>
<div class="flex gap-1 text-primary" id="livesContainer">
<span class="material-symbols-outlined">rocket_launch</span>
<span class="material-symbols-outlined">rocket_launch</span>
<span class="material-symbols-outlined">rocket_launch</span>
</div>
</div>
<div class="flex flex-col items-end gap-unit w-32">
<span class="font-label-caps text-label-caps text-primary opacity-60">SHIELDS</span>
<div class="w-full h-2 border border-primary/40 p-[1px]">
<div class="h-full bg-primary" id="shieldBar" style="width: 100%;"></div>
</div>
<span class="font-label-caps text-label-caps" id="shieldText">100%</span>
</div>
</div>
<!-- Main Game Canvas -->
<canvas class="w-full h-full" id="gameCanvas"></canvas>
<!-- Start Overlay -->
<div class="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm px-margin-safe text-center" id="startOverlay">
<h1 class="font-display-arcade text-headline-lg text-primary mb-8 tracking-tighter">INITIATE_VECT_OS</h1>
<div class="mb-12 max-w-lg border border-primary/20 p-gutter">
<p class="font-body-md text-on-surface-variant leading-relaxed">
                CAUTION: HIGH DENSITY DEBRIS DETECTED IN SECTOR_7G. PILOT_ALPHA IS AUTHORIZED TO USE TACTICAL DEFENSES.
            </p>
</div>
<button class="group relative px-12 py-4 border-2 border-primary hover:bg-primary/10 transition-all active:scale-95" id="startBtn">
<span class="font-headline-sm text-headline-sm text-primary blink group-hover:animate-none">PRESS_START</span>
<div class="absolute -top-1 -left-1 w-2 h-2 bg-primary"></div>
<div class="absolute -bottom-1 -right-1 w-2 h-2 bg-primary"></div>
</button>
</div>
<!-- Game Over Overlay -->
<div class="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background/95 backdrop-blur-md hidden text-center" id="gameOverOverlay">
<h1 class="font-display-arcade text-headline-lg text-error mb-4">SYSTEM_FAILURE</h1>
<p class="font-label-caps text-label-caps text-error mb-12">SECTOR LOST // MISSION ABORTED</p>
<div class="flex flex-col gap-2 mb-12">
<span class="font-label-caps text-on-surface-variant">FINAL_SCORE</span>
<span class="font-headline-lg text-headline-lg text-primary" id="finalScore">000000</span>
</div>
<button class="px-8 py-3 border border-secondary text-secondary hover:bg-secondary/10 font-label-caps" onclick="location.reload()">REBOOT_SYSTEM</button>
</div>
<!-- Controls Footer -->
<footer class="fixed bottom-0 w-full flex justify-around items-center px-margin-safe pb-4 border-t border-primary/20 z-50">
<div class="flex gap-gutter items-center">
<div class="flex items-center gap-2">
<span class="px-2 py-1 border border-primary/40 font-label-caps text-label-caps text-on-surface-variant">ARROWS</span>
<span class="font-label-caps text-label-caps">MOVE</span>
</div>
<div class="flex items-center gap-2">
<span class="px-2 py-1 border border-primary/40 font-label-caps text-label-caps text-on-surface-variant">SPACE</span>
<span class="font-label-caps text-label-caps">FIRE</span>
</div>
<div class="flex items-center gap-2">
<span class="px-2 py-1 border border-primary/40 font-label-caps text-label-caps text-on-surface-variant">P</span>
<span class="font-label-caps text-label-caps">PAUSE</span>
</div>
</div>
<div class="hidden md:block">
<span class="font-label-caps text-label-caps opacity-40">SYSTEM STATUS: OPTIMAL</span>
</div>
</footer>
<script>
        /** @type {HTMLCanvasElement} */
        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        const scoreDisplay = document.getElementById('scoreVal');
        const finalScoreDisplay = document.getElementById('finalScore');
        const shieldBar = document.getElementById('shieldBar');
        const shieldText = document.getElementById('shieldText');
        const startOverlay = document.getElementById('startOverlay');
        const gameOverOverlay = document.getElementById('gameOverOverlay');
        const startBtn = document.getElementById('startBtn');
        const livesContainer = document.getElementById('livesContainer');

        let width, height;
        let score = 0;
        let lives = 3;
        let shields = 100;
        let gameRunning = false;
        let paused = false;

        function resize() {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        }

        window.addEventListener('resize', resize);
        resize();

        // Input Management
        const keys = {};
        window.addEventListener('keydown', e => {
            keys[e.code] = true;
            if (e.code === 'KeyP') paused = !paused;
        });
        window.addEventListener('keyup', e => keys[e.code] = false);

        class Bullet {
            constructor(x, y, angle) {
                this.x = x;
                this.y = y;
                this.speed = 8;
                this.vx = Math.cos(angle) * this.speed;
                this.vy = Math.sin(angle) * this.speed;
                this.life = 60; // frames
            }
            update() {
                this.x += this.vx;
                this.y += this.vy;
                this.life--;
                
                if (this.x < 0) this.x = width;
                if (this.x > width) this.x = 0;
                if (this.y < 0) this.y = height;
                if (this.y > height) this.y = 0;
            }
            draw() {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.x - this.vx * 0.5, this.y - this.vy * 0.5);
                ctx.stroke();
            }
        }

        class Asteroid {
            constructor(x, y, size = 60, generation = 3) {
                this.x = x || Math.random() * width;
                this.y = y || Math.random() * height;
                this.size = size;
                this.gen = generation;
                this.angle = Math.random() * Math.PI * 2;
                this.rotSpeed = (Math.random() - 0.5) * 0.04;
                this.curRot = 0;
                this.vx = (Math.random() - 0.5) * (4 - generation);
                this.vy = (Math.random() - 0.5) * (4 - generation);
                this.points = [];
                const sides = 6 + Math.floor(Math.random() * 5);
                for (let i = 0; i < sides; i++) {
                    const r = size * (0.8 + Math.random() * 0.4);
                    const theta = (i / sides) * Math.PI * 2;
                    this.points.push({
                        x: Math.cos(theta) * r,
                        y: Math.sin(theta) * r
                    });
                }
            }
            update() {
                this.x += this.vx;
                this.y += this.vy;
                this.curRot += this.rotSpeed;
                
                if (this.x < -this.size) this.x = width + this.size;
                if (this.x > width + this.size) this.x = -this.size;
                if (this.y < -this.size) this.y = height + this.size;
                if (this.y > height + this.size) this.y = -this.size;
            }
            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate(this.curRot);
                ctx.strokeStyle = '#00dddd';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(this.points[0].x, this.points[0].y);
                for (let i = 1; i < this.points.length; i++) {
                    ctx.lineTo(this.points[i].x, this.points[i].y);
                }
                ctx.closePath();
                ctx.stroke();
                
                // Glow effect
                ctx.globalAlpha = 0.2;
                ctx.lineWidth = 4;
                ctx.stroke();
                ctx.restore();
            }
        }

        class Player {
            constructor() {
                this.reset();
            }
            reset() {
                this.x = width / 2;
                this.y = height / 2;
                this.angle = -Math.PI / 2;
                this.vx = 0;
                this.vy = 0;
                this.friction = 0.98;
                this.thrust = 0.15;
                this.rotSpeed = 0.08;
                this.radius = 15;
                this.blink = 0;
            }
            update() {
                if (keys['ArrowLeft']) this.angle -= this.rotSpeed;
                if (keys['ArrowRight']) this.angle += this.rotSpeed;
                
                if (keys['ArrowUp']) {
                    this.vx += Math.cos(this.angle) * this.thrust;
                    this.vy += Math.sin(this.angle) * this.thrust;
                }

                this.x += this.vx;
                this.y += this.vy;
                this.vx *= this.friction;
                this.vy *= this.friction;

                if (this.x < 0) this.x = width;
                if (this.x > width) this.x = 0;
                if (this.y < 0) this.y = height;
                if (this.y > height) this.y = 0;

                if (this.blink > 0) this.blink--;
            }
            draw() {
                if (this.blink > 0 && Math.floor(Date.now() / 100) % 2 === 0) return;

                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate(this.angle);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                
                // Ship shape
                ctx.beginPath();
                ctx.moveTo(this.radius, 0);
                ctx.lineTo(-this.radius, this.radius * 0.7);
                ctx.lineTo(-this.radius * 0.6, 0);
                ctx.lineTo(-this.radius, -this.radius * 0.7);
                ctx.closePath();
                ctx.stroke();

                // Engine flame
                if (keys['ArrowUp']) {
                    ctx.strokeStyle = '#ffabf3';
                    ctx.beginPath();
                    ctx.moveTo(-this.radius * 0.7, 0);
                    ctx.lineTo(-this.radius * 1.5 - Math.random() * 5, 0);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

        let player = new Player();
        let asteroids = [];
        let bullets = [];
        let cooldown = 0;

        function initGame() {
            asteroids = [];
            bullets = [];
            score = 0;
            lives = 3;
            shields = 100;
            player.reset();
            
            for (let i = 0; i < 6; i++) {
                // Keep center clear initially
                let ax, ay;
                do {
                    ax = Math.random() * width;
                    ay = Math.random() * height;
                } while (Math.hypot(ax - width/2, ay - height/2) < 200);
                asteroids.push(new Asteroid(ax, ay));
            }
            updateHUD();
        }

        function updateHUD() {
            scoreDisplay.textContent = score.toString().padStart(6, '0');
            shieldBar.style.width = `${shields}%`;
            shieldText.textContent = `${Math.floor(shields)}%`;
            
            // Update lives display
            livesContainer.innerHTML = '';
            for(let i=0; i<lives; i++) {
                livesContainer.innerHTML += '<span class="material-symbols-outlined">rocket_launch</span>';
            }
        }

        function handleCollisions() {
            // Bullets vs Asteroids
            for (let i = bullets.length - 1; i >= 0; i--) {
                for (let j = asteroids.length - 1; j >= 0; j--) {
                    const b = bullets[i];
                    const a = asteroids[j];
                    const dist = Math.hypot(b.x - a.x, b.y - a.y);
                    
                    if (dist < a.size) {
                        bullets.splice(i, 1);
                        // Break asteroid
                        if (a.gen > 1) {
                            for (let k = 0; k < 2; k++) {
                                asteroids.push(new Asteroid(a.x, a.y, a.size / 2, a.gen - 1));
                            }
                        }
                        asteroids.splice(j, 1);
                        score += (4 - a.gen) * 100;
                        updateHUD();
                        break;
                    }
                }
            }

            // Player vs Asteroids
            if (player.blink === 0) {
                for (let i = 0; i < asteroids.length; i++) {
                    const a = asteroids[i];
                    const dist = Math.hypot(player.x - a.x, player.y - a.y);
                    if (dist < a.size + player.radius) {
                        shields -= 25;
                        player.blink = 120; // 2 seconds
                        if (shields <= 0) {
                            lives--;
                            shields = 100;
                            if (lives <= 0) {
                                gameOver();
                            } else {
                                player.reset();
                                player.blink = 120;
                            }
                        }
                        updateHUD();
                        break;
                    }
                }
            }
        }

        function gameOver() {
            gameRunning = false;
            finalScoreDisplay.textContent = score.toString().padStart(6, '0');
            gameOverOverlay.classList.remove('hidden');
        }

        function loop() {
            if (!gameRunning) return;
            if (paused) {
                requestAnimationFrame(loop);
                return;
            }

            ctx.clearRect(0, 0, width, height);

            player.update();
            player.draw();

            if (keys['Space'] && cooldown === 0) {
                bullets.push(new Bullet(player.x, player.y, player.angle));
                cooldown = 15;
            }
            if (cooldown > 0) cooldown--;

            for (let i = bullets.length - 1; i >= 0; i--) {
                bullets[i].update();
                bullets[i].draw();
                if (bullets[i].life <= 0) bullets.splice(i, 1);
            }

            for (let a of asteroids) {
                a.update();
                a.draw();
            }

            handleCollisions();

            // Spawn more asteroids if none left
            if (asteroids.length === 0) {
                for (let i = 0; i < 5; i++) {
                    asteroids.push(new Asteroid());
                }
            }

            requestAnimationFrame(loop);
        }

        startBtn.addEventListener('click', () => {
            startOverlay.classList.add('hidden');
            gameRunning = true;
            initGame();
            loop();
        });

        // Background atmosphere drawing
        function drawHUDOverlay() {
            // Static decorations for HUD
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            // Border corners
            const m = 32;
            ctx.beginPath();
            ctx.moveTo(m, m + 20); ctx.lineTo(m, m); ctx.lineTo(m + 20, m);
            ctx.moveTo(width - m - 20, m); ctx.lineTo(width - m, m); ctx.lineTo(width - m, m + 20);
            ctx.moveTo(m, height - m - 20); ctx.lineTo(m, height - m); ctx.lineTo(m + 20, height - m);
            ctx.moveTo(width - m - 20, height - m); ctx.lineTo(width - m, height - m); ctx.lineTo(width - m, height - m - 20);
            ctx.stroke();
            ctx.restore();
        }

        // Add to main loop implicitly via a second raf if needed for UI elements on canvas
    </script>
</body></html>

1. 🚀 Mecânicas de Movimentação e Sobrevivência (Pilotagem)
Dash / Impulso Fantasma (Dodge):
Um pequeno dash rápido na direção que a nave está apontada (com tempo de recarga ou gasto de energia). Durante o dash, a nave fica invulnerável por 0.3 segundos, permitindo esquivar no último instante de um asteroide gigante.
Sobrecarga de Escudo (Shield Burst / Repulsor):
Em vez do escudo ser apenas uma barra de vida passiva, você pode ativá-lo ativamente para emitir uma onda de choque repulsora. Ela não destrói os asteroides, mas os empurra com força para longe, abrindo caminho.
Hipespaço arriscado (Emergency Teleport):
O clássico teleporte cego do Asteroids original, mas com um twist: ao teleportar, você deixa para trás uma bomba de energia (deixando um rastro tático onde você estava).
2. ⚡ Armamento e Power-Ups Temporários
Quando asteroides especiais são destruídos, eles podem soltar Capsulas de Energia (Data Nodes) que concedem poderes por tempo limitado (ex: 8-10 segundos):

Spread Shot (Tiro Triplo / Leque):
Dispara 3 lasers em leque, excelente para limpar grandes grupos de pedras menores.
Beam Laser (Raio Contínuo):
Um raio vetorial que corta asteroides instantaneamente em linha reta enquanto você segura o botão.
Míssil Perseguidor / Homing Missiles:
Dispara mísseis lentos que se curvam sozinhos em direção aos fragmentos mais próximos.
EMP Bomb (Limpa-Tela):
Uma bomba com 1 uso único guardada no inventário. Ao usar, gera uma explosão em cadeia que destrói todos os fragmentos pequenos e paralisa os grandes por alguns segundos.
Drones de Suporte (Orbiters):
Dois pequenos triângulos que orbitam a sua nave atirando automaticamente em alvos próximos.
3. ☄️ Tipos de Asteroides & Perigos Ambientais
Para que o jogo não fique repetitivo, diferentes tipos de ameaças podem surgir nas ondas:

Asteroides Magmáticos / Explosivos (Vermelhos):
Ao destruí-los, eles explodem em raio de área, destruindo outros asteroides próximos ou causando dano se a nave estiver muito perto.
Asteroides Crio / Gelo (Azuis):
Ao quebrar, soltam uma nuvem de gelo que reduz a velocidade de rotação da nave se você passar por ela.
Asteroides Cristalinos (Cianos):
São mais duros (precisam de mais tiros), mas ao serem destruídos sempre dropam power-ups ou pontos de escudo extra.
Anomalias Gravitacionais (Buracos Negros Minúsculos):
Surgem esporadicamente no mapa e puxam a nave e os asteroides em direção ao centro, curvando a trajetória dos seus tiros!
Naves Inimigas Caçadoras (OVNIs Vetoriais):
UFO Pequeno: Rápido, tenta atirar direto na sua nave.
UFO Matriz / Base: Lento, que solta minas espaciais imóveis no campo.
4. 🎯 Sistema de Pontuação e Multiplicador (High Score Viciante)
Combo de Precisão:
Cada tiro acertado sequencialmente sem errar aumenta o multiplicador (
x
1.0
→
x
1.5
→
x
2.0
…
at
e
ˊ
 
x
5.0
x1.0→x1.5→x2.0…at 
e
ˊ
  x5.0). Se disparar e o tiro sumir sem acertar nada, o combo reseta.
Quebra em Cadeia (Chain Reactions):
Destruir um asteroide explosivo que faz outros 3 estourarem concede um bônus especial de pontos ("CHAIN REACTION!").
5. 🎮 Modos de Jogo Propostos
Modo Clássico Arcade (Ondas Infinitas):
Sobreviva o máximo de ondas possível. A cada onda aumentam a quantidade, a velocidade e os tipos de asteroides.
Modo Defesa de Núcleo (Core Defense):
Existe uma estação espacial ou gerador no centro da tela. Além de cuidar da sua nave, você precisa impedir que os asteroides atinjam o núcleo no centro.
Modo Desafio Roguelite (Run-Based):
A cada onda concluída, você escolhe 1 entre 3 melhorias passivas para a sua nave durante aquela corrida (ex: +15% velocidade de giro, lasers atravessam 1 alvo, recupera 10% de escudo por onda).