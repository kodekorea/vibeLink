import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getActiveHost, onHostChange, getActiveSessionId, onSessionChange, consumeNewSession, type Host, type Session } from '@/lib/hub';
import { SessionBar } from '@/components/session-bar';
import { notifyLocal } from '@/lib/notify';
import { usePrefs } from '@/lib/prefs';
import { t } from '@/lib/i18n';

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
  const { c, lang } = usePrefs();
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

  const openNew = useCallback(() => webRef.current?.injectJavaScript('window.__mtbNew && window.__mtbNew(); true;'), []);
  // 다른 탭에서 '+'로 넘어왔으면 포커스 시 새 세션 모달을 연다.
  useFocusEffect(useCallback(() => {
    if (consumeNewSession()) setTimeout(openNew, 600);
  }, [openNew]));

  async function onMessage(e: { nativeEvent: { data: string } }) {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.t === 'notify') await notifyLocal('MTB: ' + (m.label || t('endSession')), t('completionAlarm'));
    } catch (err) { /* ignore */ }
  }

  if (!host) return null;

  const cookieInject = "document.cookie='mtb_jwt=" + host.token + ";path=/';true;";

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <SessionBar
        showNew
        onActive={(s: Session | null) => setSid(s ? s.id : null)}
        onNew={openNew}
      />
      <View style={{ flex: 1 }}>
        <WebView
          ref={webRef}
          key={host.id + ':' + (sid || '')}
          source={{ uri: host.url + '?embed=1' + (sid ? '&session=' + encodeURIComponent(sid) : '') + '&lang=' + lang + '&safe=' + Math.round(insets.bottom) }}
          injectedJavaScriptBeforeContentLoaded={cookieInject}
          injectedJavaScript={NOTIFY_INJECT}
          onMessage={onMessage}
          style={{ flex: 1, backgroundColor: c.canvas }}
          keyboardDisplayRequiresUserAction={false}
        />
      </View>
    </View>
  );
}
