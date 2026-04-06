# Design Document: Procedural Solar System

This document outlines the architectural decisions and implementation details for the "Solar System" phase of the WebGame project.

## 1. Architectural Vision
The goal is to move from a static, hardcoded environment in `main.js` to a modular, object-oriented system managed by a `World` class. This ensures the environment is dynamic, extensible, and easier to maintain.

## 2. Components

### A. The Sun (Central Star)
- **Visuals**: A `SphereGeometry` with a `MeshBasicMaterial` (glowing orange/yellow).
- **Functionality**: Houses a `PointLight` that provides the primary illumination for the entire system.
- **Position**: Fixed at `(0, 0, 0)`.

### B. Procedural Planets
- **Generation**: A loop will create $N$ planets (default 5-8).
- **Parameters (Randomized)**:
    - `Orbit Radius`: Distance from the Sun (between 20 and 90 units).
    - `Size`: Sphere radius (between 1.5 and 5 units).
    - `Color`: HSL randomized to ensure high-vibrancy palettes.
    - `Orbital Speed`: How fast the planet moves (randomized).
- **Orbital Mechanics**:
    - Each planet will be placed inside an "Orbit Group" (`THREE.Group`).
    - Instead of moving the planet's position manually, we rotate the *Orbit Group*. This ensures perfectly circular movement with minimal math.

### C. The Starfield (Background)
- **Implementation**: A `BufferGeometry` with thousands of `Points`.
- **Optimization**: We use a single `Points` object instead of thousands of individual meshes to maintain a high frame rate.

## 3. Key Decisions

- **Decision 1: Modular World**: Move lighting and boundary logic from `main.js` to `World.js`.
    - *Why?* To keep `main.js` clean and focused on game logic while `World.js` handles the "stage".
- **Decision 2: HSL over Hex**: Use HSL for planet colors.
    - *Why?* It's much easier to randomize "hue" while keeping "saturation" and "lightness" consistent for a premium look.
- **Decision 3: Orthographic Perspective**: Maintain the isometric look.
    - *Why?* It simplifies navigation and gives the game a unique, tactical board-game feel.

## 4. Technical Requirements
- **Framework**: Three.js (WebGL).
- **Logic**: ES6 Modules for clean imports/exports.
- **Math**: Delta-time integration for frame-rate-independent orbital speeds.
