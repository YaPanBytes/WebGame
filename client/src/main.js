import * as THREE from 'three';
import { keys } from './Input.js';
// --- 1. Core Setup ---
const canvasContainer = document.getElementById('game-container');
const scene = new THREE.Scene();

// --- 2. Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio); // Keeps it sharp on high-res displays
canvasContainer.appendChild(renderer.domElement);

// --- 3. The Isometric Camera ---
// Using Orthographic to remove depth distortion. 
const aspect = window.innerWidth / window.innerHeight;
const frustumSize = 50; // Controls "zoom". Higher number = see more of the map.

const camera = new THREE.OrthographicCamera(
  (frustumSize * aspect) / -2, // left
  (frustumSize * aspect) / 2,  // right
  frustumSize / 2,             // top
  frustumSize / -2,            // bottom
  1,                           // near clipping plane
  1000                         // far clipping plane
);

// Position it diagonally and point it at the center of the world
camera.position.set(50, 50, 50);
camera.lookAt(0, 0, 0);

// --- 4. Lighting ---
// Soft global light so shadows aren't pitch black
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

// The "Sun" - a point light at the center of your solar system
const sunLight = new THREE.PointLight(0xffaa00, 2, 300);
sunLight.position.set(0, 0, 0);
scene.add(sunLight);

// --- 5. Placeholders (To see it working) ---
// A grid makes it infinitely easier to visualize the X/Z movement plane
const gridHelper = new THREE.GridHelper(100, 20, 0x00ffff, 0x444444);
scene.add(gridHelper);

// A placeholder for your plane model
const geometry = new THREE.BoxGeometry(4, 2, 4);
const material = new THREE.MeshStandardMaterial({ color: 0x00ffaa });
const playerPlaceholder = new THREE.Mesh(geometry, material);
scene.add(playerPlaceholder);

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
});

// --- 7. The Game Loop ---
// --- 7. The Game Loop ---
const speed = 0.3;      // How fast the plane moves forward
const turnSpeed = 0.05; // How fast the plane rotates

function animate() {
  requestAnimationFrame(animate);

  // 1. Handle Rotation (A and D keys)
  if (keys.a) {
    playerPlaceholder.rotation.y += turnSpeed;
  }
  if (keys.d) {
    playerPlaceholder.rotation.y -= turnSpeed;
  }

  // 2. Handle Forward Movement (W key)
  // We use Sine and Cosine to calculate the X and Z velocity based on where the box is pointing
  if (keys.w) {
    playerPlaceholder.position.x += Math.sin(playerPlaceholder.rotation.y) * speed;
    playerPlaceholder.position.z += Math.cos(playerPlaceholder.rotation.y) * speed;
  }

  // 3. Handle Reverse (S key)
  if (keys.s) {
    playerPlaceholder.position.x -= Math.sin(playerPlaceholder.rotation.y) * speed;
    playerPlaceholder.position.z -= Math.cos(playerPlaceholder.rotation.y) * speed;
  }

  // Render the scene
  renderer.render(scene, camera);
}

// Start the engine
animate();
// Start the engine
animate();