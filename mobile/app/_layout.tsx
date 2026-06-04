import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { setupNotifications } from '@/lib/notify';

export default function RootLayout() {
  useEffect(() => {
    setupNotifications();
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
