import * as vscode from 'vscode';
import { WebSocket } from 'ws';
import { MtbServer, S2C } from './server';

const CHANGE_DEBOUNCE_MS = 300;
const MAX_CONTENT_BYTES  = 512 * 1024; // 512KB 초과 파일은 앞부분만 전송

export class EditorManager {
  private changeTimer?: ReturnType<typeof setTimeout>;
  private disposables: vscode.Disposable[] = [];

  constructor(private server: MtbServer) {
    // 신규 WS 접속자에게 현재 에디터 상태 전송
    server.clientJoinHandlers.push((ws: WebSocket) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        ws.send(JSON.stringify(this.makeOpenMsg(editor)));
        ws.send(JSON.stringify(this.makeCursorMsg(editor)));
      } else {
        ws.send(JSON.stringify({ type: 'editor_close' } satisfies S2C));
      }
    });
  }

  activate(context: vscode.ExtensionContext): void {
    // 현재 열린 파일 즉시 브로드캐스트
    const current = vscode.window.activeTextEditor;
    if (current) {
      this.server.broadcast(this.makeOpenMsg(current));
      this.server.broadcast(this.makeCursorMsg(current));
    }

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.server.broadcast(this.makeOpenMsg(editor));
          this.server.broadcast(this.makeCursorMsg(editor));
        } else {
          this.server.broadcast({ type: 'editor_close' });
        }
      }),

      // 타이핑 중 디바운스 — 300ms 정지 후 전송
      vscode.workspace.onDidChangeTextDocument(e => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || e.document !== editor.document) return;
        clearTimeout(this.changeTimer);
        this.changeTimer = setTimeout(() => {
          this.server.broadcast({ type: 'editor_change', content: this.getContent(e.document) });
        }, CHANGE_DEBOUNCE_MS);
      }),

      // 커서 이동
      vscode.window.onDidChangeTextEditorSelection(e => {
        if (e.textEditor !== vscode.window.activeTextEditor) return;
        this.server.broadcast(this.makeCursorMsg(e.textEditor));
      }),
    );

    context.subscriptions.push(...this.disposables);
  }

  private getContent(doc: vscode.TextDocument): string {
    const text = doc.getText();
    if (Buffer.byteLength(text, 'utf8') > MAX_CONTENT_BYTES) {
      const truncated = text.slice(0, MAX_CONTENT_BYTES);
      return truncated + '\n\n[파일이 너무 큽니다 — 앞부분만 표시]';
    }
    return text;
  }

  private makeOpenMsg(editor: vscode.TextEditor): S2C {
    return {
      type:    'editor_open',
      path:    editor.document.uri.fsPath,
      lang:    editor.document.languageId,
      content: this.getContent(editor.document),
    };
  }

  private makeCursorMsg(editor: vscode.TextEditor): S2C {
    return {
      type: 'editor_cursor',
      line: editor.selection.active.line,
      col:  editor.selection.active.character,
    };
  }

  dispose(): void {
    clearTimeout(this.changeTimer);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
