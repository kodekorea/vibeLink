import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { setupNotifications } from '@/lib/notify';

export default function RootLayout() {
  useEffect(() => {
    setupNotifications();
  }, []);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0b0b0b' },
        headerTintColor: '#fff',
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="terminal" options={{ title: 'MTB Hub' }} />
    </Stack>
  );
}
