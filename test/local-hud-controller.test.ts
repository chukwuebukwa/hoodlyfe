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
