import * as THREE from 'three';
import { keys } from './Input.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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

// --- 5. The Player Object ---
const playerGroup = new THREE.Group();
scene.add(playerGroup);

// Initialize the loader
const loader = new GLTFLoader();

// Load the 3D model from the public folder
// Load the 3D model from the public folder
loader.load(
  '/assets/ship.glb', 
  (gltf) => {
    const shipModel = gltf.scene;
    // --- NEW: Paint every part of the ship white ---
    shipModel.traverse((child) => {
      if (child.isMesh) {
        // Change the existing material's color to pure white (Hex: 0xffffff)
        child.material.color.setHex(0xffffff);
      }
    });
    
    // Scale the model down if it's too huge. Adjust these numbers as needed!
    shipModel.scale.set(1, 1, 1); 

    playerGroup.add(shipModel);
    console.log("Model loaded and painted white!");
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
});

// --- 7. The Game Loop ---
const speed = 1.0;      
const turnSpeed = 0.09; 

function animate() {
  requestAnimationFrame(animate);

  // 1. Handle Rotation
  if (keys.a) {
    playerGroup.rotation.y += turnSpeed;
  }
  if (keys.d) {
    playerGroup.rotation.y -= turnSpeed;
  }

  // 2. Handle Forward Movement
  if (keys.w) {
    playerGroup.position.x += Math.sin(playerGroup.rotation.y) * speed;
    playerGroup.position.z += Math.cos(playerGroup.rotation.y) * speed;
  }

  // 3. Handle Reverse
  if (keys.s) {
    playerGroup.position.x -= Math.sin(playerGroup.rotation.y) * speed;
    playerGroup.position.z -= Math.cos(playerGroup.rotation.y) * speed;
  }

  renderer.render(scene, camera);
}

// Start the engine
animate();
