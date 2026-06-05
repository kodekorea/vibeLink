import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  listSessions, closeSession, getActiveSessionId, setActiveSessionId,
  onSessionChange, onHostChange, type Session,
} from '@/lib/hub';
import { color, radius, font } from '@/lib/theme';

export function SessionBar({ onActive, showNew, onNew }: {
  onActive: (s: Session | null) => void;
  showNew?: boolean;
  onNew?: () => void;
}) {
  const insets = useSafeAreaInsets();
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
    Alert.alert('세션 종료', s.label + ' 세션을 종료할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '종료', style: 'destructive', onPress: async () => { try { await closeSession(s.id); } catch { /* */ } refresh(); } },
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
          return (
            <Pressable key={s.id} onPress={() => pick(s)} style={[styles.chip, on && styles.active]}>
              <Text style={[styles.txt, on && styles.txtOn]} numberOfLines={1}>{s.label}</Text>
              <Pressable onPress={() => remove(s)} hitSlop={10} style={[styles.x, on && styles.xOn]}>
                <Text style={[styles.xTxt, on && styles.txtOn]}>×</Text>
              </Pressable>
            </Pressable>
          );
        })}
        {sessions.length === 0 ? <Text style={styles.empty}>실행 중인 세션 없음 — 터미널 탭에서 ＋</Text> : null}
        {showNew ? (
          <Pressable onPress={() => onNew?.()} style={styles.plus} hitSlop={6}><Text style={styles.plusTxt}>＋</Text></Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { backgroundColor: color.canvas, borderBottomWidth: 1, borderBottomColor: color.hairline },
  row: { height: 52 },
  rowContent: { gap: 8, paddingHorizontal: 12, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingLeft: 14, paddingRight: 8, backgroundColor: color.surfaceCard, borderRadius: radius.pill, borderWidth: 1, borderColor: color.hairline },
  active: { backgroundColor: color.primary, borderColor: 'transparent' },
  txt: { color: color.bodyStrong, fontSize: 14, fontFamily: font.bodyMedium, maxWidth: 180 },
  txtOn: { color: color.onPrimary },
  x: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.06)' },
  xOn: { backgroundColor: 'rgba(255,255,255,0.22)' },
  xTxt: { color: color.muted, fontSize: 15, lineHeight: 16 },
  plus: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceCard, borderWidth: 1, borderColor: color.hairline },
  plusTxt: { color: color.primary, fontSize: 20, lineHeight: 22 },
  empty: { color: color.mutedSoft, fontSize: 13, paddingHorizontal: 6 },
});
