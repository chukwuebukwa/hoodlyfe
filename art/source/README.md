# Character Sprite Source

`characters-master-chroma.png` is the AI-generated source used for NOCK0's original player, civilian, and police animation sheets.

Generation brief:

- Original strict-overhead pixel-art characters matched to the world's near-vertical camera.
- Three role blocks: urban player, civilian in green, and navy police officer.
- Nine production frames per role: one idle frame and an eight-frame walk cycle. The police source contains six unique poses, which are sequenced into the same nine-frame runtime contract.
- Neutral hands with no weapons so held weapons can be separate runtime overlays.
- Flat magenta chroma background for deterministic transparency extraction.

The production sheets are under `public/assets/original/sprites/`. They were chroma-keyed, trimmed, nearest-neighbor scaled, and centered into the existing 72-by-72 frame contract.

## Vehicle Sprite Source

`vehicles-master-chroma.png` is the AI-generated source for the original civilian sedan, police cruiser, and taxi sheet. The production sheet is stored at `public/assets/original/sprites/vehicles.png` with three transparent 96-by-96 frames. Runtime rendering adds the alternating police lights, damage tint, smoke, and fire.
