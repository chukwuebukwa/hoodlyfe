# Universal LPC Character Spike

This is a narrow integration spike, not the final character creator.

## What works

- One Universal LPC recipe is packed into NOCK0's current player atlas contract.
- Generated files live in `public/assets/custom/lpc-spike/`.
- `python3 scripts/import-lpc-spike.py` regenerates the atlases from a local Universal LPC checkout at `/tmp/ulpc-generator`.
- `?renderer=three&lpc=1` uses the LPC spike in game.
- `?renderer=three&lpc=0` returns to the current NOCK0 avatar.
- LPC mode now uses a directional walk atlas for Three: `player-lpc-walk-4dir.png`.
- Armed LPC movement faces the mouse/aim row while movement still advances the walk cycle, so backpedaling and strafing can read better.

## Mapping

NOCK0 requires:

- walk atlas: `216x216`, `3x3`, `72px` frames
- action atlas: `288x216`, `4x3`, `72px` frames

The spike maps:

- LPC `idle` down frame 0 -> NOCK0 walk frame 0
- LPC `walk` down frames 1-8 -> NOCK0 walk frames 1-8
- LPC `idle/walk` rows `up,left,down,right` -> experimental Three locomotion atlas `9x4`
- LPC `slash` down frames 0-3 -> NOCK0 melee frames 0-3
- LPC `hurt` frames 0,1,3,5 -> NOCK0 hit/knockdown/dead frames 4-7
- LPC `sit` down frames 0,1,2,2 -> NOCK0 vehicle/carjack frames 8-11

Some selected LPC clothing layers do not cover every animation. The importer keeps those layers visible by falling back to the same item's walk sheet for missing idle/sit/hurt-style frames.

## Gaps

- LPC is 64px RPG-front/side/back art; NOCK0 currently renders 72px near-overhead action art.
- LPC walk and slash are usable enough to test scale/readability.
- LPC standard modular character coverage is cardinal, not reliably 8-directional. Diagonal movement currently selects the nearest cardinal row.
- LPC does not solve weapon-held poses for this camera/action style. For now, NOCK0 keeps the existing rotating weapon sprite around the character.
- LPC does not provide NOCK0-style vehicle entry, carjacking, knockdown, or death animation coverage.
- Production use needs an explicit license/attribution decision. This recipe pulls from LPC assets with OGA-BY, CC-BY-SA, and GPL-family credits.

## Recommendation

Use LPC for the creator data model and early avatar variety only if the in-game visual test is acceptable. For full production, either:

1. author NOCK0-specific action overlays for the missing LPC animations, or
2. keep LPC as an out-of-game portrait/identity creator while the in-game avatar remains the current authored NOCK0 action set.
