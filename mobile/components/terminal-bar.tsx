import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  listSessions, createTerminal, closeTerminal,
  getActiveSessionId, getActiveTerminalId, setActiveTerminalId,
  onSessionChange, onTerminalChange, onHostChange, claudeTerminalId,
  getHubInfo,
  type TerminalInfo, type Session,
} from '@/lib/hub';
import { usePrefs, type Palette } from '@/lib/prefs';
import { t } from '@/lib/i18n';

// 새 터미널 picker 선택지: 에이전트(셸/Claude/opencode/codex/grok/antigravity) × 환경.
const AGENTS: [string, string][] = [['shell', 'Shell'], ['claude', 'Claude'], ['opencode', 'opencode'], ['codex', 'codex'], ['grok', 'Grok'], ['antigravity', 'Antigravity']];
const ENVS: [string, string][] = [['powershell', 'PowerShell'], ['cmd', 'cmd'], ['gitbash', 'Git Bash'], ['wsl', 'WSL'], ['zsh', 'zsh'], ['bash', 'bash'], ['sh', 'sh']];
const DEFAULT_ENVS = ENVS.map(([k]) => k);

// 활성 세션의 터미널 줄(2단 바의 아래단). claude(고정) + 셸 터미널들 + ＋.
export function TerminalBar() {
  const { c } = usePrefs();
  const styles = makeStyles(c);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeTid, setActiveTid] = useState<string | null>(getActiveTerminalId());
  const [adding, setAdding] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pAgent, setPAgent] = useState('shell');
  const [pEnv, setPEnv] = useState('powershell');
  const [envChoices, setEnvChoices] = useState<string[]>(DEFAULT_ENVS);

  const refreshEnvChoices = useCallback(async () => {
    const info = await getHubInfo();
    const next = info?.envs?.length ? info.envs : DEFAULT_ENVS;
    setEnvChoices(next);
    setPEnv(cur => next.includes(cur) ? cur : (info?.defaultEnv && next.includes(info.defaultEnv) ? info.defaultEnv : next[0] ?? 'powershell'));
  }, []);

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
    refreshEnvChoices();
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh, refreshEnvChoices]));

  useEffect(() => {
    const offT = onTerminalChange(() => setActiveTid(getActiveTerminalId()));
    const offS = onSessionChange(refresh);
    const offH = onHostChange(() => { refreshEnvChoices(); refresh(); });
    return () => { offT(); offS(); offH(); };
  }, [refresh, refreshEnvChoices]);

  async function addTerminal() {
    const sid = getActiveSessionId();
    if (!sid || adding) return;
    setAdding(true);
    setPicker(false);
    const tid = await createTerminal(sid, { agent: pAgent, env: pEnv });
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
        <Pressable onPress={() => setPicker(true)} style={[styles.plus, { backgroundColor: c.surfaceCard, borderColor: c.hairline }]} hitSlop={6}>
          <Text style={[styles.plusTxt, { color: c.primary }]}>＋</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={picker} transparent animationType="fade" onRequestClose={() => setPicker(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{t('newTerminal')}</Text>

            <Text style={styles.sheetLabel}>{t('agentLabel')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segScroll} contentContainerStyle={styles.segScrollContent}>
              {AGENTS.map(([k, lbl]) => {
                const on = pAgent === k;
                return (
                  <Pressable key={k} onPress={() => setPAgent(k)} style={[styles.segScrollItem, on && { backgroundColor: c.primary }]}>
                    <Text style={[styles.segTxt, { color: on ? c.onPrimary : c.body }]}>{k === 'shell' ? t('shell') : lbl}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.sheetLabel}>{t('environment')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segScroll} contentContainerStyle={styles.segScrollContent}>
              {ENVS.filter(([k]) => envChoices.includes(k)).map(([k, lbl]) => {
                const on = pEnv === k;
                return (
                  <Pressable key={k} onPress={() => setPEnv(k)} style={[styles.segScrollItem, on && { backgroundColor: c.primary }]}>
                    <Text style={[styles.segTxt, { color: on ? c.onPrimary : c.body }]}>{lbl}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.sheetActions}>
              <Pressable onPress={() => setPicker(false)} style={[styles.actBtn, { backgroundColor: c.surfaceCard, borderColor: c.hairline, borderWidth: 1 }]}>
                <Text style={[styles.actTxt, { color: c.body }]}>{t('cancel')}</Text>
              </Pressable>
              <Pressable onPress={addTerminal} disabled={adding} style={[styles.actBtn, { backgroundColor: c.primary, opacity: adding ? 0.6 : 1 }]}>
                <Text style={[styles.actTxt, { color: c.onPrimary }]}>{t('add')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.canvas, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 28, gap: 8 },
  sheetTitle: { color: c.body, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sheetLabel: { color: c.mutedSoft, fontSize: 12, marginTop: 6 },
  segWrap: { flexDirection: 'row', gap: 6, backgroundColor: c.surfaceCard, borderRadius: 10, padding: 4 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 7, alignItems: 'center' },
  segScroll: { flexDirection: 'row', backgroundColor: c.surfaceCard, borderRadius: 10, padding: 4 },
  segScrollContent: { flexDirection: 'row', gap: 6 },
  segScrollItem: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 7, alignItems: 'center', minWidth: 70 },
  segTxt: { fontSize: 13, fontWeight: '600' },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  actTxt: { fontSize: 15, fontWeight: '700' },
});
