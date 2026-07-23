import * as THREE from 'three';
import {
  formatWorldTime,
  lightingAtMinute,
  worldMinuteAt,
  type ReplicatedWorldClock
} from '../../../shared/content/world-time.ts';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {STREET_LIGHT_FIXTURES, type StreetLightFixture} from '../../../shared/content/lighting-fixtures.ts';
import {serverYToScene} from './scene-policy.ts';
import {radialGlow, updateRadialGlow, type RadialGlow} from './effects/glow.ts';
import {
  deriveRoadLightEmitters,
  mergeLightEmitters,
  type RoadMask
} from './map/road-light-policy.ts';

interface FixtureLight {
  definition: StreetLightFixture;
  glow: RadialGlow;
  light: THREE.PointLight;
}

export class LightingPresentation {
  private readonly hemisphere = new THREE.HemisphereLight();
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.45);
  private readonly sun = new THREE.DirectionalLight();
  private readonly fixtureLights: FixtureLight[];
  private debugMinute = developmentTimeOverride();
  private readonly timeControls = document.querySelector<HTMLElement>('#debug-time-controls');
  private readonly timeInput = document.querySelector<HTMLInputElement>('#debug-time-input');
  private readonly timeValue = document.querySelector<HTMLOutputElement>('#debug-time-value');
  private readonly liveButton = document.querySelector<HTMLButtonElement>('#debug-time-live');
  private lastLabel = '';

  private constructor(
    private readonly scene: THREE.Scene,
    surfaceHeightAt: (x: number, y: number) => number,
    fixtures: readonly StreetLightFixture[]
  ) {
    this.hemisphere.name = 'world-hemisphere';
    this.sun.name = 'world-sun';
    this.sun.castShadow = false;
    this.scene.add(this.ambient, this.hemisphere, this.sun);
    this.timeControls?.classList.remove('hidden');
    this.timeInput?.addEventListener('input', this.handleTimeInput);
    this.liveButton?.addEventListener('click', this.handleLiveTime);
    this.fixtureLights = fixtures.map((fixture) => {
      const glow = radialGlow(220, 0xffd793, 0, 14);
      glow.position.set(fixture.x, serverYToScene(fixture.y), surfaceHeightAt(fixture.x, fixture.y) + 2);
      glow.visible = false;
      const light = new THREE.PointLight(0xffd7a0, 0, 175, 2);
      light.position.set(fixture.x, serverYToScene(fixture.y), surfaceHeightAt(fixture.x, fixture.y) + 28);
      light.visible = false;
      this.scene.add(glow, light);
      return {definition: fixture, glow, light};
    });
  }

  static async create(
    scene: THREE.Scene,
    surfaceHeightAt: (x: number, y: number) => number,
    mapUrl = '/assets/maps/district-map.json',
    authoredFixtures: readonly StreetLightFixture[] = STREET_LIGHT_FIXTURES
  ): Promise<LightingPresentation> {
    const response = await fetch(mapUrl);
    if (!response.ok) throw new Error(`Road lighting mask failed to load (${response.status}).`);
    const generated = deriveRoadLightEmitters(await response.json() as RoadMask, {
      coverageRadius: 168,
      existing: authoredFixtures
    });
    const fixtures = mergeLightEmitters(authoredFixtures, generated);
    return new LightingPresentation(scene, surfaceHeightAt, fixtures);
  }

  update(
    clock: ReplicatedWorldClock,
    nowMs: number,
    focusX: number,
    focusY: number,
    localSpaceId: string,
    label?: HTMLElement
  ): number {
    const minute = this.debugMinute ?? worldMinuteAt(clock, nowMs);
    const lighting = lightingAtMinute(minute);
    const interior = localSpaceId !== STREET_SPACE_ID;
    this.scene.background = new THREE.Color(interior ? 0x080a0c : lighting.skyColor);
    if (!(this.scene.fog instanceof THREE.FogExp2)) {
      this.scene.fog = new THREE.FogExp2(lighting.skyColor, 0.000035);
    }
    this.scene.fog.color.setHex(interior ? 0x080a0c : lighting.skyColor);
    this.scene.fog.density = interior ? 0 : 0.000025 + lighting.streetlightIntensity * 0.000025;
    this.hemisphere.color.setHex(interior ? 0xf2dfc0 : lighting.hemisphereSkyColor);
    this.hemisphere.groundColor.setHex(interior ? 0x433b34 : lighting.hemisphereGroundColor);
    this.hemisphere.intensity = interior ? 1.25 : lighting.hemisphereIntensity;
    this.ambient.color.setHex(interior ? 0xffeed8 : 0x9eb4cb);
    this.ambient.intensity = interior ? 0.72 : 0.48 + (1 - lighting.streetlightIntensity) * 0.1;
    this.sun.color.setHex(lighting.sunColor);
    this.sun.intensity = interior ? 0 : lighting.sunIntensity;
    this.sun.position.set(
      focusX + Math.cos(lighting.sunAngle) * 900,
      serverYToScene(focusY) + Math.sin(lighting.sunAngle) * 900,
      900
    );
    this.sun.target.position.set(focusX, serverYToScene(focusY), 0);
    if (!this.sun.target.parent) this.scene.add(this.sun.target);
    this.updateFixtureLights(focusX, focusY, interior ? 0 : lighting.streetlightIntensity);
    const nextLabel = `${formatWorldTime(minute)} ${lighting.phase.toUpperCase()}`;
    if (label && nextLabel !== this.lastLabel) {
      label.textContent = nextLabel;
      this.lastLabel = nextLabel;
    }
    if (this.timeInput && document.activeElement !== this.timeInput) {
      this.timeInput.value = String(Math.round(minute));
    }
    if (this.timeValue) this.timeValue.textContent = formatWorldTime(minute);
    this.liveButton?.classList.toggle('active', this.debugMinute === undefined);
    return interior ? 0 : lighting.streetlightIntensity;
  }

  destroy(): void {
    this.scene.remove(this.ambient, this.hemisphere, this.sun, this.sun.target);
    for (const fixture of this.fixtureLights) {
      this.scene.remove(fixture.glow, fixture.light);
      fixture.glow.geometry.dispose();
      fixture.glow.material.dispose();
      fixture.light.dispose();
    }
    this.timeInput?.removeEventListener('input', this.handleTimeInput);
    this.liveButton?.removeEventListener('click', this.handleLiveTime);
    this.timeControls?.classList.add('hidden');
  }

  private readonly handleTimeInput = (): void => {
    const minute = Number(this.timeInput?.value);
    if (Number.isFinite(minute)) this.debugMinute = Math.max(0, Math.min(1439, minute));
  };

  private readonly handleLiveTime = (): void => {
    this.debugMinute = undefined;
  };

  private updateFixtureLights(focusX: number, focusY: number, intensity: number): void {
    const nearest = new Set(
      this.fixtureLights
        .map((fixture) => ({
          id: fixture.definition.id,
          distance: Math.hypot(fixture.definition.x - focusX, fixture.definition.y - focusY)
        }))
        .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
        .slice(0, 16)
        .map(({id}) => id)
    );
    for (const fixture of this.fixtureLights) {
      const active = intensity > 0.01 && nearest.has(fixture.definition.id);
      fixture.glow.visible = active;
      updateRadialGlow(fixture.glow, 0xffd793, intensity * 0.13);
      fixture.light.visible = active;
      fixture.light.intensity = intensity * 1.8;
    }
  }
}

function developmentTimeOverride(): number | undefined {
  if (!isDevelopment()) return undefined;
  const value = new URLSearchParams(window.location.search).get('time');
  if (value === 'night') return 23 * 60;
  if (value === 'dawn') return 6 * 60;
  if (value === 'noon') return 12 * 60;
  if (value === 'dusk') return 19 * 60;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric < 24 ? numeric * 60 : undefined;
}

function isDevelopment(): boolean {
  const metaEnv = (import.meta as unknown as {env?: {DEV?: boolean}}).env;
  return metaEnv?.DEV ?? process.env.NODE_ENV !== 'production';
}
