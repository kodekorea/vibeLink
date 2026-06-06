import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import { previewBase, screenDataUri, listPorts, listDisplays, type DisplayInfo } from '@/lib/hub';
import { usePrefs, type Palette } from '@/lib/prefs';
import { t } from '@/lib/i18n';

export default function Preview() {
  const insets = useSafeAreaInsets();
  const { c } = usePrefs();
  const styles = makeStyles(c);
  const [mode, setMode] = useState<'web' | 'screen'>('web');

  // web
  const [port, setPort] = useState('3000');
  const [webUri, setWebUri] = useState<string | null>(null);
  const [webErr, setWebErr] = useState('');
  const [ports, setPorts] = useState<number[]>([]);
  const [loadingWeb, setLoadingWeb] = useState(false);
  const webRef = useRef<WebView>(null);

  const loadPorts = useCallback(() => { listPorts().then(setPorts).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => { loadPorts(); }, [loadPorts]));

  async function openWeb(p: string) {
    setWebErr('');
    setLoadingWeb(true);
    const base = await previewBase();
    if (!base) {
      setWebErr(t('previewLanHint'));
      setWebUri(null);
      setLoadingWeb(false);
      return;
    }
    setWebUri(base + ':' + p);
  }

  // screen
  const [shot, setShot] = useState<string | null>(null);
  const [shotErr, setShotErr] = useState('');
  const [loadingShot, setLoadingShot] = useState(false);
  const [auto, setAuto] = useState(false);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [display, setDisplay] = useState<number | undefined>(undefined); // undefined = 전체

  const capture = useCallback(async (d?: number) => {
    setLoadingShot(true);
    const r = await screenDataUri(d);
    if (r.uri) { setShot(r.uri); setShotErr(''); }
    else setShotErr(t('screenFail') + (r.error ? ' (' + r.error + ')' : ''));
    setLoadingShot(false);
  }, []);

  // 모니터 목록을 받아 주 모니터를 기본 선택(없으면 전체).
  useEffect(() => {
    if (mode !== 'screen' || displays.length) return;
    listDisplays().then(ds => {
      setDisplays(ds);
      if (ds.length > 1) {
        const prim = ds.find(x => x.primary) || ds[0];
        setDisplay(prim.idx);
        capture(prim.idx);
      } else {
        capture(undefined);
      }
    }).catch(() => capture(undefined));
  }, [mode]);

  useEffect(() => {
    if (mode !== 'screen' || !auto) return;
    const id = setInterval(() => capture(display), 2000);
    return () => clearInterval(id);
  }, [mode, auto, capture, display]);

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
            <Pressable style={styles.btnGhost} onPress={loadPorts}><Text style={styles.btnGhostTxt}>↻</Text></Pressable>
            {webUri ? <Pressable style={styles.btnGhost} onPress={() => webRef.current?.reload()}><Text style={styles.btnGhostTxt}>⟳</Text></Pressable> : null}
          </View>
          {ports.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsRow}
              contentContainerStyle={styles.chips}
            >
              {ports.map(String).map(p => (
                <Pressable key={p} onPress={() => { setPort(p); openWeb(p); }} style={[styles.chip, port === p && webUri && styles.chipOn]}>
                  <Text style={[styles.chipTxt, port === p && webUri && styles.chipTxtOn]}>● {p}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>감지된 로컬 포트가 없습니다 (PC에서 서버 실행 필요)</Text>
            </View>
          )}
          {webErr ? <Text style={styles.err}>{webErr}</Text> : null}
          {webUri && !webErr ? (
            <WebView
              ref={webRef}
              source={{ uri: webUri }}
              style={styles.flex}
              onLoadStart={() => { setLoadingWeb(true); setWebErr(''); }}
              onLoadEnd={() => setLoadingWeb(false)}
              onError={(e) => {
                setLoadingWeb(false);
                setWebErr(`연결 실패: 포트가 올바르지 않거나 서버가 꺼져 있습니다 (${e.nativeEvent.description || 'Connection refused'})`);
                setWebUri(null);
              }}
              onHttpError={(e) => {
                setLoadingWeb(false);
                setWebErr(`HTTP 오류 (${e.nativeEvent.statusCode}): 서버 응답 에러`);
                setWebUri(null);
              }}
            />
          ) : (
            <View style={styles.center}>
              {loadingWeb ? (
                <ActivityIndicator color={c.primary} size="large" />
              ) : (
                <Text style={styles.hint}>{ports.length ? '포트를 선택하거나 직접 입력 후 Open을 누르세요.' : t('port') + ' → ' + t('open')}</Text>
              )}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.flex}>
          <View style={styles.bar}>
            <Pressable style={styles.btn} onPress={() => capture(display)}><Text style={styles.btnTxt}>{t('refresh')}</Text></Pressable>
            <Pressable style={[styles.btnGhost, auto && styles.btnOn]} onPress={() => setAuto(a => !a)}><Text style={[styles.btnGhostTxt, auto && styles.btnOnTxt]}>{t('auto')}</Text></Pressable>
            {loadingShot ? <ActivityIndicator color={c.primary} style={{ marginLeft: 8 }} /> : null}
          </View>
          {displays.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsRow}
              contentContainerStyle={styles.chips}
            >
              <Pressable onPress={() => { setDisplay(undefined); capture(undefined); }} style={[styles.chip, display === undefined && styles.chipOn]}>
                <Text style={[styles.chipTxt, display === undefined && styles.chipTxtOn]}>{t('allDisplays')}</Text>
              </Pressable>
              {displays.map((d, i) => (
                <Pressable key={d.idx} onPress={() => { setDisplay(d.idx); capture(d.idx); }} style={[styles.chip, display === d.idx && styles.chipOn]}>
                  <Text style={[styles.chipTxt, display === d.idx && styles.chipTxtOn]}>🖥 {i + 1}{d.primary ? '★' : ''} {d.w}×{d.h}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {shotErr ? <Text style={styles.err}>{shotErr}</Text> : null}
          {shot ? (
            <WebView
              style={[styles.flex, styles.shotWrap]}
              originWhitelist={['*']}
              scalesPageToFit={false}
              source={{ html: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=6,user-scalable=yes"><style>html,body{margin:0;height:100%;background:#181715;display:flex;align-items:center;justify-content:center}img{max-width:100%;height:auto}</style></head><body><img src="' + shot + '"></body></html>' }}
            />
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
  chipsRow: { flexGrow: 0, flexShrink: 0 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 6 },
  chip: { backgroundColor: c.surfaceCard, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: c.hairline },
  chipOn: { backgroundColor: c.primary, borderColor: 'transparent' },
  chipTxt: { color: c.body, fontSize: 13 },
  chipTxtOn: { color: c.onPrimary },
  emptyContainer: { paddingHorizontal: 12, paddingVertical: 6, paddingBottom: 8 },
  emptyText: { color: c.muted, fontSize: 13, fontStyle: 'italic' },
  shotWrap: { backgroundColor: c.surfaceDark },
});
