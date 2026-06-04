import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { listHosts, getActiveHost, setActiveHost, removeHost, type Host } from '@/lib/hub';
import { notificationsAvailable } from '@/lib/notify';
import { color, radius, font } from '@/lib/theme';

export default function Settings() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listHosts().then(setHosts);
    getActiveHost().then(h => setActiveId(h?.id ?? null));
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  async function pick(id: string) { await setActiveHost(id); setActiveId(id); }
  async function remove(id: string) { await removeHost(id); refresh(); }

  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={styles.section}>연결된 PC (호스트)</Text>
      {hosts.length === 0 ? <Text style={styles.empty}>없음</Text> : null}
      {hosts.map(h => (
        <View key={h.id} style={[styles.card, h.id === activeId && styles.cardActive]}>
          <Pressable style={styles.cardMain} onPress={() => pick(h.id)}>
            <Text style={styles.hLabel}>{h.id === activeId ? '● ' : '○ '}{h.label}</Text>
            <Text selectable style={styles.hUrl} numberOfLines={1}>{h.url}</Text>
          </Pressable>
          <Pressable onPress={() => remove(h.id)} hitSlop={10}><Text style={styles.del}>삭제</Text></Pressable>
        </View>
      ))}
      <Pressable style={styles.add} onPress={() => router.push('/')}>
        <Text style={styles.addTxt}>＋ PC 추가 (QR 스캔)</Text>
      </Pressable>
      <View style={styles.card}>
        <Text style={styles.label}>완료 알림</Text>
        <Text style={styles.value}>{notificationsAvailable ? '사용 가능' : 'Expo Go에서는 꺼짐 (dev build 필요)'}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  section: { color: color.muted, fontSize: 13, fontFamily: font.bodySemibold },
  empty: { color: color.mutedSoft, fontSize: 13 },
  card: { backgroundColor: color.surfaceCard, borderRadius: radius.lg, borderCurve: 'continuous', padding: 14, gap: 6, flexDirection: 'row', alignItems: 'center' },
  cardActive: { borderWidth: 1, borderColor: color.primary },
  cardMain: { flex: 1, gap: 4 },
  hLabel: { color: color.ink, fontSize: 15, fontFamily: font.bodyMedium },
  hUrl: { color: color.mutedSoft, fontSize: 12 },
  del: { color: color.error, fontSize: 14 },
  add: { backgroundColor: color.primary, borderRadius: radius.md, borderCurve: 'continuous', padding: 14, alignItems: 'center' },
  addTxt: { color: color.onPrimary, fontSize: 15, fontFamily: font.bodySemibold },
  label: { color: color.muted, fontSize: 12 },
  value: { color: color.ink, fontSize: 15 },
});
