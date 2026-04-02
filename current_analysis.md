# Codebase Analysis: WebGame

This document provides a detailed overview of the current state of the **WebGame** project, featuring recent updates to model loading, thrusters, and the procedural solar system.

---

## 1. Project Overview
The game is a 3D isometric space combat experience built with modern web technologies. It features a high-fidelity procedural solar system and responsive spaceflight mechanics.

- **Objective:** Competitive browser-based space combat.
- **Visual Style:** Isometric locked-camera with 3D model interaction and cinematic bloom.
- **Key Mechanics:** Trigonometric movement, Warp Drive, and orbital mechanics.

---

## 2. Technology Stack

### Frontend
- **Framework:** Vanilla Javascript
- **3D Engine:** [Three.js](https://threejs.org/) (v0.160.1)
- **Asset Loading:** [GLTFLoader](https://threejs.org/docs/#examples/en/loaders/GLTFLoader) for 3D models.
- **Post-Processing:** UnrealBloomPass for glowing thrusters and Sun effects.
- **Build Tool:** [Vite](https://vitejs.dev/) (v5.0.0)
- **Styling:** Vanilla CSS

### Backend
- **Platform:** [Node.js](https://nodejs.org/) (Initial setup phase)
- **Logic:** Custom game logic (Planned for multiplayer sync)

---

## 3. Project Structure

```text
WebGame/
├── client/                 # Frontend application
│   ├── src/                
│   │   ├── main.js        # Entry point: 3D Engine, Game Loop & Physics
│   │   ├── World.js       # Solar System Engine: Planets, Asteroids, Stars
│   │   ├── Input.js       # Input handling (Keyboard: WASD + Shift + Space)
│   │   ├── Camera.js      # Camera logic (Placeholder)
│   │   ├── Entities.js    # Game entity definitions (Placeholder)
│   │   └── Network.js     # Multiplayer syncing (Placeholder)
│   ├── public/             
│   │   ├── assets/        # 3D Assets (ship.glb)
│   │   └── textures/      # Planet and Sun textures
│   ├── index.html          # HUD Structure
│   ├── style.css           # HUD and Layout styling
│   └── package.json        
├── server/                 # Backend application (Planned)
└── solar_system_design.md  # Architectural vision for World.js
```

---

## 4. Key Implementation Details

### Client-Side Architecture
- **Isometric View:** Achieved using a `THREE.OrthographicCamera` with a dynamic follow-script that tracks the player's position.
- **Game Loop:** Utilizes `requestAnimationFrame` with `THREE.Clock` for frame-rate independent updates.
- **Input System:** Advanced tracking for `W` (Thrust), `A/D` (Rotation), `Space` (Brake), and `Shift` (Warp Drive).

### Visual Excellence (Latest)
- **Post-Processing:** Integrated `EffectComposer` with `UnrealBloomPass` to create cinematic light-bleed from the Sun and Engine Thrusters.
- **Dynamic Thrusters:** Ship model features procedural `CylinderGeometry` thrusters that scale and change opacity based on thrust inputs and velocity.
- **High-Fidelity Assets:** GLTF models with custom PBR materials injected at runtime (Metalness 0.8, Roughness 0.2).

### The Procedural Solar System (World.js)
- **Solar System Scale:** World radius expanded to **500 units**.
- **The Sun:** Central light source with `PointLight` and emissive material.
- **Planetary Bodies:** 8 unique planets (Mercury through Neptune) with real-world scale ratios and high-res textures.
- **Orbital Mechanics:** Planets move in realistic circular orbits at speeds matching Kepler's planetary laws.
- **Asteroid Belt:** Over **800** individually transforming asteroids orbiting in a dense belt between 60-95 units.
- **Atmospheric Depth:** Multi-layered starfields and volumetric space dust for enhanced parallax depth.

### Movement & Physics
- **Trigonometric Flight:** Movement uses `Math.sin`/`Math.cos` for relative thrust.
- **Warp Drive:** Pressing `Shift` triples max speed and doubles acceleration.
- **Boundary Interaction:** Players are restricted to the 500-unit circle and bounce off the edges with velocity loss.

---

## 5. Current Features
- [x] Basic 3D Scene (Scene, Camera, Renderer).
- [x] **Post-Processing (Bloom Filter).**
- [x] **3D Ship Model with Procedural Thrusters.**
- [x] **Warp Drive & Braking Mechanics.**
- [x] **Full Solar System (8 Planets + Sun).**
- [x] **Dynamic Asteroid Belt & Starfields.**
- [x] **Dynamic Follow Camera.**
- [x] Responsive window resizing support.
- [x] HUD UI structure (Health Bar, Score).

---

## 6. Upcoming Features
- [ ] **Combat Implementation:** Shooting projectiles and hit detection.
- [ ] **Multiplayer State:** Synchronization via Socket.io.
- [ ] **Enemy Entities:** Basic AI drones for dogfighting.
- [ ] **HUD Data Binding:** Connecting UI to player health/velocity.
