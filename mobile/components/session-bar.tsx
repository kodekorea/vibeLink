import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  listSessions, closeSession, getActiveSessionId, setActiveSessionId,
  onSessionChange, onHostChange, type Session,
} from '@/lib/hub';
import { usePrefs, type Palette } from '@/lib/prefs';
import { t } from '@/lib/i18n';

export function SessionBar({ onActive, showNew, onNew }: {
  onActive: (s: Session | null) => void;
  showNew?: boolean;
  onNew?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { c } = usePrefs();
  const styles = makeStyles(c);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(getActiveSessionId());
  const lastActive = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    let list: Session[] = [];
    try { list = await listSessions(); } catch { list = []; }
    setSessions(list);
    let id = getActiveSessionId();
    if (!id || !list.find(s => s.id === id)) {
      id = list[0]?.id ?? null;
      setActiveSessionId(id); // emits
    }
    setActiveId(id);
    // 활성 세션이 실제로 바뀐 경우에만 부모 재로드(폴링마다 재로드 방지)
    if (id !== lastActive.current) {
      lastActive.current = id;
      onActive(id ? (list.find(s => s.id === id) ?? null) : null);
    }
  }, [onActive]);

  // 포커스 동안 2초마다 폴링 → 다른 곳(터미널 WebView)에서 만든/지운 세션이 바로 반영됨
  useFocusEffect(useCallback(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]));

  useEffect(() => {
    const offS = onSessionChange(() => { setActiveId(getActiveSessionId()); refresh(); });
    const offH = onHostChange(() => { lastActive.current = undefined; refresh(); });
    return () => { offS(); offH(); };
  }, [refresh]);

  function pick(s: Session) { setActiveSessionId(s.id); setActiveId(s.id); lastActive.current = s.id; onActive(s); }

  function remove(s: Session) {
    Alert.alert(t('endSession'), t('endSessionQ')(s.label), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('end'), style: 'destructive', onPress: async () => { try { await closeSession(s.id); } catch { /* */ } refresh(); } },
    ]);
  }

  return (
    // 상단 네브바: 크림이 상태바까지 꽉 차고(paddingTop=insets), 칩 행은 그 아래 고정 높이.
    <View style={[styles.nav, { paddingTop: insets.top }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.row}
        contentContainerStyle={styles.rowContent}>
        {sessions.map(s => {
          const on = s.id === activeId;
          // 색을 inline으로 강제 — 리마운트/테마 전환에도 항상 대비가 보장됨.
          const tabBg = on ? c.primary : c.surfaceCard;
          const txtColor = on ? c.onPrimary : c.bodyStrong;
          return (
            <Pressable key={s.id} onPress={() => pick(s)} style={[styles.tab, { backgroundColor: tabBg, borderColor: on ? 'transparent' : c.hairline }]}>
              <Text style={[styles.txt, { color: txtColor, fontWeight: on ? '700' : '600' }]} numberOfLines={1}>{s.label}</Text>
              <Pressable onPress={() => remove(s)} hitSlop={10} style={styles.x}>
                <Text style={[styles.xTxt, { color: on ? c.onPrimary : c.mutedSoft }]}>×</Text>
              </Pressable>
            </Pressable>
          );
        })}
        {sessions.length === 0 ? <Text style={styles.empty}>{t('noSession')}</Text> : null}
        {showNew ? (
          <Pressable onPress={() => onNew?.()} style={styles.plus} hitSlop={6}><Text style={styles.plusTxt}>＋</Text></Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  nav: { backgroundColor: c.surfaceSoft, borderBottomWidth: 1, borderBottomColor: c.hairline },
  row: { height: 48 },
  rowContent: { gap: 6, paddingHorizontal: 8, alignItems: 'center' },
  // 알약 탭. 활성=코랄 채움(흰 글자), 비활성=카드색(진한 글자) — 색은 렌더 시 inline으로 강제.
  tab: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, minWidth: 90, maxWidth: 200, paddingLeft: 14, paddingRight: 6, borderRadius: 18, borderWidth: 1 },
  // 시스템 폰트 + fontWeight (커스텀 폰트 미로드 시 안드로이드 투명글자 방지)
  txt: { flexShrink: 1, fontSize: 13 },
  x: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  xTxt: { fontSize: 16, lineHeight: 17 },
  plus: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceCard, borderWidth: 1, borderColor: c.hairline, marginLeft: 2 },
  plusTxt: { color: c.primary, fontSize: 20, lineHeight: 22 },
  empty: { color: c.muted, fontSize: 13, paddingHorizontal: 8 },
});
