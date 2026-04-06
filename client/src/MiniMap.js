import * as THREE from 'three';
import { socket, serverState } from './Network.js';

export class MiniMap {
  constructor(canvasId, world, player) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.world = world;
    this.backdrop = document.getElementById('mini-map-backdrop');
    this.player = player;
    this.isMaximized = false;

    // Size settings
    this.miniSize = 200;
    this.maxSize = Math.min(window.innerWidth, window.innerHeight) * 0.8;

    // Generate static debris points for the asteroid belt (to prevent flickering)
    this.debrisCount = 400;
    this.debrisPoints = [];
    for (let i = 0; i < this.debrisCount; i++) {
        this.debrisPoints.push({
            angle: Math.random() * Math.PI * 2,
            radiusOffset: Math.random() // Normalized 0-1 across the belt width
        });
    }

    this.setupEvents();
    this.resize();
  }

  setupEvents() {
    this.canvas.parentElement.addEventListener('click', () => {
      if (!this.isMaximized) this.open();
    });

    this.backdrop.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    window.addEventListener('resize', () => this.resize());
  }

  open() {
    this.isMaximized = true;
    this.canvas.parentElement.classList.add('maximized');
    this.backdrop.classList.add('visible');
    this.resize();
  }

  close() {
    this.isMaximized = false;
    this.canvas.parentElement.classList.remove('maximized');
    this.backdrop.classList.remove('visible');
    this.resize();
  }

  resize() {
    const size = this.isMaximized ? this.maxSize : this.miniSize;
    this.canvas.width = size * window.devicePixelRatio;
    this.canvas.height = size * window.devicePixelRatio;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  draw() {
    const size = this.isMaximized ? this.maxSize : this.miniSize;
    this.ctx.clearRect(0, 0, size, size);

    const centerX = size / 2;
    const centerY = size / 2;
    // Scale everything relative to the world radius
    const scale = (size / 2 - 10) / this.world.WORLD_RADIUS;

    // 1. Draw Boundary
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, this.world.WORLD_RADIUS * scale, 0, Math.PI * 2);
    this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
    this.ctx.setLineDash([5, 5]);
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // 2. Draw Sun
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, 8 * scale, 0, Math.PI * 2);
    this.ctx.fillStyle = '#ffaa00';
    this.ctx.shadowBlur = 10;
    this.ctx.shadowColor = '#ffaa00';
    this.ctx.fill();
    this.ctx.shadowBlur = 0;

    if (this.isMaximized) {
        this.ctx.fillStyle = 'rgba(255, 170, 0, 0.8)';
        this.ctx.font = '10px Courier New';
        this.ctx.textAlign = 'center';
        this.ctx.fillText("The Sun", centerX, centerY + 20);
    }

    // 2.5 Draw Asteroid Belt as Debris
    if (this.world.asteroidInner && this.world.asteroidOuter) {
        this.ctx.fillStyle = 'rgba(150, 150, 150, 0.4)';
        const beltWidth = this.world.asteroidOuter - this.world.asteroidInner;

        this.debrisPoints.forEach(p => {
            const radius = (this.world.asteroidInner + p.radiusOffset * beltWidth) * scale;
            const x = centerX + Math.cos(p.angle) * radius;
            const y = centerY + Math.sin(p.angle) * radius;

            // Draw a tiny dot for each asteroid
            this.ctx.fillRect(x, y, 1, 1);
        });

        if (this.isMaximized) {
            this.ctx.fillStyle = 'rgba(150, 150, 150, 0.5)';
            this.ctx.font = '10px Courier New';
            this.ctx.textAlign = 'center';
            this.ctx.fillText("Asteroid Belt", centerX, centerY - (this.world.asteroidOuter * scale) - 10);
        }
    }

    // 3. Draw Planets
    this.world.planets.forEach(p => {
      const planetMesh = p.group.children[0]; 
      const worldPos = new THREE.Vector3();
      planetMesh.getWorldPosition(worldPos);

      const mapX = centerX + worldPos.x * scale;
      const mapY = centerY + worldPos.z * scale;

      this.ctx.beginPath();
      this.ctx.arc(mapX, mapY, 4, 0, Math.PI * 2);
      this.ctx.fillStyle = '#00ffff';
      this.ctx.fill();
      
      // Label planets if maximized
      if (this.isMaximized) {
          this.ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
          this.ctx.font = '10px Courier New';
          this.ctx.textAlign = 'center';
          this.ctx.fillText(p.name, mapX, mapY + 15);
      }
    });

    // 3.5 Draw Other Players (Multiplayer)
    if (serverState && serverState.players) {
        for (const id in serverState.players) {
            if (id === socket.id) continue; // Skip local player (drawn below)

            const pData = serverState.players[id];
            
            // --- NEW: Stealth Mechanic for Radar ---
            const VISIBILITY_WINDOW = 1500; // 1.5 seconds
            const isVisible = (Date.now() - (pData.lastShot || 0)) < VISIBILITY_WINDOW;
            if (!isVisible) continue;

            const enemyX = centerX + pData.x * scale;
            const enemyY = centerY + pData.z * scale;

            this.ctx.beginPath();
            this.ctx.arc(enemyX, enemyY, 3, 0, Math.PI * 2);
            this.ctx.fillStyle = '#ff3333'; // Red for other players
            this.ctx.fill();

            if (this.isMaximized) {
                this.ctx.fillStyle = 'rgba(255, 51, 51, 0.8)';
                this.ctx.font = '8px Courier New';
                this.ctx.fillText("Pilot", enemyX, enemyY + 10);
            }
        }
    }

    // 4. Draw Player
    const playerX = centerX + this.player.position.x * scale;
    const playerY = centerY + this.player.position.z * scale;
    const playerRotation = this.player.rotation.y;

    this.ctx.save();
    this.ctx.translate(playerX, playerY);
    this.ctx.rotate(-playerRotation + Math.PI); // Corrected to point forward
    
    this.ctx.beginPath();
    this.ctx.moveTo(0, -8);
    this.ctx.lineTo(-5, 6);
    this.ctx.lineTo(5, 6);
    this.ctx.closePath();
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowBlur = 8;
    this.ctx.shadowColor = '#00ffff';
    this.ctx.fill();
    this.ctx.restore();
  }
}
