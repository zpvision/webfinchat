// One manager per signed-in client. History and replay must never ring.
export class MessageNotifications {
  constructor({ user, sounds, onNotice = () => {}, onOpen = () => {},
    getAPI = () => globalThis.Notification, focus = () => globalThis.window?.focus(),
    now = () => Date.now() } = {}) {
    Object.assign(this, { user, sounds, onNotice, onOpen, getAPI, focus, now });
    this.sequences = new Map();
    this.active = new Map();
    this.lastSound = -Infinity;
  }

  seed(chats) {
    for (const chat of chats) this.sequences.set(chat.topic,
      Math.max(this.sequences.get(chat.topic) || 0, Number(chat.raw?.seq) || 0));
  }

  receive(data, message, chat, { selectedId, focused } = {}) {
    if (this.disposed || !chat || data.id || data.topic === 'me') return;
    const seq = Number(data.seq);
    if (!Number.isSafeInteger(seq) || seq <= (this.sequences.get(data.topic) || 0)) return;
    this.sequences.set(data.topic, seq);
    if (!data.from || data.from === this.user || message.deletedAt || message.replaceSeq || data.head?.webrtc) return;
    if (focused && chat.id === selectedId) return;
    const notice = { topic: chat.topic, chatId: chat.id, title: chat.title || 'Новое сообщение',
      body: String(message.preview || message.text || 'Новое сообщение').slice(0, 180), seq };
    this.onNotice(notice);
    if (this.now() - this.lastSound >= 1200) {
      this.lastSound = this.now();
      this.sounds?.setMode('notice', `${notice.topic}:${seq}`);
      clearTimeout(this.soundTimer);
      // Do not play a stale message later when autoplay is finally unlocked.
      this.soundTimer = setTimeout(() => this.sounds?.setMode(null), 1200);
    }
    if (this.getAPI()?.permission !== 'granted') return;
    this.close(chat.topic);
    try {
      const API = this.getAPI();
      const notification = new API(`${notice.title} · FinChat`, {
        body: notice.body, icon: '/favicon-96.png', tag: `finchat-message-${chat.topic}`, silent: true,
      });
      this.active.set(chat.topic, notification);
      notification.onclick = () => {
        if (this.disposed || this.active.get(chat.topic) !== notification) return;
        this.focus();
        this.onOpen(notice);
        this.close(chat.topic);
      };
      notification.onclose = () => {
        if (this.active.get(chat.topic) === notification) this.active.delete(chat.topic);
      };
      while (this.active.size > 20) this.close(this.active.keys().next().value);
    } catch { /* In-app notice and sound still work without native notifications. */ }
  }

  close(topic) {
    const notification = this.active.get(topic);
    if (!notification) return;
    this.active.delete(topic);
    notification.onclick = null;
    notification.onclose = null;
    notification.close();
  }

  read(chat) {
    if (chat) this.close(chat.topic);
    clearTimeout(this.soundTimer);
    this.sounds?.setMode(null);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.soundTimer);
    for (const topic of this.active.keys()) this.close(topic);
    this.sounds?.dispose();
  }
}
