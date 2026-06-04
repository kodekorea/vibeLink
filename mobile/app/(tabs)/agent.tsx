import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { apiGet } from '@/lib/hub';
import { ProjectBar } from '@/components/project-bar';

interface Ev { kind: string; text?: string; tool?: string; file?: string; isError?: boolean; }

function base(p?: string): string {
  if (!p) return '';
  const m = p.split(/[\\/]/).filter(Boolean);
  return m[m.length - 1] || p;
}

export default function Agent() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [path, setPath] = useState<string | null>(null);

  async function load(p: string) {
    setLoading(true);
    setError('');
    try {
      const r = await apiGet<{ events: Ev[] }>('/agent/log?path=' + encodeURIComponent(p));
      setEvents(r.events);
    } catch (e) {
      setError('세션을 불러오지 못했어요 (claude 세션이 있어야 함)');
      setEvents([]);
    }
    setLoading(false);
  }

  function onProject(p: string) { setPath(p); load(p); }

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
      <ProjectBar onChange={onProject} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#fff" /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.err}>{error}</Text></View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => path && load(path)} tintColor="#fff" />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: '#f87171', padding: 24, textAlign: 'center' },
  bubble: { borderRadius: 12, borderCurve: 'continuous', padding: 12, maxWidth: '92%' },
  user: { backgroundColor: '#1e3a8a', alignSelf: 'flex-end' },
  userTxt: { color: '#fff', fontSize: 14 },
  asst: { backgroundColor: '#1a1a1a', alignSelf: 'flex-start' },
  asstTxt: { color: '#e5e5e5', fontSize: 14 },
  think: { color: '#666', fontSize: 12, fontStyle: 'italic', paddingHorizontal: 4 },
  tool: { color: '#7aa2ff', fontSize: 12, paddingHorizontal: 4 },
  result: { color: '#777', fontSize: 11, paddingHorizontal: 8, fontFamily: 'monospace' },
  resultErr: { color: '#f87171' },
});
