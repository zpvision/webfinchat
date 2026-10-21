// Notifications are local to an open FinChat tab. No push subscription or server secrets.
export class CallNotifications {
  constructor({ getAPI = () => globalThis.Notification, focus = () => globalThis.window?.focus() } = {}) {
    this.getAPI = getAPI;
    this.focus = focus;
    this.active = new Map();
    this.seen = new Set();
    this.disposed = false;
  }

  get permission() { return this.getAPI()?.permission || 'unsupported'; }

  async requestPermission() {
    // Called only by a permission button, never by receipt of a call event.
    if (this.disposed) return 'unsupported';
    if (this.permission === 'default') return this.getAPI().requestPermission();
    return this.permission;
  }

  show(notice, onOpen = () => {}) {
    if (this.disposed || this.permission !== 'granted' || this.seen.has(notice.callId)) return;
    this.seen.add(notice.callId);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
    try {
      const API = this.getAPI();
      const notification = new API('Групповой звонок · FinChat', {
        body: `В группе «${notice.title}» идёт звонок. Откройте FinChat, чтобы подключиться.`,
        icon: '/favicon-96.png', tag: `finchat-call-${notice.callId}`, silent: true,
      });
      notification.onclick = () => {
        if (this.disposed || !this.active.has(notice.callId)) return;
        this.focus();
        onOpen();
        this.close(notice.callId);
      };
      notification.onclose = () => this.active.delete(notice.callId);
      this.active.set(notice.callId, notification);
    } catch {
      return 'Браузер не смог показать системное уведомление. Приглашение доступно в FinChat.';
    }
  }

  close(callId) {
    const notification = this.active.get(callId);
    if (!notification) return;
    this.active.delete(callId);
    notification.onclick = null;
    notification.onclose = null;
    notification.close();
  }

  retain(callIds) {
    const keep = new Set(callIds);
    for (const callId of this.active.keys()) if (!keep.has(callId)) this.close(callId);
  }

  dispose() { this.disposed = true; this.retain([]); }
}
