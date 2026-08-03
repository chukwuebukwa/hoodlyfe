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

test('enabled production editor requires configured credentials', () => {
  assert.deepEqual(evaluateEditorAccess(null, {
    NODE_ENV: 'production',
    EDITOR_PRODUCTION_ENABLED: '1'
  }), {
    allowed: false,
    status: 503,
    reason: 'Editor authentication is not configured.'
  });
  const environment = {
    NODE_ENV: 'production',
    EDITOR_PRODUCTION_ENABLED: '1',
    EDITOR_AUTH_USER: 'builder',
    EDITOR_AUTH_PASSWORD: 'correct horse battery staple'
  };
  assert.deepEqual(evaluateEditorAccess(null, environment), {
    allowed: false,
    status: 401,
    reason: 'Editor authentication is required.'
  });
  assert.deepEqual(evaluateEditorAccess('Basic YnVpbGRlcjp3cm9uZw==', environment), {
    allowed: false,
    status: 401,
    reason: 'Editor authentication is required.'
  });
  assert.deepEqual(
    evaluateEditorAccess('Basic YnVpbGRlcjpjb3JyZWN0IGhvcnNlIGJhdHRlcnkgc3RhcGxl', environment),
    {allowed: true, actor: 'builder'}
  );
});
