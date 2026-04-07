const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- Game Constants ---
const BULLET_SPEED = 8; 
const HITBOX_RADIUS = 8; // <--- Increase this from 5 to 12 (or even 15)
const WORLD_RADIUS = 100000;
// --- NEW: Added projectiles array ---
const gameState = {
  players: {},
  projectiles: [] 
};

io.on('connection', (socket) => {console.log(`[+] Player joined: ${socket.id}`);

  // --- NEW: Give players 100 HP when they join ---
  gameState.players[socket.id] = { x: 0, z: 0, rotation: 0, hp: 100, score: 0 };
  // Listen for movement
  socket.on('playerMoved', (data) => {
    if (gameState.players[socket.id]) {
      gameState.players[socket.id].x = data.x;
      gameState.players[socket.id].z = data.z;
      gameState.players[socket.id].rotation = data.rotation;
    }
  });

  // --- NEW: Listen for firing ---
  socket.on('fire', (data) => {
    gameState.projectiles.push({
      id: Math.random().toString(36).substr(2, 9), // Give the bullet a unique ID
      ownerId: socket.id, // So you don't shoot yourself
      x: data.x,
      z: data.z,
      rotation: data.rotation
    });
  });

  socket.on('disconnect', () => {
    console.log(`[-] Player left: ${socket.id}`);
    delete gameState.players[socket.id];
  });
});

// The Heartbeat & Physics Loop
setInterval(() => {
  // --- NEW: Move bullets and check collisions ---
  // Loop backward safely
  for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
    let p = gameState.projectiles[i];

    // 1. Move the bullet forward
    p.x += Math.sin(p.rotation) * BULLET_SPEED;
    p.z += Math.cos(p.rotation) * BULLET_SPEED;

    let bulletDestroyed = false;

    // 2. Check collision against all players
    for (let playerId in gameState.players) {
      if (playerId === p.ownerId) continue; // Ignore the player who shot it

      let player = gameState.players[playerId];
      
      // The Pythagorean theorem!
      let dist = Math.sqrt((player.x - p.x) ** 2 + (player.z - p.z) ** 2);
      
      if (dist < HITBOX_RADIUS) {
        // HIT! Deduct health and flag bullet for destruction
        player.hp -= 10;
        bulletDestroyed = true;
        
        // 3. Death & Respawn Logic
        // 3. Death & Respawn Logic
        if (player.hp <= 0) {
          console.log(`[!] ${playerId} was destroyed!`);
          
          // --- NEW: Give the shooter a point and broadcast the kill ---
          if (gameState.players[p.ownerId]) {
            gameState.players[p.ownerId].score += 1;
            
            // Tell all browsers to show a message! (We grab the first 4 characters of their ID as a "name")
            io.emit('killFeed', { 
              killer: p.ownerId.substring(0, 4), 
              victim: playerId.substring(0, 4) 
            });
          }

          // Teleport victim to a random location inside the arena
          player.x = (Math.random() - 0.5) * WORLD_RADIUS;
          player.z = (Math.random() - 0.5) * WORLD_RADIUS;
          player.hp = 100; // Restore health
        }
        break; // Bullet vanishes after hitting one person
      }
    }

    // 4. Cleanup: Remove bullet if it hit someone OR flew off the map
    let distFromCenter = Math.sqrt(p.x ** 2 + p.z ** 2);
    if (bulletDestroyed || distFromCenter > WORLD_RADIUS) {
      gameState.projectiles.splice(i, 1);
    }
  }

  // Broadcast the new truth to everyone
  io.emit('stateUpdate', gameState);
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} with Combat Systems Online`);
});