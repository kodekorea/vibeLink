import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'MTB Hub 연결' }} />
      <Stack.Screen name="terminal" options={{ title: 'MTB Hub' }} />
    </Stack>
  );
}
