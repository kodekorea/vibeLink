import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { disconnect, loadCreds } from '@/lib/hub';
import { notificationsAvailable } from '@/lib/notify';

export default function Settings() {
  const [url, setUrl] = useState('');

  useEffect(() => { loadCreds().then(c => setUrl(c?.url ?? '')); }, []);

  async function onDisconnect() {
    await disconnect();
    router.replace('/');
  }

  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 18 }}>
      <View style={styles.card}>
        <Text style={styles.label}>연결된 hub</Text>
        <Text selectable style={styles.value}>{url || '(없음)'}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>완료 알림</Text>
        <Text style={styles.value}>{notificationsAvailable ? '사용 가능' : 'Expo Go에서는 꺼짐 (dev build 필요)'}</Text>
      </View>
      <Pressable style={styles.btn} onPress={onDisconnect}>
        <Text style={styles.btnTxt}>연결 해제 (QR 다시)</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0b' },
  card: { backgroundColor: '#151515', borderRadius: 12, borderCurve: 'continuous', padding: 16, gap: 6 },
  label: { color: '#888', fontSize: 12 },
  value: { color: '#eee', fontSize: 15 },
  btn: { backgroundColor: '#3a1212', borderWidth: 1, borderColor: '#7f1d1d', borderRadius: 10, borderCurve: 'continuous', padding: 14, alignItems: 'center' },
  btnTxt: { color: '#fca5a5', fontSize: 15, fontWeight: '600' },
});
