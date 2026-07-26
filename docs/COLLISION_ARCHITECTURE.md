# Collision Architecture

Street collision has one owner: the engine's contact resolver
(`engine/solvers/vehicle-contact.ts`) behind `engine/adapters/surface-physics.ts`.

## Tick flow

1. Vehicle and humanoid controllers compute desired motion.
2. The server reconciles active entities with persistent bodies in stable key order.
3. Vehicle drive updates authored linear and angular velocity without replacing the body.
4. `PhysicsWorld` (`engine/adapters/surface-physics.ts`) advances all bodies once at 60 Hz.
5. Simulation state captures the resulting poses and velocities.
6. Server controllers consume engine contact facts and apply damage, crime, and other
   execute-once outcomes.

Clients do not run collision physics. They render replicated authoritative poses through
surface-aware snapshot timelines.

## Shapes and groups

- Static district tiles are greedily meshed into fixed rectangles, plus explicit map
  border walls.
- Vehicles are catalog-sized oriented boxes with free rotation. Their handling model
  applies acceleration, steering torque, lateral grip, handbrake grip loss, and power
  oversteer before the engine's contact resolver resolves contacts.
- Street humanoids are balls.
- Vehicles collide with statics, vehicles, and humanoids.
- Humanoids collide with statics and vehicles, not other humanoids.

## Boundaries

- `PhysicsWorld` owns collision detection, separation, and contact facts.
- Control-policy modules own desired engine motion and tyre response; the engine's
  contact resolver owns the resulting pose, angular motion, collision response, and
  contact facts.
- Server gameplay controllers own damage and side effects.
- Interior walking retains authored rectangle occupancy until interior geometry joins
  a physics world.
- Hitscan and projectile rewind remain combat-query systems, not rigid-body collision.

Do not add a parallel street collision kernel or resolve an engine dynamic pair a second
time in gameplay code.
