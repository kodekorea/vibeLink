import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiGet } from '@/lib/hub';
import { ProjectBar } from '@/components/project-bar';

interface Change { file: string; kind: 'edit' | 'write' | 'multiedit'; edits?: { old: string; new: string }[]; content?: string; }

function base(p: string): string {
  const m = p.split(/[\\/]/).filter(Boolean);
  return m[m.length - 1] || p;
}

export default function Changes() {
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Change | null>(null);

  async function load(p: string) {
    setLoading(true);
    setError('');
    setSel(null);
    try {
      const r = await apiGet<{ changes: Change[] }>('/agent/changes?path=' + encodeURIComponent(p));
      setChanges(r.changes);
    } catch (e) {
      setError('세션을 불러오지 못했어요');
      setChanges([]);
    }
    setLoading(false);
  }

  if (sel) {
    const lines: { t: 'add' | 'del'; s: string }[] = [];
    if (sel.kind === 'write') {
      (sel.content || '').split('\n').forEach(s => lines.push({ t: 'add', s }));
    } else {
      (sel.edits || []).forEach(e => {
        e.old.split('\n').forEach(s => lines.push({ t: 'del', s }));
        e.new.split('\n').forEach(s => lines.push({ t: 'add', s }));
      });
    }
    return (
      <View style={styles.root}>
        <View style={styles.bar2}>
          <Pressable onPress={() => setSel(null)} hitSlop={10}><Text style={styles.link}>← 목록</Text></Pressable>
          <Text style={styles.barTitle} numberOfLines={1}>{base(sel.file)}</Text>
        </View>
        <ScrollView style={styles.flex}>
          <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
            <View>
              {lines.map((ln, i) => (
                <Text key={i} style={[styles.code, ln.t === 'add' ? styles.add : styles.del]}>
                  {ln.t === 'add' ? '+ ' : '- '}{ln.s}
                </Text>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ProjectBar onChange={load} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#fff" /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.err}>{error}</Text></View>
      ) : changes.length === 0 ? (
        <View style={styles.center}><Text style={styles.empty}>이 세션에서 Claude가 바꾼 파일이 없어요</Text></View>
      ) : (
        <FlatList
          data={changes}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => setSel(item)}>
              <Text style={styles.kind}>{item.kind === 'write' ? '✎' : '±'}</Text>
              <View style={styles.flex}>
                <Text style={styles.fname} numberOfLines={1}>{base(item.file)}</Text>
                <Text style={styles.fdir} numberOfLines={1}>{item.file}</Text>
              </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: '#f87171', padding: 24, textAlign: 'center' },
  empty: { color: '#888', padding: 24, textAlign: 'center' },
  bar2: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#222' },
  barTitle: { color: '#aaa', fontSize: 14, flex: 1 },
  link: { color: '#7aa2ff', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  kind: { color: '#7aa2ff', fontSize: 16, width: 20, textAlign: 'center' },
  fname: { color: '#eee', fontSize: 15 },
  fdir: { color: '#666', fontSize: 11 },
  code: { fontSize: 12, fontFamily: 'monospace' },
  add: { color: '#86efac' },
  del: { color: '#fca5a5' },
});
