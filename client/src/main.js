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
const thrusters = [];

// Load the 3D model from the public folder
loader.load('/assets/ship.glb',(gltf) => {
    const shipModel = gltf.scene;

    shipModel.traverse((child) => {
      if (child.isMesh) {
        // Change the existing material's color to pure white (Hex: 0xffffff)
        child.material.color.setHex(0xffffff);
      }
    });
    // Scale the model down if it's too huge. Adjust these numbers as needed!
    shipModel.scale.set(1, 1, 1); 

    playerGroup.add(shipModel);
    console.log("Model loaded with realistic PBR and Thrusters!");
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

// --- NEW: Handle initial sync when we first connect ---
socket.on('connect', () => {
    // We strictly wait for the server to send us a 'forceRespawn' with our random location
    console.log("[📡] Connected to solar system. Waiting for spawn coordinates...");
});

// --- NEW: Handle Server-Forced Respawn Override ---
socket.on('forceRespawn', (data) => {
  playerGroup.position.x = data.x;
  playerGroup.position.z = data.z;
  playerGroup.visible = true; // Show ship now that it's moved from the origin
  hasReceivedSpawn = true; // We now have valid server-sent coordinates
  
  if (data.repel) {
    velocity = -Math.abs(velocity) * 0.8 - 2.0; // Hard bounce back
    // Flash HUD yellow/orange for damage
    const hpBarContainer = document.querySelector('.health-bar-container');
    if(hpBarContainer) {
      hpBarContainer.style.boxShadow = "0 0 20px 5px rgba(255, 170, 0, 0.8)";
      setTimeout(() => { hpBarContainer.style.boxShadow = "none"; }, 300);
    }
  } else {
    velocity = 0; // Stop moving
    // Flash HUD red to signify death
    const hpBarContainer = document.querySelector('.health-bar-container');
    if(hpBarContainer) {
      hpBarContainer.style.boxShadow = "0 0 20px 5px rgba(255, 0, 0, 0.8)";
      setTimeout(() => { hpBarContainer.style.boxShadow = "none"; }, 500);
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

  // 2. Physics & Warp Logic
  const isWarp = keys.shift;
  const currentMaxSpeed = isWarp ? MAX_BASE_SPEED * 3.0 : MAX_BASE_SPEED;
  const currentAcc = isWarp ? ACCELERATION * 2.0 : ACCELERATION;

  // 3. User Input (Throttle)
  if (keys.w) velocity += currentAcc;      // W = accelerate forward
  if (keys.s) velocity -= currentAcc * 1.5; // S = decelerate / reverse thrust

  // 4. Apply Damping (Coasting in space)
  velocity *= DAMPING;

  // Cap Velocity
  velocity = Math.max(-currentMaxSpeed / 2, Math.min(velocity, currentMaxSpeed));

  // --- 5.5 Combat Input (Fire) — SPACEBAR fires ---
  const now = Date.now();
  if (keys.space && now - lastFireTime > FIRE_COOLDOWN) {
    // Spawn bullet slightly ahead of the ship so it doesn't hit self
    const spawnOffset = 6;
    socket.emit('fire', {
      x: playerGroup.position.x + Math.sin(playerGroup.rotation.y) * spawnOffset,
      z: playerGroup.position.z + Math.cos(playerGroup.rotation.y) * spawnOffset,
      rotation: playerGroup.rotation.y
    });
    lastFireTime = now;
    console.log("🔥 Pew Pew!");
  }

  // 6. Thruster Visuals (React to Thrust and Velocity)
  const isThrusting = keys.w;
  const targetScale = isThrusting ? (isWarp ? 4.0 : 2.0) + Math.random() * 0.5 : (Math.abs(velocity) * 0.5 + 0.2);
  const targetOpacity = isThrusting ? 0.9 : (Math.abs(velocity) * 0.2 + 0.1);

  thrusters.forEach(t => {
    t.scale.set(1, targetScale, 1); 
    t.material.opacity = THREE.MathUtils.lerp(t.material.opacity, targetOpacity, 0.1);
  });

  // 7. Handle Rotation — A = turn right, D = turn left
  if (keys.a) playerGroup.rotation.y -= turnSpeed;
  if (keys.d) playerGroup.rotation.y += turnSpeed;

  // 8. Move Ship based on Velocity
  playerGroup.position.x += Math.sin(playerGroup.rotation.y) * velocity;
  playerGroup.position.z += Math.cos(playerGroup.rotation.y) * velocity;

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
  
  // Check Sun
  if (world.sunMesh) {
    const sunDist = Math.sqrt(myPos.x ** 2 + myPos.z ** 2);
    if (sunDist < 45 + SHIP_HITBOX) {
        // Bounce
        velocity = -Math.abs(velocity) * 0.8 - 2.0;
        
        // Push out slightly to prevent getting stuck
        const pushAngle = Math.atan2(myPos.x, myPos.z);
        myPos.x = Math.sin(pushAngle) * (45 + SHIP_HITBOX + 1);
        myPos.z = Math.cos(pushAngle) * (45 + SHIP_HITBOX + 1);

        if (nowTime - lastEnvDamageTime > 500) {
            socket.emit('takeDamage', 20);
            lastEnvDamageTime = nowTime;
            
            // Flash HUD
            const hpBarContainer = document.querySelector('.health-bar-container');
            if(hpBarContainer) {
                hpBarContainer.style.boxShadow = "0 0 20px 5px rgba(255, 170, 0, 0.8)";
                setTimeout(() => { hpBarContainer.style.boxShadow = "none"; }, 300);
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
             // Bounce
             velocity = -Math.abs(velocity) * 0.8 - 2.0;

             // WE NEED TO PUSH OUT HERE!
             const pushAngle = Math.atan2(myPos.x - planetWorldPos.x, myPos.z - planetWorldPos.z);
             myPos.x = planetWorldPos.x + Math.sin(pushAngle) * (planetRadius + SHIP_HITBOX + 1);
             myPos.z = planetWorldPos.z + Math.cos(pushAngle) * (planetRadius + SHIP_HITBOX + 1);

             if (nowTime - lastEnvDamageTime > 500) {
                 socket.emit('takeDamage', 20);
                 lastEnvDamageTime = nowTime;
                 
                 // Flash HUD
                 const hpBarContainer = document.querySelector('.health-bar-container');
                 if(hpBarContainer) {
                     hpBarContainer.style.boxShadow = "0 0 20px 5px rgba(255, 170, 0, 0.8)";
                     setTimeout(() => { hpBarContainer.style.boxShadow = "none"; }, 300);
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
      
      // 1. Check for Hit (HP dropped)
      if (serverPlayerData.hp < enemyPlaneObj.lastHp && serverPlayerData.hp > 0) {
        // Flash Red!
        enemyPlaneObj.model.traverse((child) => {
          if (child.isMesh) {
            child.material.color.setHex(0xff0000); 
            child.material.emissive.setHex(0x550000);
          }
        });
        
        // Reset color after 150ms
        setTimeout(() => {
          if (enemyPlanes[id]) { // Check if they didn't disconnect
             enemyPlanes[id].model.traverse((child) => {
               if (child.isMesh) {
                 child.material.color.setHex(0xffffff);
                 child.material.emissive.setHex(0x000000);
               }
             });
          }
        }, 150);
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

  composer.render();
  miniMap.draw();
}

// Start the engine
animate();
