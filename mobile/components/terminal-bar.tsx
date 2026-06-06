import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  listSessions, createTerminal, closeTerminal,
  getActiveSessionId, getActiveTerminalId, setActiveTerminalId,
  onSessionChange, onTerminalChange, onHostChange, claudeTerminalId,
  type TerminalInfo, type Session,
} from '@/lib/hub';
import { usePrefs, type Palette } from '@/lib/prefs';

// 활성 세션의 터미널 줄(2단 바의 아래단). claude(고정) + 셸 터미널들 + ＋.
export function TerminalBar() {
  const { c } = usePrefs();
  const styles = makeStyles(c);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeTid, setActiveTid] = useState<string | null>(getActiveTerminalId());
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    const sid = getActiveSessionId();
    if (!sid) { setTerminals([]); return; }
    let list: Session[] = [];
    try { list = await listSessions(); } catch { list = []; }
    const sess = list.find(s => s.id === sid);
    const terms = sess?.terminals ?? [];
    setTerminals(terms);
    // 활성 터미널이 사라졌으면 그 세션의 claude로 복귀
    const cur = getActiveTerminalId();
    if (sess && (!cur || !terms.find(x => x.id === cur))) {
      setActiveTerminalId(claudeTerminalId(sess));
    }
    setActiveTid(getActiveTerminalId());
  }, []);

  useFocusEffect(useCallback(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]));

  useEffect(() => {
    const offT = onTerminalChange(() => setActiveTid(getActiveTerminalId()));
    const offS = onSessionChange(refresh);
    const offH = onHostChange(refresh);
    return () => { offT(); offS(); offH(); };
  }, [refresh]);

  async function addShell() {
    const sid = getActiveSessionId();
    if (!sid || adding) return;
    setAdding(true);
    const tid = await createTerminal(sid);
    if (tid) setActiveTerminalId(tid);
    await refresh();
    setAdding(false);
  }

  async function remove(term: TerminalInfo) {
    if (term.kind === 'agent') return;
    await closeTerminal(term.id);
    refresh();
  }

  if (!getActiveSessionId()) return null;

  return (
    <View style={styles.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {terminals.map(term => {
          const on = term.id === activeTid;
          const isClaude = term.kind === 'agent';
          return (
            <Pressable key={term.id} onPress={() => setActiveTerminalId(term.id)}
              style={[styles.pill, { backgroundColor: on ? c.primary : c.surfaceCard, borderColor: on ? 'transparent' : c.hairline }]}>
              <Text style={[styles.txt, { color: on ? c.onPrimary : c.body }]} numberOfLines={1}>
                {isClaude ? '✦ ' : ''}{term.label}
              </Text>
              {!isClaude ? (
                <Pressable onPress={() => remove(term)} hitSlop={8} style={styles.x}>
                  <Text style={[styles.xTxt, { color: on ? c.onPrimary : c.mutedSoft }]}>×</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
        <Pressable onPress={addShell} style={[styles.plus, { backgroundColor: c.surfaceCard, borderColor: c.hairline }]} hitSlop={6}>
          <Text style={[styles.plusTxt, { color: c.primary }]}>＋</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  bar: { backgroundColor: c.canvas, borderBottomWidth: 1, borderBottomColor: c.hairline },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 30, minWidth: 64, maxWidth: 160, paddingLeft: 12, paddingRight: 4, borderRadius: 15, borderWidth: 1 },
  txt: { flexShrink: 1, fontSize: 12, fontWeight: '600' },
  x: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  xTxt: { fontSize: 15, lineHeight: 16 },
  plus: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  plusTxt: { fontSize: 18, lineHeight: 20 },
});
