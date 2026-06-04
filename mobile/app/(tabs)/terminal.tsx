import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadCreds, type Creds } from '@/lib/hub';
import { notifyLocal } from '@/lib/notify';

const NOTIFY_INJECT = `(function(){
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
  const [creds, setCreds] = useState<Creds | null>(null);

  useEffect(() => {
    loadCreds().then(c => {
      if (!c) router.replace('/');
      else setCreds(c);
    });
  }, []);

  async function onMessage(e: { nativeEvent: { data: string } }) {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.t === 'notify') {
        await notifyLocal('MTB: ' + (m.label || '세션'), '완료 / 입력 대기');
      }
    } catch (err) { /* ignore */ }
  }

  if (!creds) return null;

  const cookieInject = "document.cookie='mtb_jwt=" + creds.token + ";path=/';true;";

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0b0b', paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <WebView
        source={{ uri: creds.url }}
        injectedJavaScriptBeforeContentLoaded={cookieInject}
        injectedJavaScript={NOTIFY_INJECT}
        onMessage={onMessage}
        style={{ flex: 1, backgroundColor: '#0b0b0b' }}
        keyboardDisplayRequiresUserAction={false}
      />
    </View>
  );
}
