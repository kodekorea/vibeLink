import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
import { apiGet, imageDataUri, type Session } from '@/lib/hub';
import { SessionBar } from '@/components/session-bar';
import { color, font } from '@/lib/theme';

interface Entry { name: string; path: string; dir: boolean; size: number; }

type Kind = 'image' | 'md' | 'text' | 'pdf';
interface FileView {
  name: string;
  kind: Kind;
  content?: string;
  truncated?: boolean;
  uri?: string | null;
  imgError?: string;
}

const IMG = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

// VS Code 류 — 소스 종류별 아이콘(이모지). 확장자/특수파일명 기준.
const ICON_BY_EXT: Record<string, string> = {
  '.ts': '🟦', '.tsx': '🟦', '.js': '🟨', '.jsx': '🟨', '.mjs': '🟨', '.cjs': '🟨',
  '.json': '🔧', '.html': '🌐', '.htm': '🌐', '.css': '🎨', '.scss': '🎨',
  '.py': '🐍', '.rb': '💎', '.go': '🐹', '.rs': '🦀', '.java': '☕', '.kt': '🟪',
  '.c': '🔵', '.h': '🔵', '.cpp': '🔵', '.cs': '🟩', '.php': '🐘', '.swift': '🕊️',
  '.sh': '🐚', '.bat': '🖥️', '.ps1': '🖥️', '.vbs': '🖥️',
  '.md': '📝', '.txt': '📄', '.log': '📜', '.csv': '📊', '.xml': '📰', '.yml': '⚙️', '.yaml': '⚙️',
  '.pdf': '📕', '.doc': '📘', '.docx': '📘', '.xls': '📗', '.xlsx': '📗', '.ppt': '📙', '.pptx': '📙',
  '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.gif': '🖼️', '.webp': '🖼️', '.bmp': '🖼️', '.svg': '🖼️',
  '.zip': '📦', '.tar': '📦', '.gz': '📦', '.7z': '📦', '.rar': '📦',
  '.mp3': '🎵', '.wav': '🎵', '.mp4': '🎬', '.mov': '🎬', '.mkv': '🎬',
  '.env': '🔑', '.gitignore': '🌳', '.lock': '🔒', '.exe': '⚡', '.dll': '⚙️',
};
const ICON_BY_NAME: Record<string, string> = {
  'package.json': '📦', 'package-lock.json': '🔒', 'tsconfig.json': '🟦', 'readme.md': '📖',
  '.gitignore': '🌳', '.env': '🔑', 'dockerfile': '🐳', 'license': '⚖️', 'makefile': '🔨',
};
function iconFor(name: string, dir: boolean): string {
  if (dir) return '📁';
  const low = name.toLowerCase();
  if (ICON_BY_NAME[low]) return ICON_BY_NAME[low];
  return ICON_BY_EXT[extOf(name)] || '📄';
}

function parentOf(p: string): string | null {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 2 ? p.slice(0, i) : null;
}

function fmtSize(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export default function Files() {
  const insets = useSafeAreaInsets();
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [file, setFile] = useState<FileView | null>(null);

  async function load(p: string | null) {
    setLoading(true);
    setError('');
    try {
      const r = await apiGet<{ cwd: string | null; entries: Entry[] }>('/files' + (p ? '?path=' + encodeURIComponent(p) : ''));
      setCwd(r.cwd);
      setEntries(r.entries);
    } catch (e) {
      setError('불러오기 실패: ' + String(e));
      setEntries([]);
    }
    setLoading(false);
  }

  useEffect(() => { load(null); }, []);

  async function open(e: Entry) {
    if (e.dir) { load(e.path); return; }
    const ext = extOf(e.name);
    setLoading(true);
    try {
      if (IMG.includes(ext)) {
        const res = await imageDataUri(e.path);
        setFile({ name: e.name, kind: 'image', uri: res.uri, imgError: res.error });
      } else if (ext === '.pdf') {
        setFile({ name: e.name, kind: 'pdf' });
      } else {
        const r = await apiGet<{ content: string; truncated: boolean; size: number }>('/file?path=' + encodeURIComponent(e.path));
        setFile({ name: e.name, kind: ext === '.md' ? 'md' : 'text', content: r.content, truncated: r.truncated });
      }
    } catch (err) {
      setFile({ name: e.name, kind: 'text', content: '읽기 실패: ' + String(err) });
    }
    setLoading(false);
  }

  if (file) {
    const dark = file.kind === 'image' || file.kind === 'text';
    return (
      <View style={[styles.viewerRoot, !dark && styles.viewerRootLight]}>
        <View style={[styles.viewerBar, { paddingTop: insets.top + 10 }, !dark && styles.viewerBarLight]}>
          <Pressable onPress={() => setFile(null)} hitSlop={12} style={styles.closeBtn}><Text style={styles.link}>← 닫기</Text></Pressable>
          <Text style={[styles.viewerTitle, !dark && styles.viewerTitleLight]} numberOfLines={1}>{file.name}</Text>
        </View>
        {file.kind === 'image' ? (
          file.uri ? (
            <ScrollView style={styles.flex} contentContainerStyle={styles.imageWrap} maximumZoomScale={4} minimumZoomScale={1}>
              <Image source={{ uri: file.uri }} style={styles.image} resizeMode="contain" />
            </ScrollView>
          ) : <View style={styles.center}><Text style={styles.err}>이미지를 불러올 수 없어요{file.imgError ? '\n(' + file.imgError + ')' : ''}</Text></View>
        ) : file.kind === 'md' ? (
          <ScrollView style={styles.flex} contentContainerStyle={{ padding: 16 }}>
            <Markdown style={mdStyles as any}>{file.content || ''}</Markdown>
            {file.truncated ? <Text style={styles.truncated}>… (잘림)</Text> : null}
          </ScrollView>
        ) : file.kind === 'pdf' ? (
          <View style={styles.center}><Text style={styles.pdfMsg}>PDF 미리보기는 아직 지원 안 해요.{'\n'}터미널에서 경로로 열어보세요.</Text></View>
        ) : (
          <ScrollView style={styles.flex} contentContainerStyle={{ padding: 12 }}>
            <ScrollView horizontal>
              <Text selectable style={styles.code}>{file.content}{file.truncated ? '\n\n… (잘림)' : ''}</Text>
            </ScrollView>
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SessionBar onActive={(s: Session | null) => load(s ? s.cwd : null)} />
      <View style={styles.bar}>
        {cwd ? (
          <Pressable onPress={() => load(parentOf(cwd))} hitSlop={10}><Text style={styles.link}>⬆ 상위</Text></Pressable>
        ) : (
          <Text style={styles.link}>드라이브</Text>
        )}
        <Text style={styles.barTitle} numberOfLines={1}>{cwd ?? ''}</Text>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={color.primary} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.err}>{error}</Text></View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.path}
          contentInsetAdjustmentBehavior="automatic"
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => open(item)}>
              <Text style={styles.rowName} numberOfLines={1}>{iconFor(item.name, item.dir)} {item.name}</Text>
              {!item.dir ? <Text style={styles.rowSize}>{fmtSize(item.size)}</Text> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.hairline },
  barTitle: { color: color.mutedSoft, fontSize: 12, flex: 1 },
  link: { color: color.primary, fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: color.error, fontSize: 14, padding: 24, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: color.hairline },
  rowName: { color: color.ink, fontSize: 15, flex: 1, fontFamily: font.bodyMedium },
  rowSize: { color: color.mutedSoft, fontSize: 12 },
  viewerRoot: { flex: 1, backgroundColor: color.surfaceDark },
  viewerBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: color.surfaceDarkElevated },
  closeBtn: { paddingVertical: 4, paddingRight: 4 },
  viewerTitle: { color: color.onDark, fontSize: 12, flex: 1 },
  code: { color: color.onDark, fontSize: 12, fontFamily: font.code },
  viewerRootLight: { backgroundColor: color.canvas },
  viewerBarLight: { backgroundColor: color.surfaceSoft },
  viewerTitleLight: { color: color.ink },
  imageWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  image: { width: 360, height: 360, maxWidth: '100%' },
  truncated: { color: color.mutedSoft, fontSize: 12, marginTop: 12 },
  pdfMsg: { color: color.muted, fontSize: 14, textAlign: 'center', lineHeight: 22, padding: 24 },
});

const mdStyles = {
  body: { color: color.body, fontFamily: font.body, fontSize: 15, lineHeight: 22 },
  heading1: { color: color.ink, fontFamily: font.display, fontSize: 26, marginTop: 8, marginBottom: 8 },
  heading2: { color: color.ink, fontFamily: font.display, fontSize: 22, marginTop: 8, marginBottom: 6 },
  heading3: { color: color.ink, fontFamily: font.bodySemibold, fontSize: 18, marginTop: 6, marginBottom: 4 },
  link: { color: color.primary },
  code_inline: { color: color.ink, backgroundColor: color.surfaceCard, fontFamily: font.code, fontSize: 13, paddingHorizontal: 4, borderRadius: 4 },
  code_block: { color: color.onDark, backgroundColor: color.surfaceDark, fontFamily: font.code, fontSize: 13, padding: 12, borderRadius: 8 },
  fence: { color: color.onDark, backgroundColor: color.surfaceDark, fontFamily: font.code, fontSize: 13, padding: 12, borderRadius: 8 },
  blockquote: { backgroundColor: color.surfaceCard, borderLeftColor: color.primary, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 4 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  hr: { backgroundColor: color.hairline, height: 1 },
} as const;
