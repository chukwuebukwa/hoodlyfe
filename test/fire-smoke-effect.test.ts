import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createFireSmokeEffect} from '../src/game/three/three-fire-smoke-effect.ts';

test('fire and explosion effects do not add dynamic lights', () => {
  const effect = createFireSmokeEffect({radius: 80, seed: 1, burst: true});

  assert.equal(effect.children.some((child) => child instanceof THREE.Light), false);
});
