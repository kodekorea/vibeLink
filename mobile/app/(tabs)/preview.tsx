import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import { previewBase, screenDataUri, listPorts, listDisplays, sendClick, type DisplayInfo } from '@/lib/hub';
import { usePrefs, type Palette } from '@/lib/prefs';
import { t } from '@/lib/i18n';

// 화면 캡처 뷰어: 맞춤(fit) + 핀치 줌/팬 + 탭=클릭. window.__setSrc(uri)로 이미지 교체(줌 유지).
function buildShotHtml(shot: string): string {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#181715;touch-action:none;-webkit-user-select:none;user-select:none}
#stage{position:absolute;inset:0}
#img{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;-webkit-user-drag:none}
.btns{position:fixed;right:12px;bottom:12px;display:flex;flex-direction:column;gap:10px;z-index:10}
.btns button{width:46px;height:46px;border-radius:23px;border:none;background:rgba(0,0,0,.55);color:#fff;font-size:22px;padding:0}
#ring{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border:2px solid #4ade80;border-radius:50%;opacity:0;pointer-events:none;z-index:9;transition:opacity .12s,transform .25s}
</style></head><body>
<div id="stage"><img id="img" src="${shot}"></div>
<div class="btns"><button id="zin">＋</button><button id="zout">－</button><button id="fit">⤢</button></div>
<div id="ring"></div>
<script>(function(){
var stage=document.getElementById('stage'),img=document.getElementById('img'),ring=document.getElementById('ring');
var scale=1,tx=0,ty=0,fitScale=1,natW=1,natH=1;
function apply(){img.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';}
function fit(){var vw=innerWidth,vh=innerHeight;fitScale=Math.min(vw/natW,vh/natH)||1;scale=fitScale;tx=(vw-natW*scale)/2;ty=(vh-natH*scale)/2;apply();}
img.onload=function(){var nw=img.naturalWidth||1,nh=img.naturalHeight||1;img.style.width=nw+'px';img.style.height=nh+'px';var ch=(nw!==natW||nh!==natH);natW=nw;natH=nh;if(ch)fit();else apply();};
window.__setSrc=function(u){img.src=u;};
function post(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o));}catch(e){}}
function zoomAt(ns,cx,cy){ns=Math.min(8,Math.max(fitScale*0.5,ns));var k=ns/scale;tx=cx-(cx-tx)*k;ty=cy-(cy-ty)*k;scale=ns;apply();}
document.getElementById('zin').onclick=function(){zoomAt(scale*1.3,innerWidth/2,innerHeight/2);};
document.getElementById('zout').onclick=function(){zoomAt(scale/1.3,innerWidth/2,innerHeight/2);};
document.getElementById('fit').onclick=fit;addEventListener('resize',fit);
var pts={},sd=1,ss=1,smid=null,stx=0,sty=0,moved=false,st=0,panId=null,sx=0,sy=0;
function ids(){return Object.keys(pts);}
stage.addEventListener('touchstart',function(e){
 for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];pts[t.identifier]={x:t.clientX,y:t.clientY};}
 var k=ids();
 if(k.length===1){panId=k[0];sx=pts[panId].x;sy=pts[panId].y;stx=tx;sty=ty;moved=false;st=Date.now();}
 else if(k.length===2){var a=pts[k[0]],b=pts[k[1]];sd=Math.hypot(a.x-b.x,a.y-b.y)||1;ss=scale;smid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};stx=tx;sty=ty;moved=true;}
},{passive:false});
stage.addEventListener('touchmove',function(e){
 e.preventDefault();
 for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];if(pts[t.identifier])pts[t.identifier]={x:t.clientX,y:t.clientY};}
 var k=ids();
 if(k.length===2){var a=pts[k[0]],b=pts[k[1]];var d=Math.hypot(a.x-b.x,a.y-b.y)||1;var ns=Math.min(8,Math.max(fitScale*0.5,ss*d/sd));var kk=ns/ss;tx=smid.x-(smid.x-stx)*kk;ty=smid.y-(smid.y-sty)*kk;scale=ns;apply();moved=true;}
 else if(k.length===1&&panId!=null&&pts[panId]){var p=pts[panId];tx=stx+(p.x-sx);ty=sty+(p.y-sy);if(Math.abs(p.x-sx)>8||Math.abs(p.y-sy)>8)moved=true;apply();}
},{passive:false});
stage.addEventListener('touchend',function(e){
 var ended=e.changedTouches[0];
 for(var i=0;i<e.changedTouches.length;i++)delete pts[e.changedTouches[i].identifier];
 if(ids().length===0){if(!moved&&Date.now()-st<300&&ended)click(ended.clientX,ended.clientY);panId=null;}
},{passive:false});
function click(cx,cy){var ix=(cx-tx)/scale,iy=(cy-ty)/scale,xf=ix/natW,yf=iy/natH;if(xf<0||xf>1||yf<0||yf>1)return;ring.style.left=cx+'px';ring.style.top=cy+'px';ring.style.opacity='1';ring.style.transform='scale(1.6)';setTimeout(function(){ring.style.opacity='0';ring.style.transform='scale(1)';},250);post({t:'click',xf:xf,yf:yf});}
})();</script></body></html>`;
}

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
  const shotRef = useRef<WebView>(null);
  const htmlRef = useRef<string | null>(null);

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

  // 새 캡처가 오면 WebView 이미지를 교체(소스 재로드 없이 → 줌/팬 상태 유지).
  useEffect(() => {
    if (shot && shotRef.current) {
      shotRef.current.injectJavaScript('window.__setSrc&&window.__setSrc(' + JSON.stringify(shot) + ');true;');
    }
  }, [shot]);

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
              ref={shotRef}
              style={[styles.flex, styles.shotWrap]}
              originWhitelist={['*']}
              scalesPageToFit={false}
              source={{ html: (htmlRef.current ??= buildShotHtml(shot)) }}
              onMessage={(e) => {
                try {
                  const m = JSON.parse(e.nativeEvent.data);
                  if (m && m.t === 'click') {
                    sendClick(m.xf, m.yf, display).then(() => setTimeout(() => capture(display), 350));
                  }
                } catch { /* ignore */ }
              }}
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
