import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { getActiveHost, addHost } from '@/lib/hub';

type Stage = 'checking' | 'scan' | 'connect';

export default function Index() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>('checking');
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scanned = useRef(false);

  useEffect(() => {
    getActiveHost().then(c => {
      if (c) router.replace('/terminal');
      else setStage('scan');
    });
  }, []);

  useEffect(() => {
    if (stage === 'scan' && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [stage, permission]);

  function onScan(r: { data: string }) {
    if (scanned.current) return;
    scanned.current = true;
    Haptics.selectionAsync().catch(() => {});
    setUrl(r.data);
    setStage('connect');
  }

  async function connect() {
    setBusy(true);
    setError('');
    const res = await addHost(url, password);
    setBusy(false);
    if (res.ok) router.replace('/terminal');
    else setError(res.error || '실패');
  }

  if (stage === 'checking') {
    return <View style={styles.center}><ActivityIndicator color="#fff" /></View>;
  }

  if (stage === 'connect') {
    return (
      <View style={[styles.connect, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.title}>hub 연결</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="hub URL"
          placeholderTextColor="#888"
          style={styles.input}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoFocus
          onSubmitEditing={connect}
          returnKeyType="go"
          placeholder="암호 (MTB_PASSWORD)"
          placeholderTextColor="#888"
          style={styles.input}
        />
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Pressable style={styles.btn} onPress={connect} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>연결</Text>}
        </Pressable>
        <Pressable onPress={() => { scanned.current = false; setError(''); setStage('scan'); }} hitSlop={10}>
          <Text style={styles.link}>← QR 다시 스캔</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {permission?.granted && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
      )}
      <View
        style={[styles.overlay, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
        pointerEvents="box-none"
      >
        <View style={styles.head}>
          <Text style={styles.title}>PC의 QR을 비추세요</Text>
          <Text style={styles.sub}>hub 실행 후 뜨는 QR (또는 /qr.html)</Text>
        </View>
        {permission?.granted ? (
          <View style={styles.frame} />
        ) : (
          <View style={styles.head}>
            <Text style={styles.sub}>카메라 권한이 필요해요</Text>
            <Pressable style={styles.btn} onPress={requestPermission}>
              <Text style={styles.btnTxt}>권한 허용</Text>
            </Pressable>
          </View>
        )}
        <Pressable onPress={() => { setUrl(''); setStage('connect'); }} hitSlop={10}>
          <Text style={styles.link}>URL 직접 입력</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b0b' },
  connect: { flex: 1, paddingHorizontal: 24, gap: 14, justifyContent: 'center', backgroundColor: '#0b0b0b' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24 },
  head: { alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  sub: { color: '#bbb', fontSize: 13, textAlign: 'center' },
  err: { color: '#f87171', fontSize: 13, textAlign: 'center' },
  frame: { width: 240, height: 240, borderWidth: 3, borderColor: '#2563eb', borderRadius: 22, borderCurve: 'continuous', backgroundColor: 'transparent' },
  input: { color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: '#444', borderRadius: 10, padding: 14, fontSize: 16, borderCurve: 'continuous' },
  btn: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 26, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  btnTxt: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { color: '#7aa2ff', fontSize: 15, padding: 10, textAlign: 'center' },
});
