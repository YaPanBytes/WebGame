import * as THREE from 'three';
import { keys } from './Input.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { World } from './World.js';
import { MiniMap } from './MiniMap.js';
import { socket, serverState } from './Network.js';
// Post-processing imports
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
// --- 1. Core Setup ---
const canvasContainer = document.getElementById('game-container');
const scene = new THREE.Scene();

// --- 2. Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
canvasContainer.appendChild(renderer.domElement);

// --- 3. The Isometric Camera ---
const aspect = window.innerWidth / window.innerHeight;
const frustumSize = 115;

const camera = new THREE.OrthographicCamera(
  (frustumSize * aspect) / -2, // left
  (frustumSize * aspect) / 2,  // right
  frustumSize / 2,             // top
  frustumSize / -2,            // bottom
  1,                           // near clipping plane
  5000                         // far clipping plane (must reach Neptune at ~2053 units)
);

camera.position.set(50, 50, 50);
camera.lookAt(0, 0, 0);

// --- 4. Post-Processing Setup ---
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Bloom makes the Sun and glowing parts "bleed" light
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.5, // strength
  0.4, // radius
  0.85 // threshold
);
composer.addPass(bloomPass);

// --- 4. The World Engine ---
const world = new World(scene);

const playerGroup = new THREE.Group();
playerGroup.visible = false; // Stay hidden until we get our first spawn location
// Removed hardcoded spawn: Server now tells us where to start via forceRespawn
scene.add(playerGroup);

const enemyPlanes = {}; 
// We will clone your ship model for the enemies
let enemyModelTemplate = null;

// --- Bullet Visuals ---
// CylinderGeometry oriented along the Z-axis so it reads as a cylinder/missile from the isometric view.
// rotateX(Math.PI/2) pre-rotates the geometry so each mesh's +Z axis is the elongated direction.
const projectileMeshes = {};
const bulletGeometry = new THREE.CylinderGeometry(0.5, 0.5, 5, 8);
bulletGeometry.rotateX(Math.PI / 2); // elongated along Z so it aligns with flight direction
const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff3300 });

// --- 6. The Tactical Mini-Map ---
const miniMap = new MiniMap('mini-map-canvas', world, playerGroup);

// Initialize the loader
const loader = new GLTFLoader();

// ============================================================
// THRUSTER FLAME SYSTEM — Two parallel cylindrical exhausts
// Each thruster has:
//   - Inner cylinder (bright cyan/white core)
//   - Outer cylinder (wider, low-opacity blue glow)
// Positioned left (-X) and right (+X) behind the ship (-Z).
// ============================================================

function makeThrusterCylinder(radiusOuter, length, color, opacity) {
  // Cylinder oriented along Z axis: open-ended so it looks like a tube exhaust
  const geo = new THREE.CylinderGeometry(radiusOuter, radiusOuter * 0.4, length, 10, 1, true);
  geo.rotateX(Math.PI / 2); // align along -Z (pointing backward)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
  return new THREE.Mesh(geo, mat);
}

// --- LEFT thruster (offset -X) ---
const leftGroup  = new THREE.Group();
leftGroup.position.set(-1.8, 0, -3.0); // behind ship, left side

const leftCore  = makeThrusterCylinder(0.25, 3.5, 0xffffff, 0.90);
const leftGlow  = makeThrusterCylinder(0.65, 4.5, 0x00aaff, 0.35);
leftCore.position.z = -1.5;
leftGlow.position.z = -1.5;
leftGroup.add(leftCore, leftGlow);

// --- RIGHT thruster (offset +X) ---
const rightGroup = new THREE.Group();
rightGroup.position.set(1.8, 0, -3.0); // behind ship, right side

const rightCore = makeThrusterCylinder(0.25, 3.5, 0xffffff, 0.90);
const rightGlow = makeThrusterCylinder(0.65, 4.5, 0x00aaff, 0.35);
rightCore.position.z = -1.5;
rightGlow.position.z = -1.5;
rightGroup.add(rightCore, rightGlow);

playerGroup.add(leftGroup, rightGroup);

// Point light between both nozzles
const thrusterLight = new THREE.PointLight(0x0099ff, 3, 20);
thrusterLight.position.set(0, 0, -3);
playerGroup.add(thrusterLight);

// Flat arrays for easy per-frame updates
const thrusterCores = [leftCore, rightCore];
const thrusterGlows = [leftGlow, rightGlow];

// Load the 3D model from the public folder
loader.load('assets/ship.glb', (gltf) => {
    const shipModel = gltf.scene;

    shipModel.traverse((child) => {
      if (child.isMesh) {
        child.material.color.setHex(0xffffff);
      }
    });
    shipModel.scale.set(1, 1, 1);

    playerGroup.add(shipModel);
    console.log('Model loaded!');
    enemyModelTemplate = shipModel;
  },
  undefined,
  (error) => {
    console.error('Error loading the model. Check the file path!', error);
  }
);

// --- 6. Responsive Resize ---
// Keeps the game from distorting if the user resizes the browser window
window.addEventListener('resize', () => {
  const newAspect = window.innerWidth / window.innerHeight;
  camera.left = (-frustumSize * newAspect) / 2;
  camera.right = (frustumSize * newAspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// --- 7. The Game Loop ---
const clock = new THREE.Clock();
let velocity = 0;      
const ACCELERATION = 0.1;
const DAMPING = 0.985;  // Space Friction
const MAX_BASE_SPEED = 5.0;
const turnSpeed = 0.09;

// --- Combat Settings ---
let lastFireTime = 0;
let lastEnvDamageTime = 0;
const FIRE_COOLDOWN = 180; // ~5.5 shots per second
let hasReceivedSpawn = false; // Prevent logic before we get coordinates from server

// --- Nitro / Boost System ---
// Boost is HOLD-BASED: active exactly while Shift is held, capped by a fuel tank.
// Fuel drains at DRAIN_RATE while boosting, recharges at REFILL_RATE when not.
// Range: 0 (empty) ↔ 100 (full). Once empty, boost cuts out until tank recovers.
const BOOST_DRAIN_RATE   = 100 / 5000;  // full tank exhausted in 5 s (ms⁻¹)
const BOOST_REFILL_RATE  = 100 / 10000; // recharges fully in 10 s (ms⁻¹)
const BOOST_MULTIPLIER   = 2.5;

// Restore boost fuel from last session (survives page refresh)
const _savedFuel = parseFloat(sessionStorage.getItem('boostFuel'));
let boostFuel    = (!isNaN(_savedFuel) && _savedFuel >= 0 && _savedFuel <= 100) ? _savedFuel : 100;
let lastBoostTs  = Date.now();
let isBoosting   = false;  // updated each frame

// Spawn-grace: block takeDamage emissions for 2 s after a (re)spawn
let spawnGraceUntil = 0;

// --- NEW: Handle initial sync when we first connect ---
socket.on('connect', () => {
    // We strictly wait for the server to send us a 'forceRespawn' with our random location
    console.log("[📡] Connected to solar system. Waiting for spawn coordinates...");
});

// --- NEW: Handle Server-Forced Respawn Override ---
socket.on('forceRespawn', (data) => {
  playerGroup.position.x = data.x;
  playerGroup.position.z = data.z;
  playerGroup.visible = true;
  hasReceivedSpawn = true;

  // 2-second immunity: block client-side env damage emissions after every (re)spawn
  spawnGraceUntil = Date.now() + 2000;
  velocity = 0; // always stop on (re)spawn

  if (data.repel) {
    velocity = -Math.abs(velocity) * 0.8 - 2.0;
    const hpBarContainer = document.querySelector('.health-bar-container');
    if (hpBarContainer) {
      hpBarContainer.style.boxShadow = '0 0 20px 5px rgba(255, 170, 0, 0.8)';
      setTimeout(() => { hpBarContainer.style.boxShadow = 'none'; }, 300);
    }
  } else {
    const hpBarContainer = document.querySelector('.health-bar-container');
    if (hpBarContainer) {
      hpBarContainer.style.boxShadow = '0 0 20px 5px rgba(255, 0, 0, 0.8)';
      setTimeout(() => { hpBarContainer.style.boxShadow = 'none'; }, 500);
    }
  }
});

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = clock.getDelta();

  // 1. HARD STOP: Do not process ANY game logic or network updates 
  // until we receive our first server-authorized spawn location.
  if (!hasReceivedSpawn) {
      if (world) world.update(deltaTime, serverState);
      composer.render();
      miniMap.draw();
      return;
  }

  // 1. Update World (Orbital Motion & Asteroids)
  world.update(deltaTime, serverState);

  // 2. Physics & Boost Logic
  const now_physics = Date.now();
  const dtMs = Math.min(now_physics - lastBoostTs, 100);
  lastBoostTs = now_physics;

  isBoosting = keys.shift && boostFuel > 0;

  if (isBoosting) {
    boostFuel = Math.max(0, boostFuel - BOOST_DRAIN_RATE * dtMs);
  } else {
    boostFuel = Math.min(100, boostFuel + BOOST_REFILL_RATE * dtMs);
  }

  // Persist boost fuel to sessionStorage every ~500ms so refresh restores it
  if (Math.floor(now_physics / 500) !== Math.floor((now_physics - dtMs) / 500)) {
    sessionStorage.setItem('boostFuel', boostFuel.toFixed(2));
  }

  const currentMaxSpeed = isBoosting ? MAX_BASE_SPEED * BOOST_MULTIPLIER : MAX_BASE_SPEED;
  const currentAcc      = isBoosting ? ACCELERATION * 2.5 : ACCELERATION;

  // 3. User Input (Throttle)
  if (keys.w) velocity += currentAcc;      // W = accelerate forward
  if (keys.s) velocity -= currentAcc * 1.5; // S = decelerate / reverse thrust

  // 4. Apply Damping (Coasting in space)
  velocity *= DAMPING;

  // Cap Velocity
  velocity = Math.max(-currentMaxSpeed / 2, Math.min(velocity, currentMaxSpeed));

  // --- 5.5 Combat Input (Fire) — SPACEBAR fires, BLOCKED while boosting ---
  const now = Date.now();
  if (keys.space && !isBoosting && now - lastFireTime > FIRE_COOLDOWN) {
    // We no longer send coordinates. The server will use its own authoritative
    // position to spawn the bullet correctly.
    socket.emit('fire');
    lastFireTime = now;
    console.log('🔥 Pew Pew!');
  }

  // 6. Thruster Cylinder Animation
  const isThrusting = keys.w;
  const flicker     = 1.0 + Math.random() * 0.3; // organic random flicker

  // speedFactor uses ACTUAL velocity vs normal max — so it is 0→1 at normal speed
  // and 0→BOOST_MULTIPLIER (2.5) at full boost. Flame scales exactly with real speed.
  const speedFactor = Math.abs(velocity) / MAX_BASE_SPEED; // can exceed 1.0 when boosting
  const speedRatio  = Math.min(speedFactor, 1.0);          // clamped version for opacity calcs

  // Base length at normal full-speed thrust = 2.2 units.
  // When boosting at full speed: speedFactor = 2.5 → length = 2.2 * 2.5 = 5.5 (exact 2.5x match)
  const BASE_LENGTH  = 2.2;
  const targetLength = isThrusting
    ? Math.max(BASE_LENGTH * 0.5, BASE_LENGTH * speedFactor) * flicker
    : Math.max(0.1, speedFactor * 0.8 * flicker);

  // Core cylinder: bright white/cyan
  const coreColor   = isBoosting ? 0x88ffff : 0xffffff;
  const coreOpacity = isThrusting ? 0.95 : Math.max(0.05, speedRatio * 0.7);

  // Glow cylinder: wider blue halo — opacity also scales with speed factor
  const glowColor   = isBoosting ? 0x00ffff : 0x0088ff;
  const glowOpacity = isThrusting ? Math.min(0.75, 0.38 * Math.max(1, speedFactor)) : Math.max(0.02, speedRatio * 0.25);

  thrusterCores.forEach(m => {
    m.scale.y = THREE.MathUtils.lerp(m.scale.y, targetLength, 0.3);
    m.material.color.setHex(coreColor);
    m.material.opacity = THREE.MathUtils.lerp(m.material.opacity, coreOpacity, 0.2);
  });
  thrusterGlows.forEach(m => {
    m.scale.y = THREE.MathUtils.lerp(m.scale.y, targetLength * 1.15, 0.2);
    m.material.color.setHex(glowColor);
    m.material.opacity = THREE.MathUtils.lerp(m.material.opacity, glowOpacity, 0.2);
  });

  // Point light intensity tracks real speed — not just a binary boost boolean
  thrusterLight.intensity = THREE.MathUtils.lerp(
    thrusterLight.intensity,
    isThrusting ? (3 + speedFactor * 3) + Math.random() * 1.5 : speedRatio,
    0.25
  );

  // 7. Handle Rotation — A = turn left, D = turn right (from behind-the-ship POV)
  // We use (deltaTime * 60) to normalize the rotation speed to 60 FPS.
  const frameTurnSpeed = turnSpeed * (deltaTime * 60);
  if (keys.a) playerGroup.rotation.y += frameTurnSpeed;
  if (keys.d) playerGroup.rotation.y -= frameTurnSpeed;

  // 8. Move Ship based on Velocity
  // We normalize velocity application to 60 FPS using deltaTime.
  const frameVelocity = velocity * (deltaTime * 60);
  playerGroup.position.x += Math.sin(playerGroup.rotation.y) * frameVelocity;
  playerGroup.position.z += Math.cos(playerGroup.rotation.y) * frameVelocity;

  // 9. Camera Follow (Dynamic Isometric)
  const cameraOffset = new THREE.Vector3(50, 50, 50);
  camera.position.copy(playerGroup.position).add(cameraOffset);
  camera.lookAt(playerGroup.position);

  // 10. The Boundary Math
  const distFromCenter = Math.sqrt(playerGroup.position.x ** 2 + playerGroup.position.z ** 2);
  
  if (distFromCenter > world.WORLD_RADIUS) {
    const angle = Math.atan2(playerGroup.position.x, playerGroup.position.z);
    playerGroup.position.x = Math.sin(angle) * world.WORLD_RADIUS;
    playerGroup.position.z = Math.cos(angle) * world.WORLD_RADIUS;
    velocity *= -0.5; // Bounce off the wall
  }
  
  // --- 10.5 Environment Collisions (Client-Side) ---
  const myPos = playerGroup.position;
  const SHIP_HITBOX = 5;
  const nowTime = Date.now();
  // Skip all env damage during spawn-grace window
  const inGrace = nowTime < spawnGraceUntil;

  // Check Sun
  if (world.sunMesh) {
    const sunDist = Math.sqrt(myPos.x ** 2 + myPos.z ** 2);
    if (sunDist < 45 + SHIP_HITBOX) {
        velocity = -Math.abs(velocity) * 0.8 - 2.0;
        const pushAngle = Math.atan2(myPos.x, myPos.z);
        myPos.x = Math.sin(pushAngle) * (45 + SHIP_HITBOX + 1);
        myPos.z = Math.cos(pushAngle) * (45 + SHIP_HITBOX + 1);

        if (!inGrace && nowTime - lastEnvDamageTime > 500) {
            socket.emit('takeDamage', 20);
            lastEnvDamageTime = nowTime;
            const hpBarContainer = document.querySelector('.health-bar-container');
            if (hpBarContainer) {
                hpBarContainer.style.boxShadow = '0 0 20px 5px rgba(255, 170, 0, 0.8)';
                setTimeout(() => { hpBarContainer.style.boxShadow = 'none'; }, 300);
            }
        }
    }
  }

  // Check Planets
  world.planets.forEach(p => {
      const planetMesh = p.group.children[0];
      if (planetMesh) {
          const planetWorldPos = new THREE.Vector3();
          planetMesh.getWorldPosition(planetWorldPos);
          const planetRadius = planetMesh.geometry.parameters.radius;
          const dist = Math.sqrt((myPos.x - planetWorldPos.x)**2 + (myPos.z - planetWorldPos.z)**2);
          if (dist < planetRadius + SHIP_HITBOX) {
             velocity = -Math.abs(velocity) * 0.8 - 2.0;
             const pushAngle = Math.atan2(myPos.x - planetWorldPos.x, myPos.z - planetWorldPos.z);
             myPos.x = planetWorldPos.x + Math.sin(pushAngle) * (planetRadius + SHIP_HITBOX + 1);
             myPos.z = planetWorldPos.z + Math.cos(pushAngle) * (planetRadius + SHIP_HITBOX + 1);
             if (!inGrace && nowTime - lastEnvDamageTime > 500) {
                 socket.emit('takeDamage', 20);
                 lastEnvDamageTime = nowTime;
                 const hpBarContainer = document.querySelector('.health-bar-container');
                 if (hpBarContainer) {
                     hpBarContainer.style.boxShadow = '0 0 20px 5px rgba(255, 170, 0, 0.8)';
                     setTimeout(() => { hpBarContainer.style.boxShadow = 'none'; }, 300);
                 }
             }
          }
      }
  });

  // --- NEW: Tell the server where we calculated we should be ---
  if (socket.connected) {
    socket.emit('playerMoved', {
      x: playerGroup.position.x,
      z: playerGroup.position.z,
      rotation: playerGroup.rotation.y
    });
  }

  // --- NEW: Sync Enemy Planes & Hit Visuals ---
  if (enemyModelTemplate && serverState.players) {
    for (const id in serverState.players) {
      if (id === socket.id) continue;

      const serverPlayerData = serverState.players[id];

      if (!enemyPlanes[id]) {
        const newEnemy = new THREE.Group();
        // Clone the model deeply
        const modelClone = enemyModelTemplate.clone();
        
        // Ensure every clone has its own unique color material so they can flash independently
        modelClone.traverse((child) => {
          if (child.isMesh) {
            child.material = child.material.clone();
          }
        });

        newEnemy.add(modelClone);
        newEnemy.visible = false; // Initially hide untill mapped to server coordinates
        scene.add(newEnemy);
        
        // Store the previous HP so we know if they take damage
        enemyPlanes[id] = {
           group: newEnemy,
           model: modelClone,
           lastHp: serverPlayerData.hp
        };
      }

      const enemyPlaneObj = enemyPlanes[id];
      
      // 1. Check for Hit (HP dropped) — smooth color fade animation
      if (serverPlayerData.hp < enemyPlaneObj.lastHp && serverPlayerData.hp > 0) {
        // Start the smooth hit-flash: snap to bright red, then lerp back to white over ~500ms
        const HIT_DURATION = 500; // ms to fade back to normal
        const hitStart = Date.now();

        // Immediately set the hit colour
        enemyPlaneObj.model.traverse((child) => {
          if (child.isMesh) {
            child.material.color.setHex(0xff2200);
            child.material.emissive.setHex(0x660000);
          }
        });

        // Animate the colour smoothly back to white/0 emissive
        const animateHitFade = () => {
          const elapsed = Date.now() - hitStart;
          const t = Math.min(elapsed / HIT_DURATION, 1.0); // 0 → 1 over 500ms

          // Lerp each colour channel: red (1,0,0) → white (1,1,1)
          const g = t;          // green channel 0→1
          const b = t;          // blue  channel 0→1
          const emR = 0.4 * (1 - t); // emissive red fades out

          if (enemyPlanes[id]) {
            enemyPlanes[id].model.traverse((child) => {
              if (child.isMesh) {
                child.material.color.setRGB(1, g, b);
                child.material.emissive.setRGB(emR, 0, 0);
              }
            });

            if (t < 1.0) {
              requestAnimationFrame(animateHitFade); // keep going until fully white
            } else {
              // Snap to exact white/black to avoid floating-point drift
              enemyPlanes[id].model.traverse((child) => {
                if (child.isMesh) {
                  child.material.color.setHex(0xffffff);
                  child.material.emissive.setHex(0x000000);
                }
              });
            }
          }
        };
        requestAnimationFrame(animateHitFade);
      }

      // 2. Check for Death (HP hit 0 or below) — hide enemy briefly so spawn point isn't revealed
      const justDied = enemyPlaneObj.lastHp > 0 && serverPlayerData.hp <= 0;
      const justRespawned = enemyPlaneObj.lastHp <= 0 && serverPlayerData.hp > 0;

      if (justDied) {
        // Hide the ship immediately on death — keep hidden until we confirm a new HP>0 reading
        enemyPlaneObj.group.visible = false;
        enemyPlaneObj.hiddenUntilRespawn = true;
      }

      if (justRespawned) {
        // They got a new position from the server — hide for 1.5s more to mask the spawn warp
        enemyPlaneObj.group.visible = false;
        enemyPlaneObj.hiddenUntilRespawn = false;
        enemyPlaneObj.hideUntil = Date.now() + 1500;
      }
      
      // Update our local tracking variable
      enemyPlaneObj.lastHp = serverPlayerData.hp;

      // --- Physics & Sync ---
      enemyPlaneObj.group.position.x = serverPlayerData.x;
      enemyPlaneObj.group.position.z = serverPlayerData.z;
      
      enemyPlaneObj.group.rotation.y = THREE.MathUtils.lerp(
        enemyPlaneObj.group.rotation.y, 
        serverPlayerData.rotation, 
        0.2
      );
      
      // Only make visible if not in death-hide or post-respawn-hide window
      const isHidden = enemyPlaneObj.hiddenUntilRespawn || (enemyPlaneObj.hideUntil && Date.now() < enemyPlaneObj.hideUntil);
      enemyPlaneObj.group.visible = !isHidden;
    }

    // Cleanup: Remove disconnected planes
    for (const id in enemyPlanes) {
      if (!serverState.players[id]) {
        scene.remove(enemyPlanes[id].group);
        delete enemyPlanes[id];
      }
    }
  }

  // --- NEW: Projectile Synchronization ---
  if (serverState.projectiles) {
    // 1. Update/Create projectile meshes
    const currentProjectileIds = new Set();
    
    serverState.projectiles.forEach(p => {
      currentProjectileIds.add(p.id);

      if (!projectileMeshes[p.id]) {
        // Create new bullet mesh
        const mesh = new THREE.Mesh(bulletGeometry, bulletMaterial);
        scene.add(mesh);
        projectileMeshes[p.id] = mesh;
      }

      // Update position and rotation
      // The cylinder geometry was pre-rotated along Z, so matching rotation.y aligns it to flight dir
      projectileMeshes[p.id].position.set(p.x, 0, p.z);
      projectileMeshes[p.id].rotation.y = p.rotation;
    });

    // 2. Remove dead projectiles
    for (const id in projectileMeshes) {
      if (!currentProjectileIds.has(id)) {
        scene.remove(projectileMeshes[id]);
        delete projectileMeshes[id];
      }
    }
  }

  // --- NEW: Update Health Bar HUD & Score ---
  if (serverState.players && serverState.players[socket.id]) {
    const myData = serverState.players[socket.id];
    
    // 1. Health Bar
    const hpBar = document.getElementById('health-bar');
    const hpText = document.getElementById('health-text');
    if (hpBar && hpText) {
      hpBar.style.width = `${myData.hp}%`;
      hpText.innerText = myData.hp;
      if (myData.hp > 60) hpBar.style.backgroundColor = '#00ffaa';
      else if (myData.hp > 30) hpBar.style.backgroundColor = '#ffaa00';
      else hpBar.style.backgroundColor = '#ff4444';
    }

    // 2. Score
    const scoreEl = document.getElementById('score');
    if (scoreEl && myData.kills !== undefined) {
      scoreEl.innerText = myData.kills;
    }
  }

  // --- Update Boost / Fuel Bar HUD ---
  {
    const fuelBar       = document.getElementById('boost-bar');
    const fuelLabel     = document.getElementById('boost-label');
    const fuelContainer = document.querySelector('.boost-bar-container');

    if (fuelBar && fuelLabel && fuelContainer) {
      const fillPct = boostFuel;
      let labelText = 'NITRO READY';
      let barColor  = '#00aaff';
      let glowing   = false;

      if (isBoosting) {
        labelText = 'BOOSTING!';
        barColor  = '#00ccff';
        glowing   = true;
      } else if (boostFuel < 100) {
        const pct = Math.round(boostFuel);
        labelText = boostFuel < 5 ? 'EMPTY — RECHARGING' : `RECHARGING ${pct}%`;
        barColor  = '#0044aa';
        glowing   = false;
      }

      fuelBar.style.width = `${fillPct}%`;
      fuelBar.style.backgroundColor = barColor;
      fuelLabel.textContent = labelText;
      fuelContainer.style.boxShadow = glowing
        ? '0 0 14px 4px rgba(0, 180, 255, 0.8)'
        : 'none';
    }
  }

  composer.render();
  miniMap.draw();
}

// Start the engine
animate();
