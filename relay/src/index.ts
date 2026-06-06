// Self-hosted relay for VibeLink / mobile_term_bridge.
//
// A small PUBLIC, host-agnostic server. Hubs (on the user's PC, behind NAT) dial OUT to
// the control path and register with {id,key}. Phones connect to https://relay/h/<id>/…
// and the relay pipes raw bytes between the phone and the matching hub over a single
// multiplexed control WebSocket. The relay never reads or forges the hub JWT — it only
// routes by id. See docs/superpowers/specs/2026-06-06-self-relay-design.md.

import * as http from 'http';
import * as net from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import {
  FrameType, CONTROL_STREAM, encodeFrame, decodeFrame,
  stripPrefixFromRequestLine, RegisterMsg,
} from './protocol';

const PORT = Number(process.env.RELAY_PORT ?? 8787);
const HUB_PATH = process.env.RELAY_HUB_PATH ?? '/_hub';
const PUBLIC_URL = process.env.RELAY_PUBLIC_URL ?? `http://localhost:${PORT}`;
// "id:key,id2:key2". Empty => accept any id/key (dev only — log a warning).
const KEYS = parseKeys(process.env.RELAY_KEYS ?? '');
const MAX_STREAMS_PER_HUB = Number(process.env.RELAY_MAX_STREAMS ?? 256);

function parseKeys(s: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of s.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf(':');
    if (i <= 0) continue;
    m.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
  return m;
}

function log(msg: string): void { console.log(`[relay] ${msg}`); }

// One registered hub: its control socket + the phone streams multiplexed over it.
interface Hub {
  id: string;
  socket: WebSocket;
  streams: Map<number, net.Socket>; // streamId -> phone socket
  nextStreamId: number;
}

const hubs = new Map<string, Hub>();

function allocStreamId(hub: Hub): number {
  do {
    hub.nextStreamId = (hub.nextStreamId + 1) >>> 0;
    if (hub.nextStreamId === CONTROL_STREAM) hub.nextStreamId = 1;
  } while (hub.streams.has(hub.nextStreamId));
  return hub.nextStreamId;
}

// Parse "/h/<id>" prefix from a request target. Returns { id, prefix } or null.
function matchHubPrefix(target: string): { id: string; prefix: string } | null {
  const m = /^\/h\/([^/?#]+)/.exec(target);
  if (!m) return null;
  return { id: decodeURIComponent(m[1]), prefix: `/h/${m[1]}` };
}

// ── Listener: peek first chunk, route by target path ─────────────────────────────────
// We front everything with a plain net.Server so phone traffic (any HTTP method +
// WebSocket upgrades) can be forwarded as raw bytes. Non-phone traffic (the hub control
// /_hub upgrade and /healthz) is replayed into a real http.Server.

// http.Server used ONLY for the hub control upgrade + health endpoint.
const ctrlHttp = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, hubs: [...hubs.keys()], publicUrl: PUBLIC_URL }));
    return;
  }
  res.writeHead(404); res.end('not found');
});
const hubWss = new WebSocketServer({ noServer: true });
ctrlHttp.on('upgrade', (req, socket, head) => {
  if ((req.url ?? '').split('?')[0] !== HUB_PATH) { socket.destroy(); return; }
  hubWss.handleUpgrade(req, socket as net.Socket, head, (ws) => onHubSocket(ws));
});

const server = net.createServer((socket: net.Socket) => {
  socket.once('data', (chunk: Buffer) => {
    const firstLine = chunk.toString('latin1', 0, Math.min(chunk.length, 4096)).split('\r\n', 1)[0] || '';
    const m = /^\S+\s+(\S+)\s+HTTP\/\d\.\d$/.exec(firstLine);
    const target = m ? m[1] : '';
    const hubMatch = target ? matchHubPrefix(target) : null;

    if (hubMatch) {
      handlePhoneSocket(socket, chunk, hubMatch.id, hubMatch.prefix);
    } else {
      // Replay this connection into the real http.Server so it parses /_hub & /healthz.
      socket.pause();
      socket.unshift(chunk);
      ctrlHttp.emit('connection', socket);
      socket.resume();
    }
  });
  socket.on('error', () => { /* client reset before head — ignore */ });
});

// ── Phone socket: rewrite head, push as a stream onto the hub control socket ─────────
function handlePhoneSocket(phone: net.Socket, firstChunk: Buffer, hubId: string, prefix: string): void {
  const hub = hubs.get(hubId);
  if (!hub) {
    phone.end('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nhub not connected\r\n');
    return;
  }
  if (hub.streams.size >= MAX_STREAMS_PER_HUB) {
    phone.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\ntoo many streams\r\n');
    return;
  }

  const streamId = allocStreamId(hub);
  hub.streams.set(streamId, phone);

  const rewritten = rewriteHead(firstChunk, prefix);
  hub.socket.send(encodeFrame(FrameType.OPEN, streamId, JSON.stringify({ kind: 'http' })));
  hub.socket.send(encodeFrame(FrameType.DATA, streamId, rewritten));

  phone.on('data', (d: Buffer) => {
    if (hub.socket.readyState === WebSocket.OPEN) hub.socket.send(encodeFrame(FrameType.DATA, streamId, d));
  });
  const closeStream = () => {
    if (!hub.streams.has(streamId)) return;
    hub.streams.delete(streamId);
    if (hub.socket.readyState === WebSocket.OPEN) hub.socket.send(encodeFrame(FrameType.CLOSE, streamId));
  };
  phone.on('close', closeStream);
  phone.on('error', closeStream);
}

// Rewrite the request line within the first chunk and set Host to loopback.
export function rewriteHead(chunk: Buffer, prefix: string): Buffer {
  const headStr = chunk.toString('latin1');
  const lineEnd = headStr.indexOf('\r\n');
  if (lineEnd < 0) return chunk; // no full request line yet (rare); pass through
  const requestLine = headStr.slice(0, lineEnd);
  const newLine = stripPrefixFromRequestLine(requestLine, prefix);

  const sepIdx = headStr.indexOf('\r\n\r\n');
  const headerBlockEnd = sepIdx >= 0 ? sepIdx : headStr.length;
  let headerBlock = headStr.slice(lineEnd, headerBlockEnd);
  headerBlock = headerBlock.replace(/(\r\nHost:)[^\r\n]*/i, '$1 127.0.0.1');
  const rest = sepIdx >= 0 ? headStr.slice(headerBlockEnd) : '';
  return Buffer.from(newLine + headerBlock + rest, 'latin1');
}

// ── Hub control socket lifecycle ─────────────────────────────────────────────────────
function onHubSocket(ws: WebSocket): void {
  let hub: Hub | null = null;
  let alive = true;

  const ping = setInterval(() => {
    if (!alive) { try { ws.terminate(); } catch { /* */ } return; }
    alive = false;
    try { ws.ping(); } catch { /* */ }
  }, 20000);
  ws.on('pong', () => { alive = true; });

  ws.on('message', (raw: Buffer, isBinary: boolean) => {
    if (!isBinary) return;
    let frame;
    try { frame = decodeFrame(raw); } catch { return; }

    if (frame.type === FrameType.REGISTER) {
      if (hub) return;
      let msg: RegisterMsg;
      try { msg = JSON.parse(frame.payload.toString('utf8')); }
      catch { ws.send(encodeFrame(FrameType.REG_ERR, 0, 'bad register')); ws.close(); return; }
      if (!authRegister(msg)) { ws.send(encodeFrame(FrameType.REG_ERR, 0, 'unauthorized')); ws.close(); return; }
      const prev = hubs.get(msg.id);
      if (prev) { try { prev.socket.close(); } catch { /* */ } for (const s of prev.streams.values()) s.destroy(); }
      hub = { id: msg.id, socket: ws, streams: new Map(), nextStreamId: 0 };
      hubs.set(msg.id, hub);
      ws.send(encodeFrame(FrameType.REG_OK, 0));
      log(`hub registered: ${msg.id}  (now ${hubs.size} hub(s))`);
      return;
    }

    if (!hub) { ws.close(); return; }

    const phone = hub.streams.get(frame.streamId);
    switch (frame.type) {
      case FrameType.DATA:
        if (phone && phone.writable) phone.write(frame.payload);
        break;
      case FrameType.CLOSE:
        if (phone) { hub.streams.delete(frame.streamId); phone.end(); }
        break;
    }
  });

  const cleanup = () => {
    clearInterval(ping);
    if (hub && hubs.get(hub.id) === hub) {
      for (const s of hub.streams.values()) s.destroy();
      hubs.delete(hub.id);
      log(`hub disconnected: ${hub.id}  (now ${hubs.size} hub(s))`);
    }
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

function authRegister(msg: RegisterMsg): boolean {
  if (!msg.id) return false;
  if (KEYS.size === 0) return true; // dev mode
  const expected = KEYS.get(msg.id);
  return !!expected && expected === msg.key;
}

server.listen(PORT, () => {
  log(`listening on :${PORT}`);
  log(`hub control path: ${HUB_PATH}`);
  log(`public URL: ${PUBLIC_URL}  (phones use ${PUBLIC_URL}/h/<id>)`);
  if (KEYS.size === 0) log('WARNING: RELAY_KEYS empty — accepting ANY hub id/key (dev only).');
  else log(`registered keys for ids: ${[...KEYS.keys()].join(', ')}`);
});
