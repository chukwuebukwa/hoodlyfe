# Audio System

The game audio stack follows the same split as the rest of the project: gameplay systems publish facts, transport decides who needs to know, and client audio systems decide how those facts should sound.

## Current Layers

- `server/game/events/game-events.ts` is the authoritative gameplay fact stream.
- `server/game/audio/audio-event-controller.ts` projects selected gameplay events into lightweight public audio events and sends only nearby events to each client.
- `shared/protocol/audio-events.ts` is the transport contract.
- `src/game/audio/sfx-system.ts` converts audio events into local WebAudio voices.
- `src/game/audio/vehicle-audio-system.ts` owns continuous vehicle loops such as active police sirens.
- `src/game/audio/positional-audio-policy.ts` owns distance rolloff and stereo pan.
- `src/game/audio/radio-system.ts` remains the streamed music layer for vehicle radio.

This means combat, vehicles, pickups, police, missions, and interiors should not directly play sound. They should publish domain events; the audio layer interprets those events.

## Proximity Sound

Proximity sound has two stages:

1. Server relevance filtering:
   The server sends a sound event to a client when the listener is close enough, or when the listener caused the event.

2. Client mix projection:
   The client computes gain and pan from listener position to event position. Loud events such as explosions use a wider max distance than pickups or melee hits.

This avoids making every client receive every gunshot, car crash, and pickup in the city.

## Planned Voice Chat

Voice chat should use the same listener model but a different transport.

The recommended path is:

1. Start with push-to-talk and party/local channels.
2. Add a voice signaling protocol separate from gameplay messages.
3. Use WebRTC for media, ideally through an SFU when player counts grow.
4. Let the server publish each player's voice zone/channel eligibility.
5. Let the client apply proximity gain, stereo pan, mute, ducking, and radio/phone effects.

Do not stream voice through the Colyseus gameplay room. Gameplay state should decide who is eligible to hear whom; WebRTC should carry the audio media.

## Next Sound Targets

- Pistol, SMG, and shotgun shots use the public-domain Snake's SECOND Authentic Gun Sounds pack.
- Remaining files under `public/assets/audio/gta2/sfx` are temporary placeholders; the directory name does not establish their provenance.
- Replace generated weapon and impact cues with short authored samples.
- Add vehicle engine loops tied to speed, gear, damage, and siren state.
- Add tire skid, horn, car door, hijack, and crash families.
- Add ambient zone beds for districts and interiors.
- Add UI click, service purchase, mission start/fail/success, and wanted-level stingers.
- Add audio ducking so explosions and radio retunes briefly lower radio/music volume.
