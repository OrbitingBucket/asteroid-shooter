import Phaser from 'phaser';

// --- Get initial screen dimensions ---
// Note: These might change on resize, use scene.scale inside functions
// const screenWidth = window.innerWidth;
// const screenHeight = window.innerHeight;

// --- Configuration ---
const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,  // Use window size initially
    height: window.innerHeight,
    parent: 'app', // Make sure you have <div id="app"></div> in your HTML
    backgroundColor: '#005D83', // Dark blue space background
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            // Set large world bounds if needed, or rely on cleanup
            // worldBounds: new Phaser.Geom.Rectangle(-2000, -2000, 4000, 4000),
            debug: false // Set to true to see physics bodies
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

// --- Game Initialization ---
const game = new Phaser.Game(config);

// --- Game Variables ---
let player;
let playerGraphics;
let cursors;
let wasdKeys;
let spaceKey;
let gridGraphics;
let asteroidsGroup; // Physics group for asteroids
let asteroidSpawnTimer;
let proactiveSpawnTimer; // Timer for the new system
let bulletsGroup;   // Physics group for bullets
let lastFiredTime = 0; // For shooting cooldown
let particleEmitter; // For explosion effects

// --- Constants ---

// Grid
const GRID_SIZE = 50;
const GRID_COLOR = 0x4488ff;
const GRID_ALPHA = 0.3;
const GRID_LINE_WIDTH = .35;

// Player
const SHIP_SPEED = 250;
const PLAYER_SIZE = { width: 20, height: 30 };
const PLAYER_LINE_WIDTH = 2;
const PLAYER_ANGULAR_VELOCITY = 250;
const PLAYER_DRAG = 0.2;
const PLAYER_ANGULAR_DRAG = 200;

// Asteroid Categories Configuration
const ASTEROID_CATEGORIES = {
    XS: { minSize: 10, maxSize: 15, hp: 1, breakInto: null, breakCount: 0 },
    S:  { minSize: 16, maxSize: 24, hp: 2, breakInto: null, breakCount: 0 },
    M:  { minSize: 25, maxSize: 40, hp: 3, breakInto: null, breakCount: 0 }, // Changed breakInto to S
    // L:  { minSize: 41, maxSize: 55, hp: 2, breakInto: 'M', breakCount: 2 }, // For future implementation
    // XL: { minSize: 56, maxSize: 70, hp: 3, breakInto: 'M', breakCount: 3 }  // For future implementation
};
// Currently active categories for spawning
const ACTIVE_ASTEROID_CATEGORIES = ['XS', 'S', 'M'];

// General Asteroid Constants
const ASTEROID_LINE_WIDTH = 1.5;
const ASTEROID_COLOR = 0xffffff;
const ASTEROID_JAGGEDNESS = 0.4; // Shape irregularity factor
const ASTEROID_MIN_VERTICES = 6; // Min vertices for shape
const ASTEROID_MAX_VERTICES = 11;// Max vertices for shape
const ASTEROID_SPAWN_RATE = 2500; // Milliseconds between standard off-screen spawns
const ASTEROID_MIN_SPEED = 30;    // Min initial speed
const ASTEROID_MAX_SPEED = 80;    // Max initial speed
const ASTEROID_MAX_ROTATION_SPEED = 60; // Degrees per second max angular velocity
const ASTEROID_BOUNCE = 0.8;      // Elasticity for collisions
const SPAWN_BUFFER = 100;         // How far off-screen to spawn (standard timer)
const CLEANUP_BUFFER = 400;       // How far off-screen before despawning
const SPAWN_CHECK_RADIUS_MULTIPLIER = 1.2; // Multiplier for overlap check distance
const SPAWN_MAX_RETRIES = 15;      // Attempts to find non-overlapping spot (Increased slightly for proactive)
const ASTEROID_HIT_FILL_COLOR = 0xffffff; // Color for hit flash
const ASTEROID_HIT_FILL_ALPHA = 0.4;    // Alpha for hit flash
const ASTEROID_HIT_DURATION = 100;      // Duration of hit flash in ms

// *** NEW/UPDATED Asteroid Generation Strategy Constants ***
const ASTEROID_INITIAL_COUNT = 20; // Number of asteroids at game start
const PLAYER_INITIAL_SAFE_ZONE_RADIUS = 150; // Don't spawn initial asteroids too close to player start
const PLAYER_SPEED_THRESHOLD_FOR_BIAS = 50; // Player speed needed to trigger biased spawning (for edge selection)
const SPAWN_BIAS_STRENGTH = 0.6; // How much to favor the forward direction (0 = no bias, 1 = heavily biased)

// *** NEW Constants for Proactive Spawning ***
// How far out to check for density, relative to camera view size.
// E.g., 2.5 means check a region 2.5x the width/height of the view, centered on the player.
const PROACTIVE_GENERATION_RADIUS_MULTIPLIER = 2.5;
// The minimum number of asteroids we want in each 'distant' quadrant.
const TARGET_ASTEROIDS_PER_QUADRANT = 4;
// How often (in ms) to check and potentially fill distant areas.
const PROACTIVE_SPAWN_INTERVAL = 2000; // Check every 2 seconds
// How far beyond the immediate view to consider "distant" for proactive spawning.
// This should be larger than SPAWN_BUFFER.
const PROACTIVE_INNER_BUFFER = SPAWN_BUFFER * 1.5;


// Bullets
const BULLET_SPEED = 1500;
const BULLET_COOLDOWN = 300;
const BULLET_LENGTH = 32;         // Visual length of the bullet line
const BULLET_THICKNESS = 3;         // Visual thickness
const BULLET_COLOR = 0x06a2c6;    // Bright green color
const BULLET_CLEANUP_BUFFER = 50;   // How far off-screen before despawning

// Explosion Particles
const PARTICLE_SIZE = 3; // Size of the particle texture
const EXPLOSION_PARTICLE_COUNT = 25; // How many particles per explosion
const EXPLOSION_PARTICLE_LIFESPAN = 400; // Milliseconds particles last
const EXPLOSION_PARTICLE_SPEED = 180; // Max speed of particles

// --- Temporary Variables (for calculations, avoid recreating in loops) ---
let tempVec1 = new Phaser.Math.Vector2();
let tempVec2 = new Phaser.Math.Vector2();
let tempSpawnPoint = new Phaser.Math.Vector2();
let tempBulletPos = new Phaser.Geom.Point(); // Using Geom.Point for transformPoint output

// --- Phaser Scene Functions ---

function preload() {
    // Generate a simple square texture for particles
    const graphics = this.make.graphics();
    graphics.fillStyle(0xffffff); // White color
    graphics.fillRect(0, 0, PARTICLE_SIZE, PARTICLE_SIZE); // Draw a square
    graphics.generateTexture('particle', PARTICLE_SIZE, PARTICLE_SIZE); // Create texture named 'particle'
    graphics.destroy(); // Clean up the graphics object
}

function create() {
    const scene = this; // 'this' refers to the Scene object Phaser creates

    // --- Get Actual Initial Game Size ---
    const gameWidth = scene.scale.width;
    const gameHeight = scene.scale.height;
    console.log(`Initial game size: ${gameWidth} x ${gameHeight}`);

    // --- Grid Setup ---
    gridGraphics = scene.add.graphics().setDepth(-1); // Draw grid behind everything

    // --- Player Setup ---
    playerGraphics = scene.add.graphics();
    drawPlayerShape(playerGraphics); // Draw the triangle
    player = scene.add.container(gameWidth / 2, gameHeight / 2, [playerGraphics]);
    player.angle = -90; // Point upwards initially
    scene.physics.world.enable(player);
    player.body.setSize(PLAYER_SIZE.width, PLAYER_SIZE.height);
    player.body.setOffset(-PLAYER_SIZE.width / 2, -PLAYER_SIZE.height / 2);
    player.body.setCollideWorldBounds(false); // Allow moving off-screen
    player.body.setDamping(true);
    player.body.setDrag(PLAYER_DRAG, PLAYER_DRAG);
    player.body.setAngularDrag(PLAYER_ANGULAR_DRAG);
    player.body.setMaxVelocity(SHIP_SPEED * 1.5);

    // --- Camera Setup ---
    // scene.cameras.main.setBounds(-Infinity, -Infinity, Infinity, Infinity); // Not strictly needed with cleanup
    scene.cameras.main.startFollow(player, true, 0.1, 0.1); // Use lerp for smoother follow
    scene.cameras.main.setBackgroundColor(config.backgroundColor);
    // Set camera bounds manually if needed for world limits, but cleanup is generally preferred for infinite feel
    // scene.cameras.main.setBounds(-WORLD_BOUNDS/2, -WORLD_BOUNDS/2, WORLD_BOUNDS, WORLD_BOUNDS);


    // --- Input Setup ---
    cursors = scene.input.keyboard.createCursorKeys();
    wasdKeys = scene.input.keyboard.addKeys('W,A,S,D');
    spaceKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // --- Asteroid Setup ---
    asteroidsGroup = scene.physics.add.group({
        bounceX: ASTEROID_BOUNCE,
        bounceY: ASTEROID_BOUNCE,
        collideWorldBounds: false, // Rely on cleanup
    });

    // --- Bullet Setup ---
    bulletsGroup = scene.physics.add.group({
        collideWorldBounds: false, // Rely on cleanup
        allowGravity: false,       // Bullets shouldn't fall
    });
    lastFiredTime = 0;

    // --- Particle Setup ---
    particleEmitter = scene.add.particles(0, 0, 'particle', {
        speed: { min: 50, max: EXPLOSION_PARTICLE_SPEED },
        angle: { min: 0, max: 360 },
        scale: { start: 1.2, end: 0 },
        alpha: { start: 1, end: 0 },
        lifespan: EXPLOSION_PARTICLE_LIFESPAN,
        blendMode: 'ADD',
        frequency: -1, // Emit only when called manually
        quantity: EXPLOSION_PARTICLE_COUNT
    });
    particleEmitter.setDepth(1); // Draw particles above most things

    // --- Physics Colliders / Overlaps ---
    scene.physics.add.collider(asteroidsGroup, asteroidsGroup, handleAsteroidCollision);
    scene.physics.add.collider(player, asteroidsGroup, handlePlayerAsteroidCollision);
    scene.physics.add.overlap(
        bulletsGroup,
        asteroidsGroup,
        handleBulletAsteroidCollision,
        null, // Process callback (optional filtering)
        scene // Context for the callback
    );

    // --- Initial Spawning (USING IN-VIEW FUNCTION) ---
    // This is the ONLY time asteroids are intentionally spawned inside the view, at game start.
    console.log(`Spawning ${ASTEROID_INITIAL_COUNT} initial asteroids in view...`);
    for (let i = 0; i < ASTEROID_INITIAL_COUNT; i++) {
        spawnAsteroidInView(scene); // Spawn asteroids within initial view
    }

    // --- Timed Spawning ---
    // Standard timer: Spawns asteroids just off-screen, biased towards player movement
    asteroidSpawnTimer = scene.time.addEvent({
        delay: ASTEROID_SPAWN_RATE,
        callback: () => { spawnAsteroid(scene); }, // Calls the bias-aware function
        loop: true
    });

    // *** Proactive spawning timer ***
    // Checks distant areas and populates them if density is low, ensuring spawns are off-screen.
    proactiveSpawnTimer = scene.time.addEvent({
        delay: PROACTIVE_SPAWN_INTERVAL,
        callback: () => { checkAndPopulateDistantAreas(scene); },
        loop: true
    });


    // --- Initial Grid Draw ---
    drawVisibleGrid(scene.cameras.main);

    // --- Add Resize Listener ---
    scene.scale.on('resize', handleResize, scene);
}

function update(time, delta) {
    const scene = this;

    handlePlayerMovement(scene);
    handleShooting(scene, time);
    drawVisibleGrid(scene.cameras.main);
    cleanupOutOfBoundsAsteroids(scene.cameras.main);
    cleanupOutOfBoundsBullets(scene.cameras.main);

    // Optional: Log asteroid count for debugging
    // console.log("Active Asteroids:", asteroidsGroup.getLength());
}

function handleResize(gameSize, baseSize, displaySize, resolution) {
    const scene = this;
    const newWidth = gameSize.width;
    const newHeight = gameSize.height;
    console.log(`Game resized to: ${newWidth}x${newHeight}`);
    // The camera automatically adjusts its size, but we might need to redraw static elements or UI
    if (gridGraphics && scene.cameras.main) {
        // Redraw grid based on the new camera view dimensions
        drawVisibleGrid(scene.cameras.main);
    }
    // Reposition UI elements here if needed
}

// --- Helper Functions ---

// --- Spawning Logic ---

// Spawns an asteroid *within* or *near* the initial camera view
// Used ONLY for the initial setup at game start.
function spawnAsteroidInView(scene) {
    const camera = scene.cameras.main;
    if (!camera) return;

    const spawnAreaWidth = scene.scale.width;
    const spawnAreaHeight = scene.scale.height;
    const playerStartX = spawnAreaWidth / 2;
    const playerStartY = spawnAreaHeight / 2;

    const categoryName = Phaser.Utils.Array.GetRandom(ACTIVE_ASTEROID_CATEGORIES);
    const category = ASTEROID_CATEGORIES[categoryName];
    if (!category) {
        console.error("Invalid asteroid category selected:", categoryName);
        return;
    }
    const visualSize = Phaser.Math.Between(category.minSize, category.maxSize);
    const initialHp = category.hp;
    const numVertices = Phaser.Math.Between(ASTEROID_MIN_VERTICES, ASTEROID_MAX_VERTICES);

    let spawnX, spawnY;
    let foundSpot = false;

    for (let retry = 0; retry < SPAWN_MAX_RETRIES * 2; retry++) {
        const margin = visualSize;
        spawnX = Phaser.Math.FloatBetween(margin, spawnAreaWidth - margin);
        spawnY = Phaser.Math.FloatBetween(margin, spawnAreaHeight - margin);
        tempSpawnPoint.set(spawnX, spawnY);

        const distFromPlayer = Phaser.Math.Distance.Between(spawnX, spawnY, playerStartX, playerStartY);
        if (distFromPlayer < PLAYER_INITIAL_SAFE_ZONE_RADIUS) {
            continue;
        }

        let overlaps = false;
        asteroidsGroup.children.iterate((existingAsteroid) => {
            if (!existingAsteroid || !existingAsteroid.body || !existingAsteroid.active) return true;
            const existingSize = existingAsteroid.getData('visualSize') || category.minSize;
            const requiredDist = (visualSize + existingSize) * SPAWN_CHECK_RADIUS_MULTIPLIER;
            const currentDist = Phaser.Math.Distance.Between(tempSpawnPoint.x, tempSpawnPoint.y, existingAsteroid.x, existingAsteroid.y);
            if (currentDist < requiredDist) {
                overlaps = true;
                return false;
            }
            return true;
        });

        if (!overlaps) {
            foundSpot = true;
            break;
        }
    }

    if (!foundSpot) {
         console.warn("Could not find suitable spot in view for initial asteroid, spawning off-screen fallback.");
         spawnAsteroid(scene); // Use the regular off-screen spawner as fallback
         return;
    }

    // --- Create the Asteroid ---
    const points = generateAsteroidPoints(visualSize, numVertices);
    const asteroidGraphics = scene.add.graphics();
    drawAsteroidShape(asteroidGraphics, points);
    asteroidsGroup.add(asteroidGraphics);
    asteroidGraphics.setPosition(spawnX, spawnY);

    if (asteroidGraphics.body) {
        const body = asteroidGraphics.body;
        const colliderRadius = visualSize * 0.9;
        body.setCircle(colliderRadius);
        body.setOffset(-colliderRadius, -colliderRadius);

        // *** Set initial velocity to a RANDOM direction for in-view asteroids ***
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const speed = Phaser.Math.Between(ASTEROID_MIN_SPEED * 0.5, ASTEROID_MAX_SPEED * 0.8);
        scene.physics.velocityFromRotation(angle, speed, body.velocity);

        body.setAngularVelocity(Phaser.Math.FloatBetween(-ASTEROID_MAX_ROTATION_SPEED, ASTEROID_MAX_ROTATION_SPEED));
        body.setBounce(ASTEROID_BOUNCE);

        asteroidGraphics.setData('category', categoryName);
        asteroidGraphics.setData('hitPoints', initialHp);
        asteroidGraphics.setData('visualSize', visualSize);
        asteroidGraphics.setData('points', points);
        asteroidGraphics.setData('isHit', false);

    } else {
        console.error("Failed to get physics body for initial asteroid!");
        asteroidGraphics.destroy();
    }
}

// Spawns a single asteroid off-screen (using SPAWN_BUFFER).
// Velocity targets a random point within the current view.
// This is called by the regular asteroidSpawnTimer.
function spawnAsteroid(scene) {
    const camera = scene.cameras.main;
    if (!camera) return;
    const worldView = camera.worldView;

    const categoryName = Phaser.Utils.Array.GetRandom(ACTIVE_ASTEROID_CATEGORIES);
    const category = ASTEROID_CATEGORIES[categoryName];
    if (!category) {
        console.error("Invalid asteroid category selected:", categoryName);
        return;
    }
    const visualSize = Phaser.Math.Between(category.minSize, category.maxSize);
    const initialHp = category.hp;
    const numVertices = Phaser.Math.Between(ASTEROID_MIN_VERTICES, ASTEROID_MAX_VERTICES);

    let spawnX, spawnY;
    let foundSpot = false;
    let edge = Phaser.Math.Between(0, 3); // Default: Random edge

    // --- Determine Spawn Edge Bias (based on player speed) ---
    if (player && player.body) {
        const playerSpeed = player.body.velocity.length();
        if (playerSpeed > PLAYER_SPEED_THRESHOLD_FOR_BIAS) {
            const playerVelAngle = player.body.velocity.angle(); // Radians
            const angleRight = 0;
            const angleDown = Math.PI / 2;
            const angleLeft = Math.PI;
            const angleUp = -Math.PI / 2;

            // Using shortest angle difference in degrees for clarity
            const degPlayerAngle = Phaser.Math.RadToDeg(playerVelAngle);
            const diffRight = Phaser.Math.Angle.ShortestBetween(degPlayerAngle, 0);
            const diffDown = Phaser.Math.Angle.ShortestBetween(degPlayerAngle, 90);
            const diffLeft = Phaser.Math.Angle.ShortestBetween(degPlayerAngle, 180);
            const diffUp = Phaser.Math.Angle.ShortestBetween(degPlayerAngle, -90); // or 270

             // Simple bias: Increase weight for the edge the player is moving towards
            const weights = [1.0, 1.0, 1.0, 1.0]; // Top, Right, Bottom, Left
            const biasAmount = 1.0 + SPAWN_BIAS_STRENGTH * 4; // How much to favor

            if (Math.abs(diffUp) <= 45)    weights[0] *= biasAmount;
            if (Math.abs(diffRight) <= 45) weights[1] *= biasAmount;
            if (Math.abs(diffDown) <= 45)  weights[2] *= biasAmount;
            if (Math.abs(diffLeft) <= 45)  weights[3] *= biasAmount; // Covers angles around 180/-180

            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            let randomThreshold = Math.random() * totalWeight;
            for (let i = 0; i < weights.length; i++) {
                if (randomThreshold < weights[i]) {
                    edge = i;
                    break;
                }
                randomThreshold -= weights[i];
            }
        }
    }
    // --- End Spawn Edge Bias ---

    for (let retry = 0; retry < SPAWN_MAX_RETRIES; retry++) {
        // Calculate spawn point OUTSIDE the view + SPAWN_BUFFER
        switch (edge) {
             case 0: // Top edge
                 spawnX = Phaser.Math.FloatBetween(worldView.left - SPAWN_BUFFER, worldView.right + SPAWN_BUFFER);
                 spawnY = worldView.top - SPAWN_BUFFER - Math.random() * visualSize; // Ensure fully outside buffer
                 break;
            case 1: // Right edge
                 spawnX = worldView.right + SPAWN_BUFFER + Math.random() * visualSize;
                 spawnY = Phaser.Math.FloatBetween(worldView.top - SPAWN_BUFFER, worldView.bottom + SPAWN_BUFFER);
                 break;
            case 2: // Bottom edge
                 spawnX = Phaser.Math.FloatBetween(worldView.left - SPAWN_BUFFER, worldView.right + SPAWN_BUFFER);
                 spawnY = worldView.bottom + SPAWN_BUFFER + Math.random() * visualSize;
                 break;
            case 3: // Left edge
                 spawnX = worldView.left - SPAWN_BUFFER - Math.random() * visualSize;
                 spawnY = Phaser.Math.FloatBetween(worldView.top - SPAWN_BUFFER, worldView.bottom + SPAWN_BUFFER);
                 break;
        }
        tempSpawnPoint.set(spawnX, spawnY);

        // --- Overlap Check with existing asteroids ---
        let overlaps = false;
        asteroidsGroup.children.iterate((existingAsteroid) => {
            if (!existingAsteroid || !existingAsteroid.body || !existingAsteroid.active) return true;
             // Basic distance check first for performance
             const checkDist = (visualSize + (existingAsteroid.getData('visualSize') || category.minSize)) * SPAWN_CHECK_RADIUS_MULTIPLIER * 1.5;
             if (Math.abs(existingAsteroid.x - spawnX) > checkDist || Math.abs(existingAsteroid.y - spawnY) > checkDist) {
                 return true;
             }
            const existingSize = existingAsteroid.getData('visualSize') || category.minSize;
            const requiredDist = (visualSize + existingSize) * SPAWN_CHECK_RADIUS_MULTIPLIER;
            const currentDist = Phaser.Math.Distance.Between(tempSpawnPoint.x, tempSpawnPoint.y, existingAsteroid.x, existingAsteroid.y);
            if (currentDist < requiredDist) {
                overlaps = true;
                return false;
            }
            return true;
        });

        if (!overlaps) {
            foundSpot = true;
            break;
        }
    }

    if (!foundSpot) {
        // console.log("Could not find non-overlapping spawn spot for standard off-screen asteroid.");
        return;
    }

    // --- Create Asteroid ---
    const points = generateAsteroidPoints(visualSize, numVertices);
    const asteroidGraphics = scene.add.graphics();
    drawAsteroidShape(asteroidGraphics, points);
    asteroidsGroup.add(asteroidGraphics);
    asteroidGraphics.setPosition(spawnX, spawnY); // Position is guaranteed outside view + buffer

    if (asteroidGraphics.body) {
        const body = asteroidGraphics.body;
        const colliderRadius = visualSize * 0.9;
        body.setCircle(colliderRadius);
        body.setOffset(-colliderRadius, -colliderRadius);

        // Velocity towards a RANDOM point within the current view
        const targetX = Phaser.Math.FloatBetween(worldView.left, worldView.right);
        const targetY = Phaser.Math.FloatBetween(worldView.top, worldView.bottom);
        const angle = Phaser.Math.Angle.Between(spawnX, spawnY, targetX, targetY);
        const speed = Phaser.Math.Between(ASTEROID_MIN_SPEED, ASTEROID_MAX_SPEED);
        scene.physics.velocityFromRotation(angle, speed, body.velocity);

        body.setAngularVelocity(Phaser.Math.FloatBetween(-ASTEROID_MAX_ROTATION_SPEED, ASTEROID_MAX_ROTATION_SPEED));
        body.setBounce(ASTEROID_BOUNCE);

        asteroidGraphics.setData('category', categoryName);
        asteroidGraphics.setData('hitPoints', initialHp);
        asteroidGraphics.setData('visualSize', visualSize);
        asteroidGraphics.setData('points', points);
        asteroidGraphics.setData('isHit', false);
    } else {
        console.error("Failed to get physics body for off-screen asteroid!");
        asteroidGraphics.destroy();
    }
}


/**
 * UPDATED: Spawns a single asteroid directly within a specified rectangular region,
 * BUT ensures the spawn point is *outside* the current camera view.
 * Used by the proactive spawning system. Checks for overlaps before placing.
 * Gives the asteroid a random velocity. Returns the created asteroid or null.
 */
function spawnAsteroidInRegion(scene, regionBounds) {
    const camera = scene.cameras.main; // Get the camera
    if (!camera) return null; // Need camera to check view bounds
    const worldView = camera.worldView; // Get current visible area

    // Select category, size, hp, vertices
    const categoryName = Phaser.Utils.Array.GetRandom(ACTIVE_ASTEROID_CATEGORIES);
    const category = ASTEROID_CATEGORIES[categoryName];
    if (!category) return null;
    const visualSize = Phaser.Math.Between(category.minSize, category.maxSize);
    const initialHp = category.hp;
    const numVertices = Phaser.Math.Between(ASTEROID_MIN_VERTICES, ASTEROID_MAX_VERTICES);

    let spawnX, spawnY;
    let foundSpot = false;

    // Try to find a non-overlapping spot within the region AND outside the current view
    for (let retry = 0; retry < SPAWN_MAX_RETRIES; retry++) {
        // Pick a random point within the target region
        spawnX = Phaser.Math.FloatBetween(regionBounds.left, regionBounds.right);
        spawnY = Phaser.Math.FloatBetween(regionBounds.top, regionBounds.bottom);
        tempSpawnPoint.set(spawnX, spawnY);

        // *** CHECK 1: Ensure the chosen point is OUTSIDE the current camera view ***
        if (Phaser.Geom.Rectangle.Contains(worldView, spawnX, spawnY)) {
            continue; // This point is currently visible, try another random point in the region
        }

        // *** CHECK 2: Check for overlap with existing asteroids ***
        let overlaps = false;
        asteroidsGroup.children.iterate((existingAsteroid) => {
            if (!existingAsteroid || !existingAsteroid.body || !existingAsteroid.active) return true;

            // Basic distance check for efficiency
            const checkDist = (visualSize + (existingAsteroid.getData('visualSize') || category.minSize)) * SPAWN_CHECK_RADIUS_MULTIPLIER * 1.5;
            if (Math.abs(existingAsteroid.x - spawnX) > checkDist || Math.abs(existingAsteroid.y - spawnY) > checkDist) {
                 return true; // Too far away, skip detailed check
             }

            const existingSize = existingAsteroid.getData('visualSize') || category.minSize;
            const requiredDist = (visualSize + existingSize) * SPAWN_CHECK_RADIUS_MULTIPLIER;
            const currentDist = Phaser.Math.Distance.Between(tempSpawnPoint.x, tempSpawnPoint.y, existingAsteroid.x, existingAsteroid.y);
            if (currentDist < requiredDist) {
                overlaps = true;
                return false; // Stop iteration, overlap found
            }
            return true;
        });

        // If it passed the view check (was outside) AND the overlap check
        if (!overlaps) {
            foundSpot = true;
            break; // Found a valid spot, exit retry loop
        }
        // If overlaps was true OR if the point was inside the view, the loop continues to retry
    }

    if (!foundSpot) {
        // console.log(`Proactive spawn failed: Couldn't find valid non-visible, non-overlapping spot in region`);
        return null; // Could not place asteroid according to constraints
    }

    // --- Create the Asteroid (Same as before) ---
    const points = generateAsteroidPoints(visualSize, numVertices);
    const asteroidGraphics = scene.add.graphics();
    drawAsteroidShape(asteroidGraphics, points);
    asteroidsGroup.add(asteroidGraphics);
    asteroidGraphics.setPosition(spawnX, spawnY); // Position is guaranteed outside view now

    if (asteroidGraphics.body) {
        const body = asteroidGraphics.body;
        const colliderRadius = visualSize * 0.9;
        body.setCircle(colliderRadius);
        body.setOffset(-colliderRadius, -colliderRadius);

        // Give it a completely random velocity
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const speed = Phaser.Math.Between(ASTEROID_MIN_SPEED * 0.8, ASTEROID_MAX_SPEED * 1.1);
        scene.physics.velocityFromRotation(angle, speed, body.velocity);

        body.setAngularVelocity(Phaser.Math.FloatBetween(-ASTEROID_MAX_ROTATION_SPEED, ASTEROID_MAX_ROTATION_SPEED));
        body.setBounce(ASTEROID_BOUNCE);

        asteroidGraphics.setData('category', categoryName);
        asteroidGraphics.setData('hitPoints', initialHp);
        asteroidGraphics.setData('visualSize', visualSize);
        asteroidGraphics.setData('points', points);
        asteroidGraphics.setData('isHit', false);
        // console.log(`Proactively spawned ${categoryName} at ${spawnX.toFixed(0)}, ${spawnY.toFixed(0)} (outside view)`);
        return asteroidGraphics; // Success
    } else {
        console.error("Failed to get physics body for proactively spawned asteroid!");
        asteroidGraphics.destroy();
        return null;
    }
}


/**
 * Checks distant areas around the player (outside the main view + buffer)
 * and spawns asteroids using spawnAsteroidInRegion (which ensures off-screen placement)
 * if the density is too low. Called by proactiveSpawnTimer.
 */
function checkAndPopulateDistantAreas(scene) {
    const camera = scene.cameras.main;
    // Ensure player and group exist before proceeding
    if (!camera || !player || !player.body || !asteroidsGroup) return;

    const worldView = camera.worldView;
    const viewWidth = worldView.width;
    const viewHeight = worldView.height;

    // Define the generation area (larger than the view), centered on the PLAYER
    const genRadiusX = viewWidth * PROACTIVE_GENERATION_RADIUS_MULTIPLIER * 0.5;
    const genRadiusY = viewHeight * PROACTIVE_GENERATION_RADIUS_MULTIPLIER * 0.5;
    const genBounds = new Phaser.Geom.Rectangle(
        player.x - genRadiusX, // Use player position as center
        player.y - genRadiusY,
        genRadiusX * 2,
        genRadiusY * 2
    );

    // Define the inner area (view + buffer) to exclude from density check
    const innerBounds = new Phaser.Geom.Rectangle(
        worldView.left - PROACTIVE_INNER_BUFFER,
        worldView.top - PROACTIVE_INNER_BUFFER,
        viewWidth + PROACTIVE_INNER_BUFFER * 2,
        viewHeight + PROACTIVE_INNER_BUFFER * 2
    );

    // Define the four distant quadrants relative to the PLAYER position (genBounds center)
    const quadWidth = genRadiusX;  // Half the generation width
    const quadHeight = genRadiusY; // Half the generation height

    const quadrants = [
        { name: 'Top-Left',     bounds: new Phaser.Geom.Rectangle(genBounds.left, genBounds.top, quadWidth, quadHeight) },
        { name: 'Top-Right',    bounds: new Phaser.Geom.Rectangle(player.x, genBounds.top, quadWidth, quadHeight) },
        { name: 'Bottom-Left',  bounds: new Phaser.Geom.Rectangle(genBounds.left, player.y, quadWidth, quadHeight) },
        { name: 'Bottom-Right', bounds: new Phaser.Geom.Rectangle(player.x, player.y, quadWidth, quadHeight) }
    ];

    // Count asteroids in each distant quadrant
    const asteroidCounts = [0, 0, 0, 0];
    asteroidsGroup.children.iterate((asteroid) => {
        if (!asteroid || !asteroid.active || !asteroid.body) return true;

        // Skip if asteroid is inside the inner bounds (too close to the view)
        if (Phaser.Geom.Rectangle.Contains(innerBounds, asteroid.x, asteroid.y)) {
            return true;
        }

        // Check which quadrant it falls into (only if within the overall generation bounds)
        if (Phaser.Geom.Rectangle.Contains(genBounds, asteroid.x, asteroid.y)) {
            for (let i = 0; i < quadrants.length; i++) {
                if (Phaser.Geom.Rectangle.Contains(quadrants[i].bounds, asteroid.x, asteroid.y)) {
                    asteroidCounts[i]++;
                    break; // Found in quadrant, move to next asteroid
                }
            }
        }
        return true;
    });

    // Spawn asteroids in quadrants that are below the target count
    for (let i = 0; i < quadrants.length; i++) {
        const count = asteroidCounts[i];
        const needed = TARGET_ASTEROIDS_PER_QUADRANT - count;

        if (needed > 0) {
            // console.log(`Quadrant ${quadrants[i].name} needs ${needed} asteroids. Attempting proactive spawn...`);
            for (let j = 0; j < needed; j++) {
                // spawnAsteroidInRegion now handles ensuring the spawn is outside the current view
                spawnAsteroidInRegion(scene, quadrants[i].bounds);
            }
        }
    }
}


// --- Shooting Logic ---
// (No changes needed here)
function handleShooting(scene, time) {
    if (spaceKey.isDown && time > lastFiredTime + BULLET_COOLDOWN) {
        shootBullet(scene);
        lastFiredTime = time;
    }
}

function shootBullet(scene) {
    if (!player || !player.active || !player.body) return; // Check player exists and is active

    // Calculate tip position in world space
    const localTipX = PLAYER_SIZE.height / 2 + 5; // Point slightly ahead of the visual tip
    const localTipY = 0;
    player.getWorldTransformMatrix().transformPoint(localTipX, localTipY, tempBulletPos); // Use pre-allocated Geom.Point

    const bulletGraphics = scene.add.graphics();
    bulletGraphics.lineStyle(BULLET_THICKNESS, BULLET_COLOR, 1.0);
    // Draw line centered on its position for easier physics body alignment
    bulletGraphics.lineBetween(-BULLET_LENGTH / 2, 0, BULLET_LENGTH / 2, 0);

    bulletsGroup.add(bulletGraphics); // Add to physics group *before* setting physics properties
    bulletGraphics.setPosition(tempBulletPos.x, tempBulletPos.y);
    bulletGraphics.setRotation(player.rotation); // Align bullet rotation with player

    if (bulletGraphics.body) {
        const body = bulletGraphics.body;
        // Set size slightly smaller than visual for better hit feel? Or match visual size.
        body.setSize(BULLET_LENGTH, BULLET_THICKNESS);
        // Center the physics body on the graphic's origin
        body.setOffset(-BULLET_LENGTH / 2, -BULLET_THICKNESS / 2);

        scene.physics.velocityFromRotation(player.rotation, BULLET_SPEED, body.velocity);
        // body.setAllowGravity(false); // Already set by group? Double check if needed.
        body.setAngularVelocity(0); // Bullets shouldn't rotate
        body.setDrag(0, 0); // No air resistance
        body.setBounce(0, 0); // No bounce
    } else {
        console.error("Failed to create physics body for bullet!");
        bulletsGroup.remove(bulletGraphics, true, true); // Clean up if body fails
    }
}

// --- Collision Handlers ---
// (No changes needed here)
function handleBulletAsteroidCollision(bullet, asteroid) {
    const scene = this; // 'this' is bound to the scene in the overlap call
    // Check if objects are still valid and active before processing
    if (!bullet || !bullet.active || !asteroid || !asteroid.active || !asteroid.body) {
        return;
    }

    // Destroy bullet immediately
    // bulletsGroup.remove(bullet, true, true); // More robust way to remove and destroy
    bullet.destroy(); // Simpler if no pooling is used

    let currentHp = asteroid.getData('hitPoints');
    const categoryName = asteroid.getData('category');
    const points = asteroid.getData('points');
    const isHit = asteroid.getData('isHit'); // Check if already flashing

    if (currentHp === undefined || currentHp === null) {
        console.warn("Asteroid hit without valid hitPoints data!", asteroid);
        asteroidsGroup.remove(asteroid, true, true); // Clean up invalid asteroid
        return;
    }
    if (!points) {
        console.warn("Asteroid hit without points data! Cannot show hit effect.", asteroid);
    }

    currentHp--;
    asteroid.setData('hitPoints', currentHp);

    if (currentHp <= 0) {
        // Emit particles at asteroid location before destroying it
        if (particleEmitter) {
            particleEmitter.emitParticleAt(asteroid.x, asteroid.y);
        }
        // TODO: Implement Breaking Logic (spawning smaller asteroids) here if needed
        // const category = ASTEROID_CATEGORIES[categoryName];
        // if (category && category.breakInto) { /* spawn new ones */ }

        asteroidsGroup.remove(asteroid, true, true); // Destroy the asteroid
        // TODO: Add Scoring / Sound Effect for destruction
    } else {
        // Apply hit flash effect only if it has points and isn't already flashing
        if (points && !isHit) {
            asteroid.setData('isHit', true);
            // Redraw with fill
            drawAsteroidShape(asteroid, points, ASTEROID_HIT_FILL_COLOR, ASTEROID_HIT_FILL_ALPHA);
            // Schedule timer to revert the effect
            scene.time.delayedCall(ASTEROID_HIT_DURATION, () => {
                // Check if asteroid still exists and hasn't been destroyed in the meantime
                if (asteroid && asteroid.active && asteroid.getData('hitPoints') > 0) {
                     drawAsteroidShape(asteroid, points); // Redraw normal state
                     asteroid.setData('isHit', false);    // Reset hit flag
                }
            }, [], scene); // Pass scene context to timer callback
        }
        // TODO: Add Hit Sound Effect
    }
}

function handlePlayerAsteroidCollision(playerGameObject, asteroidGameObject) {
     // Ensure both objects are valid before proceeding
    if (!playerGameObject || !playerGameObject.active || !asteroidGameObject || !asteroidGameObject.active || !asteroidGameObject.body) return;

    console.log("Player hit asteroid!");
    // Emit particles at the asteroid's position
    if (particleEmitter) {
        particleEmitter.emitParticleAt(asteroidGameObject.x, asteroidGameObject.y);
    }
    // Destroy the asteroid
    asteroidsGroup.remove(asteroidGameObject, true, true);

    // TODO: Implement Player Damage Logic
    // - Reduce player health
    // - Check for game over
    // - Maybe add brief invincibility?
    // - Play player hit sound/visual effect
}

function handleAsteroidCollision(asteroid1, asteroid2) {
    // This function is called when two asteroids collide.
    // The physics engine handles the bounce automatically based on group/body settings.
    // You could add a small sound effect here if desired.
    // console.log("Asteroids collided");
}

// --- Cleanup Functions ---
// (No changes needed here)
function cleanupOutOfBoundsBullets(camera) {
    if (!camera) return;
    const worldView = camera.worldView;
    // Define bounds slightly larger than the view
    const cleanupBounds = new Phaser.Geom.Rectangle(
        worldView.left - BULLET_CLEANUP_BUFFER,
        worldView.top - BULLET_CLEANUP_BUFFER,
        worldView.width + BULLET_CLEANUP_BUFFER * 2,
        worldView.height + BULLET_CLEANUP_BUFFER * 2
    );

    bulletsGroup.children.iterate((bullet) => {
        // Important check: Ensure bullet and body exist before accessing position
        if (bullet && bullet.body && !Phaser.Geom.Rectangle.Contains(cleanupBounds, bullet.x, bullet.y)) {
            // bulletsGroup.remove(bullet, true, true); // Use group removal for safety
            bullet.destroy(); // Direct destroy is often fine
        }
        return true; // Continue iteration
    });
}

function cleanupOutOfBoundsAsteroids(camera) {
    if (!camera) return;
    const worldView = camera.worldView;
    // Use a larger buffer for asteroids as they move slower and might re-enter
    const cleanupBounds = new Phaser.Geom.Rectangle(
        worldView.left - CLEANUP_BUFFER,
        worldView.top - CLEANUP_BUFFER,
        worldView.width + CLEANUP_BUFFER * 2,
        worldView.height + CLEANUP_BUFFER * 2
    );

    asteroidsGroup.children.iterate((asteroid) => {
        // Important check: Ensure asteroid and body exist
        if (asteroid && asteroid.body && !Phaser.Geom.Rectangle.Contains(cleanupBounds, asteroid.x, asteroid.y)) {
            // console.log("Cleaning up asteroid far from view");
            asteroidsGroup.remove(asteroid, true, true);
        }
        return true; // Continue iteration
    });
}

// --- Player Movement ---
// (No changes needed here)
function handlePlayerMovement(scene) {
    if (!player || !player.body) return; // Safety check

    // Angular Velocity (Rotation)
    player.body.setAngularVelocity(0); // Stop rotation if no input
    if (cursors.left.isDown || wasdKeys.A.isDown) {
        player.body.setAngularVelocity(-PLAYER_ANGULAR_VELOCITY);
    } else if (cursors.right.isDown || wasdKeys.D.isDown) {
        player.body.setAngularVelocity(PLAYER_ANGULAR_VELOCITY);
    }

    // Acceleration (Forward Thrust)
    if (cursors.up.isDown || wasdKeys.W.isDown) {
        // Apply acceleration in the direction the player is facing
        scene.physics.velocityFromRotation(player.rotation, SHIP_SPEED, player.body.acceleration);
    } else {
        player.body.setAcceleration(0); // Stop accelerating if key is up
    }

    // Drag and angular drag handle deceleration automatically
}

// --- Graphics Drawing Functions ---
// (No changes needed here)
function drawPlayerShape(graphics) {
    graphics.clear();
    graphics.lineStyle(PLAYER_LINE_WIDTH, 0xffffff, 1.0); // White outline
    graphics.fillStyle(0xaaaaaa, 1.0); // Optional: Add a fill color
    graphics.beginPath();
    // Define points relative to the container's center (0,0)
    graphics.moveTo(PLAYER_SIZE.height / 2, 0); // Nose
    graphics.lineTo(-PLAYER_SIZE.height / 2, -PLAYER_SIZE.width / 2); // Back-left wing tip
    graphics.lineTo(-PLAYER_SIZE.height / 2, PLAYER_SIZE.width / 2); // Back-right wing tip
    graphics.closePath();
    // graphics.fillPath(); // Uncomment if you want a filled ship
    graphics.strokePath(); // Draw the outline
}

function generateAsteroidPoints(avgRadius, numVertices) {
    const points = [];
    const angleStep = (Math.PI * 2) / numVertices;
    const radiusMin = avgRadius * (1 - ASTEROID_JAGGEDNESS);
    const radiusMax = avgRadius * (1 + ASTEROID_JAGGEDNESS);

    for (let i = 0; i < numVertices; i++) {
        const baseAngle = i * angleStep;
        // Add slight random variation to angle and radius for jaggedness
        const angle = baseAngle + Phaser.Math.FloatBetween(-angleStep * 0.3, angleStep * 0.3); // More angle variation
        const radius = Phaser.Math.FloatBetween(radiusMin, radiusMax);
        points.push({
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius
        });
    }
    return points;
}

function drawAsteroidShape(graphics, points, fillStyle = null, fillAlpha = 1.0) {
    // Ensure graphics and points are valid
    if (!graphics || !points || points.length < 3) {
        // console.warn("Attempted to draw invalid asteroid shape");
        return;
    }
    graphics.clear(); // Clear previous drawing

    // Optional Fill (used for hit effect)
    if (fillStyle !== null) {
        graphics.fillStyle(fillStyle, fillAlpha);
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            graphics.lineTo(points[i].x, points[i].y);
        }
        graphics.closePath();
        graphics.fillPath();
    }

    // Stroke (Outline)
    graphics.lineStyle(ASTEROID_LINE_WIDTH, ASTEROID_COLOR, 1.0);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        graphics.lineTo(points[i].x, points[i].y);
    }
    graphics.closePath();
    graphics.strokePath();
}

// --- Grid Drawing ---
// (No changes needed here)
function drawVisibleGrid(camera) {
    if (!gridGraphics || !camera) return;

    gridGraphics.clear(); // Clear previous grid lines
    gridGraphics.lineStyle(GRID_LINE_WIDTH, GRID_COLOR, GRID_ALPHA);

    const worldView = camera.worldView; // Get the camera's current view rectangle in world coordinates

    // Calculate the starting grid lines slightly outside the view
    const startX = Math.floor(worldView.left / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor(worldView.top / GRID_SIZE) * GRID_SIZE;
    const endX = Math.ceil(worldView.right / GRID_SIZE) * GRID_SIZE;
    const endY = Math.ceil(worldView.bottom / GRID_SIZE) * GRID_SIZE;

    // Draw vertical lines
    for (let x = startX; x < endX; x += GRID_SIZE) {
        gridGraphics.lineBetween(x, worldView.top, x, worldView.bottom);
    }

    // Draw horizontal lines
    for (let y = startY; y < endY; y += GRID_SIZE) {
        gridGraphics.lineBetween(worldView.left, y, worldView.right, y);
    }
}