import {Encoder} from '@colyseus/schema';

// A 32-player streamed district produced 88-96 KB view patches during reconnects.
// Keep enough headroom to avoid overflow re-encoding in the simulation patch path.
export const SCHEMA_ENCODER_BUFFER_BYTES = 256 * 1024;

Encoder.BUFFER_SIZE = SCHEMA_ENCODER_BUFFER_BYTES;
