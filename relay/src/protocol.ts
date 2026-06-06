// Wire protocol shared (by copy) between the relay and the hub's relayClient.
// Every control-socket message is one binary WebSocket frame:
//   byte 0     : type (uint8)
//   bytes 1..4 : streamId (uint32 BE)   — 0 is reserved for control (REGISTER/REG_OK/…)
//   bytes 5..  : payload
//
// A "stream" is one phone connection (an HTTP request or a /ws upgrade). Its raw bytes
// are carried as DATA frames; OPEN starts it, CLOSE ends it. The relay allocates stream
// ids, so they are unique within a single hub control socket.

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
export interface OpenMsg { kind: 'http'; }

// Rewrite the raw first line of a phone HTTP request so the hub sees a normal request:
//   "GET /h/<id>/sessions?x=1 HTTP/1.1"  ->  "GET /sessions?x=1 HTTP/1.1"
// Returns the rewritten head string. `prefix` is "/h/<id>".
export function stripPrefixFromRequestLine(requestLine: string, prefix: string): string {
  const m = /^(\S+)\s+(\S+)\s+(HTTP\/\d\.\d)$/.exec(requestLine.trim());
  if (!m) return requestLine;
  const [, method, target, version] = m;
  let path = target;
  if (path === prefix) path = '/';
  else if (path.startsWith(prefix + '/')) path = path.slice(prefix.length);
  else if (path.startsWith(prefix + '?')) path = '/' + path.slice(prefix.length);
  if (!path.startsWith('/')) path = '/' + path;
  return `${method} ${path} ${version}`;
}
