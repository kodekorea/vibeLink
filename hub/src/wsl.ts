// WSL(env='wsl') 런타임 헬퍼. sessions.ts를 깔끔하게 유지하려고 분리.
//
// 모델: hub는 셸을 spawn한 뒤 에이전트 실행 명령(claude 등)을 pty.write(launch+'\r')로
//       "타이핑"한다. 따라서 WSL도 비대화형(-e bash -c "claude")이 아니라, 그 세션 폴더에서
//       대화형 로그인 셸을 띄워야 한다. 그 안에서 사용자가/혹은 hub가 claude를 친다.
//
// 핵심: `wsl.exe --cd <WindowsPath>`는 해당 Windows 경로(\\wsl 변환 포함)를 작업 디렉터리로
//       두고 기본 배포판의 대화형 셸을 띄운다. node-pty의 cwd 옵션은 Windows 측 cwd이므로
//       WSL 내부 디렉터리를 바꾸지 못한다 — 그래서 --cd 인자가 필요하다.

export interface WslSpawn { file: string; args: string[]; }

// Windows 경로 → WSL 경로. (예: E:\foo\bar → /mnt/e/foo/bar)
// UNC(\\wsl$\...) 나 이미 POSIX(/...) 경로는 그대로 둔다.
export function winPathToWsl(p: string): string {
  if (!p) return p;
  // 이미 POSIX 경로
  if (p.startsWith('/')) return p;
  const drive = p.match(/^([A-Za-z]):[\\/](.*)$/);
  if (drive) {
    const letter = drive[1].toLowerCase();
    const rest = drive[2].replace(/\\/g, '/');
    return `/mnt/${letter}/${rest}`;
  }
  // 드라이브 없는 경로 — 백슬래시만 정규화.
  return p.replace(/\\/g, '/');
}

// wsl.exe spawn 인자 구성.
//  - cwd: 세션의 Windows 경로. wsl.exe --cd 로 작업 디렉터리를 잡는다.
//  - distro: 선택적 배포판 이름(-d). 없으면 기본 배포판.
// 명령(launch)은 spawn 인자에 넣지 않는다 — 호출부에서 대화형 셸에 타이핑한다.
export function buildWslSpawn(cwd: string, distro?: string): WslSpawn {
  const args: string[] = [];
  if (distro) { args.push('-d', distro); }
  if (cwd) { args.push('--cd', cwd); }
  return { file: 'wsl.exe', args };
}
