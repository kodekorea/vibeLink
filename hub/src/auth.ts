import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';

const PAIR_CODE_TTL    = 300;
const PAIR_FAIL_LIMIT  = 5;
const RATE_LIMIT_PER_MIN = 5;
const JWT_TTL          = 7 * 24 * 3600;
const AUDIT_PATH       = path.join(os.homedir(), '.mtb', 'audit.log');

interface PairingCode {
  code: string; issuedAt: number;
  used: boolean; failCount: number; revoked: boolean;
}

export interface Device {
  deviceId: string; pairedAt: number; jwtJti: string; revoked: boolean;
}

interface RateBucket { minute: number; count: number; }

function audit(event: string, fields: Record<string, unknown>): void {
  const dir = path.dirname(AUDIT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(AUDIT_PATH, JSON.stringify({ ts: Date.now() / 1000, event, ...fields }) + '\n');
}

function genCode(): string {
  const fixed = process.env.MTB_FIXED_CODE;
  if (fixed) return fixed;
  return String(crypto.randomInt(1_000_000)).padStart(6, '0');
}

export class AuthStore {
  private codes   = new Map<string, PairingCode>();
  private devices = new Map<string, Device>();
  private rate    = new Map<string, RateBucket>();

  constructor(private secret: string) {}

  issueCode(): string {
    const code = genCode();
    this.codes.set(code, { code, issuedAt: Date.now() / 1000, used: false, failCount: 0, revoked: false });
    audit('issue', { code });
    return code;
  }

  attemptPair(code: string, deviceId: string, ip: string, ua: string): { ok: boolean; token?: string; reason: string } {
    // Rate limit
    const key = `${ip}|${ua}`;
    const bucket = this.rate.get(key) ?? { minute: 0, count: 0 };
    const curMin = Math.floor(Date.now() / 60000);
    if (curMin !== bucket.minute) { bucket.minute = curMin; bucket.count = 0; }
    bucket.count++;
    this.rate.set(key, bucket);
    if (bucket.count > RATE_LIMIT_PER_MIN) {
      audit('attempt', { code, ip, ua, result: 'rate_limited' });
      return { ok: false, reason: 'rate_limited' };
    }

    // Password mode — reissue on every match so it's infinitely reusable
    const password = process.env.MTB_PASSWORD;
    if (password && code === password) {
      this.codes.set(code, { code, issuedAt: Date.now() / 1000, used: false, failCount: 0, revoked: false });
    }

    const pc = this.codes.get(code);
    if (!pc) { audit('attempt', { code, ip, ua, result: 'unknown_code' }); return { ok: false, reason: 'unknown_code' }; }

    const now = Date.now() / 1000;
    const expired = (now - pc.issuedAt) > PAIR_CODE_TTL;
    if (pc.used || pc.revoked || expired || pc.failCount >= PAIR_FAIL_LIMIT) {
      audit('attempt', { code, ip, ua, result: 'expired_or_used' });
      return { ok: false, reason: 'expired_or_used' };
    }

    pc.used = true;
    const jti = crypto.randomBytes(16).toString('base64url');
    this.devices.set(deviceId, { deviceId, pairedAt: now, jwtJti: jti, revoked: false });
    const token = jwt.sign({ sub: deviceId, jti }, this.secret, { expiresIn: JWT_TTL });
    audit('success', { code, deviceId, ip, ua, jti });
    return { ok: true, token, reason: 'ok' };
  }

  registerFailure(code: string, ip: string, ua: string): void {
    const pc = this.codes.get(code);
    if (!pc) return;
    pc.failCount++;
    audit('fail', { code, ip, ua, failCount: pc.failCount });
    if (pc.failCount >= PAIR_FAIL_LIMIT) { pc.revoked = true; audit('auto_revoke', { code }); }
  }

  issueJwtDirect(deviceId: string, ip: string, ua: string): string {
    const jti = crypto.randomBytes(16).toString('base64url');
    this.devices.set(deviceId, { deviceId, pairedAt: Date.now() / 1000, jwtJti: jti, revoked: false });
    const token = jwt.sign({ sub: deviceId, jti }, this.secret, { expiresIn: JWT_TTL });
    audit('auto_issue', { deviceId, ip, ua });
    return token;
  }

  verifyJwt(token: string): Device | null {
    try {
      const payload = jwt.verify(token, this.secret) as jwt.JwtPayload;
      const dev = this.devices.get(payload['sub'] ?? '');
      if (!dev || dev.revoked || dev.jwtJti !== payload['jti']) return null;
      return dev;
    } catch { return null; }
  }

  revokeDevice(deviceId: string): boolean {
    const dev = this.devices.get(deviceId);
    if (!dev || dev.revoked) return false;
    dev.revoked = true;
    audit('revoke', { deviceId });
    return true;
  }

  revokeAll(): number {
    let n = 0;
    for (const dev of this.devices.values()) {
      if (!dev.revoked) { dev.revoked = true; n++; }
    }
    audit('revoke_all', { count: n });
    return n;
  }
}
