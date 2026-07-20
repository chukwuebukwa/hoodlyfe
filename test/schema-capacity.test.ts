import assert from 'node:assert/strict';
import test from 'node:test';
import {Encoder} from '@colyseus/schema';
import {SCHEMA_ENCODER_BUFFER_BYTES} from '../server/schema-capacity.ts';

test('district encoder capacity retains headroom above observed 32-client patches', () => {
  assert.equal(SCHEMA_ENCODER_BUFFER_BYTES, 256 * 1024);
  assert.equal(Encoder.BUFFER_SIZE, SCHEMA_ENCODER_BUFFER_BYTES);
  assert.ok(SCHEMA_ENCODER_BUFFER_BYTES >= 2 * 96 * 1024);
});
