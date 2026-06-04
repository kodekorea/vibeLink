import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiGet } from '@/lib/hub';
import { ProjectBar } from '@/components/project-bar';
import { color, font } from '@/lib/theme';

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
      <View style={styles.viewerRoot}>
        <View style={styles.bar2}>
          <Pressable onPress={() => setSel(null)} hitSlop={10}><Text style={styles.link}>← 목록</Text></Pressable>
          <Text style={styles.viewerTitle} numberOfLines={1}>{base(sel.file)}</Text>
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
        <View style={styles.center}><ActivityIndicator color={color.primary} /></View>
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
  root: { flex: 1, backgroundColor: color.canvas },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: color.error, padding: 24, textAlign: 'center' },
  empty: { color: color.muted, padding: 24, textAlign: 'center' },
  viewerRoot: { flex: 1, backgroundColor: color.surfaceDark },
  bar2: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: color.surfaceDarkElevated },
  viewerTitle: { color: color.onDark, fontSize: 14, flex: 1 },
  link: { color: color.primary, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.hairline },
  kind: { color: color.primary, fontSize: 16, width: 20, textAlign: 'center' },
  fname: { color: color.ink, fontSize: 15, fontFamily: font.bodyMedium },
  fdir: { color: color.mutedSoft, fontSize: 11 },
  code: { fontSize: 12, fontFamily: font.code },
  add: { color: color.success },
  del: { color: color.error },
});
