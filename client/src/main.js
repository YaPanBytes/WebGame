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
  1000                         // far clipping plane
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

// --- 5. The Player Object ---
const playerGroup = new THREE.Group();
playerGroup.position.set(0, 0, 160); // Spawn safely outside the enlarged Sun
scene.add(playerGroup);
// --- Weapon System Variables ---
const projectiles = []; // Array to track all active bullets on screen
const networkProjectiles = {}; // Tracks bullets fired by other players
const enemyBulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red lasers!
let lastFireTime = 0;
const FIRE_COOLDOWN = 150; // Milliseconds between shots (lower = faster firing)

// Create the laser template (A long, thin neon green cylinder)
const bulletGeometry = new THREE.CylinderGeometry(0.3, 0.3, 4, 8);
// By default, Three.js cylinders stand straight up (Y-axis). 
// We rotate it 90 degrees so it points forward (Z-axis).
bulletGeometry.rotateX(Math.PI / 2); 
const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); // Neon Green
const enemyPlanes = {}; 
// We will clone your ship model for the enemies
let enemyModelTemplate = null;
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

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = clock.getDelta();

  // 1. Update World (Orbital Motion & Asteroids)
  world.update(deltaTime);

  // 2. Physics & Warp Logic
  const isWarp = keys.shift;
  const currentMaxSpeed = isWarp ? MAX_BASE_SPEED * 3.0 : MAX_BASE_SPEED;
  const currentAcc = isWarp ? ACCELERATION * 2.0 : ACCELERATION;

  // 3. User Input (Throttle)
  if (keys.w) velocity += currentAcc;
  if (keys.s) velocity -= currentAcc;

  // 4. Hard Brake (Space)
  if (keys.space) {
    velocity *= 0.92;
  }

  // 5. Apply Damping (Coasting)
  velocity *= DAMPING;

  // Cap Velocity
  velocity = Math.max(-currentMaxSpeed / 2, Math.min(velocity, currentMaxSpeed));

  // 6. Thruster Visuals (React to Thrust and Velocity)
  const isThrusting = keys.w;
  const targetScale = isThrusting ? (isWarp ? 4.0 : 2.0) + Math.random() * 0.5 : (Math.abs(velocity) * 0.5 + 0.2);
  const targetOpacity = isThrusting ? 0.9 : (Math.abs(velocity) * 0.2 + 0.1);

  thrusters.forEach(t => {
    t.scale.set(1, targetScale, 1); 
    t.material.opacity = THREE.MathUtils.lerp(t.material.opacity, targetOpacity, 0.1);
  });

  // 7. Handle Rotation
  if (keys.a) playerGroup.rotation.y += turnSpeed;
  if (keys.d) playerGroup.rotation.y -= turnSpeed;

  // 8. Move Ship based on Velocity
  playerGroup.position.x += Math.sin(playerGroup.rotation.y) * velocity;
  playerGroup.position.z += Math.cos(playerGroup.rotation.y) * velocity;

  // 9. Camera Follow (Dynamic Isometric)
  const cameraOffset = new THREE.Vector3(50, 50, 50);
  camera.position.copy(playerGroup.position).add(cameraOffset);
  camera.lookAt(playerGroup.position);
// --- NEW: Combat System ---
  const currentTime = Date.now();

 // 1. Firing Logic
  if (keys.f && currentTime - lastFireTime > FIRE_COOLDOWN) {
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
    
    // Start at the ship's center...
    bullet.position.copy(playerGroup.position);
    bullet.rotation.y = playerGroup.rotation.y;

    // --- NEW: The Spawn Offset ---
    // Push the bullet 5 units forward so it spawns at the "nose" of the ship, not inside it!
    const offset = 5; 
    bullet.position.x += Math.sin(bullet.rotation.y) * offset;
    bullet.position.z += Math.cos(bullet.rotation.y) * offset;
    
    scene.add(bullet);
    projectiles.push(bullet);
    lastFireTime = currentTime;

    if (socket.connected) {
      socket.emit('fire', {
        x: bullet.position.x,
        z: bullet.position.z,
        rotation: bullet.rotation.y
      });
    }
  }

  // 2. Projectile Movement
  const bulletSpeed = MAX_BASE_SPEED * 8.0; // Lasers should be way faster than ships

  // We loop backward through the array. This is a classic game dev trick 
  // so we can safely delete bullets from the array without breaking the loop!
  for (let i = projectiles.length - 1; i >= 0; i--) {
    let p = projectiles[i];
    
    // Move the bullet forward based on its rotation
    p.position.x += Math.sin(p.rotation.y) * bulletSpeed;
    p.position.z += Math.cos(p.rotation.y) * bulletSpeed;

    // Cleanup: If the bullet flies past the world boundary, delete it to save memory
    const bulletDist = Math.sqrt(p.position.x ** 2 + p.position.z ** 2);
    if (bulletDist > world.WORLD_RADIUS) {
      scene.remove(p);
      projectiles.splice(i, 1);
    }
  }
  // 10. The Boundary Math
  const distFromCenter = Math.sqrt(playerGroup.position.x ** 2 + playerGroup.position.z ** 2);
  
  if (distFromCenter > world.WORLD_RADIUS) {
    const angle = Math.atan2(playerGroup.position.x, playerGroup.position.z);
    playerGroup.position.x = Math.sin(angle) * world.WORLD_RADIUS;
    playerGroup.position.z = Math.cos(angle) * world.WORLD_RADIUS;
    velocity *= 0.5; // Bounce off the wall
  }
// ... [Your Boundary Math] ...
  
  // --- NEW: Tell the server where we calculated we should be ---
  if (socket.connected) {
    socket.emit('playerMoved', {
      x: playerGroup.position.x,
      z: playerGroup.position.z,
      rotation: playerGroup.rotation.y
    });
  }
  // --- NEW: Sync Enemy Planes ---
  if (enemyModelTemplate && serverState.players) {
    // Loop through all players the server knows about
    for (const id in serverState.players) {
      // Ignore ourselves!
      if (id === socket.id) continue;

      const serverPlayerData = serverState.players[id];

      // If this enemy doesn't exist on our screen yet, create them!
      if (!enemyPlanes[id]) {
        const newEnemy = new THREE.Group();
        newEnemy.add(enemyModelTemplate.clone()); // Clone the 3D model
        scene.add(newEnemy);
        enemyPlanes[id] = newEnemy;
      }

      // Snap the enemy plane to the server's coordinates
      enemyPlanes[id].position.x = serverPlayerData.x;
      enemyPlanes[id].position.z = serverPlayerData.z;
      
      // We use lerp (Linear Interpolation) for rotation so it looks smooth, not snappy
      enemyPlanes[id].rotation.y = THREE.MathUtils.lerp(
        enemyPlanes[id].rotation.y, 
        serverPlayerData.rotation, 
        0.2
      );
    }

    // Cleanup: Remove planes that disconnected
    for (const id in enemyPlanes) {
      if (!serverState.players[id]) {
        scene.remove(enemyPlanes[id]);
        delete enemyPlanes[id];
      }
    }
    // ... (Your enemyPlanes cleanup loop is right above this)

    // --- 1. SYNC SERVER PROJECTILES (RED LASERS) ---
    if (serverState.projectiles) {
      const activeServerBullets = {};

      serverState.projectiles.forEach(p => {
        // Ignore our own bullets (we are already drawing them in neon green!)
        if (p.ownerId === socket.id) return; 

        activeServerBullets[p.id] = true;

        // If we haven't drawn this enemy bullet yet, spawn it
        if (!networkProjectiles[p.id]) {
           const bullet = new THREE.Mesh(bulletGeometry, enemyBulletMaterial);
           scene.add(bullet);
           networkProjectiles[p.id] = bullet;
        }

        // Snap the red laser to the exact position the server says it is
        networkProjectiles[p.id].position.set(p.x, playerGroup.position.y, p.z);
        networkProjectiles[p.id].rotation.y = p.rotation;
      });

      // Cleanup: Remove red lasers that hit something or flew off the map
      for (let id in networkProjectiles) {
        if (!activeServerBullets[id]) {
          scene.remove(networkProjectiles[id]);
          delete networkProjectiles[id];
        }
      }
    }

    // --- 2. SYNC HEALTH & RESPAWN ---
    if (serverState.players[socket.id]) {
      const myServerData = serverState.players[socket.id];
      
      // Update HTML Health Bar
      const hpFill = document.getElementById('health-bar-fill');
      if (hpFill) {
        hpFill.style.width = myServerData.hp + '%';
        // Turn health bar red if below 30 HP
        hpFill.style.background = myServerData.hp > 30 ? '#00ff00' : '#ff0000'; 
      }

      // Teleportation Check for Respawns
      // If the server's X/Z is massively different from our local X/Z, 
      // it means the server killed us and forced a respawn!
      const distToServer = Math.sqrt(
        (playerGroup.position.x - myServerData.x) ** 2 +
        (playerGroup.position.z - myServerData.z) ** 2
      );

      if (distToServer > 20) {
        console.log("💥 Ship Destroyed! Warping to new sector...");
        playerGroup.position.x = myServerData.x;
        playerGroup.position.z = myServerData.z;
        velocity = 0; // Kill momentum so you don't instantly fly away on spawn
      }
    }
  }
  composer.render();
  miniMap.draw();
}

// Start the engine
animate();
