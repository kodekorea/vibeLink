import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiGet } from '@/lib/hub';

interface Entry { name: string; path: string; dir: boolean; size: number; }
interface FileView { name: string; content: string; truncated: boolean; }

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
    setLoading(true);
    try {
      const r = await apiGet<{ content: string; truncated: boolean; size: number }>('/file?path=' + encodeURIComponent(e.path));
      setFile({ name: e.name, content: r.content, truncated: r.truncated });
    } catch (err) {
      setFile({ name: e.name, content: '읽기 실패: ' + String(err), truncated: false });
    }
    setLoading(false);
  }

  if (file) {
    return (
      <View style={styles.root}>
        <View style={styles.bar}>
          <Pressable onPress={() => setFile(null)} hitSlop={10}><Text style={styles.link}>← 닫기</Text></Pressable>
          <Text style={styles.barTitle} numberOfLines={1}>{file.name}</Text>
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={{ padding: 12 }} horizontal={false}>
          <ScrollView horizontal>
            <Text selectable style={styles.code}>{file.content}{file.truncated ? '\n\n… (잘림)' : ''}</Text>
          </ScrollView>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        {cwd ? (
          <Pressable onPress={() => load(parentOf(cwd))} hitSlop={10}><Text style={styles.link}>⬆ 상위</Text></Pressable>
        ) : (
          <Text style={styles.link}>드라이브</Text>
        )}
        <Text style={styles.barTitle} numberOfLines={1}>{cwd ?? ''}</Text>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#fff" /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.err}>{error}</Text></View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.path}
          contentInsetAdjustmentBehavior="automatic"
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => open(item)}>
              <Text style={styles.rowName} numberOfLines={1}>{item.dir ? '📁 ' : '📄 '}{item.name}</Text>
              {!item.dir ? <Text style={styles.rowSize}>{fmtSize(item.size)}</Text> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0b' },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#222' },
  barTitle: { color: '#888', fontSize: 12, flex: 1 },
  link: { color: '#7aa2ff', fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: '#f87171', fontSize: 14, padding: 24, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  rowName: { color: '#eee', fontSize: 15, flex: 1 },
  rowSize: { color: '#777', fontSize: 12 },
  code: { color: '#ddd', fontSize: 12, fontFamily: 'monospace' },
});
