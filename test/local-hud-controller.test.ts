import assert from 'node:assert/strict';
import test from 'node:test';
import {LocalHudController} from '../src/game/ui/local-hud-controller.ts';

test('destroy clears a shared event toast before the next world session reuses it', () => {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const toast = {
    textContent: '',
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name))
    },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name)
  };
  const root = {
    querySelector: (selector: string) => selector === '#event-toast' ? toast : null,
    querySelectorAll: () => []
  };
  const hud = new LocalHudController(root as unknown as Document);

  hud.show('GO!', 'success');
  assert.equal(toast.textContent, 'GO!');
  assert.equal(classes.has('visible'), true);
  assert.equal(attributes.get('data-tone'), 'success');

  hud.destroy();
  assert.equal(toast.textContent, '');
  assert.equal(classes.has('visible'), false);
  assert.equal(attributes.has('data-tone'), false);
});

test('police awareness drives spotted and searching HUD states', () => {
  const heatClasses = new Set<string>();
  const heatAttributes = new Map<string, string>();
  const heatMeter = {
    classList: {
      toggle: (name: string, active: boolean) => active
        ? heatClasses.add(name)
        : heatClasses.delete(name)
    },
    setAttribute: (name: string, value: string) => heatAttributes.set(name, value)
  };
  const shell = {dataset: {} as Record<string, string>};
  const root = {
    querySelector: (selector: string) => {
      if (selector === '#heat-meter') return heatMeter;
      if (selector === '#game-shell') return shell;
      return null;
    },
    querySelectorAll: () => []
  };
  const hud = new LocalHudController(root as unknown as Document);

  hud.setPoliceAwareness({
    phase: 'searching',
    wantedLevel: 2,
    lastKnownX: 10,
    lastKnownY: 20,
    lastSeenAt: 100,
    searchStartedAt: 200,
    zones: []
  }, 2);
  assert.equal(heatClasses.has('searching'), true);
  assert.equal(heatClasses.has('spotted'), false);
  assert.equal(shell.dataset.policeAwareness, 'searching');
  assert.match(heatAttributes.get('aria-description') ?? '', /searching/i);

  hud.setPoliceAwareness({
    phase: 'spotted',
    wantedLevel: 2,
    lastKnownX: 10,
    lastKnownY: 20,
    lastSeenAt: 300,
    searchStartedAt: 0,
    zones: []
  }, 2);
  assert.equal(heatClasses.has('searching'), false);
  assert.equal(heatClasses.has('spotted'), true);

  hud.setPoliceAwareness({
    phase: 'searching',
    wantedLevel: 2,
    lastKnownX: 10,
    lastKnownY: 20,
    lastSeenAt: 300,
    searchStartedAt: 400,
    zones: []
  }, 0);
  assert.equal(heatClasses.has('searching'), false);
  assert.equal(heatClasses.has('spotted'), false);
  assert.equal(shell.dataset.policeAwareness, 'clear');
});
