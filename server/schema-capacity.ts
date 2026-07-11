import {Encoder} from '@colyseus/schema';

export const SCHEMA_ENCODER_BUFFER_BYTES = 64 * 1024;

Encoder.BUFFER_SIZE = SCHEMA_ENCODER_BUFFER_BYTES;
