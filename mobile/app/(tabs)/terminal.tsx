import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getActiveHost, onHostChange, getActiveSessionId, onSessionChange, type Host, type Session } from '@/lib/hub';
import { SessionBar } from '@/components/session-bar';
import { notifyLocal } from '@/lib/notify';
import { color } from '@/lib/theme';

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
  const [host, setHost] = useState<Host | null>(null);
  const webRef = useRef<WebView>(null);
  const [sid, setSid] = useState<string | null>(getActiveSessionId());

  useEffect(() => {
    let alive = true;
    const refresh = () => getActiveHost().then(h => { if (alive) { if (!h) router.replace('/'); else setHost(h); } });
    refresh();
    const off = onHostChange(refresh);
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    const off = onSessionChange(() => setSid(getActiveSessionId()));
    return off;
  }, []);

  async function onMessage(e: { nativeEvent: { data: string } }) {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.t === 'notify') await notifyLocal('MTB: ' + (m.label || '세션'), '완료 / 입력 대기');
    } catch (err) { /* ignore */ }
  }

  if (!host) return null;

  const cookieInject = "document.cookie='mtb_jwt=" + host.token + ";path=/';true;";

  return (
    <View style={{ flex: 1, backgroundColor: color.canvas, paddingBottom: insets.bottom }}>
      <SessionBar
        showNew
        onActive={(s: Session | null) => setSid(s ? s.id : null)}
        onNew={() => webRef.current?.injectJavaScript('window.__mtbNew && window.__mtbNew(); true;')}
      />
      <View style={{ flex: 1 }}>
        <WebView
          ref={webRef}
          key={host.id + ':' + (sid || '')}
          source={{ uri: host.url + '?embed=1' + (sid ? '&session=' + encodeURIComponent(sid) : '') }}
          injectedJavaScriptBeforeContentLoaded={cookieInject}
          injectedJavaScript={NOTIFY_INJECT}
          onMessage={onMessage}
          style={{ flex: 1, backgroundColor: color.canvas }}
          keyboardDisplayRequiresUserAction={false}
        />
      </View>
    </View>
  );
}
