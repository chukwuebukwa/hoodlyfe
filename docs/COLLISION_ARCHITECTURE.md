# Collision Architecture

Street collision has one owner: Rapier.

## Tick flow

1. Vehicle and humanoid controllers compute desired motion.
2. The server rebuilds active street bodies from the tick baseline in stable key order.
3. `PhysicsWorld` advances all bodies once at 30 Hz.
4. Simulation state captures the resulting poses and velocities.
5. Server controllers consume Rapier contact facts and apply damage, crime, and other
   execute-once outcomes.

Clients do not run collision physics. They render replicated authoritative poses through
surface-aware snapshot timelines.

## Shapes and groups

- Static district tiles are greedily meshed into fixed rectangles, plus explicit map
  border walls.
- Vehicles are catalog-sized oriented boxes with locked rotation.
- Street humanoids are balls.
- Vehicles collide with statics, vehicles, and humanoids.
- Humanoids collide with statics and vehicles, not other humanoids.

## Boundaries

- `PhysicsWorld` owns collision detection, separation, and contact facts.
- Control-policy modules own desired motion and vehicle heading.
- Server gameplay controllers own damage and side effects.
- Interior walking retains authored rectangle occupancy until interior geometry joins
  a physics world.
- Hitscan and projectile rewind remain combat-query systems, not rigid-body collision.

Do not add a parallel street collision kernel or resolve a Rapier dynamic pair a second
time in gameplay code.
