import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';

const URL_KEY = 'mtb_hub_url';

export default function Index() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [checked, setChecked] = useState(false);
  const [manual, setManual] = useState(false);
  const [input, setInput] = useState('');
  const handled = useRef(false);

  // 이미 저장된 hub URL이 있으면 곧장 터미널로.
  useEffect(() => {
    SecureStore.getItemAsync(URL_KEY).then(v => {
      if (v) router.replace('/terminal');
      else setChecked(true);
    });
  }, []);

  // 스캔 화면에서 카메라 권한 자동 요청.
  useEffect(() => {
    if (checked && !manual && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [checked, manual, permission]);

  async function save(raw: string) {
    let u = (raw || '').trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) u = 'https://' + u;
    await SecureStore.setItemAsync(URL_KEY, u);
    if (process.env.EXPO_OS === 'ios') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    router.replace('/terminal');
  }

  function onScan(result: { data: string }) {
    if (handled.current) return;
    handled.current = true;
    Haptics.selectionAsync().catch(() => {});
    save(result.data);
  }

  if (!checked) return null;

  // --- URL 직접 입력 모드 ---
  if (manual) {
    return (
      <View style={[styles.manualRoot, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.title}>hub URL 직접 입력</Text>
        <Text style={styles.sub}>cloudflared 주소 또는 같은 와이파이의 http://PC-IP:포트</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          autoFocus
          onSubmitEditing={() => save(input)}
          placeholder="https://xxxx.trycloudflare.com"
          placeholderTextColor="#888"
          style={styles.input}
        />
        <Pressable style={styles.btn} onPress={() => save(input)}>
          <Text style={styles.btnTxt}>연결</Text>
        </Pressable>
        <Pressable onPress={() => setManual(false)} hitSlop={10}>
          <Text style={styles.link}>← QR 스캔으로</Text>
        </Pressable>
      </View>
    );
  }

  // --- QR 스캔 모드 ---
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

        <Pressable onPress={() => setManual(true)} hitSlop={10}>
          <Text style={styles.link}>URL 직접 입력</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  manualRoot: { flex: 1, paddingHorizontal: 24, gap: 14, justifyContent: 'center', backgroundColor: '#0b0b0b' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24 },
  head: { alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  sub: { color: '#bbb', fontSize: 13, textAlign: 'center' },
  frame: {
    width: 240, height: 240, borderWidth: 3, borderColor: '#2563eb',
    borderRadius: 22, borderCurve: 'continuous', backgroundColor: 'transparent',
  },
  input: {
    color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: '#444',
    borderRadius: 10, padding: 14, fontSize: 16, borderCurve: 'continuous',
  },
  btn: {
    backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 26,
    borderRadius: 10, borderCurve: 'continuous', alignItems: 'center',
  },
  btnTxt: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { color: '#7aa2ff', fontSize: 15, padding: 10 },
});
