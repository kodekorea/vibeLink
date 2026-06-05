import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { font } from '@/lib/theme';
import { usePrefs } from '@/lib/prefs';
import { t } from '@/lib/i18n';

export default function TabsLayout() {
  const { c } = usePrefs();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: c.canvas, borderTopColor: c.hairline },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarLabelStyle: { fontFamily: font.bodyMedium },
      }}
    >
      <Tabs.Screen
        name="terminal"
        options={{ title: t('terminal'), headerShown: false, tabBarIcon: ({ color, size }) => <Ionicons name="terminal-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="agent"
        options={{ title: t('agent'), tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="changes"
        options={{ title: t('changes'), tabBarIcon: ({ color, size }) => <Ionicons name="git-compare-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="files"
        options={{ title: t('files'), tabBarIcon: ({ color, size }) => <Ionicons name="folder-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t('settings'), tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
