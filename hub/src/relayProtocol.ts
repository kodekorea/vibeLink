// Hub-side copy of the relay wire protocol (kept independent of the relay package).
// Mirror of relay/src/protocol.ts — see docs/superpowers/specs/2026-06-06-self-relay-design.md.
//
// Every control-socket message is one binary WebSocket frame:
//   byte 0     : type (uint8)
//   bytes 1..4 : streamId (uint32 BE)   — 0 is reserved for control
//   bytes 5..  : payload

export const enum FrameType {
  OPEN = 0x01,
  DATA = 0x02,
  CLOSE = 0x03,
  REGISTER = 0x10,
  REG_OK = 0x11,
  REG_ERR = 0x12,
}

export const CONTROL_STREAM = 0;

export interface Frame {
  type: FrameType;
  streamId: number;
  payload: Buffer;
}

export function encodeFrame(type: FrameType, streamId: number, payload?: Buffer | string): Buffer {
  const body = payload === undefined
    ? Buffer.alloc(0)
    : Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const head = Buffer.allocUnsafe(5);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(streamId >>> 0, 1);
  return Buffer.concat([head, body]);
}

export function decodeFrame(buf: Buffer): Frame {
  if (buf.length < 5) throw new Error('relay frame too short');
  return {
    type: buf.readUInt8(0) as FrameType,
    streamId: buf.readUInt32BE(1),
    payload: buf.subarray(5),
  };
}

export interface RegisterMsg { id: string; key: string; }
