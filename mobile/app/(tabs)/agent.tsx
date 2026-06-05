import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { apiGet, requestNewSession, type Session } from '@/lib/hub';
import { SessionBar } from '@/components/session-bar';
import { radius, font } from '@/lib/theme';
import { usePrefs, type Palette } from '@/lib/prefs';
import { t } from '@/lib/i18n';

interface Ev { kind: string; text?: string; tool?: string; file?: string; isError?: boolean; }

function base(p?: string): string {
  if (!p) return '';
  const m = p.split(/[\\/]/).filter(Boolean);
  return m[m.length - 1] || p;
}

export default function Agent() {
  const { c } = usePrefs();
  const styles = makeStyles(c);
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const listRef = useRef<FlatList<Ev>>(null);

  function scrollToBottom() {
    try { listRef.current?.scrollToEnd({ animated: true }); } catch (e) { /* */ }
  }

  async function load(p: string) {
    setLoading(true);
    setError('');
    try {
      const r = await apiGet<{ events: Ev[] }>('/agent/log?path=' + encodeURIComponent(p));
      setEvents(r.events);
      setTimeout(scrollToBottom, 120);
    } catch (e) {
      setError(t('loadSessionFail'));
      setEvents([]);
    }
    setLoading(false);
  }

  function renderItem({ item }: { item: Ev }) {
    if (item.kind === 'user') {
      return <View style={[styles.bubble, styles.user]}><Text selectable style={styles.userTxt}>{item.text}</Text></View>;
    }
    if (item.kind === 'assistant') {
      return <View style={[styles.bubble, styles.asst]}><Text selectable style={styles.asstTxt}>{item.text}</Text></View>;
    }
    if (item.kind === 'thinking') {
      return <Text style={styles.think} numberOfLines={3}>💭 {item.text}</Text>;
    }
    if (item.kind === 'tool') {
      return <Text style={styles.tool}>🔧 {item.tool}{item.file ? ' · ' + base(item.file) : ''}</Text>;
    }
    if (item.kind === 'tool_result') {
      return <Text style={[styles.result, item.isError ? styles.resultErr : null]} numberOfLines={2}>↳ {item.text}</Text>;
    }
    return null;
  }

  return (
    <View style={styles.root}>
      <SessionBar
        showNew
        onNew={() => { requestNewSession(); router.navigate('/terminal'); }}
        onActive={(s: Session | null) => { if (s) { setPath(s.cwd); load(s.cwd); } else { setPath(null); setEvents([]); } }} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.primary} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.err}>{error}</Text></View>
      ) : (
        <>
          <FlatList
            ref={listRef}
            data={events}
            keyExtractor={(_, i) => String(i)}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 12, gap: 8 }}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={() => path && load(path)} tintColor={c.muted} />}
          />
          {events.length > 0 ? (
            <Pressable style={styles.fab} onPress={scrollToBottom} hitSlop={8}>
              <Text style={styles.fabTxt}>⤓</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: c.error, padding: 24, textAlign: 'center' },
  bubble: { borderRadius: radius.lg, borderCurve: 'continuous', padding: 12, maxWidth: '92%' },
  user: { backgroundColor: c.primary, alignSelf: 'flex-end' },
  userTxt: { color: c.onPrimary, fontSize: 14, fontFamily: font.body },
  asst: { backgroundColor: c.surfaceCard, alignSelf: 'flex-start' },
  asstTxt: { color: c.ink, fontSize: 14, fontFamily: font.body },
  think: { color: c.mutedSoft, fontSize: 12, fontStyle: 'italic', paddingHorizontal: 4 },
  tool: { color: c.muted, fontSize: 12, paddingHorizontal: 4 },
  result: { color: c.mutedSoft, fontSize: 11, paddingHorizontal: 8, fontFamily: font.code },
  resultErr: { color: c.error },
  fab: { position: 'absolute', right: 16, bottom: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' },
  fabTxt: { color: c.onPrimary, fontSize: 22, lineHeight: 26 },
});
