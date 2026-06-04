import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';

const URL_KEY = 'mtb_hub_url';

export default function Index() {
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(URL_KEY).then(v => {
      if (v) router.replace('/terminal');
      else setChecked(true);
    });
  }, []);

  async function connect() {
    let u = input.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) u = 'https://' + u;
    await SecureStore.setItemAsync(URL_KEY, u);
    if (process.env.EXPO_OS === 'ios') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    router.replace('/terminal');
  }

  if (!checked) return null;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text selectable style={{ fontSize: 15, color: '#666' }}>
        hub 접속 URL을 입력하세요. cloudflared 주소 또는 같은 와이파이의 http://PC-IP:포트.
      </Text>
      <TextInput
        value={input}
        onChangeText={setInput}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={connect}
        placeholder="https://xxxx.trycloudflare.com"
        placeholderTextColor="#999"
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 14, fontSize: 16, borderCurve: 'continuous' }}
      />
      <Pressable
        onPress={connect}
        style={{ backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center', borderCurve: 'continuous' }}
      >
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>연결</Text>
      </Pressable>
    </ScrollView>
  );
}
