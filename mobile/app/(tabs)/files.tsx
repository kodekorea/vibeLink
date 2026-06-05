import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { apiGet, imageDataUri, requestNewSession, type Session } from '@/lib/hub';
import { SessionBar } from '@/components/session-bar';
import { font } from '@/lib/theme';
import { usePrefs, type Palette } from '@/lib/prefs';
import { t } from '@/lib/i18n';

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
  const { c } = usePrefs();
  const styles = makeStyles(c);
  const mdStyles = makeMdStyles(c);
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
      setError(t('browseFail') + String(e));
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
      setFile({ name: e.name, kind: 'text', content: t('readFail') + String(err) });
    }
    setLoading(false);
  }

  if (file) {
    // 이미지만 다크 배경(투명 이미지 표시용). 코드/텍스트/md/pdf는 앱 테마를 따른다.
    const dark = file.kind === 'image';
    return (
      <View style={[styles.viewerRoot, !dark && styles.viewerRootLight]}>
        <View style={[styles.viewerBar, { paddingTop: insets.top + 10 }, !dark && styles.viewerBarLight]}>
          <Pressable onPress={() => setFile(null)} hitSlop={12} style={styles.closeBtn}><Text style={styles.link}>← {t('close')}</Text></Pressable>
          <Text style={[styles.viewerTitle, !dark && styles.viewerTitleLight]} numberOfLines={1}>{file.name}</Text>
        </View>
        {file.kind === 'image' ? (
          file.uri ? (
            <ScrollView style={styles.flex} contentContainerStyle={styles.imageWrap} maximumZoomScale={4} minimumZoomScale={1}>
              <Image source={{ uri: file.uri }} style={styles.image} resizeMode="contain" />
            </ScrollView>
          ) : <View style={styles.center}><Text style={styles.err}>{t('imgFail')}{file.imgError ? '\n(' + file.imgError + ')' : ''}</Text></View>
        ) : file.kind === 'md' ? (
          <ScrollView style={styles.flex} contentContainerStyle={{ padding: 16 }}>
            <Markdown style={mdStyles as any}>{file.content || ''}</Markdown>
            {file.truncated ? <Text style={styles.truncated}>{t('truncated')}</Text> : null}
          </ScrollView>
        ) : file.kind === 'pdf' ? (
          <View style={styles.center}><Text style={styles.pdfMsg}>{t('pdfMsg')}</Text></View>
        ) : (
          <ScrollView style={styles.flex} contentContainerStyle={{ padding: 12 }}>
            <ScrollView horizontal>
              <Text selectable style={styles.code}>{file.content}{file.truncated ? '\n\n' + t('truncated') : ''}</Text>
            </ScrollView>
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SessionBar
        showNew
        onNew={() => { requestNewSession(); router.navigate('/terminal'); }}
        onActive={(s: Session | null) => load(s ? s.cwd : null)} />
      <View style={styles.bar}>
        {cwd ? (
          <Pressable onPress={() => load(parentOf(cwd))} hitSlop={10}><Text style={styles.link}>{t('up')}</Text></Pressable>
        ) : (
          <Text style={styles.link}>{t('drives')}</Text>
        )}
        <Text style={styles.barTitle} numberOfLines={1}>{cwd ?? ''}</Text>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.primary} /></View>
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

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.hairline },
  barTitle: { color: c.mutedSoft, fontSize: 12, flex: 1 },
  link: { color: c.primary, fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: c.error, fontSize: 14, padding: 24, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.hairline },
  rowName: { color: c.ink, fontSize: 15, flex: 1, fontFamily: font.bodyMedium },
  rowSize: { color: c.mutedSoft, fontSize: 12 },
  viewerRoot: { flex: 1, backgroundColor: c.surfaceDark },
  viewerBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: c.surfaceDarkElevated },
  closeBtn: { paddingVertical: 4, paddingRight: 4 },
  viewerTitle: { color: c.onDark, fontSize: 12, flex: 1 },
  code: { color: c.ink, fontSize: 12, fontFamily: font.code },
  viewerRootLight: { backgroundColor: c.canvas },
  viewerBarLight: { backgroundColor: c.surfaceSoft },
  viewerTitleLight: { color: c.ink },
  imageWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  image: { width: 360, height: 360, maxWidth: '100%' },
  truncated: { color: c.mutedSoft, fontSize: 12, marginTop: 12 },
  pdfMsg: { color: c.muted, fontSize: 14, textAlign: 'center', lineHeight: 22, padding: 24 },
});

const makeMdStyles = (c: Palette) => ({
  body: { color: c.body, fontFamily: font.body, fontSize: 15, lineHeight: 22 },
  heading1: { color: c.ink, fontFamily: font.display, fontSize: 26, marginTop: 8, marginBottom: 8 },
  heading2: { color: c.ink, fontFamily: font.display, fontSize: 22, marginTop: 8, marginBottom: 6 },
  heading3: { color: c.ink, fontFamily: font.bodySemibold, fontSize: 18, marginTop: 6, marginBottom: 4 },
  link: { color: c.primary },
  code_inline: { color: c.ink, backgroundColor: c.surfaceCard, fontFamily: font.code, fontSize: 13, paddingHorizontal: 4, borderRadius: 4 },
  code_block: { color: c.onDark, backgroundColor: c.surfaceDark, fontFamily: font.code, fontSize: 13, padding: 12, borderRadius: 8 },
  fence: { color: c.onDark, backgroundColor: c.surfaceDark, fontFamily: font.code, fontSize: 13, padding: 12, borderRadius: 8 },
  blockquote: { backgroundColor: c.surfaceCard, borderLeftColor: c.primary, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 4 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  hr: { backgroundColor: c.hairline, height: 1 },
} as const);
