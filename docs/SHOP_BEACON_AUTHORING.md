# Shop Beacon Authoring

Shop beacons separate fixture placement from shader construction. Do not edit the
cone, footprint, bloom, and point-light positions independently.

## Placement model

Each fixture uses one `ShopBeaconPlacement` object:

```ts
{
  position: [80, 22, 136],
  aimOffset: [60, -104, -101]
}
```

- `position` is the mounted light source. Change this one tuple to translate the
  whole fixture.
- `aimOffset` is the cone target relative to `position`. Change its first value
  to aim left or right, its second value to aim nearer or farther across the map,
  and its third value to aim higher or lower.

The renderer derives the cone target, midpoint, orientation, footprint position,
source glow, and point-light position from these two tuples. Cone radius,
footprint shape, and point-light calibration are renderer defaults, not values
that every fixture author must synchronize.

## Adding more fixtures

Define another placement object and pass it to `createShopBeacon`:

```ts
const placement: ShopBeaconPlacement = {
  position: [0, 0, 110],
  aimOffset: [0, -120, -105]
};

createShopBeacon({color: 0xff4fd8, intensity: 0.9, placement});
```

Keep fixtures sparse. Reuse the same renderer and vary data instead of copying
shader or mesh code. Adding another matching fixture requires only a mount
position, an aim offset, a color, and optionally an intensity.

The repair alley is the first additional fixture authored through this model:

```ts
{
  position: [216, 280, 108],
  aimOffset: [-70, -96, -73]
}
```

It is mounted on the alley's right wall and aimed diagonally back through the
passage. It shares the repair entrance's cyan color but uses a lower mounting
height and lower intensity.

## Lessons learned

1. Establish placement and aim before tuning shader appearance.
2. Treat source, target, footprint, bloom, and real light as one fixture—not
   independent coordinates.
3. Preserve a known-good visual while changing one authoring variable at a time.
4. Verify both the gameplay camera and an angled debug camera; flat artifacts and
   misplaced volume are not equally visible from both.
5. Never pulse or scale the parent of a fixed environmental light.
6. Use configuration data for additional lights so the system scales beyond one
   hand-tuned repair-shop fixture.
7. Treat a successful compile as part of the feedback loop. A temporarily invalid
   coordinate edit can leave the browser displaying the previous valid bundle.
8. Keep rendering calibration inside the renderer. Fixture data should describe
   where a light is mounted and where it aims—not repeat internal offsets and
   shader dimensions.
