import Phaser from 'phaser';

// --- Get initial screen dimensions ---
const screenWidth = window.innerWidth;
const screenHeight = window.innerHeight;

// --- Configuration ---
const config = {
  type: Phaser.AUTO,
  // --- Use initial window size ---
  width: screenWidth,
  height: screenHeight,
  // --- Specify the parent container ID ---
  parent: 'app', // Tells Phaser to put the canvas inside the <div id="app">
  backgroundColor: '#003456',
  // --- Add Scale Manager Config ---
  scale: {
      mode: Phaser.Scale.RESIZE, // Resizes canvas to fit parent ('app' div)
      autoCenter: Phaser.Scale.CENTER_BOTH // Centers canvas within parent (good practice)
  },
  physics: {
      default: 'arcade',
      arcade: {
          gravity: { y: 0 },
          debug: false
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
const GRID_SIZE = 50; // Increased size for visibility
const GRID_COLOR = 0x4488ff;
const GRID_ALPHA = 0.3;
const GRID_LINE_WIDTH = .35;

// Player
const SHIP_SPEED = 250;
const PLAYER_SIZE = { width: 20, height: 30 };
const PLAYER_LINE_WIDTH = 2;
const PLAYER_ANGULAR_VELOCITY = 250;
const PLAYER_DRAG = 0.2; // Changed drag interpretation slightly (closer to 1 = less drag)
const PLAYER_ANGULAR_DRAG = 200; // Angular drag still seems reasonable

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
const ASTEROID_INITIAL_COUNT = 10; // Increased initial count
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
    const scene = this; // 'this' refers to the Scene object Phaser creates

    // --- Get Actual Initial Game Size ---
    // Use the scale manager's size AFTER Phaser initialization
    const gameWidth = scene.scale.width;
    const gameHeight = scene.scale.height;
    console.log(`Initial game size: ${gameWidth} x ${gameHeight}`);

    // --- Grid Setup ---
    gridGraphics = scene.add.graphics().setDepth(-1); // Draw grid behind everything

    // --- Player Setup ---
    playerGraphics = scene.add.graphics();
    drawPlayerShape(playerGraphics); // Draw the triangle
    // --- Position player in the center of the actual game view ---
    player = scene.add.container(gameWidth / 2, gameHeight / 2, [playerGraphics]);
    player.angle = -90; // Point upwards initially
    scene.physics.world.enable(player);
    player.body.setSize(PLAYER_SIZE.width, PLAYER_SIZE.height); // Match visual shape better
    player.body.setOffset(-PLAYER_SIZE.width / 2, -PLAYER_SIZE.height / 2); // Center physics body
    player.body.setCollideWorldBounds(false); // Allow player to fly off-screen
    player.body.setDamping(true); // Enable drag
    player.body.setDrag(PLAYER_DRAG, PLAYER_DRAG); // Apply linear drag (both x/y)
    player.body.setAngularDrag(PLAYER_ANGULAR_DRAG); // Apply angular drag
    player.body.setMaxVelocity(SHIP_SPEED * 1.5); // Limit max speed

    // --- Camera Setup ---
    // Set infinite bounds for scrolling map
    scene.cameras.main.setBounds(-Infinity, -Infinity, Infinity, Infinity);
    // Make camera follow the player smoothly
    scene.cameras.main.startFollow(player, true, 0.1, 0.1); // lerp values control smoothness (0 to 1)
    // Set background color (redundant with config but good practice)
    scene.cameras.main.setBackgroundColor(config.backgroundColor);

    // --- Input Setup ---
    cursors = scene.input.keyboard.createCursorKeys();
    wasdKeys = scene.input.keyboard.addKeys('W,A,S,D');
    spaceKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // --- Asteroid Setup ---
    asteroidsGroup = scene.physics.add.group({
        bounceX: ASTEROID_BOUNCE,
        bounceY: ASTEROID_BOUNCE,
        collideWorldBounds: false, // Allow asteroids to go off-screen
    });

    // --- Bullet Setup ---
    bulletsGroup = scene.physics.add.group({
        collideWorldBounds: false, // Allow bullets to go off-screen
    });
    lastFiredTime = 0; // Initialize fire timer

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
    scene.physics.add.overlap(
        bulletsGroup,
        asteroidsGroup,
        handleBulletAsteroidCollision, // The collision callback
        null,                          // Optional process callback (we don't need one)
        scene                          // The context ('this') for the callback function
    );

    // --- Initial Spawning ---
    for (let i = 0; i < ASTEROID_INITIAL_COUNT; i++) {
        spawnAsteroid(scene); // Pass scene context
    }
    // Start timed asteroid spawning
    asteroidSpawnTimer = scene.time.addEvent({
        delay: ASTEROID_SPAWN_RATE,
        callback: () => { spawnAsteroid(scene); }, // Ensure scene context is available
        loop: true
    });

    // --- Initial Grid Draw ---
    // Assuming drawVisibleGrid uses the camera passed to it correctly
    drawVisibleGrid(scene.cameras.main);

    // --- Add Resize Listener ---
    // Listen for the 'resize' event from the Scale Manager
    scene.scale.on('resize', handleResize, scene); // Call handleResize with scene context
}

function update(time, delta) {
    const scene = this; // Reference to the scene context for callbacks

    // Handle player input for movement and rotation
    handlePlayerMovement(scene); // Pass scene context

    // Handle player input for shooting
    handleShooting(scene, time); // Pass scene context and time

    // Redraw the grid based on camera movement
    // Consider optimizing if performance becomes an issue
    drawVisibleGrid(scene.cameras.main); // Pass camera

    // Remove asteroids that have flown too far off-screen
    cleanupOutOfBoundsAsteroids(scene.cameras.main); // Pass camera

    // Remove bullets that have flown too far off-screen
    cleanupOutOfBoundsBullets(scene.cameras.main); // Pass camera
}

// --- Add the Resize Handler Function ---
function handleResize(gameSize, baseSize, displaySize, resolution) {
    // 'this' will be the scene context because we passed it in scene.scale.on
    const scene = this;
    const newWidth = gameSize.width;
    const newHeight = gameSize.height;

    console.log(`Game resized to: ${newWidth}x${newHeight}`);

    // The main camera is automatically resized by RESIZE mode.
    // You usually DON'T need to resize it manually:
    // scene.cameras.main.setSize(newWidth, newHeight);

    // Redraw the grid immediately with the new camera size/view
    if (gridGraphics && scene.cameras.main) { // Check if graphics object exists
        drawVisibleGrid(scene.cameras.main);
    }

    // If you had UI elements (like score text, lives) anchored to corners,
    // you would reposition them here based on newWidth and newHeight.
    // Example:
    // if (scene.scoreText) {
    //    scene.scoreText.setPosition(newWidth - 10, 10).setOrigin(1, 0); // Anchor to Top right
    // }
    // if (scene.livesIcons) {
    //    // Reposition a group of life icons in the top left
    //    scene.livesIcons.setX(10);
    //    scene.livesIcons.setY(10);
    // }
}


// --- Helper Functions ---

// --- Spawning Logic ---
// Spawns a single asteroid off-screen
function spawnAsteroid(scene) {
    const camera = scene.cameras.main;
    if (!camera) return; // Safety check
    const worldView = camera.worldView;

    // Select a random category (XS, S, M)
    const categoryName = Phaser.Utils.Array.GetRandom(ACTIVE_ASTEROID_CATEGORIES);
    const category = ASTEROID_CATEGORIES[categoryName];
    if (!category) {
        console.error("Invalid asteroid category selected:", categoryName);
        return;
    }
    // Determine visual size and HP based on category
    const visualSize = Phaser.Math.Between(category.minSize, category.maxSize);
    const initialHp = category.hp;
    const numVertices = Phaser.Math.Between(ASTEROID_MIN_VERTICES, ASTEROID_MAX_VERTICES);

    let spawnX, spawnY;
    let foundSpot = false;
    // Try several times to find a non-overlapping spawn location
    for (let retry = 0; retry < SPAWN_MAX_RETRIES; retry++) {
        // Choose a random edge (top, right, bottom, left) relative to camera view
        const edge = Phaser.Math.Between(0, 3);
        switch (edge) {
            case 0: // Top edge
                 spawnX = Phaser.Math.FloatBetween(worldView.left - SPAWN_BUFFER, worldView.right + SPAWN_BUFFER);
                 spawnY = worldView.top - SPAWN_BUFFER - Math.random() * SPAWN_BUFFER; break;
            case 1: // Right edge
                 spawnX = worldView.right + SPAWN_BUFFER + Math.random() * SPAWN_BUFFER;
                 spawnY = Phaser.Math.FloatBetween(worldView.top - SPAWN_BUFFER, worldView.bottom + SPAWN_BUFFER); break;
            case 2: // Bottom edge
                 spawnX = Phaser.Math.FloatBetween(worldView.left - SPAWN_BUFFER, worldView.right + SPAWN_BUFFER);
                 spawnY = worldView.bottom + SPAWN_BUFFER + Math.random() * SPAWN_BUFFER; break;
            case 3: // Left edge
                 spawnX = worldView.left - SPAWN_BUFFER - Math.random() * SPAWN_BUFFER;
                 spawnY = Phaser.Math.FloatBetween(worldView.top - SPAWN_BUFFER, worldView.bottom + SPAWN_BUFFER); break;
        }
        tempSpawnPoint.set(spawnX, spawnY); // Use temp vector

        // Check for overlap with existing asteroids
        let overlaps = false;
        asteroidsGroup.children.iterate((existingAsteroid) => {
            if (!existingAsteroid || !existingAsteroid.body || !existingAsteroid.active) return true; // Skip inactive/invalid
            const existingSize = existingAsteroid.getData('visualSize') || category.minSize; // Use stored size or default
            // Calculate required distance based on both radii + multiplier
            const requiredDist = (visualSize + existingSize) * SPAWN_CHECK_RADIUS_MULTIPLIER;
            const currentDist = Phaser.Math.Distance.Between(tempSpawnPoint.x, tempSpawnPoint.y, existingAsteroid.x, existingAsteroid.y);
            if (currentDist < requiredDist) {
                overlaps = true;
                return false; // Stop iteration early if overlap found
            }
            return true; // Continue checking
        });

        if (!overlaps) {
            foundSpot = true;
            break; // Exit retry loop
        }
    }

    // If no non-overlapping spot found after retries, skip spawning this time
    if (!foundSpot) {
        // console.log("Could not find non-overlapping spawn spot.");
        return;
    }

    // Generate Graphics Points for the asteroid's jagged shape
    const points = generateAsteroidPoints(visualSize, numVertices);

    // Create Graphics object for the asteroid visual
    const asteroidGraphics = scene.add.graphics();
    drawAsteroidShape(asteroidGraphics, points); // Initial draw (stroke only)

    // Add the graphics object to the PHYSICS group (this enables physics)
    asteroidsGroup.add(asteroidGraphics); // IMPORTANT: Add to the correct group
    asteroidGraphics.setPosition(spawnX, spawnY); // Set position

    // Configure the Physics Body *after* adding to the group
    if (asteroidGraphics.body) {
        const body = asteroidGraphics.body;
        // Set physics body to a circle approximating the visual size
        const colliderRadius = visualSize * 0.9; // Adjust multiplier as needed
        body.setCircle(colliderRadius);
        body.setOffset(-colliderRadius, -colliderRadius); // Center the circle body

        // Set initial velocity towards the center of the current view (approx)
        const targetX = worldView.centerX + Phaser.Math.FloatBetween(-worldView.width * 0.1, worldView.width * 0.1);
        const targetY = worldView.centerY + Phaser.Math.FloatBetween(-worldView.height * 0.1, worldView.height * 0.1);
        const angle = Phaser.Math.Angle.Between(spawnX, spawnY, targetX, targetY);
        const speed = Phaser.Math.Between(ASTEROID_MIN_SPEED, ASTEROID_MAX_SPEED);
        scene.physics.velocityFromRotation(angle, speed, body.velocity); // Use scene context

        // Set random angular velocity
        body.setAngularVelocity(Phaser.Math.FloatBetween(-ASTEROID_MAX_ROTATION_SPEED, ASTEROID_MAX_ROTATION_SPEED));
        // Set bounce (restitution)
        body.setBounce(ASTEROID_BOUNCE); // Inherited from group, but can be set per-object

        // --- Store Custom Data on the Asteroid GameObject --- //
        asteroidGraphics.setData('category', categoryName);
        asteroidGraphics.setData('hitPoints', initialHp);
        asteroidGraphics.setData('visualSize', visualSize);
        asteroidGraphics.setData('points', points); // Store the vertex points for redrawing
        asteroidGraphics.setData('isHit', false);   // Flag for hit visual effect state

    } else {
        console.error("Failed to get physics body for asteroid! Was it added to the physics group?");
        asteroidGraphics.destroy(); // Clean up if physics body failed
    }
}

// --- Shooting Logic ---
// Checks input and cooldown, calls shootBullet if ready
function handleShooting(scene, time) {
     if (spaceKey.isDown && time > lastFiredTime + BULLET_COOLDOWN) {
        shootBullet(scene); // Pass scene context
        lastFiredTime = time; // Reset cooldown timer
    }
}

// Creates and fires a single bullet from the player's ship tip
function shootBullet(scene) {
    if (!player || !player.active) return; // Don't shoot if player doesn't exist

    // Calculate the world position of the ship's tip
    // Local offset: x = distance forward from center, y = 0 (centerline)
    const localTipX = PLAYER_SIZE.height / 2 + 5; // Slightly ahead of the visual tip
    const localTipY = 0;
    player.getWorldTransformMatrix().transformPoint(localTipX, localTipY, tempBulletPos); // Use temp point

    // Create Graphics object for the bullet's visual representation
    const bulletGraphics = scene.add.graphics();
    bulletGraphics.lineStyle(BULLET_THICKNESS, BULLET_COLOR, 1.0);
    // Draw a line centered at (0,0) - position/rotation handles placement
    bulletGraphics.lineBetween(-BULLET_LENGTH / 2, 0, BULLET_LENGTH / 2, 0);

    // Add the graphics object to the bullets physics group
    bulletsGroup.add(bulletGraphics);
    bulletGraphics.setPosition(tempBulletPos.x, tempBulletPos.y); // Set initial position
    bulletGraphics.setRotation(player.rotation); // Match player's rotation

    // Configure the Physics Body
    if (bulletGraphics.body) {
        const body = bulletGraphics.body;
        // Set physics body size (approximating the line)
        body.setSize(BULLET_LENGTH, BULLET_THICKNESS);
        body.setOffset(-BULLET_LENGTH / 2, -BULLET_THICKNESS / 2); // Center the body

        // Set velocity based on player's rotation and bullet speed
        scene.physics.velocityFromRotation(player.rotation, BULLET_SPEED, body.velocity); // Use scene context

        // Bullets shouldn't be affected by gravity or drag
        body.setAllowGravity(false);
        body.setAngularVelocity(0); // No spin
        body.setDrag(0, 0); // No air resistance
    } else {
        console.error("Failed to create physics body for bullet!");
        bulletGraphics.destroy(); // Clean up if physics fails
    }
}

// --- Collision Handlers ---

// Called when a bullet OVERLAPS an asteroid (using scene.physics.add.overlap)
function handleBulletAsteroidCollision(bullet, asteroid) {
    // 'this' context is passed correctly from the add.overlap call
    const scene = this;

    // Ensure both objects are still active and valid before proceeding
    if (!bullet.active || !asteroid.active || !asteroid.body) {
        return;
    }

    // Destroy the bullet immediately on impact
    bulletsGroup.remove(bullet, true, true); // Remove from group, destroy GameObject, remove from scene

    // Get asteroid custom data
    let currentHp = asteroid.getData('hitPoints');
    const categoryName = asteroid.getData('category');
    const points = asteroid.getData('points'); // Get stored points for redrawing hit effect
    const isHit = asteroid.getData('isHit');   // Check if already showing hit effect

    // Safety check for missing HP data
    if (currentHp === undefined) {
        console.warn("Asteroid hit without hitPoints data!", asteroid);
        asteroidsGroup.remove(asteroid, true, true); // Remove the invalid asteroid
        return;
    }
     // Safety check for missing points data (needed for hit effect)
     if (!points) {
        console.warn("Asteroid hit without points data! Cannot show hit effect.", asteroid);
        // Asteroid still takes damage, just no visual flash
    }

    // Decrement HP
    currentHp--;
    asteroid.setData('hitPoints', currentHp); // Update the HP stored on the asteroid

    // Check if asteroid is destroyed (HP <= 0)
    if (currentHp <= 0) {
        // --- Asteroid Destroyed ---

        // 1. Trigger Explosion Effect at asteroid's position
        if (particleEmitter) { // Check if emitter exists
            particleEmitter.emitParticleAt(asteroid.x, asteroid.y); // Emit particles
        }

        // --- TODO: Implement Breaking Logic ---
        // Check if the category is supposed to break into smaller pieces
        // const category = ASTEROID_CATEGORIES[categoryName];
        // if (category && category.breakInto && category.breakCount > 0) {
        //     breakAsteroid(scene, asteroid, category.breakInto, category.breakCount); // Need to implement breakAsteroid
        // }

        // 2. Destroy the asteroid *after* getting its position for the explosion/breaking
        asteroidsGroup.remove(asteroid, true, true); // Remove & Destroy

        // --- TODO: Add Point Scoring / Sound Effects Here ---
        // e.g., scene.registry.get('scoreManager').addScore(10);
        // e.g., scene.sound.play('explosion_sound');

    } else {
        // --- Asteroid Hit but Survived ---

        // 1. Apply Visual Hit Effect (flash) if points exist and not already flashing
        if (points && !isHit) {
            asteroid.setData('isHit', true); // Mark as being in hit state

            // Redraw the asteroid shape with a temporary fill
            drawAsteroidShape(asteroid, points, ASTEROID_HIT_FILL_COLOR, ASTEROID_HIT_FILL_ALPHA);

            // Schedule a revert back to the normal stroke-only appearance after a short duration
            scene.time.delayedCall(ASTEROID_HIT_DURATION, () => {
                // IMPORTANT: Check if asteroid still exists and is active before trying to redraw
                if (asteroid && asteroid.active && asteroid.getData('hitPoints') > 0) { // Also check HP > 0 just in case
                     drawAsteroidShape(asteroid, points); // Redraw stroke-only
                     asteroid.setData('isHit', false); // Reset hit state flag
                }
            }, [], scene); // Pass scene context to delayedCall's scope
        }

        // --- TODO: Add Hit Sound Effect Here ---
        // e.g., scene.sound.play('asteroid_hit_sound');
        // console.log(`Asteroid ${categoryName} hit, HP remaining: ${currentHp}`);
    }
}

// Called when the player physically collides with an asteroid (using scene.physics.add.collider)
function handlePlayerAsteroidCollision(player, asteroid) {
    // 'this' context should be the scene, but we don't strictly need it here yet
    // const scene = this;

    // Basic check if objects are valid
    if (!player.active || !asteroid.active || !asteroid.body) return;

    console.log("Player hit asteroid!");

    // Trigger explosion effect for the asteroid
    if (particleEmitter) {
        particleEmitter.emitParticleAt(asteroid.x, asteroid.y);
    }

    // Destroy the asteroid on collision with player
    asteroidsGroup.remove(asteroid, true, true);

    // --- TODO: Implement Player Damage Logic ---
    // - Reduce player lives/health
    // - Trigger player hit visual effect (e.g., flash, temporary invincibility)
    // - Play player damage sound
    // - Check for game over condition
    // Example:
    // player.setData('health', player.getData('health') - 1);
    // if (player.getData('health') <= 0) { scene.scene.start('GameOverScene'); }
    // else { scene.cameras.main.flash(200, 255, 0, 0); } // Red flash
}

// Called when two asteroids physically collide (using scene.physics.add.collider)
function handleAsteroidCollision(asteroid1, asteroid2) {
    // Could play a small "thud" or "clack" sound effect here
    // e.g., this.sound.play('asteroid_collide_sound', { volume: 0.2 });
    // console.log("Asteroids collided");
    // Physics engine handles the bounce based on group/body settings
}

// --- Cleanup Functions ---
// Removes bullets that are far outside the camera's view
function cleanupOutOfBoundsBullets(camera) {
    if (!camera) return;
    const worldView = camera.worldView;
    // Define a larger boundary outside the camera view
    const cleanupBounds = new Phaser.Geom.Rectangle(
        worldView.left - BULLET_CLEANUP_BUFFER,
        worldView.top - BULLET_CLEANUP_BUFFER,
        worldView.width + BULLET_CLEANUP_BUFFER * 2,
        worldView.height + BULLET_CLEANUP_BUFFER * 2
    );

    bulletsGroup.children.iterate((bullet) => {
        // Check if bullet exists, has a body, and is outside the cleanup bounds
        if (bullet && bullet.body && !Phaser.Geom.Rectangle.Contains(cleanupBounds, bullet.x, bullet.y)) {
            bulletsGroup.remove(bullet, true, true); // Remove and destroy
        }
        return true; // Continue iteration
    });
}

// Removes asteroids that are far outside the camera's view
function cleanupOutOfBoundsAsteroids(camera) {
     if (!camera) return;
    const worldView = camera.worldView;
    // Define a larger boundary outside the camera view for asteroids
    const cleanupBounds = new Phaser.Geom.Rectangle(
        worldView.left - CLEANUP_BUFFER,
        worldView.top - CLEANUP_BUFFER,
        worldView.width + CLEANUP_BUFFER * 2,
        worldView.height + CLEANUP_BUFFER * 2
    );

    asteroidsGroup.children.iterate((asteroid) => {
         // Check if asteroid exists, has a body, and is outside the cleanup bounds
        if (asteroid && asteroid.body && !Phaser.Geom.Rectangle.Contains(cleanupBounds, asteroid.x, asteroid.y)) {
            asteroidsGroup.remove(asteroid, true, true); // Remove and destroy
        }
        return true; // Continue iteration
    });
}

// --- Player Movement ---
// Handles player rotation and thrust based on keyboard input
function handlePlayerMovement(scene) {
    // Safety check for player and its physics body
     if (!player || !player.body) return;

    // --- Rotation ---
    // Reset angular velocity each frame unless a key is pressed
    player.body.setAngularVelocity(0);

    if (cursors.left.isDown || wasdKeys.A.isDown) {
        player.body.setAngularVelocity(-PLAYER_ANGULAR_VELOCITY); // Rotate left
    } else if (cursors.right.isDown || wasdKeys.D.isDown) {
        player.body.setAngularVelocity(PLAYER_ANGULAR_VELOCITY); // Rotate right
    }

    // --- Thrust ---
    // Apply acceleration in the direction the ship is facing
    if (cursors.up.isDown || wasdKeys.W.isDown) {
        // Calculate acceleration vector based on ship's rotation and speed constant
        scene.physics.velocityFromRotation(player.rotation, SHIP_SPEED, player.body.acceleration); // Use scene context
    } else {
        // If up key isn't pressed, stop accelerating
        // Drag will naturally slow the ship down
        player.body.setAcceleration(0);
    }

    // --- Optional: Brakes/Reverse ---
    // if (cursors.down.isDown || wasdKeys.S.isDown) {
    //     // Apply acceleration in the opposite direction
    //     scene.physics.velocityFromRotation(player.rotation, -SHIP_SPEED / 2, player.body.acceleration);
    // }
}


// --- Graphics Drawing Functions ---

// Draws the player's ship shape (triangle)
function drawPlayerShape(graphics) {
    graphics.clear(); // Clear previous drawing
    graphics.lineStyle(PLAYER_LINE_WIDTH, 0xffffff, 1.0); // White outline
    graphics.beginPath();
    // Define vertices relative to the container's center (0,0)
    // Tip points forward (positive X direction before rotation)
    graphics.moveTo(PLAYER_SIZE.height / 2, 0);                    // Nose tip
    graphics.lineTo(-PLAYER_SIZE.height / 2, -PLAYER_SIZE.width / 2); // Bottom-left wing
    graphics.lineTo(-PLAYER_SIZE.height / 2, PLAYER_SIZE.width / 2);  // Bottom-right wing
    graphics.closePath(); // Connect back to the start
    graphics.strokePath(); // Draw the outline
}

// Generates random points for a jagged asteroid shape
function generateAsteroidPoints(avgRadius, numVertices) {
    const points = [];
    const angleStep = (Math.PI * 2) / numVertices; // Angle between base vertices
    // Define min/max radius based on average and jaggedness factor
    const radiusMin = avgRadius * (1 - ASTEROID_JAGGEDNESS);
    const radiusMax = avgRadius * (1 + ASTEROID_JAGGEDNESS);

    for (let i = 0; i < numVertices; i++) {
        const baseAngle = i * angleStep;
        // Add slight randomness to the angle for vertex positioning
        const angle = baseAngle + Phaser.Math.FloatBetween(-angleStep * 0.2, angleStep * 0.2); // Adjust random range as needed
        // Choose a random radius within the defined range
        const radius = Phaser.Math.FloatBetween(radiusMin, radiusMax);
        // Calculate vertex position (relative to center 0,0)
        points.push({
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius
        });
    }
    return points; // Return the array of {x, y} points
}

// Draws the asteroid shape using provided points, optionally with a fill
function drawAsteroidShape(graphics, points, fillStyle = null, fillAlpha = 1.0) {
    // Safety check for valid graphics object and points array
    if (!graphics || !points || points.length < 3) {
        // console.warn("Cannot draw asteroid shape: Invalid graphics or points.");
        return;
    }
    graphics.clear(); // Clear any previous drawing on this graphics object

    // --- Draw Fill (if requested) ---
    if (fillStyle !== null) {
        graphics.fillStyle(fillStyle, fillAlpha);
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y); // Start at the first point
        for (let i = 1; i < points.length; i++) {
            graphics.lineTo(points[i].x, points[i].y); // Draw lines to subsequent points
        }
        graphics.closePath(); // Connect the last point back to the first
        graphics.fillPath(); // Fill the defined shape
    }

    // --- Draw Stroke (outline) - Always draw this on top of fill ---
    graphics.lineStyle(ASTEROID_LINE_WIDTH, ASTEROID_COLOR, 1.0); // Use constants for style
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y); // Start at the first point
    for (let i = 1; i < points.length; i++) {
        graphics.lineTo(points[i].x, points[i].y); // Draw lines to subsequent points
    }
    graphics.closePath(); // Connect the last point back to the first
    graphics.strokePath(); // Draw the outline
}


// --- Grid Drawing ---
// Draws a grid covering the camera's current view
function drawVisibleGrid(camera) {
    // Safety check for graphics object and camera
    if (!gridGraphics || !camera) return;

    gridGraphics.clear(); // Clear previous grid lines
    gridGraphics.lineStyle(GRID_LINE_WIDTH, GRID_COLOR, GRID_ALPHA); // Set line style

    const worldView = camera.worldView; // Get the camera's view rectangle in world coordinates

    // Calculate the offset needed to align grid lines perfectly, regardless of camera scroll
    const gridOffsetX = worldView.x % GRID_SIZE;
    const gridOffsetY = worldView.y % GRID_SIZE;

    // Draw Vertical lines
    // Start drawing from the left edge of the view, adjusted by the offset,
    // and continue until past the right edge.
    for (let x = worldView.left - gridOffsetX; x < worldView.right + GRID_SIZE; x += GRID_SIZE) {
        gridGraphics.lineBetween(x, worldView.top, x, worldView.bottom); // Draw line from top to bottom of view
    }

    // Draw Horizontal lines
    // Start drawing from the top edge of the view, adjusted by the offset,
    // and continue until past the bottom edge.
    for (let y = worldView.top - gridOffsetY; y < worldView.bottom + GRID_SIZE; y += GRID_SIZE) {
        gridGraphics.lineBetween(worldView.left, y, worldView.right, y); // Draw line from left to right of view
    }
}