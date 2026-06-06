# 변경하려던 사항 (VibeLink 프로젝트에 옮겨 적용)

> 이 문서는 **구버전 폴더(`mobile_term_bridge_distrib`)에서 작업하다 폐기**한 내용을, 진짜 VibeLink 프로젝트에 다시 적용할 수 있게 정리한 것입니다.
> VibeLink는 같은 코드의 리네임본이므로 파일 경로/구조는 동일합니다. 소스는 변경하지 않았고 **이 문서만** 담겨 있습니다.

총 4가지 + 참고. 위험도/적용 위치를 함께 표기합니다.

| # | 변경 | 위치 | 종류 |
|---|------|------|------|
| 1 | 터미널 입력창 2개 → 출력 전용 | hub PWA (`hub/pwa/index.html`) | 한 줄 |
| 2 | 터미널 스크롤 씹힘 수정 | hub PWA CSS | CSS 한 줄 |
| 3 | 프리뷰 포트 정리(필터 + 가로스크롤) | hub 서버 + 모바일 앱 | 중간 |
| 4 | 파일 다운로드 기능 | hub 서버 + 모바일 헬퍼/앱 | 신규 기능 |

---

## 1. 터미널 입력창 2개 → 출력 전용

**문제**: 터미널(xterm)에 직접 타이핑도 되고, 아래 "명령 입력" 박스로도 입력 → 입력 경로가 둘이라 빈칸이 두 개로 보임.

**수정**: 터미널을 출력 전용으로 만들어 입력은 아래 박스 하나로 통일. `hub/pwa/index.html`의 `setupTerm()` 안 `new Terminal({...})`에 옵션 한 줄 추가.

```js
term = new Terminal({
  scrollback: 5000,
  fontSize: fontSize,
  lineHeight: 1.15,
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
  theme: termTheme(),
  // 입력은 아래 '명령 입력' 박스(#line)로만 받는다. 터미널을 탭해도
  // 경쟁하는 소프트 키보드가 뜨지 않도록 xterm 자체 입력을 끈다(출력 전용).
  disableStdin: true,
});
```

> 키바(Esc/Enter/방향키/Tab/^C/⇧⇥)는 `disableStdin`과 무관하게 그대로 동작합니다(별도 `sendWs`로 전송).

---

## 2. 터미널 스크롤이 자주 씹히는 문제

**원인**: 모바일에서 손가락이 실제로 닿는 레이어는 `.xterm-screen`(텍스트/캔버스)인데, 세로 팬 허용(`touch-action:pan-y`)이 그 **밑에 깔린** `.xterm-viewport`에만 걸려 있었음. 그래서 브라우저가 세로 스크롤로 확정하지 못하고 선택/스크롤 사이에서 드래그를 씹음. (DOM 측정으로 `.xterm-screen`이 viewport를 덮는 것 확인)

**수정**: `hub/pwa/index.html`의 `<style>`에서 viewport 규칙 아래에 한 줄 추가.

```css
#term .xterm-viewport{overflow-y:auto !important;-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain}
/* 모바일에서 손가락이 실제 닿는 캔버스(.xterm-screen) 레이어에도 세로 팬을 허용 */
#term .xterm-screen,#term .xterm-screen canvas{touch-action:pan-y}
```

→ 세로 드래그 = 즉시 네이티브 스크롤, 가로 드래그 = 세션 스와이프로 깔끔히 분리.

> 데스크톱 Chromium 기준으로 검증함. 실제 Android WebView에서 여전히 버벅이면 `touchmove`에서 `viewport.scrollTop`을 직접 제어하는 수동 스크롤 핸들러로 확정 처리 가능.

---

## 3. 프리뷰 포트 정리

### 3-a. 서버: 무의미한 포트 필터 (`hub/src/server.ts`)

**문제**: `listeningPorts()`가 `1024~49151` 범위 LISTEN 포트를 전부 노출 → DB/윈도우 서비스까지 떠서 목록이 너무 김(실측 73개).

**수정**: 웹 dev 서버로 흔한 포트만 화이트리스트로 노출(실측 73개 → 2개). 그 외 포트는 프리뷰 화면의 직접 입력칸으로 열 수 있음.

```ts
// listeningPorts 위에 추가
const DEV_PORTS = new Set<number>([
  3000, 3001, 3002, 3003, // Next.js / CRA / Node
  4173, 4174,             // Vite preview
  4200,                   // Angular
  5000, 5001,             // Flask / .NET / 일반
  5173, 5174, 5175,       // Vite dev
  8000, 8001,             // Django / 일반 http
  8080, 8081,             // 일반 웹 / webpack
  8888,                   // Jupyter / 일반
  9000, 9001,             // 일반 dev
  19006,                  // Expo web
]);
```

```ts
// netstat 파싱 루프 안의 필터 조건을 교체:
//   기존: if (port < 1024 || port === selfPort || port > 49151) continue;
//   변경:
if (port === selfPort || !DEV_PORTS.has(port)) continue;
```

### 3-b. 앱: 칩을 가로 스크롤 한 줄로 (`mobile/app/(tabs)/preview.tsx`)

**문제**: 포트 칩 컨테이너가 `flexWrap:'wrap'`이라 포트가 많으면 여러 줄로 쌓여 WebView를 화면 밖으로 밀어냄.

**수정**: `ScrollView`를 import하고, 칩 컨테이너를 가로 스크롤 한 줄로.

```tsx
// import 줄에 ScrollView 추가
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
```

```tsx
// ports.length > 0 일 때의 <View style={styles.chips}>...</View> 를 아래로 교체
<ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  style={styles.chipsRow}
  contentContainerStyle={styles.chips}
>
  {ports.map(String).map(p => (
    <Pressable key={p} onPress={() => { setPort(p); openWeb(p); }} style={[styles.chip, port === p && webUri && styles.chipOn]}>
      <Text style={[styles.chipTxt, port === p && webUri && styles.chipTxtOn]}>● {p}</Text>
    </Pressable>
  ))}
</ScrollView>
```

```ts
// 스타일: chips 의 flexWrap 제거 + chipsRow 추가
//   기존: chips: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 6, flexWrap: 'wrap' },
chipsRow: { flexGrow: 0, flexShrink: 0 },
chips: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 6 },
```

---

## 4. 파일 다운로드 기능 (파일 탭)

뷰어는 되는데 폰으로 다운로드가 안 되던 문제. **`expo-linking`(이미 설치된 모듈)으로 시스템 브라우저 다운로드**를 쓰므로 **새 네이티브 모듈이 없어 OTA로 배포 가능**.

### 4-a. 서버: `/download` 라우트 (`hub/src/server.ts`)

시스템 브라우저는 헤더를 못 실으므로 **쿼리 토큰(`?token=`)** 도 허용하고, `Content-Disposition: attachment`로 저장을 유도. 한글 파일명은 RFC 5987(`filename*`)로 안전 처리. `/raw` 라우트 바로 뒤에 추가.

```ts
// 파일 다운로드 — 폰의 시스템 브라우저가 저장하도록 attachment로 내려준다.
// 브라우저는 헤더를 못 실으므로 쿼리 토큰(?token=)도 허용한다.
if (meth === 'GET' && pathOnly === '/download') {
  const u = new URL(url, 'http://x');
  const tok = u.searchParams.get('token') || parseCookies(req)['mtb_jwt'] || bearer(req);
  if (!this.store.verifyJwt(tok)) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('unauthenticated'); return; }
  const p = u.searchParams.get('path');
  if (!p) { res.writeHead(400); res.end('path required'); return; }
  const fp = decodeURIComponent(p);
  let st: fs.Stats;
  try { st = fs.statSync(fp); } catch { res.writeHead(404); res.end('not found'); return; }
  if (st.isDirectory()) { res.writeHead(400); res.end('is a directory'); return; }
  const name = path.basename(fp);
  const ext = path.extname(fp).toLowerCase();
  const mime = ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json',
  } as Record<string, string>)[ext] || 'application/octet-stream';
  // RFC 5987: 비ASCII(한글) 파일명도 안전하게. filename(폴백) + filename*(UTF-8).
  const asciiName = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || ('download' + ext);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': String(st.size),
    'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(fp).pipe(res);
  return;
}
```

> 쿠키 이름(`mtb_jwt`)은 VibeLink에서 바뀌었을 수 있으니 그 프로젝트의 쿠키/토큰 이름에 맞추세요.

### 4-b. 클라이언트 헬퍼 (`mobile/lib/hub.ts`)

```ts
// 파일 다운로드 URL (시스템 브라우저로 열어 저장). 브라우저는 헤더를 못 실으므로
// 토큰을 쿼리로 붙인다 — Linking.openURL(await downloadUrl(path)).
export async function downloadUrl(filePath: string): Promise<string | null> {
  const h = await getActiveHost();
  if (!h) return null;
  return h.url + '/download?path=' + encodeURIComponent(filePath) + '&token=' + encodeURIComponent(h.token);
}
```

### 4-c. 파일 뷰어 UI (`mobile/app/(tabs)/files.tsx`)

```tsx
// import 추가
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { apiGet, downloadUrl, imageDataUri, requestNewSession, type Session } from '@/lib/hub';
```

```ts
// FileView 인터페이스에 path 추가
interface FileView {
  name: string;
  path: string;        // ← 추가
  kind: Kind;
  content?: string;
  truncated?: boolean;
  uri?: string | null;
  imgError?: string;
}
```

```ts
// open() 안의 setFile(...) 4곳 모두 path: e.path 추가. 예:
setFile({ name: e.name, path: e.path, kind: 'image', uri: res.uri, imgError: res.error });
setFile({ name: e.name, path: e.path, kind: 'pdf' });
setFile({ name: e.name, path: e.path, kind: ext === '.md' ? 'md' : 'text', content: r.content, truncated: r.truncated });
// catch 블록:
setFile({ name: e.name, path: e.path, kind: 'text', content: t('readFail') + String(err) });
```

```ts
// 다운로드 핸들러 (컴포넌트 안)
async function downloadFile() {
  if (!file) return;
  try {
    const u = await downloadUrl(file.path);
    if (!u) { Alert.alert(t('downloadFail')); return; }
    await Linking.openURL(u);   // 시스템 브라우저가 다운로드 → 폰 Downloads 폴더
  } catch (err) {
    Alert.alert(t('downloadFail'), String(err));
  }
}
```

```tsx
// 뷰어 상단 바: 제목 옆에 다운로드 버튼 추가
<Pressable onPress={() => setFile(null)} hitSlop={12} style={styles.closeBtn}><Text style={styles.link}>← {t('close')}</Text></Pressable>
<Text style={[styles.viewerTitle, !dark && styles.viewerTitleLight]} numberOfLines={1}>{file.name}</Text>
<Pressable onPress={downloadFile} hitSlop={12} style={styles.dlBtn}><Text style={styles.link}>⬇ {t('download')}</Text></Pressable>
```

```ts
// 스타일 추가
dlBtn: { paddingVertical: 4, paddingLeft: 8 },
```

### 4-d. i18n 라벨 (`mobile/lib/i18n.ts`)

```ts
// EN
download: 'Download', downloadStarted: 'Download started in browser', downloadFail: 'Could not start download',
// KO
download: '다운로드', downloadStarted: '브라우저에서 다운로드를 시작했어요', downloadFail: '다운로드를 시작할 수 없어요',
```

**검증 결과(구버전에서 실측):** 토큰 없이 401 / 쿼리 토큰 200+attachment / 한글 파일명 `filename*` 정상 / 디렉터리 400 — 모두 통과.

---

## 적용 후 반영 방법 (VibeLink 기준)
- **1·2·3-a·4-a** = hub(서버/PWA) 쪽 → **hub 재시작**으로 반영 (앱 빌드 불필요).
- **3-b·4-b·4-c·4-d** = 모바일 앱 JS → 새 네이티브 모듈 없으니 **OTA(`eas update`)** 또는 재빌드로 반영.

## 참고 (이 프로젝트 코드와 무관, 별도)
- **완료 알림 소리**: `~/.claude/settings.json`에 `preferredNotifChannel: "notifications_disabled"` + Stop hook(완료 시 1회 소리)를 넣어 "명령마다 울리던 알림"을 "완료 때만"으로 바꿨음. Claude Code 설정이라 프로젝트와 무관.
