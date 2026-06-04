import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

const URL_KEY = 'mtb_hub_url';

// 페이지의 window.notify를 가로채 RN으로 브리지 (WebView에선 웹 알림이 안 뜨므로 네이티브 알림으로 처리)
const INJECT = `(function(){
  function hook(){ try {
    window.notify = function(m){
      try { window.ReactNativeWebView.postMessage(JSON.stringify({ t:'notify', sessionId: m && m.sessionId, label: m && m.label })); } catch (e) {}
    };
  } catch (e) {} }
  hook(); setTimeout(hook, 1500);
  true;
})();`;

export default function Terminal() {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(URL_KEY).then(v => {
      if (!v) router.replace('/');
      else setUrl(v);
    });
  }, []);

  async function change() {
    await SecureStore.deleteItemAsync(URL_KEY);
    router.replace('/');
  }

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

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0b0b', paddingBottom: insets.bottom }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={change} hitSlop={10}>
              <Text style={{ color: '#2563eb', fontSize: 16 }}>변경</Text>
            </Pressable>
          ),
        }}
      />
      {url ? (
        <WebView
          source={{ uri: url }}
          injectedJavaScript={INJECT}
          onMessage={onMessage}
          style={{ flex: 1, backgroundColor: '#0b0b0b' }}
          keyboardDisplayRequiresUserAction={false}
        />
      ) : null}
    </View>
  );
}
