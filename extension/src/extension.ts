import * as crypto from 'crypto';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import * as vscode from 'vscode';
import { AuthStore } from './auth';
import { EditorManager } from './editor';
import { PreviewManager } from './preview';
import { ProviderClient } from './provider';
import { MtbServer } from './server';
import { TerminalManager } from './terminal';
import { TunnelManager } from './tunnel';

let server:     MtbServer       | undefined;
let provider:   ProviderClient  | undefined;
let tunnel:     TunnelManager   | undefined;
let termMgr:    TerminalManager | undefined;
let editorMgr:  EditorManager   | undefined;
let previewMgr: PreviewManager  | undefined;
let out:        vscode.OutputChannel | undefined;
let qrPanel:    vscode.WebviewPanel | undefined;

// 이 창을 식별하는 ID/라벨 (창마다 고유). 폰은 이걸로 창을 스와이프 전환한다.
const windowId = crypto.randomBytes(4).toString('hex');
function windowLabel(): string {
  const f = vscode.workspace.workspaceFolders?.[0];
  return f ? path.basename(f.uri.fsPath) : '창';
}

async function showQrWebview(url: string): Promise<void> {
  if (!tunnel) return;
  const dataUrl = await tunnel.qrDataUrl(url);
  if (!qrPanel) {
    qrPanel = vscode.window.createWebviewPanel(
      'mtbQr', 'MTB 연결 QR', vscode.ViewColumn.Active,
      { enableScripts: false, retainContextWhenHidden: true },
    );
    qrPanel.onDidDispose(() => { qrPanel = undefined; });
  }
  qrPanel.webview.html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
<style>
  body{background:#fff;color:#111;font-family:sans-serif;text-align:center;margin:0;padding:28px}
  .h{font-size:17px;font-weight:600;margin-bottom:18px}
  img{width:min(82vw,440px);height:auto;image-rendering:pixelated;border:12px solid #fff}
  .u{margin-top:16px;font-size:13px;color:#0a58ca;word-break:break-all}
  .t{margin-top:10px;color:#666;font-size:12px}
</style></head>
<body>
  <div class="h">📱 휴대폰으로 QR을 스캔하세요</div>
  <img src="${dataUrl}" alt="QR">
  <div class="u">${url}</div>
  <div class="t">스캔 후 암호 입력 → 페어링 완료</div>
</body></html>`;
  qrPanel.reveal(vscode.ViewColumn.Active);
}

function getOrCreateSecret(context: vscode.ExtensionContext): string {
  const KEY = 'jwtSecret';
  let secret = context.globalState.get<string>(KEY);
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    context.globalState.update(KEY, secret);
  }
  return secret;
}

async function ensurePassword(): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration('mtb');
  let pwd = cfg.get<string>('password', '');
  if (pwd) { process.env.MTB_PASSWORD = pwd; return pwd; }

  pwd = await vscode.window.showInputBox({
    prompt:      'MTB 암호 설정 (휴대폰 페어링에 사용). 한 번만 물어봅니다.',
    password:    true,
    placeHolder: '암호를 입력하세요',
    ignoreFocusOut: true,
  }) ?? '';

  if (!pwd) {
    vscode.window.showWarningMessage('MTB: 암호를 설정하지 않아 시작을 취소했습니다. 설정에서 mtb.password를 입력하세요.');
    return undefined;
  }
  await cfg.update('password', pwd, vscode.ConfigurationTarget.Global);
  process.env.MTB_PASSWORD = pwd;
  return pwd;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  out = vscode.window.createOutputChannel('Mobile Terminal Bridge');

  const cmdStart = vscode.commands.registerCommand('mtb.start', async () => {
    if (server || provider) { vscode.window.showInformationMessage('MTB: 이미 실행 중입니다.'); return; }

    const pwd = await ensurePassword();
    if (!pwd) return;

    const cfg        = vscode.workspace.getConfiguration('mtb');
    const port       = cfg.get<number>('port', 47800);
    const tunnelMode = cfg.get<string>('tunnel', 'temp');
    const tunnelName = cfg.get<string>('tunnelName', '');
    const tunnelUrl  = cfg.get<string>('tunnelUrl', '');
    const label      = windowLabel();

    try {
      out!.appendLine(`\n[start] 초기화 (port=${port}, tunnel=${tunnelMode}, window=${label}/${windowId}, appRoot=${vscode.env.appRoot})`);
      const store = new AuthStore(getOrCreateSecret(context));
      tunnel = new TunnelManager(context.extensionPath, out!);
      const hub = new MtbServer(store, tunnel, context.extensionPath, out!);
      hub.localWindow = { id: windowId, label };

      out!.appendLine('[start] 허브 포트 바인딩 시도...');
      const mode = await hub.tryStart(port);

      // ── 프로바이더 모드: 다른 창이 이미 허브 → 그쪽에 붙어 터미널만 중계 ──
      if (mode === 'inuse') {
        out!.appendLine('[start] 포트 점유됨 → 프로바이더 모드(다른 창 허브에 연결)');
        tunnel = undefined; // 이 창은 터널/QR 불필요
        provider = new ProviderClient(port, windowId, label, out!);
        termMgr = new TerminalManager(provider, windowId);
        provider.termMgr = termMgr;
        termMgr.activate(context);
        vscode.window.showInformationMessage(
          `MTB: 이 창("${label}")을 허브에 연결했습니다. 폰에서 스와이프로 전환해 제어하세요.`,
        );
        out!.appendLine('[start] ✅ 프로바이더 연결 완료');
        return;
      }

      // ── 허브 모드: 이 창이 폰을 직접 받는 서버 ──
      server = hub;
      out!.appendLine('[start] 터미널(node-pty) 초기화...');
      termMgr = new TerminalManager(server, windowId);
      termMgr.activate(context);
      server.termMgr = termMgr;
      out!.appendLine('[start] 터미널 OK');

      previewMgr = new PreviewManager(context.extensionPath, out!);
      server.previewMgr = previewMgr;

      editorMgr = new EditorManager(server);
      editorMgr.activate(context);

      if (tunnelMode !== 'none') {
        out!.appendLine('[start] 터널 시작...');
        await tunnel.start(tunnelMode, port, tunnelName, tunnelUrl);
        tunnel.onReady(url => {
          void showQrWebview(url);
          tunnel!.showQR(url); // Output 패널 ASCII 폴백
          vscode.window.showInformationMessage(`MTB 연결 준비 완료 — ${url}`, 'QR 보기')
            .then(sel => { if (sel === 'QR 보기') void showQrWebview(url); });
        });
      } else {
        vscode.window.showInformationMessage(`MTB: http://127.0.0.1:${port} (LAN 모드)`);
      }
      out!.appendLine('[start] ✅ 완료 (허브)');
    } catch (e) {
      const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
      out!.appendLine(`[start] ❌ 실패:\n${detail}`);
      out!.show(true);
      vscode.window.showErrorMessage(
        `MTB 시작 실패: ${e instanceof Error ? e.message : String(e)} — Output → "Mobile Terminal Bridge" 참고`,
      );
      // 절반만 초기화된 상태 정리 → 다시 시도 가능하게
      try { previewMgr?.stop(); } catch { /* */ }
      try { editorMgr?.dispose(); } catch { /* */ }
      try { termMgr?.dispose(); } catch { /* */ }
      try { provider?.dispose(); } catch { /* */ }
      try { server?.stop(); } catch { /* */ }
      try { tunnel?.stop(); } catch { /* */ }
      previewMgr = undefined; editorMgr = undefined; termMgr = undefined;
      provider = undefined; server = undefined; tunnel = undefined;
    }
  });

  const cmdStop = vscode.commands.registerCommand('mtb.stop', () => {
    previewMgr?.stop();   previewMgr = undefined;
    editorMgr?.dispose(); editorMgr  = undefined;
    termMgr?.dispose();   termMgr    = undefined;
    provider?.dispose();  provider   = undefined;
    server?.stop();       server     = undefined;
    tunnel?.stop();       tunnel     = undefined;
    out!.appendLine('MTB 서버 중지됨.');
    vscode.window.showInformationMessage('MTB 서버가 중지됐습니다.');
  });

  const cmdQR = vscode.commands.registerCommand('mtb.showQR', () => {
    const url = tunnel?.url;
    if (!url) { vscode.window.showWarningMessage('MTB: 터널이 아직 준비되지 않았습니다.'); return; }
    void showQrWebview(url);
  });

  // PoC: VS Code 내장 node-pty를 재사용할 수 있는지 진단 (네이티브 빌드 불필요)
  const cmdPtyTest = vscode.commands.registerCommand('mtb.ptyTest', () => {
    const o = out!;
    o.show(true);
    o.appendLine('\n=== MTB node-pty 진단 ===');
    o.appendLine(`platform=${process.platform} arch=${process.arch}`);
    o.appendLine(`versions=${JSON.stringify(process.versions)}`);
    o.appendLine(`appRoot=${vscode.env.appRoot}`);

    const ptyPath = path.join(vscode.env.appRoot, 'node_modules', 'node-pty');
    o.appendLine(`node-pty 경로=${ptyPath}`);
    o.appendLine(`경로 존재=${fs.existsSync(ptyPath)}`);

    let pty: { spawn: (...a: unknown[]) => any };
    try {
      const req = createRequire(process.execPath);
      pty = req(ptyPath) as typeof pty;
      o.appendLine(`require 성공: spawn=${typeof pty.spawn}`);
    } catch (e) {
      o.appendLine(`require 실패: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    try {
      const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
      const term = pty.spawn(shell, [], {
        name: 'xterm-color', cols: 80, rows: 24,
        cwd: process.env.HOME || process.cwd(), env: process.env,
      });
      let buf = '';
      term.onData((d: string) => { buf += d; });
      term.write('echo MTB_PTY_OK\r\n');
      setTimeout(() => {
        o.appendLine(`pty 출력 샘플(앞 200자): ${JSON.stringify(buf.slice(0, 200))}`);
        o.appendLine(buf.includes('MTB_PTY_OK') ? '✅ PTY 동작 확인! (이 방식으로 재작성 가능)' : '⚠️ 출력은 받았으나 echo 미확인');
        try { term.kill(); } catch { /* ignore */ }
      }, 1800);
    } catch (e) {
      o.appendLine(`spawn 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  context.subscriptions.push(cmdStart, cmdStop, cmdQR, cmdPtyTest, out!);
}

export function deactivate(): void {
  previewMgr?.stop();
  editorMgr?.dispose();
  termMgr?.dispose();
  provider?.dispose();
  server?.stop();
  tunnel?.stop();
}
