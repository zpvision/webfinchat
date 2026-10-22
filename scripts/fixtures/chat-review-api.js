// Controlled transport for the browser regression/benchmark; never contacts FinChat.
import * as real from '__REAL_API__';
export * from '__REAL_API__';
window.__review ||= {};

function message(topic, seq) {
  return { id: `${topic}:${seq}`, topic, seq, from: 'usrPeer',
    text: `${topic} · Сообщение ${seq}\nТекст сообщения для проверки положения при чтении истории.\nЕщё одна строка текста.`,
    preview: `Сообщение ${seq}`, createdAt: new Date(Date.UTC(2026, 9, 20, 12, 0, seq)).toISOString(), attachments: [] };
}

class Socket extends EventTarget {
  constructor(client) {
    super(); this.client = client; this.readyState = 1;
    this.finchatParams = { calls: { provider: 'livekit' }, callTimeout: 30 };
    this.addEventListener('message', client.handleMessage);
    this.addEventListener('close', () => {
      if (client.socket !== this) return;
      client.subscribedTopics.clear();
      client.backgroundSubscriptions?.pause();
      client.emit({ connection: 'closed' });
    });
  }
  packet(packet) { if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(packet) })); }
  send(raw) {
    const packet = JSON.parse(raw);
    if (packet.sub) {
      const { id, topic } = packet.sub;
      const metrics = window.__review.metrics;
      metrics.pending++;
      metrics.peakPending = Math.max(metrics.peakPending, metrics.pending);
      queueMicrotask(() => { metrics.peakPendingMap = Math.max(metrics.peakPendingMap, this.client.pendingSubscriptions.size); });
      setTimeout(() => {
        metrics.pending--;
        this.packet({ __review: true, ctrl: { id, code: 200, text: 'ok' } });
      }, 120);
    } else if (packet.note?.payload?.requestId) {
      setTimeout(() => this.packet({ ctrl: { id: packet.note.payload.requestId, code: 200 } }), 1);
    }
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

export class FinchatRealtimeClient extends real.FinchatRealtimeClient {
  constructor(token) {
    super(token);
    this.socket = new Socket(this);
    this.backgroundSubscriptions?.resume();
    window.__review.client = this;
  }
  async loadUserProfile(user) { return { user, title: 'Участник' }; }
  async loadOwnProfile(user) { return { user, title: 'Вы' }; }
  async sendMessage({ topic, text }) { return { ...message(topic, 900), from: 'usrMe', text }; }
}

export async function loadChatList() {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return Array.from({ length: 100 }, (_, i) => {
    const topic = `usr${String(i).padStart(3, '0')}`;
    return { id: topic, topic, title: `Чат ${String(i).padStart(3, '0')}`, canWrite: true, isGroup: false,
      unread: 0, preview: 'Сообщение', updatedAt: '2026-10-20T12:00:00Z', raw: { seq: 400, read: 400 } };
  });
}
export async function loadTopicMessages(token, topic, { beforeSeq, limit }) {
  if (!beforeSeq) return Array.from({ length: 10 }, (_, i) => message(topic, 391 + i));
  const items = Array.from({ length: Math.min(limit, beforeSeq - 1) }, (_, i) => message(topic, Math.max(1, beforeSeq - limit) + i));
  return new Promise((resolve) => window.__review.history.push({ topic, beforeSeq, resolve: () => resolve(items) }));
}
export async function loadTopicMembers() { return []; }
export async function markTopicRead() {}
export async function loadTopicMessageBySeq() { return null; }

window.__review.packet = (topic, seq, content) => window.__review.client.socket.packet({ data: {
  topic, seq, from: 'usrPeer', ts: new Date().toISOString(), content: content || `Входящее ${seq}`,
} });
window.__review.reconnect = () => {
  const client = window.__review.client;
  client.socket.close();
  client.socket = new Socket(client);
  client.pendingSubscriptions.clear();
  client.emit({ connection: 'opened' });
  client.backgroundSubscriptions?.resume();
};
