import * as path from 'path';
import * as vscode from 'vscode';

export interface FsEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

export async function readDir(dirPath: string): Promise<FsEntry[]> {
  const uri = vscode.Uri.file(dirPath);
  const entries = await vscode.workspace.fs.readDirectory(uri);
  return entries
    .map(([name, type]) => ({
      name,
      type: type === vscode.FileType.Directory ? 'dir' : 'file' as 'file' | 'dir',
      path: path.join(dirPath, name).replace(/\\/g, '/'),
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath.replace(/\\/g, '/'));
}

export async function openFolder(folderPath: string): Promise<void> {
  const uri = vscode.Uri.file(folderPath);
  await vscode.commands.executeCommand('vscode.openFolder', uri, false);
}

export async function openFile(filePath: string): Promise<void> {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}
