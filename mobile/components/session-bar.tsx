import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  listSessions, closeSession, getActiveSessionId, setActiveSessionId,
  onSessionChange, onHostChange, type Session,
} from '@/lib/hub';
import { color, radius } from '@/lib/theme';

export function SessionBar({ onActive, showNew, onNew }: {
  onActive: (s: Session | null) => void;
  showNew?: boolean;
  onNew?: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(getActiveSessionId());

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
    onActive(id ? (list.find(s => s.id === id) ?? null) : null);
  }, [onActive]);

  // 세션/호스트 변경 + 화면 포커스 시 갱신
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  useEffect(() => {
    const offS = onSessionChange(() => { setActiveId(getActiveSessionId()); refresh(); });
    const offH = onHostChange(() => refresh());
    return () => { offS(); offH(); };
  }, [refresh]);

  function pick(s: Session) { setActiveSessionId(s.id); setActiveId(s.id); onActive(s); }

  function remove(s: Session) {
    Alert.alert('세션 종료', s.label + ' 세션을 종료할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '종료', style: 'destructive', onPress: async () => { try { await closeSession(s.id); } catch {} refresh(); } },
    ]);
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      style={styles.bar} contentContainerStyle={{ gap: 6, paddingHorizontal: 8, alignItems: 'center' }}>
      {sessions.map(s => {
        const on = s.id === activeId;
        return (
          <Pressable key={s.id} onPress={() => pick(s)} style={[styles.chip, on && styles.active]}>
            <Text style={[styles.txt, on && styles.txtOn]} numberOfLines={1}>{s.label}</Text>
            <Pressable onPress={() => remove(s)} hitSlop={8} style={styles.x}>
              <Text style={[styles.xTxt, on && styles.txtOn]}>×</Text>
            </Pressable>
          </Pressable>
        );
      })}
      {sessions.length === 0 ? <Text style={styles.empty}>실행 중인 세션 없음</Text> : null}
      {showNew ? (
        <Pressable onPress={() => onNew?.()} style={styles.plus}><Text style={styles.plusTxt}>＋</Text></Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { maxHeight: 48, backgroundColor: color.surfaceSoft, borderBottomWidth: 1, borderBottomColor: color.hairline },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingLeft: 12, paddingRight: 8, backgroundColor: color.surfaceCard, borderRadius: radius.pill, borderWidth: 1, borderColor: color.hairline },
  active: { backgroundColor: color.primary, borderColor: 'transparent' },
  txt: { color: color.muted, fontSize: 13, maxWidth: 150 },
  txtOn: { color: color.onPrimary },
  x: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  xTxt: { color: color.mutedSoft, fontSize: 16, lineHeight: 18 },
  plus: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: color.surfaceCard, borderRadius: radius.pill, borderWidth: 1, borderColor: color.hairline },
  plusTxt: { color: color.ink, fontSize: 16 },
  empty: { color: color.mutedSoft, fontSize: 12, padding: 10 },
});
