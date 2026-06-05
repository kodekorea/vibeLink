import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { getActiveHost, addHost } from '@/lib/hub';
import { radius, font } from '@/lib/theme';
import { usePrefs, type Palette } from '@/lib/prefs';
import { t } from '@/lib/i18n';

type Stage = 'checking' | 'scan' | 'connect';

export default function Index() {
  const insets = useSafeAreaInsets();
  const { c } = usePrefs();
  const styles = makeStyles(c);
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
    else setError(res.error || t('failed'));
  }

  if (stage === 'checking') {
    return <View style={styles.center}><ActivityIndicator color="#fff" /></View>;
  }

  if (stage === 'connect') {
    return (
      <View style={[styles.connect, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.title}>{t('connectTitle')}</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={t('hubUrl')}
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
          placeholder={t('password')}
          placeholderTextColor="#888"
          style={styles.input}
        />
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Pressable style={styles.btn} onPress={connect} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>{t('connect')}</Text>}
        </Pressable>
        <Pressable onPress={() => { scanned.current = false; setError(''); setStage('scan'); }} hitSlop={10}>
          <Text style={styles.link}>{t('rescan')}</Text>
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
          <Text style={styles.titleLight}>{t('scanTitle')}</Text>
          <Text style={styles.subLight}>{t('scanSub')}</Text>
        </View>
        {permission?.granted ? (
          <View style={styles.frame} />
        ) : (
          <View style={styles.head}>
            <Text style={styles.subLight}>{t('cameraNeeded')}</Text>
            <Pressable style={styles.btn} onPress={requestPermission}>
              <Text style={styles.btnTxt}>{t('allow')}</Text>
            </Pressable>
          </View>
        )}
        <Pressable onPress={() => { setUrl(''); setStage('connect'); }} hitSlop={10}>
          <Text style={styles.link}>{t('enterUrl')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.canvas },
  connect: { flex: 1, paddingHorizontal: 24, gap: 14, justifyContent: 'center', backgroundColor: c.canvas },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24 },
  head: { alignItems: 'center', gap: 8 },
  title: { color: c.ink, fontSize: 30, fontFamily: font.display, textAlign: 'center' },
  sub: { color: c.muted, fontSize: 13, textAlign: 'center' },
  titleLight: { color: c.onDark, fontSize: 22, fontFamily: font.display, textAlign: 'center' },
  subLight: { color: '#ddd', fontSize: 13, textAlign: 'center' },
  err: { color: c.error, fontSize: 13, textAlign: 'center' },
  frame: { width: 240, height: 240, borderWidth: 3, borderColor: c.primary, borderRadius: 22, borderCurve: 'continuous', backgroundColor: 'transparent' },
  input: { color: c.ink, backgroundColor: '#fff', borderWidth: 1, borderColor: c.hairline, borderRadius: radius.md, padding: 14, fontSize: 16, fontFamily: font.body, borderCurve: 'continuous' },
  btn: { backgroundColor: c.primary, paddingVertical: 12, paddingHorizontal: 26, borderRadius: radius.md, borderCurve: 'continuous', alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  btnTxt: { color: c.onPrimary, fontSize: 16, fontFamily: font.bodySemibold },
  link: { color: c.primary, fontSize: 15, padding: 10, fontFamily: font.bodyMedium, textAlign: 'center' },
});
