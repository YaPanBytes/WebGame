import * as THREE from 'three';

export class World {
  constructor(scene) {
    this.scene = scene;
    this.planets = [];
    this.textureLoader = new THREE.TextureLoader();
    
    // --- 1. Lighting ---
    // Soft global light
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(this.ambientLight);

    // The Sun - a point light at the center
    this.sunLight = new THREE.PointLight(0xffaa00, 2, 300);
    this.sunLight.position.set(0, 0, 0);
    this.scene.add(this.sunLight);

    // Sun Visual Mesh
    const sunGeometry = new THREE.SphereGeometry(45, 64, 64);
    const sunMaterial = new THREE.MeshStandardMaterial({ 
        emissive: 0xffaa00, 
        emissiveIntensity: 2 
    });
    
    // Try to load Sun texture
    this.textureLoader.load('textures/planets/sun.jpg', (tex) => {
        sunMaterial.map = tex;
        sunMaterial.needsUpdate = true;
    });

    this.sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    this.scene.add(this.sunMesh);

    // --- 2. World Boundary ---
    this.WORLD_RADIUS = 2500; // Expanded to 2500 to fit Neptune (~2053)
    const boundaryGeometry = new THREE.RingGeometry(this.WORLD_RADIUS - 2, this.WORLD_RADIUS, 128);
    const boundaryMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff0000, 
      side: THREE.DoubleSide, 
      transparent: true, 
      opacity: 0.3 
    });
    this.boundaryMesh = new THREE.Mesh(boundaryGeometry, boundaryMaterial);
    this.boundaryMesh.rotation.x = Math.PI / 2; 
    this.scene.add(this.boundaryMesh);

    // --- 3. Starfield (Expanded for Depth) ---
    this.createStarfield();

    // --- 4. Real-World Planets (Ratios) ---
    this.generatePlanets(); 

    // --- 5. Asteroid Belt (Expanded) ---
    this.generateAsteroidBelt(360, 540, 1200); 

    // --- 6. Volumetric Space Dust ---
    this.createSpaceDust();
  }

  createSpaceDust() {
    const dustGeometry = new THREE.BufferGeometry();
    const dustMaterial = new THREE.PointsMaterial({ 
        color: 0xffffff, 
        size: 0.05, 
        transparent: true, 
        opacity: 0.2 
    });

    const dustVertices = [];
    for (let i = 0; i < 4000; i++) {
        const x = (Math.random() - 0.5) * 6000;
        const y = (Math.random() - 0.5) * 1000;
        const z = (Math.random() - 0.5) * 6000;
        dustVertices.push(x, y, z);
    }

    dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustVertices, 3));
    this.dust = new THREE.Points(dustGeometry, dustMaterial);
    this.scene.add(this.dust);
  }

  generateAsteroidBelt(inner, outer, count) {
    this.asteroidInner = inner;
    this.asteroidOuter = outer;
    this.asteroids = [];
    for (let i = 0; i < count; i++) {
        const radius = inner + Math.random() * (outer - inner);
        const angle = Math.random() * Math.PI * 2;
        const speed = (0.2 + Math.random() * 0.3) / Math.sqrt(radius);

        const asteroidGeometry = new THREE.IcosahedronGeometry(0.2 + Math.random() * 0.3, 0);
        const asteroidMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x888888, 
            roughness: 1 
        });
        const asteroid = new THREE.Mesh(asteroidGeometry, asteroidMaterial);

        // Randomize initial position and rotation
        asteroid.position.set(
            Math.cos(angle) * radius,
            (Math.random() - 0.5) * 2, // Slight vertical spread
            Math.sin(angle) * radius
        );
        asteroid.rotation.set(Math.random(), Math.random(), Math.random());
        
        this.scene.add(asteroid);
        this.asteroids.push({
            mesh: asteroid,
            radius: radius,
            angle: angle,
            speed: speed,
            rotationSpeed: Math.random() * 0.02
        });
    }
  }

  createStarfield() {
    const starCounts = [3000, 1000, 300]; // Densities for each layer
    const starSizes = [1.5, 2.0, 3.0]; // Sizes for each layer
    const starColors = [0xffffff, 0xaaaaaa, 0x99ccff]; // Colors for depth

    for (let i = 0; i < starCounts.length; i++) {
        const starGeometry = new THREE.BufferGeometry();
        const starMaterial = new THREE.PointsMaterial({ 
            color: starColors[i], 
            size: starSizes[i],
            transparent: true,
            opacity: 0.8,
            sizeAttenuation: false
        });

        const starVertices = [];
        for (let j = 0; j < starCounts[i]; j++) {
            // Distribute stars in a giant sphere for a more natural look
            const r = 1000 + Math.random() * 4000; // Larger Radius range for 2000 radius world
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);
            starVertices.push(x, y, z);
        }

        starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
        const stars = new THREE.Points(starGeometry, starMaterial);
        this.scene.add(stars);
    }
  }

  generatePlanets() {
    const PLANET_DATA = [
        { name: "Mercury", au: 0.39, size: 0.38, color: 0x97979f, roughness: 0.9 },
        { name: "Venus", au: 0.72, size: 0.95, color: 0xe3bb76, roughness: 0.8 },
        { name: "Earth", au: 1.00, size: 1.00, color: 0x2271b3, roughness: 0.4 },
        { name: "Mars", au: 1.52, size: 0.53, color: 0xe27b58, roughness: 0.9 },
        { name: "Jupiter", au: 5.20, size: 11.21, color: 0xd39c7e, roughness: 0.3 },
        { name: "Saturn", au: 9.58, size: 9.45, color: 0xc5ab6e, roughness: 0.3, hasRings: true },
        { name: "Uranus", au: 19.22, size: 4.01, color: 0xb5e3e3, roughness: 0.3 },
        { name: "Neptune", au: 30.05, size: 3.88, color: 0x4b70dd, roughness: 0.3 }
    ];

    const DISTANCE_OFFSET = 250.0; // Increased to accommodate larger Sun
    const DISTANCE_SCALE = 60.0; 
    const SIZE_SCALE = 10.0;     // Dramatically larger planets

    PLANET_DATA.forEach((data) => {
        const orbitRadius = DISTANCE_OFFSET + (data.au * DISTANCE_SCALE);
        
        // Use Math.sqrt for size to prevent Jupiter (11x) from being TOO huge
        const planetSize = SIZE_SCALE * Math.pow(data.size, 0.4); 
        
        // Kepler's Third Law (Simplified): Speed is inversely proportional to sqrt of distance
        const orbitalSpeed = 0.5 / Math.sqrt(orbitRadius); 

        const orbitGroup = new THREE.Group();
        orbitGroup.rotation.y = Math.random() * Math.PI * 2; // Randomize start position
        this.scene.add(orbitGroup);

        const planetGeometry = new THREE.SphereGeometry(planetSize, 64, 64);
        const planetMaterial = new THREE.MeshStandardMaterial({ 
            color: data.color, // Fallback color
            roughness: data.roughness,
            metalness: 0.05
        });

        // Async Texture Loading
        this.textureLoader.load(`textures/planets/${data.name.toLowerCase()}.jpg`, (tex) => {
            tex.anisotropy = 8; // Keep it sharp at isometric angles
            planetMaterial.map = tex;
            planetMaterial.color.set(0xffffff); // Remove tint to show raw texture
            planetMaterial.needsUpdate = true;
        });
        
        const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
        planetMesh.position.set(orbitRadius, 0, 0);
        orbitGroup.add(planetMesh);

        // Special Case: Saturn's Rings
        if (data.hasRings) {
            const innerRadius = planetSize * 1.4;
            const outerRadius = planetSize * 2.2;
            const ringGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 64);
            const ringMaterial = new THREE.MeshStandardMaterial({ 
                color: data.color, 
                side: THREE.DoubleSide, 
                transparent: true, 
                opacity: 0.6,
                roughness: 0.5
            });
            const rings = new THREE.Mesh(ringGeometry, ringMaterial);
            rings.rotation.x = Math.PI / 2.5; // Tilted rings
            planetMesh.add(rings); // Attach to the planet mesh
        }

        this.planets.push({
            id: data.name.toLowerCase(),
            name: data.name,
            group: orbitGroup,
            speed: orbitalSpeed
        });
    });
  }

  update(deltaTime, serverState = null) {
    // 1. Sync planets with server if available
    if (serverState && serverState.planets) {
        this.planets.forEach(p => {
            const serverPlanet = serverState.planets[p.id];
            if (serverPlanet) {
                p.group.rotation.y = serverPlanet.angle;
            }
        });
    } else {
        // Fallback to local math if no server data
        this.planets.forEach(p => {
            p.group.rotation.y += p.speed * deltaTime;
        });
    }

    // Update Asteroids
    if (this.asteroids) {
        this.asteroids.forEach(a => {
            a.angle += a.speed * deltaTime;
            a.mesh.position.x = Math.cos(a.angle) * a.radius;
            a.mesh.position.z = Math.sin(a.angle) * a.radius;
            a.mesh.rotation.y += a.rotationSpeed;
        });
    }

    // Gentle Space Dust Drift
    if (this.dust) {
        this.dust.rotation.y += 0.01 * deltaTime;
    }
  }
}