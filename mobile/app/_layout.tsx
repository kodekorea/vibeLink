import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, CormorantGaramond_500Medium } from '@expo-google-fonts/cormorant-garamond';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { setupNotifications } from '@/lib/notify';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // 폰트 로드 실패/지연이 앱을 영원히 멈추지 않도록 error도 읽고 타임아웃 폴백을 둔다.
  const [loaded, error] = useFonts({
    CormorantGaramond_500Medium,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
    JetBrainsMono_400Regular,
  });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => { setupNotifications(); }, []);
  // 최대 3초 후엔 폰트 상태와 무관하게 진행(시스템 폰트로 폴백) — 빈 화면 무한 로딩 방지.
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const ready = loaded || !!error || timedOut;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </SafeAreaProvider>
  );
}
