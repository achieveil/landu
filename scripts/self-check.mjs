import assert from 'node:assert/strict';
import { checksum } from '../client/checksum.js';

const bytes = new TextEncoder().encode('123456789');
assert.equal(checksum(bytes), 'cbf43926');
