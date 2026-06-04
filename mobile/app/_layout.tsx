import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { setupNotifications } from '@/lib/notify';

export default function RootLayout() {
  useEffect(() => {
    setupNotifications();
  }, []);

  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'MTB Hub 연결' }} />
      <Stack.Screen name="terminal" options={{ title: 'MTB Hub' }} />
    </Stack>
  );
}
