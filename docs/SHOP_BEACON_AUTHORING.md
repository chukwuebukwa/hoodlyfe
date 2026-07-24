# Colored Beacon Authoring

Colored beacons are level data. Use `/editor` instead of editing renderer
coordinates. The game loads the exported
`public/assets/maps/district-beacons.json` file and derives the cone, footprint,
bloom, and real light from each fixture.

## Editor workflow

1. Select **Place colored beacon** or press `L`, then click near the fixture.
2. Drag the square **Source** handle onto the wall or mounting point.
3. Drag the round **Target** handle to aim the cone and place its pool of light.
4. Use Source height and Target height to control the downward angle.
5. Tune color, intensity, radius, and footprint size in the inspector.
6. Export the level bundle and apply it with the existing level-editor apply
   script.

Moving the source translates only the mount. Dragging the body translates the
source and target together. Dragging the target changes aim and footprint without
moving the mount. This replaces the old workflow of synchronizing three unrelated
sets of coordinates.

The district currently has two cyan fixtures: the repair entrance and repair
alley. Both are normal objects in the **Colored beacons** editor layer.

## Data model

Each exported fixture stores:

- source world position: `x`, `y`, `z`
- target world position: `targetX`, `targetY`, `targetZ`
- appearance: `color`, `intensity`, `radius`, `footprintWidth`,
  `footprintHeight`

The renderer owns all internal offsets and shader construction. Authors should
not position the cone mesh, footprint shader, bloom, or point light separately.

## Lessons learned

1. Establish placement and aim before tuning shader appearance.
2. Treat source, target, footprint, bloom, and real light as one fixture—not
   independent coordinates.
3. Preserve a known-good visual while changing one authoring variable at a time.
4. Verify both the gameplay camera and an angled debug camera; flat artifacts and
   misplaced volume are not equally visible from both.
5. Never pulse or scale the parent of a fixed environmental light.
6. Use level-editor objects for additional lights so the system scales beyond
   one hand-tuned repair-shop fixture.
7. Treat a successful compile as part of the feedback loop. A temporarily invalid
   coordinate edit can leave the browser displaying the previous valid bundle.
8. Keep rendering calibration inside the renderer. Fixture data describes where
   a light is mounted, where it aims, and the few appearance controls an author
   actually needs.
