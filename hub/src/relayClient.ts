// Hub-side relay client. Dials OUT to the public relay (so it works behind NAT with no
// port-forwarding), registers with {id,key}, and for each phone stream the relay opens it
// dials a fresh loopback connection to this hub's own HubServer and pipes bytes both ways.
// The hub's existing HTTP router + /ws upgrade run untouched — the relayed phone looks
// like any other local client. See docs/superpowers/specs/2026-06-06-self-relay-design.md.

import * as net from 'net';
import { WebSocket } from 'ws';
import { FrameType, encodeFrame, decodeFrame } from './relayProtocol';

export interface RelayOptions {
  relayUrl: string;   // ws://host:port or wss://host  (hub control path appended)
  hubPath?: string;   // default /_hub
  id: string;         // this hub's public id (appears in phone URL)
  key: string;        // shared registration key
  localPort: number;  // this hub's HubServer port (loopback target)
  publicUrl?: string; // public https base to advertise (for QR/logs)
  log: (msg: string) => void;
}

export class RelayClient {
  private ws?: WebSocket;
  private streams = new Map<number, net.Socket>();
  private backoff = 1000;
  private stopped = false;
  private _publicHostUrl?: string;

  constructor(private opts: RelayOptions) {
    if (opts.publicUrl) {
      this._publicHostUrl = `${opts.publicUrl.replace(/\/+$/, '')}/h/${encodeURIComponent(opts.id)}`;
    }
  }

  // The URL a phone should pair against (Host.url). Undefined if no public URL configured.
  get publicHostUrl(): string | undefined { return this._publicHostUrl; }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    for (const s of this.streams.values()) s.destroy();
    this.streams.clear();
    try { this.ws?.close(); } catch { /* */ }
  }

  private controlUrl(): string {
    const base = this.opts.relayUrl.replace(/\/+$/, '');
    const path = this.opts.hubPath ?? '/_hub';
    return base + path;
  }

  private connect(): void {
    if (this.stopped) return;
    const url = this.controlUrl();
    this.opts.log(`relay 연결 시도: ${url}`);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      ws.send(encodeFrame(FrameType.REGISTER, 0, JSON.stringify({ id: this.opts.id, key: this.opts.key })));
    });

    ws.on('message', (raw: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      let frame;
      try { frame = decodeFrame(raw); } catch { return; }
      switch (frame.type) {
        case FrameType.REG_OK:
          this.backoff = 1000;
          this.opts.log(`relay 등록 완료 (id=${this.opts.id})`);
          if (this._publicHostUrl) this.opts.log(`폰 접속 URL: ${this._publicHostUrl}`);
          break;
        case FrameType.REG_ERR:
          this.opts.log(`relay 등록 거부: ${frame.payload.toString('utf8')}`);
          break;
        case FrameType.OPEN:
          this.openStream(frame.streamId);
          break;
        case FrameType.DATA: {
          const s = this.streams.get(frame.streamId);
          if (s && s.writable) s.write(frame.payload);
          break;
        }
        case FrameType.CLOSE: {
          const s = this.streams.get(frame.streamId);
          if (s) { this.streams.delete(frame.streamId); s.end(); }
          break;
        }
      }
    });

    const onDown = (why: string) => {
      if (this.ws !== ws) return; // superseded
      for (const s of this.streams.values()) s.destroy();
      this.streams.clear();
      this.ws = undefined;
      if (this.stopped) return;
      this.opts.log(`relay 연결 끊김 (${why}) — ${Math.round(this.backoff / 1000)}s 후 재시도`);
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, 30000);
      setTimeout(() => this.connect(), delay);
    };
    ws.on('close', () => onDown('close'));
    ws.on('error', (e) => onDown(String((e as Error)?.message ?? e)));
  }

  // A new phone stream: open a loopback socket to our own HubServer and pipe both ways.
  private openStream(streamId: number): void {
    const ws = this.ws;
    if (!ws) return;
    const local = net.connect(this.opts.localPort, '127.0.0.1');
    this.streams.set(streamId, local);

    local.on('data', (d: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encodeFrame(FrameType.DATA, streamId, d));
    });
    const closeStream = () => {
      if (!this.streams.has(streamId)) return;
      this.streams.delete(streamId);
      if (ws.readyState === WebSocket.OPEN) ws.send(encodeFrame(FrameType.CLOSE, streamId));
    };
    local.on('close', closeStream);
    local.on('error', closeStream);
  }
}
