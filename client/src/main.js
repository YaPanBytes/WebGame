import * as THREE from 'three';
import { keys } from './Input.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { World } from './World.js';
import { MiniMap } from './MiniMap.js';

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

// --- 6. The Tactical Mini-Map ---
const miniMap = new MiniMap('mini-map-canvas', world, playerGroup);

// Initialize the loader
const loader = new GLTFLoader();
const thrusters = [];

// Load the 3D model from the public folder
loader.load(
  '/assets/ship.glb',
  (gltf) => {
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

  // 10. The Boundary Math
  const distFromCenter = Math.sqrt(playerGroup.position.x ** 2 + playerGroup.position.z ** 2);
  
  if (distFromCenter > world.WORLD_RADIUS) {
    const angle = Math.atan2(playerGroup.position.x, playerGroup.position.z);
    playerGroup.position.x = Math.sin(angle) * world.WORLD_RADIUS;
    playerGroup.position.z = Math.cos(angle) * world.WORLD_RADIUS;
    velocity *= 0.5; // Bounce off the wall
  }

  composer.render();
  miniMap.draw();
}

// Start the engine
animate();
