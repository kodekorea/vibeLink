// Cloudflare Worker — VAPID Web Push relay. PC 의 push 검출 결과를 받아 휴대폰 PWA Service Worker 로 전달.
// M5-T3 stub. 정식 구현은 다음 마일스톤에서 (exponential backoff 3회 + JSONL audit 포함).

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('POST only', { status: 405 });
    }
    // TODO: VAPID 인증 + Web Push 전송 + retry + audit.
    return new Response(JSON.stringify({ status: 'stub' }), {
      headers: { 'content-type': 'application/json' }
    });
  }
};
