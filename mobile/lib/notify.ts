import Constants, { ExecutionEnvironment } from 'expo-constants';

// Expo Go(SDK 53+)는 푸시 알림 기능이 제거돼서, expo-notifications를 import하는 순간
// (DevicePushTokenAutoRegistration 사이드이펙트) 앱이 통째로 크래시한다.
// 따라서 dev/standalone 빌드에서만 lazy require하고, Expo Go에서는 아무것도 로드하지 않는다.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let configured = false;

function loadNotifications(): typeof import('expo-notifications') | null {
  if (isExpoGo) return null;
  // metro lazy require: 이 함수가 처음 호출될 때만 모듈이 평가된다(=Expo Go에선 절대 평가 안 됨).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const N = require('expo-notifications') as typeof import('expo-notifications');
  if (!configured) {
    configured = true;
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    N.requestPermissionsAsync().catch(() => {});
  }
  return N;
}

// _layout에서 1회 호출. dev/standalone: 핸들러+권한 셋업. Expo Go: no-op.
export function setupNotifications(): void {
  loadNotifications();
}

// 완료 알람. dev/standalone: 로컬 알림 발사. Expo Go: 조용히 패스.
export async function notifyLocal(title: string, body: string): Promise<void> {
  const N = loadNotifications();
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({ content: { title, body }, trigger: null });
  } catch {
    /* ignore */
  }
}

// UI에서 "이 빌드는 알림 가능?"을 표시하고 싶을 때 사용.
export const notificationsAvailable = !isExpoGo;
