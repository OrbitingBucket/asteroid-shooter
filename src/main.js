import Phaser from 'phaser';

// --- Get initial screen dimensions ---
const screenWidth = window.innerWidth;
const screenHeight = window.innerHeight;

// --- Configuration ---
const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,  // Use window size initially
    height: window.innerHeight,
    parent: 'app',
    backgroundColor: '#001f3f', // Dark blue space background
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
const ASTEROID_SPAWN_RATE = 2500; // Milliseconds between new spawns
const ASTEROID_MIN_SPEED = 30;    // Min initial speed
const ASTEROID_MAX_SPEED = 80;    // Max initial speed
const ASTEROID_MAX_ROTATION_SPEED = 60; // Degrees per second max angular velocity
const ASTEROID_BOUNCE = 0.8;      // Elasticity for collisions
const SPAWN_BUFFER = 100;         // How far off-screen to spawn
const CLEANUP_BUFFER = 400;       // How far off-screen before despawning
const SPAWN_CHECK_RADIUS_MULTIPLIER = 1.2; // Multiplier for overlap check distance
const SPAWN_MAX_RETRIES = 10;      // Attempts to find non-overlapping spot
const ASTEROID_HIT_FILL_COLOR = 0xffffff; // Color for hit flash
const ASTEROID_HIT_FILL_ALPHA = 0.4;    // Alpha for hit flash
const ASTEROID_HIT_DURATION = 100;      // Duration of hit flash in ms

// *** NEW/UPDATED Asteroid Generation Strategy Constants ***
const ASTEROID_INITIAL_COUNT = 20; // Number of asteroids at game start
const PLAYER_INITIAL_SAFE_ZONE_RADIUS = 150; // Don't spawn initial asteroids too close to player start
const PLAYER_SPEED_THRESHOLD_FOR_BIAS = 50; // Player speed needed to trigger biased spawning
const SPAWN_BIAS_STRENGTH = 0.6; // How much to favor the forward direction (0 = no bias, 1 = heavily biased)

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
    player.body.setCollideWorldBounds(false);
    player.body.setDamping(true);
    player.body.setDrag(PLAYER_DRAG, PLAYER_DRAG);
    player.body.setAngularDrag(PLAYER_ANGULAR_DRAG);
    player.body.setMaxVelocity(SHIP_SPEED * 1.5);

    // --- Camera Setup ---
    scene.cameras.main.setBounds(-Infinity, -Infinity, Infinity, Infinity);
    scene.cameras.main.startFollow(player, true, 0.1, 0.1);
    scene.cameras.main.setBackgroundColor(config.backgroundColor);

    // --- Input Setup ---
    cursors = scene.input.keyboard.createCursorKeys();
    wasdKeys = scene.input.keyboard.addKeys('W,A,S,D');
    spaceKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // --- Asteroid Setup ---
    asteroidsGroup = scene.physics.add.group({
        bounceX: ASTEROID_BOUNCE,
        bounceY: ASTEROID_BOUNCE,
        collideWorldBounds: false,
    });

    // --- Bullet Setup ---
    bulletsGroup = scene.physics.add.group({
        collideWorldBounds: false,
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
        frequency: -1,
        quantity: EXPLOSION_PARTICLE_COUNT
    });
    particleEmitter.setDepth(1);

    // --- Physics Colliders / Overlaps ---
    scene.physics.add.collider(asteroidsGroup, asteroidsGroup, handleAsteroidCollision);
    scene.physics.add.collider(player, asteroidsGroup, handlePlayerAsteroidCollision);
    scene.physics.add.overlap(
        bulletsGroup,
        asteroidsGroup,
        handleBulletAsteroidCollision,
        null,
        scene
    );

    // --- Initial Spawning (USING NEW IN-VIEW FUNCTION) ---
    console.log(`Spawning ${ASTEROID_INITIAL_COUNT} initial asteroids in view...`);
    for (let i = 0; i < ASTEROID_INITIAL_COUNT; i++) {
        spawnAsteroidInView(scene); // Spawn asteroids within initial view
    }

    // Start timed asteroid spawning (calls the regular 'spawnAsteroid' with bias)
    asteroidSpawnTimer = scene.time.addEvent({
        delay: ASTEROID_SPAWN_RATE,
        callback: () => { spawnAsteroid(scene); }, // This calls the bias-aware function
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
}

function handleResize(gameSize, baseSize, displaySize, resolution) {
    const scene = this;
    const newWidth = gameSize.width;
    const newHeight = gameSize.height;
    console.log(`Game resized to: ${newWidth}x${newHeight}`);
    if (gridGraphics && scene.cameras.main) {
        drawVisibleGrid(scene.cameras.main);
    }
    // Reposition UI elements here if needed
}

// --- Helper Functions ---

// --- Spawning Logic ---

// Spawns an asteroid *within* or *near* the initial camera view
// Used for the initial setup.
function spawnAsteroidInView(scene) {
    const camera = scene.cameras.main;
    if (!camera) return;

    // Use the initial game dimensions for placement, assuming create() is called once
    const spawnAreaWidth = scene.scale.width;
    const spawnAreaHeight = scene.scale.height;
    const playerStartX = spawnAreaWidth / 2;
    const playerStartY = spawnAreaHeight / 2;

    // Select category, size, hp, vertices (same as spawnAsteroid)
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

    // Try several times to find a non-overlapping spot NOT too close to the player start
    for (let retry = 0; retry < SPAWN_MAX_RETRIES * 2; retry++) { // More retries maybe needed
        // Pick a random spot within the initial screen dimensions
        // Add a small margin so they aren't exactly ON the edge
        const margin = visualSize; // Ensure the whole asteroid is likely within view
        spawnX = Phaser.Math.FloatBetween(margin, spawnAreaWidth - margin);
        spawnY = Phaser.Math.FloatBetween(margin, spawnAreaHeight - margin);
        tempSpawnPoint.set(spawnX, spawnY);

        // Check 1: Distance from player start position
        const distFromPlayer = Phaser.Math.Distance.Between(spawnX, spawnY, playerStartX, playerStartY);
        if (distFromPlayer < PLAYER_INITIAL_SAFE_ZONE_RADIUS) {
            continue; // Too close to player, try again
        }

        // Check 2: Overlap with existing asteroids
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
            break; // Exit retry loop
        }
    }

    // If no non-overlapping spot found, maybe place it slightly outside view or just skip
    if (!foundSpot) {
         // Fallback: Use the regular spawn logic to place it off-screen
         console.warn("Could not find suitable spot in view for initial asteroid, spawning off-screen.");
         spawnAsteroid(scene); // Call the regular off-screen spawner as a fallback
         return; // Exit this function
    }

    // --- Create the Asteroid --- (Mostly same as spawnAsteroid)
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
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2); // Random angle
        const speed = Phaser.Math.Between(ASTEROID_MIN_SPEED * 0.5, ASTEROID_MAX_SPEED * 0.8); // Maybe slightly slower initially
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

// Spawns a single asteroid off-screen (modified for directional bias)
// This is called by the timer and as a fallback by spawnAsteroidInView
function spawnAsteroid(scene) {
    const camera = scene.cameras.main;
    if (!camera) return; // Safety check
    const worldView = camera.worldView;

    // Select category, size, hp, vertices
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

    // --- Determine Spawn Edge (with potential bias) ---
    let edge = Phaser.Math.Between(0, 3); // Default: Random edge
    let useBias = false;

    // Check if player exists and is moving fast enough to apply bias
    if (player && player.body) {
        const playerSpeed = player.body.velocity.length();
        if (playerSpeed > PLAYER_SPEED_THRESHOLD_FOR_BIAS) {
            useBias = true;
            const playerVelAngle = player.body.velocity.angle(); // Radians

            // Define angles for edges (approximate centers) in radians
            const angleRight = 0;
            const angleDown = Math.PI / 2;
            const angleLeft = Math.PI;
            const angleUp = -Math.PI / 2; // Or Math.PI * 1.5

            // Calculate angular difference (shortest path) to determine primary direction
            const diffRight = Phaser.Math.Angle.Wrap(playerVelAngle - angleRight);
            const diffDown = Phaser.Math.Angle.Wrap(playerVelAngle - angleDown);
            const diffLeft = Phaser.Math.Angle.Wrap(playerVelAngle - angleLeft);
            const diffUp = Phaser.Math.Angle.Wrap(playerVelAngle - angleUp);

            // Simple weighting: give higher chance to edges "ahead" of the player
            // We want to spawn more frequently on the edge the player is moving TOWARDS.
            const weights = [
                1.0, // Weight for edge 0 (Top)
                1.0, // Weight for edge 1 (Right)
                1.0, // Weight for edge 2 (Bottom)
                1.0  // Weight for edge 3 (Left)
            ];
            // Bias amount increases the weight significantly for the forward edge(s)
            const biasAmount = 1.0 + SPAWN_BIAS_STRENGTH * 4; // Adjust multiplier for stronger/weaker bias

            // Check which direction the player is primarily moving towards (within +/- 45 degrees)
            if (Math.abs(diffUp) <= Math.PI / 4)    weights[0] *= biasAmount;   // Moving Up -> Spawn Top
            if (Math.abs(diffRight) <= Math.PI / 4) weights[1] *= biasAmount;   // Moving Right -> Spawn Right
            if (Math.abs(diffDown) <= Math.PI / 4)  weights[2] *= biasAmount;   // Moving Down -> Spawn Bottom
            if (Math.abs(diffLeft) <= Math.PI / 4)  weights[3] *= biasAmount;   // Moving Left -> Spawn Left

            // --- Weighted Random Selection ---
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            let randomThreshold = Math.random() * totalWeight;
            for (let i = 0; i < weights.length; i++) {
                if (randomThreshold < weights[i]) {
                    edge = i;
                    break;
                }
                randomThreshold -= weights[i];
            }
             // console.log(`Bias Active: Player Speed=${playerSpeed.toFixed(1)}, Angle=${playerVelAngle.toFixed(2)}, Chosen Edge=${edge}`); // For debugging
        }
    }
    // --- End Spawn Edge Determination ---

    // Try several times to find a non-overlapping spawn location on the chosen edge
    for (let retry = 0; retry < SPAWN_MAX_RETRIES; retry++) {
        // Calculate spawn point based on the selected edge
        switch (edge) {
             case 0: // Top edge
                 spawnX = Phaser.Math.FloatBetween(worldView.left - SPAWN_BUFFER, worldView.right + SPAWN_BUFFER);
                 spawnY = worldView.top - SPAWN_BUFFER - Math.random() * SPAWN_BUFFER * 0.5; // Slightly less random depth
                 break;
            case 1: // Right edge
                 spawnX = worldView.right + SPAWN_BUFFER + Math.random() * SPAWN_BUFFER * 0.5;
                 spawnY = Phaser.Math.FloatBetween(worldView.top - SPAWN_BUFFER, worldView.bottom + SPAWN_BUFFER);
                 break;
            case 2: // Bottom edge
                 spawnX = Phaser.Math.FloatBetween(worldView.left - SPAWN_BUFFER, worldView.right + SPAWN_BUFFER);
                 spawnY = worldView.bottom + SPAWN_BUFFER + Math.random() * SPAWN_BUFFER * 0.5;
                 break;
            case 3: // Left edge
                 spawnX = worldView.left - SPAWN_BUFFER - Math.random() * SPAWN_BUFFER * 0.5;
                 spawnY = Phaser.Math.FloatBetween(worldView.top - SPAWN_BUFFER, worldView.bottom + SPAWN_BUFFER);
                 break;
        }
        tempSpawnPoint.set(spawnX, spawnY);

        // --- Overlap Check (Same as before) ---
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
            break; // Exit retry loop
        }
    }

    // If no non-overlapping spot found after retries, skip spawning this time
    if (!foundSpot) {
        // console.log("Could not find non-overlapping spawn spot for off-screen asteroid.");
        return;
    }

    // --- Create Asteroid (Same as before) ---
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

        // *** Velocity towards the center of the current view (Same as before) ***
        const targetX = worldView.centerX + Phaser.Math.FloatBetween(-worldView.width * 0.1, worldView.width * 0.1);
        const targetY = worldView.centerY + Phaser.Math.FloatBetween(-worldView.height * 0.1, worldView.height * 0.1);
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


// --- Shooting Logic ---
function handleShooting(scene, time) {
    if (spaceKey.isDown && time > lastFiredTime + BULLET_COOLDOWN) {
        shootBullet(scene);
        lastFiredTime = time;
    }
}

function shootBullet(scene) {
    if (!player || !player.active) return;

    const localTipX = PLAYER_SIZE.height / 2 + 5;
    const localTipY = 0;
    player.getWorldTransformMatrix().transformPoint(localTipX, localTipY, tempBulletPos);

    const bulletGraphics = scene.add.graphics();
    bulletGraphics.lineStyle(BULLET_THICKNESS, BULLET_COLOR, 1.0);
    bulletGraphics.lineBetween(-BULLET_LENGTH / 2, 0, BULLET_LENGTH / 2, 0);

    bulletsGroup.add(bulletGraphics);
    bulletGraphics.setPosition(tempBulletPos.x, tempBulletPos.y);
    bulletGraphics.setRotation(player.rotation);

    if (bulletGraphics.body) {
        const body = bulletGraphics.body;
        body.setSize(BULLET_LENGTH, BULLET_THICKNESS);
        body.setOffset(-BULLET_LENGTH / 2, -BULLET_THICKNESS / 2);
        scene.physics.velocityFromRotation(player.rotation, BULLET_SPEED, body.velocity);
        body.setAllowGravity(false);
        body.setAngularVelocity(0);
        body.setDrag(0, 0);
    } else {
        console.error("Failed to create physics body for bullet!");
        bulletGraphics.destroy();
    }
}

// --- Collision Handlers ---
function handleBulletAsteroidCollision(bullet, asteroid) {
    const scene = this;
    if (!bullet.active || !asteroid.active || !asteroid.body) {
        return;
    }

    bulletsGroup.remove(bullet, true, true);

    let currentHp = asteroid.getData('hitPoints');
    const categoryName = asteroid.getData('category');
    const points = asteroid.getData('points');
    const isHit = asteroid.getData('isHit');

    if (currentHp === undefined) {
        console.warn("Asteroid hit without hitPoints data!", asteroid);
        asteroidsGroup.remove(asteroid, true, true);
        return;
    }
     if (!points) {
        console.warn("Asteroid hit without points data! Cannot show hit effect.", asteroid);
    }

    currentHp--;
    asteroid.setData('hitPoints', currentHp);

    if (currentHp <= 0) {
        if (particleEmitter) {
            particleEmitter.emitParticleAt(asteroid.x, asteroid.y);
        }
        // TODO: Implement Breaking Logic
        asteroidsGroup.remove(asteroid, true, true);
        // TODO: Add Scoring / Sound
    } else {
        if (points && !isHit) {
            asteroid.setData('isHit', true);
            drawAsteroidShape(asteroid, points, ASTEROID_HIT_FILL_COLOR, ASTEROID_HIT_FILL_ALPHA);
            scene.time.delayedCall(ASTEROID_HIT_DURATION, () => {
                if (asteroid && asteroid.active && asteroid.getData('hitPoints') > 0) {
                     drawAsteroidShape(asteroid, points);
                     asteroid.setData('isHit', false);
                }
            }, [], scene);
        }
        // TODO: Add Hit Sound
    }
}

function handlePlayerAsteroidCollision(player, asteroid) {
    if (!player.active || !asteroid.active || !asteroid.body) return;
    console.log("Player hit asteroid!");
    if (particleEmitter) {
        particleEmitter.emitParticleAt(asteroid.x, asteroid.y);
    }
    asteroidsGroup.remove(asteroid, true, true);
    // TODO: Implement Player Damage Logic
}

function handleAsteroidCollision(asteroid1, asteroid2) {
    // Optional: Play sound
}

// --- Cleanup Functions ---
function cleanupOutOfBoundsBullets(camera) {
    if (!camera) return;
    const worldView = camera.worldView;
    const cleanupBounds = new Phaser.Geom.Rectangle(
        worldView.left - BULLET_CLEANUP_BUFFER,
        worldView.top - BULLET_CLEANUP_BUFFER,
        worldView.width + BULLET_CLEANUP_BUFFER * 2,
        worldView.height + BULLET_CLEANUP_BUFFER * 2
    );

    bulletsGroup.children.iterate((bullet) => {
        if (bullet && bullet.body && !Phaser.Geom.Rectangle.Contains(cleanupBounds, bullet.x, bullet.y)) {
            bulletsGroup.remove(bullet, true, true);
        }
        return true;
    });
}

function cleanupOutOfBoundsAsteroids(camera) {
    if (!camera) return;
    const worldView = camera.worldView;
    const cleanupBounds = new Phaser.Geom.Rectangle(
        worldView.left - CLEANUP_BUFFER,
        worldView.top - CLEANUP_BUFFER,
        worldView.width + CLEANUP_BUFFER * 2,
        worldView.height + CLEANUP_BUFFER * 2
    );

    asteroidsGroup.children.iterate((asteroid) => {
         if (asteroid && asteroid.body && !Phaser.Geom.Rectangle.Contains(cleanupBounds, asteroid.x, asteroid.y)) {
            asteroidsGroup.remove(asteroid, true, true);
        }
        return true;
    });
}

// --- Player Movement ---
function handlePlayerMovement(scene) {
    if (!player || !player.body) return;

    player.body.setAngularVelocity(0);
    if (cursors.left.isDown || wasdKeys.A.isDown) {
        player.body.setAngularVelocity(-PLAYER_ANGULAR_VELOCITY);
    } else if (cursors.right.isDown || wasdKeys.D.isDown) {
        player.body.setAngularVelocity(PLAYER_ANGULAR_VELOCITY);
    }

    if (cursors.up.isDown || wasdKeys.W.isDown) {
        scene.physics.velocityFromRotation(player.rotation, SHIP_SPEED, player.body.acceleration);
    } else {
        player.body.setAcceleration(0);
    }
}

// --- Graphics Drawing Functions ---
function drawPlayerShape(graphics) {
    graphics.clear();
    graphics.lineStyle(PLAYER_LINE_WIDTH, 0xffffff, 1.0);
    graphics.beginPath();
    graphics.moveTo(PLAYER_SIZE.height / 2, 0);
    graphics.lineTo(-PLAYER_SIZE.height / 2, -PLAYER_SIZE.width / 2);
    graphics.lineTo(-PLAYER_SIZE.height / 2, PLAYER_SIZE.width / 2);
    graphics.closePath();
    graphics.strokePath();
}

function generateAsteroidPoints(avgRadius, numVertices) {
    const points = [];
    const angleStep = (Math.PI * 2) / numVertices;
    const radiusMin = avgRadius * (1 - ASTEROID_JAGGEDNESS);
    const radiusMax = avgRadius * (1 + ASTEROID_JAGGEDNESS);

    for (let i = 0; i < numVertices; i++) {
        const baseAngle = i * angleStep;
        const angle = baseAngle + Phaser.Math.FloatBetween(-angleStep * 0.2, angleStep * 0.2);
        const radius = Phaser.Math.FloatBetween(radiusMin, radiusMax);
        points.push({
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius
        });
    }
    return points;
}

function drawAsteroidShape(graphics, points, fillStyle = null, fillAlpha = 1.0) {
    if (!graphics || !points || points.length < 3) {
        return;
    }
    graphics.clear();

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
function drawVisibleGrid(camera) {
    if (!gridGraphics || !camera) return;

    gridGraphics.clear();
    gridGraphics.lineStyle(GRID_LINE_WIDTH, GRID_COLOR, GRID_ALPHA);

    const worldView = camera.worldView;
    const gridOffsetX = worldView.x % GRID_SIZE;
    const gridOffsetY = worldView.y % GRID_SIZE;

    for (let x = worldView.left - gridOffsetX; x < worldView.right + GRID_SIZE; x += GRID_SIZE) {
        gridGraphics.lineBetween(x, worldView.top, x, worldView.bottom);
    }

    for (let y = worldView.top - gridOffsetY; y < worldView.bottom + GRID_SIZE; y += GRID_SIZE) {
        gridGraphics.lineBetween(worldView.left, y, worldView.right, y);
    }
}