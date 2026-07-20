import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateEditorAccess} from '../server/editor/editor-access-policy.ts';

test('editor access stays open during local development', () => {
  assert.deepEqual(evaluateEditorAccess(null, {NODE_ENV: 'development'}), {
    allowed: true,
    actor: 'local-developer'
  });
});

test('production editor is hidden until explicitly enabled', () => {
  assert.deepEqual(evaluateEditorAccess(null, {NODE_ENV: 'production'}), {
    allowed: false,
    status: 404,
    reason: 'Editor is not enabled on this service.'
  });
});

test('production editor requires configured credentials', () => {
  assert.equal(evaluateEditorAccess(null, {
    NODE_ENV: 'production',
    EDITOR_PRODUCTION_ENABLED: '1'
  }).allowed, false);
  assert.equal(evaluateEditorAccess(null, {
    NODE_ENV: 'production',
    EDITOR_PRODUCTION_ENABLED: '1',
    EDITOR_AUTH_USER: 'builder',
    EDITOR_AUTH_PASSWORD: 'secret'
  }).allowed, false);
  assert.deepEqual(evaluateEditorAccess(`Basic ${btoa('builder:secret')}`, {
    NODE_ENV: 'production',
    EDITOR_PRODUCTION_ENABLED: '1',
    EDITOR_AUTH_USER: 'builder',
    EDITOR_AUTH_PASSWORD: 'secret'
  }), {allowed: true, actor: 'builder'});
});
