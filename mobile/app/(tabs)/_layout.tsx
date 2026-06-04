import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { color, font } from '@/lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: color.canvas, borderTopColor: color.hairline },
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.muted,
        tabBarLabelStyle: { fontFamily: font.bodyMedium },
      }}
    >
      <Tabs.Screen
        name="terminal"
        options={{ title: '터미널', headerShown: false, tabBarIcon: ({ color, size }) => <Ionicons name="terminal-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="agent"
        options={{ title: '에이전트', tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="changes"
        options={{ title: '변경', tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="files"
        options={{ title: '파일', tabBarIcon: ({ color, size }) => <Ionicons name="folder-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: '설정', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
