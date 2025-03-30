import Phaser from 'phaser';

// --- Configuration ---
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#003456',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false // Set true to see physics bodies (player rect, asteroid circles, bullet rects)
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
const GRID_SIZE = 8;
const GRID_COLOR = 0x4488ff;
const GRID_ALPHA = 0.1;
const GRID_LINE_WIDTH = .25;

// Player
const SHIP_SPEED = 250;
const PLAYER_SIZE = { width: 20, height: 30 };
const PLAYER_LINE_WIDTH = 1;
const PLAYER_ANGULAR_VELOCITY = 250;
const PLAYER_DRAG = 0.2;
const PLAYER_ANGULAR_DRAG = 200;

// Asteroid Categories Configuration
const ASTEROID_CATEGORIES = {
    XS: { minSize: 10, maxSize: 15, hp: 1, breakInto: null, breakCount: 0 },
    S:  { minSize: 16, maxSize: 24, hp: 2, breakInto: null, breakCount: 0 },
    M:  { minSize: 25, maxSize: 40, hp: 3, breakInto: null, breakCount: 0 },
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
const ASTEROID_INITIAL_COUNT = 5; // Number to spawn at start
const ASTEROID_SPAWN_RATE = 1500; // Milliseconds between new spawns
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

// Bullets
const BULLET_SPEED = 1000;
const BULLET_COOLDOWN = 300;
const BULLET_LENGTH = 18;         // Visual length of the bullet line
const BULLET_THICKNESS = 3;         // Visual thickness
const BULLET_COLOR = 0x00ff00;    // Bright green color
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
    const scene = this; // Reference to the scene context

    // --- Grid Setup ---
    gridGraphics = scene.add.graphics().setDepth(-1); // Draw grid behind everything

    // --- Player Setup ---
    playerGraphics = scene.add.graphics();
    drawPlayerShape(playerGraphics); // Draw the triangle
    player = scene.add.container(config.width / 2, config.height / 2, [playerGraphics]);
    player.angle = -90;
    scene.physics.world.enable(player);
    player.body.setSize(PLAYER_SIZE.width, PLAYER_SIZE.height);
    player.body.setOffset(-PLAYER_SIZE.width / 2, -PLAYER_SIZE.height / 2);
    player.body.setCollideWorldBounds(false);
    player.body.setDamping(true);
    player.body.setDrag(PLAYER_DRAG);
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
    particleEmitter = scene.add.particles(0, 0, 'particle', { // Use the generated 'particle' texture
        speed: { min: 50, max: EXPLOSION_PARTICLE_SPEED }, // Particle speed range
        angle: { min: 0, max: 360 },         // Emit in all directions
        scale: { start: 1.2, end: 0 },      // Shrink particles over time
        alpha: { start: 1, end: 0 },        // Fade out particles
        lifespan: EXPLOSION_PARTICLE_LIFESPAN, // How long particles live
        blendMode: 'ADD',                   // Additive blend looks good for explosions
        frequency: -1,                      // Don't emit continuously, only on explode
        quantity: EXPLOSION_PARTICLE_COUNT  // Number of particles per explosion
    });
    particleEmitter.setDepth(1); // Ensure particles appear above asteroids/grid

    // --- Physics Colliders / Overlaps ---
    // Asteroid vs Asteroid collision (Physical interaction)
    scene.physics.add.collider(asteroidsGroup, asteroidsGroup, handleAsteroidCollision);
    // Player vs Asteroid collision (Physical interaction)
    scene.physics.add.collider(player, asteroidsGroup, handlePlayerAsteroidCollision);

    // Bullet vs Asteroid collision -> USE OVERLAP
    // Overlap detects collision without causing physical bounce/momentum transfer from bullet
    scene.physics.add.overlap( // <--- CHANGED FROM COLLIDER TO OVERLAP
        bulletsGroup,
        asteroidsGroup,
        handleBulletAsteroidCollision, // The collision callback
        null,                          // Optional process callback (we don't need one)
        scene                          // The context ('this') for the callback function
    );

    // --- Initial Spawning ---
    for (let i = 0; i < ASTEROID_INITIAL_COUNT; i++) {
        spawnAsteroid(scene);
    }
    asteroidSpawnTimer = scene.time.addEvent({
        delay: ASTEROID_SPAWN_RATE,
        callback: () => { spawnAsteroid(scene); },
        loop: true
    });

    // --- Initial Grid Draw ---
    drawVisibleGrid(scene.cameras.main);
}

function update(time, delta) {
    const scene = this; // Reference to the scene context

    handlePlayerMovement(scene);
    handleShooting(scene, time);

    drawVisibleGrid(scene.cameras.main);

    cleanupOutOfBoundsAsteroids(scene.cameras.main);
    cleanupOutOfBoundsBullets(scene.cameras.main);
}

// --- Helper Functions ---

// --- Spawning Logic ---
function spawnAsteroid(scene) {
    const camera = scene.cameras.main;
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
    for (let retry = 0; retry < SPAWN_MAX_RETRIES; retry++) {
        const edge = Phaser.Math.Between(0, 3);
        switch (edge) {
            case 0: spawnX = Phaser.Math.FloatBetween(worldView.left - SPAWN_BUFFER, worldView.right + SPAWN_BUFFER); spawnY = worldView.top - SPAWN_BUFFER - Math.random() * SPAWN_BUFFER; break;
            case 1: spawnX = worldView.right + SPAWN_BUFFER + Math.random() * SPAWN_BUFFER; spawnY = Phaser.Math.FloatBetween(worldView.top - SPAWN_BUFFER, worldView.bottom + SPAWN_BUFFER); break;
            case 2: spawnX = Phaser.Math.FloatBetween(worldView.left - SPAWN_BUFFER, worldView.right + SPAWN_BUFFER); spawnY = worldView.bottom + SPAWN_BUFFER + Math.random() * SPAWN_BUFFER; break;
            case 3: spawnX = worldView.left - SPAWN_BUFFER - Math.random() * SPAWN_BUFFER; spawnY = Phaser.Math.FloatBetween(worldView.top - SPAWN_BUFFER, worldView.bottom + SPAWN_BUFFER); break;
        }
        tempSpawnPoint.set(spawnX, spawnY);

        let overlaps = false;
        asteroidsGroup.children.iterate((existingAsteroid) => {
            if (!existingAsteroid || !existingAsteroid.body || !existingAsteroid.active) return true;
            const existingSize = existingAsteroid.getData('visualSize') || category.minSize; // Use stored size
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

    if (!foundSpot) { return; }

    // Generate Graphics Points for the shape
    const points = generateAsteroidPoints(visualSize, numVertices); // <-- Generate points

    // Create Graphics object
    const asteroidGraphics = scene.add.graphics();
    drawAsteroidShape(asteroidGraphics, points); // Initial draw (stroke only)

    // Add graphics object to the PHYSICS group
    asteroidsGroup.add(asteroidGraphics);
    asteroidGraphics.setPosition(spawnX, spawnY);

    // Configure the Physics Body
    if (asteroidGraphics.body) {
        const body = asteroidGraphics.body;
        const colliderRadius = visualSize * 0.9;
        body.setCircle(colliderRadius);
        body.setOffset(-colliderRadius, -colliderRadius);

        const targetX = worldView.centerX + Phaser.Math.FloatBetween(-worldView.width * 0.1, worldView.width * 0.1);
        const targetY = worldView.centerY + Phaser.Math.FloatBetween(-worldView.height * 0.1, worldView.height * 0.1);
        const angle = Phaser.Math.Angle.Between(spawnX, spawnY, targetX, targetY);
        const speed = Phaser.Math.Between(ASTEROID_MIN_SPEED, ASTEROID_MAX_SPEED);
        scene.physics.velocityFromRotation(angle, speed, body.velocity);

        body.setAngularVelocity(Phaser.Math.FloatBetween(-ASTEROID_MAX_ROTATION_SPEED, ASTEROID_MAX_ROTATION_SPEED));
        body.setBounce(ASTEROID_BOUNCE);

        // --- Store Data on the Asteroid GameObject --- //
        asteroidGraphics.setData('category', categoryName);
        asteroidGraphics.setData('hitPoints', initialHp);
        asteroidGraphics.setData('visualSize', visualSize);
        asteroidGraphics.setData('points', points); // <-- STORE THE POINTS ARRAY
        asteroidGraphics.setData('isHit', false);   // <-- Flag for hit effect state

    } else {
        console.error("Failed to get physics body for asteroid!");
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
    const localTipX = PLAYER_SIZE.height / 2 + 10;
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

// Called when a bullet OVERLAPS an asteroid
function handleBulletAsteroidCollision(bullet, asteroid) {
    // Get scene context from 'this' passed during overlap setup
    const scene = this;

    // Ensure both objects are still active and valid
    if (!bullet.active || !asteroid.active || !asteroid.body) {
        return;
    }

    // Destroy the bullet immediately
    // No physics impact from bullet needed due to using overlap
    bulletsGroup.remove(bullet, true, true); // Remove from group, destroy GameObject, remove from scene

    // Get asteroid data
    let currentHp = asteroid.getData('hitPoints');
    const categoryName = asteroid.getData('category');
    const points = asteroid.getData('points'); // Get stored points for drawing
    const isHit = asteroid.getData('isHit');   // Check if already showing hit effect

    // Safety checks
    if (currentHp === undefined) {
        console.warn("Asteroid hit without hitPoints data!", asteroid);
        asteroidsGroup.remove(asteroid, true, true); // Remove the invalid asteroid
        return;
    }
     if (!points) {
        console.warn("Asteroid hit without points data!", asteroid);
        // Don't necessarily remove, but can't show hit effect
    }

    // Decrement HP
    currentHp--;
    asteroid.setData('hitPoints', currentHp); // Update the HP data

    // Check if asteroid is destroyed
    if (currentHp <= 0) {
        // --- Asteroid Destroyed ---

        // 1. Trigger Explosion Effect
        if (particleEmitter) { // Check if emitter exists
            particleEmitter.emitParticleAt(asteroid.x, asteroid.y); // Emit particles at asteroid's location
        }

        // --- TODO: Implement Breaking Logic ---
        // const category = ASTEROID_CATEGORIES[categoryName];
        // if (category && category.breakInto) {
        //     breakAsteroid(scene, asteroid, category.breakInto, category.breakCount);
        // }

        // 2. Destroy the asteroid *after* getting its position for the explosion
        asteroidsGroup.remove(asteroid, true, true); // Remove & Destroy

        // --- Add Point Scoring / Sound Here ---
        // e.g., updateScore(10);
        // e.g., playExplosionSound();

    } else {
        // --- Asteroid Hit but Survived ---

        // 1. Apply Visual Hit Effect (if points exist and not already hit)
        if (points && !isHit) {
            asteroid.setData('isHit', true); // Mark as being in hit state

            // Redraw with fill effect
            drawAsteroidShape(asteroid, points, ASTEROID_HIT_FILL_COLOR, ASTEROID_HIT_FILL_ALPHA);

            // Schedule revert back to stroke-only after a delay
            scene.time.delayedCall(ASTEROID_HIT_DURATION, () => {
                // Check if asteroid still exists and is active before redrawing
                if (asteroid && asteroid.active) {
                     drawAsteroidShape(asteroid, points); // Redraw stroke-only
                     asteroid.setData('isHit', false); // Reset hit state flag
                }
            }, [], scene); // Pass scene context to delayedCall
        }
        // console.log(`Asteroid ${categoryName} hit, HP remaining: ${currentHp}`);
        // Could play a small "tink" sound effect here
    }
}

// Called when the player collides with an asteroid
function handlePlayerAsteroidCollision(player, asteroid) {
    if (!player.active || !asteroid.active || !asteroid.body) return;
    console.log("Player hit asteroid!");
    // --- Player Damage Logic Here ---
    asteroidsGroup.remove(asteroid, true, true); // Destroy asteroid for now
    // Potentially trigger player damage effect, reduce lives etc.
    // You might want an explosion here too
    if (particleEmitter) {
        particleEmitter.emitParticleAt(asteroid.x, asteroid.y);
    }
}

// Called when two asteroids collide
function handleAsteroidCollision(asteroid1, asteroid2) {
    // Could play a small "thud" sound effect here
    // console.log("Asteroids collided");
}

// --- Cleanup Functions ---
function cleanupOutOfBoundsBullets(camera) {
    const worldView = camera.worldView;
    const cleanupBounds = new Phaser.Geom.Rectangle(
        worldView.left - BULLET_CLEANUP_BUFFER, worldView.top - BULLET_CLEANUP_BUFFER,
        worldView.width + BULLET_CLEANUP_BUFFER * 2, worldView.height + BULLET_CLEANUP_BUFFER * 2
    );
    bulletsGroup.children.iterate((bullet) => {
        if (bullet && bullet.body && !Phaser.Geom.Rectangle.Contains(cleanupBounds, bullet.x, bullet.y)) {
            bulletsGroup.remove(bullet, true, true);
        }
        return true;
    });
}

function cleanupOutOfBoundsAsteroids(camera) {
    const worldView = camera.worldView;
    const cleanupBounds = new Phaser.Geom.Rectangle(
        worldView.left - CLEANUP_BUFFER, worldView.top - CLEANUP_BUFFER,
        worldView.width + CLEANUP_BUFFER * 2, worldView.height + CLEANUP_BUFFER * 2
    );
    asteroidsGroup.children.iterate((asteroid) => {
        if (asteroid && asteroid.body && !Phaser.Geom.Rectangle.Contains(cleanupBounds, asteroid.x, asteroid.y)) {
            asteroidsGroup.remove(asteroid, true, true);
        }
        return true;
    });
}

// --- Graphics Drawing Functions ---
function drawPlayerShape(graphics) {
    graphics.clear();
    graphics.lineStyle(PLAYER_LINE_WIDTH, 0xffffff, 1);
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
        const angle = baseAngle + Phaser.Math.FloatBetween(-angleStep * 0.15, angleStep * 0.15);
        const radius = Phaser.Math.FloatBetween(radiusMin, radiusMax);
        points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
    return points;
}

// MODIFIED: Draws the asteroid polygon, optionally with a fill
function drawAsteroidShape(graphics, points, fillColor = null, fillAlpha = 1.0) {
    graphics.clear(); // Clear previous drawing

    // --- Draw Fill (if specified) ---
    if (fillColor !== null && points && points.length > 0) {
        graphics.fillStyle(fillColor, fillAlpha);
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            graphics.lineTo(points[i].x, points[i].y);
        }
        graphics.closePath();
        graphics.fillPath(); // Draw the fill
    }

    // --- Draw Stroke ---
    if (points && points.length > 0) {
        graphics.lineStyle(ASTEROID_LINE_WIDTH, ASTEROID_COLOR, 1.0); // White outline
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            graphics.lineTo(points[i].x, points[i].y);
        }
        graphics.closePath();
        graphics.strokePath(); // Draw the outline
    }
}

function drawVisibleGrid(camera) {
    gridGraphics.clear();
    gridGraphics.lineStyle(GRID_LINE_WIDTH, GRID_COLOR, GRID_ALPHA);

    const bounds = camera.worldView;
    const buffer = GRID_SIZE * 2;
    const startX = Math.floor((bounds.left - buffer) / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor((bounds.top - buffer) / GRID_SIZE) * GRID_SIZE;
    const endX = Math.ceil((bounds.right + buffer) / GRID_SIZE) * GRID_SIZE;
    const endY = Math.ceil((bounds.bottom + buffer) / GRID_SIZE) * GRID_SIZE;

    for (let x = startX; x <= endX; x += GRID_SIZE) {
        const isThicker = (x % (GRID_SIZE * 5) === 0);
        gridGraphics.lineStyle(isThicker ? GRID_LINE_WIDTH + 0.5 : GRID_LINE_WIDTH, GRID_COLOR, isThicker ? GRID_ALPHA + 0.2 : GRID_ALPHA);
        gridGraphics.lineBetween(x, startY, x, endY);
    }
    for (let y = startY; y <= endY; y += GRID_SIZE) {
         const isThicker = (y % (GRID_SIZE * 5) === 0);
         gridGraphics.lineStyle(isThicker ? GRID_LINE_WIDTH + 0.5 : GRID_LINE_WIDTH, GRID_COLOR, isThicker ? GRID_ALPHA + 0.2 : GRID_ALPHA);
        gridGraphics.lineBetween(startX, y, endX, y);
    }
}

// --- Player Movement Logic ---
function handlePlayerMovement(scene) {
    player.body.setAcceleration(0);
    player.body.setAngularVelocity(0);

    if (cursors.left.isDown || wasdKeys.A.isDown) {
        player.body.setAngularVelocity(-PLAYER_ANGULAR_VELOCITY);
    } else if (cursors.right.isDown || wasdKeys.D.isDown) {
        player.body.setAngularVelocity(PLAYER_ANGULAR_VELOCITY);
    }

    if (cursors.up.isDown || wasdKeys.W.isDown) {
        scene.physics.velocityFromRotation(player.rotation, SHIP_SPEED, player.body.acceleration);
    } else if (cursors.down.isDown || wasdKeys.S.isDown) {
        scene.physics.velocityFromRotation(player.rotation, -SHIP_SPEED / 2, player.body.acceleration);
    }

    applyGrip(scene);
}

function applyGrip(scene) {
    const gripFactor = 0.03;
    const currentVelocity = player.body.velocity;
    const speed = currentVelocity.length();
    if (speed < 5) { return; }
    const forwardVector = scene.physics.velocityFromRotation(player.rotation, 1, tempVec1);
    const rightVector = forwardVector.clone().rotate(Math.PI / 2);
    const sidewaysSpeed = currentVelocity.dot(rightVector);
    const correctionVelocity = rightVector.scale(sidewaysSpeed * gripFactor);
    player.body.velocity.subtract(correctionVelocity);
}