import { test } from 'node:test';
import assert from 'node:assert';
import { FrameType, encodeFrame, decodeFrame } from '../src/relayProtocol';

test('frame round-trips type/streamId/payload', () => {
  const f = encodeFrame(FrameType.DATA, 0x01020304, Buffer.from('hello'));
  const d = decodeFrame(f);
  assert.equal(d.type, FrameType.DATA);
  assert.equal(d.streamId, 0x01020304);
  assert.equal(d.payload.toString(), 'hello');
});

test('empty payload frame (CLOSE) round-trips', () => {
  const d = decodeFrame(encodeFrame(FrameType.CLOSE, 42));
  assert.equal(d.type, FrameType.CLOSE);
  assert.equal(d.streamId, 42);
  assert.equal(d.payload.length, 0);
});

test('string payload (REGISTER JSON) round-trips', () => {
  const msg = JSON.stringify({ id: 'hub-abc', key: 'k' });
  const d = decodeFrame(encodeFrame(FrameType.REGISTER, 0, msg));
  assert.equal(d.type, FrameType.REGISTER);
  assert.equal(d.streamId, 0);
  assert.deepEqual(JSON.parse(d.payload.toString()), { id: 'hub-abc', key: 'k' });
});

test('streamId wraps to uint32 (no sign issues)', () => {
  const d = decodeFrame(encodeFrame(FrameType.DATA, 0xfffffff0, Buffer.from('x')));
  assert.equal(d.streamId, 0xfffffff0);
});

test('too-short buffer throws', () => {
  assert.throws(() => decodeFrame(Buffer.from([1, 2, 3])));
});
