import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0b0b0b' },
        headerTintColor: '#fff',
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: '#0b0b0b', borderTopColor: '#222' },
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#888',
      }}
    >
      <Tabs.Screen
        name="terminal"
        options={{ title: '터미널', headerShown: false, tabBarIcon: ({ color, size }) => <Ionicons name="terminal-outline" color={color} size={size} /> }}
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
