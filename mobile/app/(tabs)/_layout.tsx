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
        options={{ title: 'Terminal', headerShown: false, tabBarIcon: ({ color, size }) => <Ionicons name="terminal-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="agent"
        options={{ title: 'Agent', tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="changes"
        options={{ title: 'Changes', tabBarIcon: ({ color, size }) => <Ionicons name="git-compare-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="files"
        options={{ title: 'Files', tabBarIcon: ({ color, size }) => <Ionicons name="folder-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
