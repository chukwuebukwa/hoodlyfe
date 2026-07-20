import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EditorRequestBodyError,
  readEditorJsonBody
} from '../server/editor/editor-request-body.ts';

test('editor request parser reads JSON below its byte limit', async () => {
  const request = new Request('http://localhost/api/editor/playtest/bil', {
    method: 'POST',
    body: JSON.stringify({district: 'bil'})
  });
  assert.deepEqual(await readEditorJsonBody(request, 64), {district: 'bil'});
});

test('editor request parser rejects declared and streamed oversized bodies', async () => {
  const declared = new Request('http://localhost', {
    method: 'POST',
    headers: {'content-length': '65'},
    body: '{}'
  });
  await assert.rejects(
    readEditorJsonBody(declared, 64),
    (error: unknown) => error instanceof EditorRequestBodyError && error.status === 413
  );

  const streamed = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({value: 'x'.repeat(80)})
  });
  await assert.rejects(
    readEditorJsonBody(streamed, 64),
    (error: unknown) => error instanceof EditorRequestBodyError && error.status === 413
  );
});

test('editor request parser rejects malformed JSON', async () => {
  const request = new Request('http://localhost', {method: 'POST', body: '{'});
  await assert.rejects(
    readEditorJsonBody(request, 64),
    (error: unknown) => error instanceof EditorRequestBodyError && error.status === 400
  );
});
