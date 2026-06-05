import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { apiGet, requestNewSession, type Session } from '@/lib/hub';
import { SessionBar } from '@/components/session-bar';
import { font } from '@/lib/theme';
import { usePrefs, type Palette } from '@/lib/prefs';
import { t } from '@/lib/i18n';

interface Change { file: string; kind: 'edit' | 'write' | 'multiedit'; edits?: { old: string; new: string }[]; content?: string; }

function base(p: string): string {
  const m = p.split(/[\\/]/).filter(Boolean);
  return m[m.length - 1] || p;
}

export default function Changes() {
  const { c } = usePrefs();
  const styles = makeStyles(c);
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
      setError(t('loadFail'));
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
          <Pressable onPress={() => setSel(null)} hitSlop={10}><Text style={styles.link}>{t('list')}</Text></Pressable>
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
      <SessionBar
        showNew
        onNew={() => { requestNewSession(); router.navigate('/terminal'); }}
        onActive={(s: Session | null) => { if (s) load(s.cwd); else { setChanges([]); } }} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.primary} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.err}>{error}</Text></View>
      ) : changes.length === 0 ? (
        <View style={styles.center}><Text style={styles.empty}>{t('noChanges')}</Text></View>
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

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: c.error, padding: 24, textAlign: 'center' },
  empty: { color: c.muted, padding: 24, textAlign: 'center' },
  viewerRoot: { flex: 1, backgroundColor: c.surfaceDark },
  bar2: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: c.surfaceDarkElevated },
  viewerTitle: { color: c.onDark, fontSize: 14, flex: 1 },
  link: { color: c.primary, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.hairline },
  kind: { color: c.primary, fontSize: 16, width: 20, textAlign: 'center' },
  fname: { color: c.ink, fontSize: 15, fontFamily: font.bodyMedium },
  fdir: { color: c.mutedSoft, fontSize: 11 },
  code: { fontSize: 12, fontFamily: font.code },
  add: { color: c.success },
  del: { color: c.error },
});
