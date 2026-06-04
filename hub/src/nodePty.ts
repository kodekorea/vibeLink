// node-pty를 표준 인터페이스로 감싼다. 테스트는 PtySpawn을 가짜로 주입한다.
export interface IPty {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  readonly pid: number;
}

export interface SpawnOpts {
  name?: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv;
}

export type PtySpawn = (file: string, args: string[], opts: SpawnOpts) => IPty;

export function loadNodePty(): PtySpawn {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pty = require('node-pty');
  return (file, args, opts) => pty.spawn(file, args, opts) as IPty;
}
