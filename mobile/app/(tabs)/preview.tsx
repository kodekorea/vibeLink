import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { previewBase, screenDataUri } from '@/lib/hub';
import { usePrefs, type Palette } from '@/lib/prefs';
import { t } from '@/lib/i18n';

const PRESETS = ['3000', '5173', '8080', '4321'];

export default function Preview() {
  const insets = useSafeAreaInsets();
  const { c } = usePrefs();
  const styles = makeStyles(c);
  const [mode, setMode] = useState<'web' | 'screen'>('web');

  // web
  const [port, setPort] = useState('3000');
  const [webUri, setWebUri] = useState<string | null>(null);
  const [webErr, setWebErr] = useState('');
  const webRef = useRef<WebView>(null);

  async function openWeb(p: string) {
    setWebErr('');
    const base = await previewBase();
    if (!base) { setWebErr(t('previewLanHint')); setWebUri(null); return; }
    setWebUri(base + ':' + p);
  }

  // screen
  const [shot, setShot] = useState<string | null>(null);
  const [shotErr, setShotErr] = useState('');
  const [loadingShot, setLoadingShot] = useState(false);
  const [auto, setAuto] = useState(false);

  const capture = useCallback(async () => {
    setLoadingShot(true);
    const r = await screenDataUri();
    if (r.uri) { setShot(r.uri); setShotErr(''); }
    else setShotErr(t('screenFail') + (r.error ? ' (' + r.error + ')' : ''));
    setLoadingShot(false);
  }, []);

  useEffect(() => {
    if (mode === 'screen' && !shot) capture();
  }, [mode]);

  useEffect(() => {
    if (mode !== 'screen' || !auto) return;
    const id = setInterval(capture, 2000);
    return () => clearInterval(id);
  }, [mode, auto, capture]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.seg}>
        {(['web', 'screen'] as const).map(m => (
          <Pressable key={m} onPress={() => setMode(m)} style={[styles.segItem, mode === m && styles.segOn]}>
            <Text style={[styles.segTxt, mode === m && styles.segTxtOn]}>{m === 'web' ? t('web') : t('screen')}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'web' ? (
        <View style={styles.flex}>
          <View style={styles.bar}>
            <TextInput style={styles.port} value={port} onChangeText={setPort} keyboardType="number-pad" placeholder={t('port')} placeholderTextColor={c.mutedSoft} />
            <Pressable style={styles.btn} onPress={() => openWeb(port)}><Text style={styles.btnTxt}>{t('open')}</Text></Pressable>
            {webUri ? <Pressable style={styles.btnGhost} onPress={() => webRef.current?.reload()}><Text style={styles.btnGhostTxt}>↻</Text></Pressable> : null}
          </View>
          <View style={styles.chips}>
            {PRESETS.map(p => (
              <Pressable key={p} onPress={() => { setPort(p); openWeb(p); }} style={styles.chip}><Text style={styles.chipTxt}>{p}</Text></Pressable>
            ))}
          </View>
          {webErr ? <Text style={styles.err}>{webErr}</Text> : null}
          {webUri ? (
            <WebView ref={webRef} source={{ uri: webUri }} style={styles.flex} />
          ) : <View style={styles.center}><Text style={styles.hint}>{t('port')} → {t('open')}</Text></View>}
        </View>
      ) : (
        <View style={styles.flex}>
          <View style={styles.bar}>
            <Pressable style={styles.btn} onPress={capture}><Text style={styles.btnTxt}>{t('refresh')}</Text></Pressable>
            <Pressable style={[styles.btnGhost, auto && styles.btnOn]} onPress={() => setAuto(a => !a)}><Text style={[styles.btnGhostTxt, auto && styles.btnOnTxt]}>{t('auto')}</Text></Pressable>
            {loadingShot ? <ActivityIndicator color={c.primary} style={{ marginLeft: 8 }} /> : null}
          </View>
          {shotErr ? <Text style={styles.err}>{shotErr}</Text> : null}
          {shot ? (
            <View style={[styles.flex, styles.shotWrap]}>
              <Image source={{ uri: shot }} style={styles.shot} resizeMode="contain" />
            </View>
          ) : <View style={styles.center}><Text style={styles.hint}>{t('screen')}</Text></View>}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: c.mutedSoft, fontSize: 14 },
  err: { color: c.error, fontSize: 13, padding: 12 },
  seg: { flexDirection: 'row', gap: 6, backgroundColor: c.surfaceSoft, padding: 8, borderBottomWidth: 1, borderBottomColor: c.hairline },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: c.surfaceCard },
  segOn: { backgroundColor: c.primary },
  segTxt: { color: c.bodyStrong, fontSize: 14, fontWeight: '600' },
  segTxtOn: { color: c.onPrimary, fontWeight: '700' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  port: { width: 90, backgroundColor: c.surfaceCard, color: c.ink, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.hairline },
  btn: { backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  btnTxt: { color: c.onPrimary, fontWeight: '600' },
  btnGhost: { backgroundColor: c.surfaceCard, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: c.hairline },
  btnGhostTxt: { color: c.body, fontWeight: '600' },
  btnOn: { backgroundColor: c.primary, borderColor: 'transparent' },
  btnOnTxt: { color: c.onPrimary },
  chips: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 6, flexWrap: 'wrap' },
  chip: { backgroundColor: c.surfaceCard, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: c.hairline },
  chipTxt: { color: c.body, fontSize: 13 },
  shotWrap: { backgroundColor: c.surfaceDark },
  shot: { flex: 1, width: '100%' },
});
