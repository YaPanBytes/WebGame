const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// 1. Setup Express and HTTP Server
const app = express();

// Add a root route for Render's health check
app.get('/', (req, res) => {
  res.send('Space Combat Server is online!');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // The asterisk means "Allow anyone to connect"
    methods: ["GET", "POST"]
  }
});
// 2. Setup Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 3. The Master State — contains ONLY plain serializable data (no timers, no circular refs)
const gameState = {
  players: {}, // socketId -> pilot snapshot (plain numbers only)
  projectiles: [],
  planets: {}
};

// --- Persistence Registry ---
// IMPORTANT: pilot objects stored here are PLAIN DATA ONLY.
// Never attach timer handles or object references to them — socket.io serializes
// gameState every 30ms and any non-plain value causes a stack overflow.
const playerRegistry = {};   // PilotToken   -> { x, z, rotation, hp, kills, lastShot, ignoreMovementUntil }
const socketToToken = {};    // SocketID      -> PilotToken
const tokenToSocket = {};    // PilotToken    -> SocketID  (active connection only)
const cleanupTimers = {};    // PilotToken    -> setTimeout handle  (kept SEPARATE from pilot data)
const collisionCooldowns = new Map(); // `p1Id|p2Id` -> timestamp

const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// --- Planet Data ---
const PLANET_CONFIG = [
  { name: "mercury", au: 0.39, size: 0.38 },
  { name: "venus",   au: 0.72, size: 0.95 },
  { name: "earth",   au: 1.00, size: 1.00 },
  { name: "mars",    au: 1.52, size: 0.53 },
  { name: "jupiter", au: 5.20, size: 11.21 },
  { name: "saturn",  au: 9.58, size: 9.45 },
  { name: "uranus",  au: 19.22, size: 4.01 },
  { name: "neptune", au: 30.05, size: 3.88 }
];

const DISTANCE_OFFSET = 250.0;
const DISTANCE_SCALE  = 60.0;
const SIZE_SCALE      = 10.0;
const SUN_RADIUS      = 45;

PLANET_CONFIG.forEach(p => {
  const orbitRadius = DISTANCE_OFFSET + (p.au * DISTANCE_SCALE);
  gameState.planets[p.name] = {
    angle: Math.random() * Math.PI * 2,
    radius: orbitRadius,
    size: SIZE_SCALE * Math.pow(p.size, 0.4),
    speed: 0.5 / Math.sqrt(orbitRadius)
  };
});

// --- Helpers ---
function getDist(p1, p2) {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.z - p2.z) ** 2);
}

function getRandomSafeSpawn(excludeToken = null) {
  const WORLD_SAFE_RADIUS  = 2200;
  const SUN_SAFE_RADIUS    = 350;  // Minimum distance from sun centre
  const MIN_SEPARATION     = 1000; // Minimum distance from any other pilot
  const MIN_PLANET_DIST    = 400;  // Minimum distance from any planet
  const MAX_ATTEMPTS       = 150;

  // All registry pilots are obstacles EXCEPT the pilot being spawned
  const playerObstacles = Object.entries(playerRegistry)
    .filter(([token]) => token !== excludeToken)
    .map(([, pilot]) => pilot);

  const planetObstacles = Object.values(gameState.planets).map(p => ({
    x: Math.cos(p.angle) * p.radius,
    z: -Math.sin(p.angle) * p.radius
  }));

  let bestAttempt = null;
  let maxFoundDist = -1;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const angle  = Math.random() * Math.PI * 2;
    const radius = SUN_SAFE_RADIUS + Math.random() * (WORLD_SAFE_RADIUS - SUN_SAFE_RADIUS);
    const candidate = {
      x: Math.cos(angle) * radius,
      z: -Math.sin(angle) * radius
    };

    let minDistToPlayer = Infinity;
    for (const pos of playerObstacles) {
      const d = getDist(candidate, pos);
      if (d < minDistToPlayer) minDistToPlayer = d;
    }

    let minDistToPlanet = Infinity;
    for (const pos of planetObstacles) {
      const d = getDist(candidate, pos);
      if (d < minDistToPlanet) minDistToPlanet = d;
    }

    if (minDistToPlayer >= MIN_SEPARATION && minDistToPlanet >= MIN_PLANET_DIST) {
      console.log(`[Spawn] Perfect spot at attempt ${i}. DistToPlayer: ${Math.floor(minDistToPlayer)}`);
      return candidate;
    }

    if (minDistToPlayer > maxFoundDist) {
      maxFoundDist = minDistToPlayer;
      bestAttempt = candidate;
    }
  }

  console.log(`[Spawn] Using best available spot. DistToPlayer: ${Math.floor(maxFoundDist)}`);
  // Fallback: angle spread around world so repeated fallbacks don't cluster
  return bestAttempt || { x: 800 + Math.random() * 400, z: (Math.random() - 0.5) * 400 };
}

// --- Connection Handling ---
io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  socket.on('authenticate', (token) => {
    if (typeof token !== 'string' || token.length === 0) {
      console.log(`[!] Invalid token from ${socket.id}, ignoring.`);
      return;
    }
    console.log(`[👤] Authenticating: ${token} (Socket: ${socket.id})`);

    // --- Step 1: Cancel any running cleanup timer for this token ---
    if (cleanupTimers[token]) {
      clearTimeout(cleanupTimers[token]);
      delete cleanupTimers[token];
    }

    // --- Step 2: Kick any OTHER socket already using this token ---
    // (Happens on rapid reload before the previous socket fully disconnects)
    const existingSocketId = tokenToSocket[token];
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);
      if (existingSocket) {
        console.log(`  -> Kicking stale socket ${existingSocketId} for token ${token}`);
        // Clean up the stale socket's entries before disconnecting
        delete gameState.players[existingSocketId];
        delete socketToToken[existingSocketId];
        existingSocket.disconnect(true);
      } else {
        // Socket object already gone but maps still held a reference — clean up
        delete gameState.players[existingSocketId];
        delete socketToToken[existingSocketId];
      }
    }

    // --- Step 3: Register the new socket <-> token mapping ---
    socketToToken[socket.id] = token;
    tokenToSocket[token]     = socket.id;

    // --- Step 4: Find or create the pilot record ---
    let pilot = playerRegistry[token];

    if (pilot) {
      console.log(`  -> Resuming session for ${token}`);
      // If they died before disconnecting, give them a fresh spawn
      if (pilot.hp <= 0) {
        console.log(`  -> Pilot was dead — respawning`);
        const spawn = getRandomSafeSpawn(token);
        pilot.x  = spawn.x;
        pilot.z  = spawn.z;
        pilot.hp = 100;
      } else {
        // Validate restored position — push out if inside sun or a planet
        const distFromSun = Math.sqrt(pilot.x ** 2 + pilot.z ** 2);
        if (distFromSun < SUN_RADIUS + 60) {
          console.log(`  -> Saved position inside sun danger zone — relocating`);
          const spawn = getRandomSafeSpawn(token);
          pilot.x = spawn.x;
          pilot.z = spawn.z;
        } else {
          // Also check planets
          for (const name in gameState.planets) {
            const planet = gameState.planets[name];
            const px = Math.cos(planet.angle) * planet.radius;
            const pz = -Math.sin(planet.angle) * planet.radius;
            const d  = Math.sqrt((pilot.x - px) ** 2 + (pilot.z - pz) ** 2);
            if (d < planet.size + 15) {
              console.log(`  -> Saved position inside planet ${name} — relocating`);
              const spawn = getRandomSafeSpawn(token);
              pilot.x = spawn.x;
              pilot.z = spawn.z;
              break;
            }
          }
        }
      }
    } else {
      console.log(`  -> Creating new pilot: ${token}`);
      const spawn = getRandomSafeSpawn(token);
      pilot = {
        x:        spawn.x,
        z:        spawn.z,
        rotation: 0,
        hp:       100,
        kills:    0,
        lastShot: 0
      };
      playerRegistry[token] = pilot;
    }

    // --- Step 5: Lock movement AND env-damage briefly to prevent desync/damage on reconnect ---
    const SPAWN_GRACE = 2000; // 2 seconds immunity after spawn/reconnect
    pilot.ignoreMovementUntil = Date.now() + SPAWN_GRACE;

    // --- Step 6: Add to ACTIVE game state ---
    // Use the pilot object directly so position updates are shared without the
    // multi-socket shared-reference problem (which is now impossible because we
    // kick any previous socket in step 2)
    gameState.players[socket.id] = pilot;

    // --- Step 7: Tell the client where it is ---
    socket.emit('forceRespawn', { x: pilot.x, z: pilot.z });
    console.log(`  -> Sent spawn coords: (${Math.floor(pilot.x)}, ${Math.floor(pilot.z)})`);
  });

  // Movement update from client physics
  const WORLD_RADIUS_SQ = 2500 * 2500;
  socket.on('playerMoved', (data) => {
    const player = gameState.players[socket.id];
    if (!player) return;
    if (player.ignoreMovementUntil && Date.now() < player.ignoreMovementUntil) return;

    // Validate — reject NaN, Infinity, or out-of-bounds
    if (typeof data.x        !== 'number' || !isFinite(data.x))        return;
    if (typeof data.z        !== 'number' || !isFinite(data.z))        return;
    if (typeof data.rotation !== 'number' || !isFinite(data.rotation)) return;
    if ((data.x * data.x + data.z * data.z) > WORLD_RADIUS_SQ)        return;

    player.x        = data.x;
    player.z        = data.z;
    player.rotation = data.rotation;
  });

  // Fire event — uses SERVER-AUTHORITATIVE position for the spawn point
  const SERVER_FIRE_COOLDOWN = 150; // ms
  socket.on('fire', () => {
    const player = gameState.players[socket.id];
    if (!player) return;
    if (Date.now() - (player.lastShot || 0) < SERVER_FIRE_COOLDOWN) return;

    // Safety: ensure player rotation and position are valid numbers
    const rot = (typeof player.rotation === 'number' && isFinite(player.rotation)) ? player.rotation : 0;
    const px  = (typeof player.x === 'number' && isFinite(player.x)) ? player.x : 0;
    const pz  = (typeof player.z === 'number' && isFinite(player.z)) ? player.z : 0;

    // Spawn 10 units in front of the ship's current server-side orientation
    const SPAWN_OFFSET = 10;
    const bulletX = px + Math.sin(rot) * SPAWN_OFFSET;
    const bulletZ = pz + Math.cos(rot) * SPAWN_OFFSET;

    // Final safety check: if everything is still a number, add the projectile
    if (isFinite(bulletX) && isFinite(bulletZ)) {
      gameState.projectiles.push({
        id: Math.random().toString(36).substring(7),
        ownerId: socket.id,
        x: bulletX,
        z: bulletZ,
        rotation: rot,
        distanceTraveled: 0
      });
      player.lastShot = Date.now();
    }
  });

  // Environmental damage — blocked during spawn-grace period
  socket.on('takeDamage', () => {
    const player = gameState.players[socket.id];
    if (!player) return;

    // Ignore env damage during the spawn-grace window (same timestamp as movement lock)
    if (player.ignoreMovementUntil && Date.now() < player.ignoreMovementUntil) {
      console.log(`[~] Env damage ignored — spawn grace active for ${socket.id}`);
      return;
    }

    const ENV_DAMAGE = 20;
    player.hp -= ENV_DAMAGE;
    player.lastShot = Date.now();
    console.log(`[!] Env damage: ${socket.id} -${ENV_DAMAGE} HP → ${player.hp}`);

    if (player.hp <= 0) handlePlayerDeath(socket.id);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const token = socketToToken[socket.id];

    // Remove from active game
    delete gameState.players[socket.id];
    delete socketToToken[socket.id];

    if (!token) {
      console.log(`[-] Anonymous socket disconnected: ${socket.id}`);
      return;
    }

    console.log(`[-] Pilot disconnected: ${token} (Socket: ${socket.id})`);

    // Only run cleanup if this was the CURRENT active socket for this token
    // (not a stale socket that we already kicked)
    if (tokenToSocket[token] === socket.id) {
      delete tokenToSocket[token];

      if (playerRegistry[token]) {
        cleanupTimers[token] = setTimeout(() => {
          console.log(`[🧹] Session expired for pilot: ${token}`);
          delete playerRegistry[token];
          delete cleanupTimers[token];
        }, SESSION_TIMEOUT);
      }
    }
  });
});

// --- Death Sequence ---
function handlePlayerDeath(pid, killerId = null) {
  const player = gameState.players[pid];
  if (!player) return;

  console.log(`[☠️] Player ${pid} destroyed!`);

  if (killerId && gameState.players[killerId]) {
    gameState.players[killerId].kills += 1;
    console.log(`  -> Killed by ${killerId}`);
  } else {
    console.log(`  -> Destroyed by environment`);
  }

  // Find the token for this socket so we can exclude them from obstacles
  const token = socketToToken[pid];
  const spawn = getRandomSafeSpawn(token);

  player.hp  = 100;
  player.x   = spawn.x;
  player.z   = spawn.z;
  player.ignoreMovementUntil = Date.now() + 1000;

  io.to(pid).emit('forceRespawn', { x: spawn.x, z: spawn.z });
}

// --- Physics Constants ---
// BULLET_SPEED must exceed the client's MAX_BASE_SPEED (5.0) by a wide margin so bullets
// always travel forward away from the firing ship, never appear to run alongside it.
const BULLET_SPEED        = 35.0;
const BULLET_MAX_DISTANCE = 2000; // increased to compensate for faster travel
const HITBOX_RADIUS       = 5.0;

// --- Game Loop (30 Hz) ---
setInterval(() => {

  // 1. Advance planet orbits
  for (const name in gameState.planets) {
    gameState.planets[name].angle += gameState.planets[name].speed * (1 / 30);
  }

  // 2. Bullet physics
  for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
    const p = gameState.projectiles[i];

    p.x += Math.sin(p.rotation) * BULLET_SPEED;
    p.z += Math.cos(p.rotation) * BULLET_SPEED;
    p.distanceTraveled += BULLET_SPEED;

    let hit = false;

    // Sun
    if (Math.sqrt(p.x ** 2 + p.z ** 2) < SUN_RADIUS) {
      hit = true;
    }

    // Planets
    if (!hit) {
      for (const name in gameState.planets) {
        const planet = gameState.planets[name];
        const px = Math.cos(planet.angle) * planet.radius;
        const pz = -Math.sin(planet.angle) * planet.radius;
        if (Math.sqrt((p.x - px) ** 2 + (p.z - pz) ** 2) < planet.size) {
          hit = true;
          break;
        }
      }
    }

    // Players — swept segment collision to prevent bullets tunnelling through targets
    // Each tick the bullet travels BULLET_SPEED units. We test the ENTIRE travelled
    // segment (prevX,prevZ) → (p.x,p.z) against each player's hitbox so fast
    // bullets can never skip past a ship between frames.
    if (!hit) {
      // Rewind to find where the bullet was at the START of this tick
      const prevX = p.x - Math.sin(p.rotation) * BULLET_SPEED;
      const prevZ = p.z - Math.cos(p.rotation) * BULLET_SPEED;

      // Segment direction and squared length
      const segDx = p.x - prevX;   // = sin(rotation) * BULLET_SPEED
      const segDz = p.z - prevZ;   // = cos(rotation) * BULLET_SPEED
      const segLenSq = segDx * segDx + segDz * segDz; // BULLET_SPEED²

      for (const pid in gameState.players) {
        if (pid === p.ownerId) continue;
        const pl = gameState.players[pid];

        // Project player position onto the segment, clamp to [0,1]
        const toDx = pl.x - prevX;
        const toDz = pl.z - prevZ;
        const t = Math.max(0, Math.min(1, (toDx * segDx + toDz * segDz) / segLenSq));

        // Closest point on segment to the player
        const closestX = prevX + t * segDx;
        const closestZ = prevZ + t * segDz;

        // Squared distance from closest point to player centre
        const distSq = (closestX - pl.x) ** 2 + (closestZ - pl.z) ** 2;

        if (distSq < HITBOX_RADIUS * HITBOX_RADIUS) {
          pl.hp -= 10;
          // NOTE: do NOT set pl.lastShot here — that field controls fire-rate limiting
          //       and contaminating it would prevent the target from firing back.
          hit = true;
          console.log(`[!] ${p.ownerId} hit ${pid}! HP: ${pl.hp}`);
          if (pl.hp <= 0) handlePlayerDeath(pid, p.ownerId);
          break;
        }
      }
    }

    if (hit || p.distanceTraveled > BULLET_MAX_DISTANCE) {
      gameState.projectiles.splice(i, 1);
    }
  }

  // 3. Ship-vs-ship collisions (with per-pair 800ms cooldown)
  const playerIds = Object.keys(gameState.players);
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const p1Id = playerIds[i];
      const p2Id = playerIds[j];
      const p1   = gameState.players[p1Id];
      const p2   = gameState.players[p2Id];

      const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.z - p2.z) ** 2);
      if (dist >= HITBOX_RADIUS * 2.5) continue;

      const pairKey = p1Id < p2Id ? `${p1Id}|${p2Id}` : `${p2Id}|${p1Id}`;
      const lastHit = collisionCooldowns.get(pairKey) || 0;
      if (Date.now() - lastHit < 800) continue;
      collisionCooldowns.set(pairKey, Date.now());

      console.log(`[💥] CRASH: ${p1Id} ↔ ${p2Id}`);
      p1.hp -= 20;
      p2.hp -= 20;

      // Repel apart
      const angle = Math.atan2(p1.z - p2.z, p1.x - p2.x);
      p1.x += Math.cos(angle) * 6;  p1.z += Math.sin(angle) * 6;
      p2.x -= Math.cos(angle) * 6;  p2.z -= Math.sin(angle) * 6;

      if (p1.hp <= 0) {
        handlePlayerDeath(p1Id, p2Id);
      } else {
        p1.ignoreMovementUntil = Date.now() + 500;
        io.to(p1Id).emit('forceRespawn', { x: p1.x, z: p1.z, repel: true });
      }

      if (p2.hp <= 0) {
        handlePlayerDeath(p2Id, p1Id);
      } else {
        p2.ignoreMovementUntil = Date.now() + 500;
        io.to(p2Id).emit('forceRespawn', { x: p2.x, z: p2.z, repel: true });
      }
    }
  }

  // 4. Broadcast — gameState contains ONLY plain serializable data, no circular refs
  io.emit('stateUpdate', gameState);

}, 1000 / 30);

// --- Start ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});