import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listHosts, getActiveHost, setActiveHost, removeHost, getNotifyMinSec, setNotifyMinSec, type Host } from '@/lib/hub';
import { notificationsAvailable } from '@/lib/notify';
import { radius, font } from '@/lib/theme';
import { usePrefs, setTheme, setLang, type Palette, type ThemeName, type Lang } from '@/lib/prefs';
import { t } from '@/lib/i18n';

export default function Settings() {
  const insets = useSafeAreaInsets();
  const { c, theme, lang } = usePrefs();
  const styles = makeStyles(c);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [alarmSec, setAlarmSec] = useState<number | null>(null);

  const refresh = useCallback(() => {
    listHosts().then(setHosts);
    getActiveHost().then(h => setActiveId(h?.id ?? null));
    getNotifyMinSec().then(setAlarmSec).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  async function pick(id: string) { await setActiveHost(id); setActiveId(id); }
  async function remove(id: string) { await removeHost(id); refresh(); }
  async function setAlarm(sec: number) { setAlarmSec(sec); await setNotifyMinSec(sec); }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, gap: 16 }}>
      <Text style={styles.section}>{t('connectedPc')}</Text>
      {hosts.length === 0 ? <Text style={styles.empty}>{t('none')}</Text> : null}
      {hosts.map(h => (
        <View key={h.id} style={[styles.card, h.id === activeId && styles.cardActive]}>
          <Pressable style={styles.cardMain} onPress={() => pick(h.id)}>
            <Text style={styles.hLabel}>{h.id === activeId ? '● ' : '○ '}{h.label}</Text>
            <Text selectable style={styles.hUrl} numberOfLines={1}>{h.url}</Text>
          </Pressable>
          <Pressable onPress={() => remove(h.id)} hitSlop={10}><Text style={styles.del}>{t('delete')}</Text></Pressable>
        </View>
      ))}
      <Pressable style={styles.add} onPress={() => router.push('/')}>
        <Text style={styles.addTxt}>{t('addPc')}</Text>
      </Pressable>

      <Text style={styles.section}>{t('appearance')}</Text>
      <View style={styles.cardCol}>
        <Text style={styles.label}>{t('theme')}</Text>
        <View style={styles.seg}>
          {([['light', t('light')], ['dark', t('dark')]] as [ThemeName, string][]).map(([k, lbl]) => (
            <Pressable key={k} onPress={() => setTheme(k)} style={[styles.segItem, theme === k && styles.segItemOn]}>
              <Text style={[styles.segTxt, theme === k && styles.segTxtOn]}>{lbl}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.label, { marginTop: 6 }]}>{t('language')}</Text>
        <View style={styles.seg}>
          {([['en', 'English'], ['ko', '한국어']] as [Lang, string][]).map(([k, lbl]) => (
            <Pressable key={k} onPress={() => setLang(k)} style={[styles.segItem, lang === k && styles.segItemOn]}>
              <Text style={[styles.segTxt, lang === k && styles.segTxtOn]}>{lbl}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.cardCol}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.label}>{t('completionAlarm')}</Text>
          <Text style={styles.value}>{notificationsAvailable ? t('available') : t('expoGoOff')}</Text>
        </View>
        <Text style={[styles.label, { marginTop: 6 }]}>{t('alarmThreshold')}</Text>
        <View style={styles.seg}>
          {[5, 10, 15, 30].map(n => {
            const on = alarmSec === n;
            return (
              <Pressable key={n} onPress={() => setAlarm(n)} style={[styles.segItem, on && styles.segItemOn]}>
                <Text style={[styles.segTxt, on && styles.segTxtOn]}>{n}{lang === 'ko' ? '초' : 's'}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.empty}>{t('alarmThresholdHint')}</Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas },
  section: { color: c.muted, fontSize: 13, fontFamily: font.bodySemibold },
  empty: { color: c.mutedSoft, fontSize: 13 },
  card: { backgroundColor: c.surfaceCard, borderRadius: radius.lg, borderCurve: 'continuous', padding: 14, gap: 6, flexDirection: 'row', alignItems: 'center' },
  cardCol: { backgroundColor: c.surfaceCard, borderRadius: radius.lg, borderCurve: 'continuous', padding: 14, gap: 8 },
  cardActive: { borderWidth: 1, borderColor: c.primary },
  cardMain: { flex: 1, gap: 4 },
  hLabel: { color: c.ink, fontSize: 15, fontFamily: font.bodyMedium },
  hUrl: { color: c.mutedSoft, fontSize: 12 },
  del: { color: c.error, fontSize: 14 },
  add: { backgroundColor: c.primary, borderRadius: radius.md, borderCurve: 'continuous', padding: 14, alignItems: 'center' },
  addTxt: { color: c.onPrimary, fontSize: 15, fontFamily: font.bodySemibold },
  label: { color: c.muted, fontSize: 12 },
  value: { color: c.ink, fontSize: 15 },
  seg: { flexDirection: 'row', gap: 6, backgroundColor: c.canvas, borderRadius: radius.md, borderCurve: 'continuous', padding: 4 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, borderCurve: 'continuous', alignItems: 'center' },
  segItemOn: { backgroundColor: c.primary },
  segTxt: { color: c.body, fontSize: 14, fontFamily: font.bodyMedium },
  segTxtOn: { color: c.onPrimary, fontFamily: font.bodySemibold },
});
