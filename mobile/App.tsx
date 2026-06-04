import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const URL_KEY = 'mtb_hub_url';

// 페이지의 window.notify를 가로채 RN으로 브리지 (WebView에선 웹 알림이 안 뜨므로 네이티브로 처리)
const INJECT = `(function(){
  function hook(){ try {
    window.notify = function(m){
      try { window.ReactNativeWebView.postMessage(JSON.stringify({ t:'notify', sessionId: m && m.sessionId, label: m && m.label })); } catch (e) {}
    };
  } catch (e) {} }
  hook(); setTimeout(hook, 1500);
  true;
})();`;

export default function App() {
  const [url, setUrl] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(URL_KEY).then(v => { if (v) { setUrl(v); setInput(v); } setLoaded(true); });
    Notifications.requestPermissionsAsync().catch(() => {});
  }, []);

  async function connect() {
    let u = input.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) u = 'https://' + u;
    await SecureStore.setItemAsync(URL_KEY, u);
    setUrl(u);
  }
  async function reset() { await SecureStore.deleteItemAsync(URL_KEY); setUrl(null); }

  async function onMessage(e: { nativeEvent: { data: string } }) {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.t === 'notify') {
        await Notifications.scheduleNotificationAsync({
          content: { title: 'MTB: ' + (m.label || '세션'), body: '완료 / 입력 대기' },
          trigger: null,
        });
      }
    } catch (err) { /* ignore */ }
  }

  if (!loaded) return <View style={styles.center}><ActivityIndicator /></View>;

  if (!url) {
    return (
      <SafeAreaProvider><SafeAreaView style={styles.setup}>
        <Text style={styles.title}>MTB Hub 연결</Text>
        <Text style={styles.hint}>hub 접속 URL을 입력하세요 (cloudflared 또는 http://PC-IP:포트)</Text>
        <TextInput style={styles.input} value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false} placeholder="https://xxxx.trycloudflare.com" placeholderTextColor="#666" />
        <Button title="연결" onPress={connect} />
      </SafeAreaView></SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider><SafeAreaView style={styles.full} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.full} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <WebView
          source={{ uri: url }}
          injectedJavaScript={INJECT}
          onMessage={onMessage}
          style={styles.full}
          keyboardDisplayRequiresUserAction={false}
        />
        <TouchableOpacity style={styles.gear} onPress={reset}><Text style={styles.gearTxt}>⚙</Text></TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#0b0b0b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b0b' },
  setup: { flex: 1, padding: 24, gap: 12, justifyContent: 'center', backgroundColor: '#0b0b0b' },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  hint: { color: '#999', fontSize: 13 },
  input: { color: '#eee', borderWidth: 1, borderColor: '#333', borderRadius: 8, padding: 12, fontSize: 15 },
  gear: { position: 'absolute', top: 4, right: 4, padding: 6, opacity: 0.4 },
  gearTxt: { fontSize: 18, color: '#fff' },
});
