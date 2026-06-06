import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { apiGet, requestNewSession, sessionAgent, listSessions, getActiveSessionId, type Session } from '@/lib/hub';
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

// 한 세션에 떠 있는 에이전트들(중복 제거). 셸은 제외. chat에서 전환용.
function agentsOf(s: Session): string[] {
  const ags = (s.terminals || []).filter(x => x.kind === 'agent' && x.agent).map(x => x.agent as string);
  const uniq = Array.from(new Set(ags));
  return uniq.length ? uniq : [sessionAgent(s)].filter(Boolean) as string[];
}

export default function Agent() {
  const { c } = usePrefs();
  const styles = makeStyles(c);
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const [agent, setAgent] = useState<string | undefined>(undefined);
  const [agents, setAgents] = useState<string[]>([]);
  const listRef = useRef<FlatList<Ev>>(null);

  function scrollToBottom() {
    try { listRef.current?.scrollToEnd({ animated: true }); } catch (e) { /* */ }
  }

  // 세션 새로고침: 활성 세션의 터미널(에이전트 목록)을 다시 받고 현재 기록을 reload.
  // (같은 세션에 에이전트 터미널을 새로 추가했을 때 칩 목록을 갱신)
  async function refreshSession() {
    const id = getActiveSessionId();
    if (!id) return;
    try {
      const s = (await listSessions()).find(x => x.id === id);
      if (s) setAgents(agentsOf(s));
    } catch (e) { /* */ }
    if (path) load(path, agent);
  }

  async function load(p: string, ag?: string) {
    setLoading(true);
    setError('');
    setUnsupported('');
    try {
      const q = '/agent/log?path=' + encodeURIComponent(p) + (ag ? '&agent=' + encodeURIComponent(ag) : '');
      const r = await apiGet<{ events: Ev[]; supported?: boolean }>(q);
      if (r.supported === false) {
        setUnsupported(t('agentNoHistory')(ag || 'agent'));
        setEvents([]);
      } else {
        setEvents(r.events);
        setTimeout(scrollToBottom, 120);
      }
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
        onActive={(s: Session | null) => { if (s) { const ag = sessionAgent(s); setPath(s.cwd); setAgents(agentsOf(s)); setAgent(ag); load(s.cwd, ag); } else { setPath(null); setAgent(undefined); setAgents([]); setEvents([]); setUnsupported(''); } }} />
      {path && agents.length >= 1 ? (
        <View style={styles.switcher}>
          {agents.map(a => {
            const on = a === agent;
            return (
              <Pressable key={a} onPress={() => { setAgent(a); if (path) load(path, a); }} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{a === 'claude' ? 'Claude' : a}</Text>
              </Pressable>
            );
          })}
          <View style={{ flex: 1 }} />
          <Pressable onPress={refreshSession} hitSlop={8} style={styles.refresh}><Text style={styles.refreshTxt}>↻</Text></Pressable>
        </View>
      ) : null}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.primary} /></View>
      ) : unsupported ? (
        <View style={styles.center}><Text style={styles.empty}>{unsupported}</Text></View>
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
            refreshControl={<RefreshControl refreshing={loading} onRefresh={() => path && load(path, agent)} tintColor={c.muted} />}
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
  switcher: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: c.surfaceSoft, borderBottomWidth: 1, borderBottomColor: c.hairline },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: c.surfaceCard, borderWidth: 1, borderColor: c.hairline },
  chipOn: { backgroundColor: c.primary, borderColor: 'transparent' },
  chipTxt: { color: c.body, fontSize: 13, fontFamily: font.bodyMedium },
  chipTxtOn: { color: c.onPrimary, fontFamily: font.bodySemibold },
  refresh: { width: 30, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceCard, borderWidth: 1, borderColor: c.hairline },
  refreshTxt: { color: c.primary, fontSize: 16, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: c.error, padding: 24, textAlign: 'center' },
  empty: { color: c.muted, padding: 24, textAlign: 'center' },
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
