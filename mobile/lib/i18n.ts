import { getLang } from './prefs';

const EN = {
  // connect / scan
  scanTitle: 'Scan the PC QR', scanSub: 'Run hub, then scan its QR (or /qr.html)',
  cameraNeeded: 'Camera permission needed', allow: 'Allow', enterUrl: 'Enter URL manually',
  connectTitle: 'Connect to hub', hubUrl: 'hub URL', password: 'Password (MTB_PASSWORD)',
  connect: 'Connect', rescan: '← Scan QR again', authFail: 'Auth failed', failed: 'Failed',
  // tabs / common
  terminal: 'Terminal', agent: 'Chat', changes: 'Changes', files: 'Files', settings: 'Settings',
  noSession: 'No running session — start one with ＋', close: 'Close', up: '⬆ Up', drives: 'Drives',
  list: '← List',
  // agent
  loadSessionFail: 'Could not load session (needs a running claude session)',
  // changes
  loadFail: 'Could not load', noChanges: "No files changed by Claude in this session", truncated: '… (truncated)',
  // files
  browseFail: 'Failed to load: ', readFail: 'Read failed: ', imgFail: 'Could not load image',
  pdfMsg: 'PDF preview not supported yet.\nOpen it from the terminal by path.',
  // settings
  connectedPc: 'Connected PCs (hosts)', none: 'None', addPc: '＋ Add PC (scan QR)',
  completionAlarm: 'Completion alarm', available: 'Available', expoGoOff: 'Off in Expo Go (needs dev build)',
  delete: 'Delete', appearance: 'Appearance', theme: 'Theme', language: 'Language', light: 'Light', dark: 'Dark',
  endSession: 'End session', endSessionQ: (l: string) => `End session "${l}"?`, cancel: 'Cancel', end: 'End',
};
type Dict = typeof EN;
const KO: Dict = {
  scanTitle: 'PC의 QR을 비추세요', scanSub: 'hub 실행 후 뜨는 QR (또는 /qr.html)',
  cameraNeeded: '카메라 권한이 필요해요', allow: '권한 허용', enterUrl: 'URL 직접 입력',
  connectTitle: 'hub 연결', hubUrl: 'hub URL', password: '암호 (MTB_PASSWORD)',
  connect: '연결', rescan: '← QR 다시 스캔', authFail: '인증 실패', failed: '실패',
  terminal: '터미널', agent: '대화', changes: '변경', files: '파일', settings: '설정',
  noSession: '실행 중인 세션 없음 — ＋로 시작', close: '닫기', up: '⬆ 상위', drives: '드라이브',
  list: '← 목록',
  loadSessionFail: '세션을 불러오지 못했어요 (claude 세션이 있어야 함)',
  loadFail: '불러오지 못했어요', noChanges: '이 세션에서 Claude가 바꾼 파일이 없어요', truncated: '… (잘림)',
  browseFail: '불러오기 실패: ', readFail: '읽기 실패: ', imgFail: '이미지를 불러올 수 없어요',
  pdfMsg: 'PDF 미리보기는 아직 지원 안 해요.\n터미널에서 경로로 열어보세요.',
  connectedPc: '연결된 PC (호스트)', none: '없음', addPc: '＋ PC 추가 (QR 스캔)',
  completionAlarm: '완료 알림', available: '사용 가능', expoGoOff: 'Expo Go에서는 꺼짐 (dev build 필요)',
  delete: '삭제', appearance: '화면', theme: '테마', language: '언어', light: '라이트', dark: '다크',
  endSession: '세션 종료', endSessionQ: (l: string) => `${l} 세션을 종료할까요?`, cancel: '취소', end: '종료',
};
const DICTS = { en: EN, ko: KO };
export function t<K extends keyof Dict>(k: K): Dict[K] { return DICTS[getLang()][k]; }
