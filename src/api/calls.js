const REQUEST_TIMEOUT = 12000;
const idle = () => ({ ready: false, reason: 'Подключаем звонки…', call: null, error: '', muted: false, needsAudio: false });

// Finchat carries signalling; only LiveKit handles microphone tracks and audio.
export class CallController {
  constructor(client, { createRoom, onChange = () => {} } = {}) {
    this.client = client;
    this.createRoom = createRoom;
    this.onChange = onChange;
    this.state = idle();
    this.pending = new Map();
    this.versions = new Map();
    this.closed = new Set();
    this.audioElements = new Set();
    this.unsubscribe = null;
    this.disposed = false;
    this.reconnecting = false;
  }

  update(patch) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  updateCall(call, patch) {
    if (this.state.call !== call || this.disposed) return false;
    Object.assign(call, patch);
    this.update({ call });
    return true;
  }

  async initialize() {
    this.unsubscribe = this.client.onPacket((packet) => this.handlePacket(packet));
    try {
      await this.client.connect();
      if (this.disposed) return;
      const params = this.client.socket.finchatParams || {};
      if (params.calls?.provider !== 'livekit') {
        this.update({ ready: false, reason: 'Сервер Finchat пока не объявляет поддержку звонков LiveKit.' });
        return;
      }
      await this.client.attach('me');
      if (this.disposed) return;
      this.callTimeout = Math.max(1, Number(params.callTimeout) || 30) * 1000;
      this.update({ ready: true, reason: '' });
    } catch (error) {
      this.update({ ready: false, reason: error.message || 'Не удалось подключить звонки.' });
      this.scheduleReconnect();
    }
  }

  request(packet, id, type, call = null) {
    if (this.disposed) return Promise.reject(new Error('Звонки отключены.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Сервер не ответил на команду звонка.'));
      }, REQUEST_TIMEOUT);
      const finish = (error, value) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (error) reject(error);
        else resolve(value);
      };
      this.pending.set(id, { type, finish, ctrl: null, info: null, call });
      try {
        if (this.client.socket?.readyState !== 1) throw new Error('Соединение Finchat потеряно.');
        this.client.socket.send(JSON.stringify(packet));
      } catch (error) { finish(error); }
    });
  }

  async note(call, action, type = 'ack') {
    if (this.disposed) throw new Error('Звонки отключены.');
    await this.client.attach(call.topic);
    const requestId = this.client.nextId('call');
    return this.request({ note: {
      topic: call.topic, what: 'call', seq: call.seq || 0,
      event: ['leave', 'end'].includes(action) ? 'hang-up' : action === 'ringing' ? 'ringing' : 'accept',
      payload: { ...(action === 'ringing' ? {} : { action }), requestId },
    } }, requestId, type);
  }

  handlePacket(packet) {
    if (packet.connection === 'closed') {
      for (const pending of [...this.pending.values()]) pending.finish(new Error('Соединение Finchat потеряно.'));
      this.update({ ready: false, reason: 'Восстанавливаем соединение звонков…' });
      this.scheduleReconnect();
      return;
    }
    const info = packet.info;
    const payload = info?.what === 'call' ? info.payload : null;
    const id = packet.ctrl?.id || payload?.requestId;
    const pending = this.pending.get(id);
    if (pending) {
      if (packet.ctrl?.code >= 300) {
        const error = new Error(packet.ctrl.text || 'Ошибка звонка.');
        error.code = packet.ctrl.code;
        pending.finish(error);
      } else {
        if (packet.ctrl) pending.ctrl = packet.ctrl;
        if (payload?.type === 'token' || payload?.type === 'status') pending.info = info;
        if (pending.type === 'start' && pending.call) {
          if (packet.ctrl?.params?.seq) pending.call.seq = packet.ctrl.params.seq;
          if (payload?.type === 'token' && (info.topic === pending.call.topic || info.src === pending.call.topic)) {
            Object.assign(pending.call, { seq: info.seq, callId: payload.callId });
          }
        }
        if (pending.type === 'start' && pending.ctrl && pending.info?.payload.type === 'token') {
          pending.finish(null, pending.info);
        } else if (pending.type === 'ack' && pending.ctrl) {
          pending.finish(null, pending.ctrl);
        } else if (pending.info?.payload.type === pending.type) {
          pending.finish(null, pending.info);
        }
      }
    }
    // Token/status responses are independent of notification versions.
    if (!payload || payload.type || !payload.callId) return;
    const callId = payload.callId;
    const version = Number(payload.version || 0);
    if (version <= (this.versions.get(callId) ?? -1)) return;
    this.versions.set(callId, version);
    // Bounded deduplication for the lifetime of this page.
    if (this.versions.size > 500) this.versions.delete(this.versions.keys().next().value);
    const event = payload.event || info.event;
    if (event === 'invite') {
      if (!this.state.ready || this.closed.has(callId) || payload.group || payload.audioOnly === false) return;
      const expiresAt = Date.parse(payload.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || this.state.call) return;
      const topic = payload.topic || info.src;
      const seq = Number(payload.seq || info.seq);
      if (!topic?.startsWith('usr') || !seq) return;
      const call = { callId, topic, seq, title: payload.title || topic, phase: 'incoming', expiresAt, incoming: true };
      this.update({ call, error: '', muted: false });
      this.armTimeout(call, expiresAt - Date.now());
      this.note(call, 'ringing').catch((error) => this.update({ error: error.message }));
      return;
    }
    const call = this.state.call;
    if (call && !call.incoming && !call.callId && call.seq === info.seq
      && call.topic === (payload.topic || info.src || info.topic)) call.callId = callId;
    if (['cancelled', 'ended', 'declined', 'answered_elsewhere'].includes(event)) {
      this.rememberClosed(callId);
      if (call?.callId === callId && (event !== 'answered_elsewhere' || (call.incoming && !call.accepted))) {
        this.finish(call);
        const message = event === 'answered_elsewhere' ? 'На звонок ответили на другом устройстве.'
          : payload.reason === 'declined' || event === 'declined' ? 'Собеседник отклонил звонок.'
            : payload.reason === 'missed' ? 'Звонок завершён без ответа.' : '';
        this.update({ error: message });
      }
    } else if (event === 'accepted' && call?.callId === callId
      && ['starting', 'outgoing', 'connecting'].includes(call.phase)) {
      clearTimeout(this.expiryTimer);
      this.updateCall(call, { phase: call.connectedAt ? 'active' : 'connecting', accepted: true });
    }
  }

  rememberClosed(callId) {
    if (!callId) return;
    this.closed.add(callId);
    if (this.closed.size > 500) this.closed.delete(this.closed.values().next().value);
  }

  armTimeout(call, delay) {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => {
      if (this.state.call !== call || call.accepted || call.connectedAt) return;
      if (call.incoming) {
        this.finish(call);
        this.update({ error: 'Время ожидания ответа истекло.' });
      } else {
        this.hangUp().catch(() => {});
      }
    }, delay);
  }

  async checkMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Для звонка нужен HTTPS и доступ к микрофону.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  }

  async start(chat) {
    if (!this.state.ready || this.state.call || !chat.topic?.startsWith('usr')) return;
    const call = { topic: chat.topic, title: chat.title, seq: 0, phase: 'preparing', incoming: false };
    this.update({ call, error: '', muted: false });
    try {
      await this.checkMicrophone();
      if (this.state.call !== call) return;
      await this.client.attach(call.topic);
      if (this.state.call !== call) return;
      const id = this.client.nextId('call-start');
      this.updateCall(call, { phase: 'starting' });
      let info;
      try {
        info = await this.request({ pub: { id, topic: call.topic, head: { webrtc: 'started', aonly: true }, content: 'Аудиозвонок' } }, id, 'start', call);
      } catch (error) {
        // A lost token/ctrl must never create a second call.
        const status = await this.note(call, 'status', 'status');
        if (!status.payload.active || !['ringing', 'connecting', 'active'].includes(status.payload.state)
          || status.payload.participation !== 'this-session') throw error;
        call.seq = status.seq;
        call.callId = status.payload.callId;
        info = await this.note(call, 'join', 'token');
      }
      Object.assign(call, { seq: info.seq, callId: info.payload.callId });
      if (this.state.call !== call || this.closed.has(call.callId)) {
        await this.note(call, 'leave');
        if (this.state.call === call) this.finish(call);
        return;
      }
      this.updateCall(call, { phase: call.accepted ? 'connecting' : 'outgoing' });
      if (!call.accepted) this.armTimeout(call, this.callTimeout);
      await this.connectMedia(call, info);
    } catch (error) { await this.fail(call, error); }
  }

  async accept() {
    const call = this.state.call;
    if (!call || call.phase !== 'incoming') return;
    this.updateCall(call, { phase: 'preparing' });
    try {
      await this.checkMicrophone();
      if (this.state.call !== call) return;
      if (Date.now() >= call.expiresAt) throw new Error('Приглашение уже истекло.');
      clearTimeout(this.expiryTimer);
      this.updateCall(call, { phase: 'joining' });
      let info;
      try { info = await this.note(call, 'join', 'token'); }
      catch (error) {
        const status = await this.note(call, 'status', 'status');
        if (status.payload.callId !== call.callId || status.payload.participation !== 'this-session'
          || !['connecting', 'active'].includes(status.payload.state)) throw error;
        info = await this.note(call, 'join', 'token');
      }
      if (info.payload.callId !== call.callId || Number(info.seq) !== Number(call.seq)
        || (info.topic !== call.topic && info.src !== call.topic)) throw new Error('Ответ относится к другому звонку.');
      if (this.state.call !== call || this.closed.has(call.callId)) return;
      clearTimeout(this.expiryTimer);
      this.updateCall(call, { phase: 'connecting', accepted: true });
      await this.connectMedia(call, info);
    } catch (error) { await this.fail(call, error); }
  }

  async connectMedia(call, info) {
    const { url, token, provider } = info.payload;
    if (provider !== 'livekit' || new URL(url).protocol !== 'wss:' || !token) throw new Error('Некорректные параметры медиасервера.');
    const { Room, RoomEvent, Track } = await import('livekit-client');
    if (this.state.call !== call || this.disposed) return;
    const room = this.createRoom ? this.createRoom() : new Room();
    this.room = room;
    const current = () => this.state.call === call && this.room === room && !this.disposed;
    const markActive = () => {
      if (!current()) return;
      const hasAudio = [...room.remoteParticipants.values()].some((participant) =>
        [...participant.audioTrackPublications.values()].some((publication) => publication.isSubscribed));
      if (hasAudio) {
        clearTimeout(this.expiryTimer);
        this.updateCall(call, { phase: 'active', accepted: true, connectedAt: call.connectedAt || Date.now() });
      }
    };
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (!current() || track.kind !== Track.Kind.Audio) return;
      const element = track.attach();
      element.hidden = true;
      document.body.appendChild(element);
      this.audioElements.add(element);
      markActive();
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => {
      this.audioElements.delete(element);
      element.remove();
    }));
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (current()) this.update({ needsAudio: !room.canPlaybackAudio });
    });
    room.on(RoomEvent.Reconnecting, () => { if (current()) this.updateCall(call, { phase: 'reconnecting' }); });
    room.on(RoomEvent.Reconnected, () => {
      if (current()) { this.updateCall(call, { phase: call.accepted ? 'connecting' : 'outgoing' }); markActive(); }
    });
    room.on(RoomEvent.Disconnected, () => {
      if (current()) this.fail(call, new Error('Медиасоединение потеряно. Попробуйте позвонить снова.'));
    });
    await room.connect(url, token);
    if (!current()) { await room.disconnect(); return; }
    await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true });
    if (!current()) { await room.disconnect(); return; }
    await room.startAudio().catch(() => { if (current()) this.update({ needsAudio: true }); });
    markActive();
  }

  async toggleMicrophone() {
    const call = this.state.call;
    const room = this.room;
    if (!room || !call || this.muting) return;
    this.muting = true;
    try {
      const muted = !this.state.muted;
      await room.localParticipant.setMicrophoneEnabled(!muted);
      if (this.room === room && this.state.call === call) this.update({ muted });
    } catch { this.update({ error: 'Не удалось переключить микрофон.' }); }
    finally { this.muting = false; }
  }

  async enableAudio() {
    try { await this.room?.startAudio(); }
    catch { this.update({ error: 'Браузер не разрешил воспроизведение звука.' }); }
  }

  async hangUp() {
    const call = this.state.call;
    if (!call || ['starting', 'joining', 'ending'].includes(call.phase)) return;
    this.updateCall(call, { phase: 'ending' });
    this.stopMedia();
    clearTimeout(this.expiryTimer);
    if (!call.seq) { this.finish(call); return; }
    try {
      await this.note(call, 'leave');
      this.finish(call);
    } catch (error) {
      // Never repeat leave blindly when its acknowledgement was lost.
      try {
        const info = await this.note(call, 'status', 'status');
        if (!info.payload.active || info.payload.callId !== call.callId || info.payload.participation !== 'this-session') {
          this.finish(call);
          return;
        }
      } catch { /* Keep a retry action visible until the user decides. */ }
      this.updateCall(call, { phase: 'end-failed' });
      this.update({ error: `${error.message} Повторите завершение звонка.` });
    }
  }

  async fail(call, error) {
    if (this.state.call !== call || this.disposed) return;
    this.update({ error: error.name === 'NotAllowedError' ? 'Разрешите доступ к микрофону в браузере.' : error.message });
    await this.hangUpAfterFailure(call);
  }

  async hangUpAfterFailure(call) {
    if (this.state.call !== call) return;
    // Unlock a failed start/join, so the existing call can be closed.
    this.updateCall(call, { phase: 'failed' });
    await this.hangUp();
  }

  stopMedia() {
    const room = this.room;
    this.room = null;
    if (room) {
      room.removeAllListeners();
      Promise.resolve(room.disconnect()).catch(() => {});
    }
    this.audioElements.forEach((element) => element.remove());
    this.audioElements.clear();
    this.update({ needsAudio: false });
  }

  finish(call) {
    if (this.state.call !== call) return;
    clearTimeout(this.expiryTimer);
    this.rememberClosed(call.callId);
    this.stopMedia();
    this.update({ call: null, muted: false });
  }

  scheduleReconnect() {
    if (this.disposed || this.reconnecting) return;
    this.reconnecting = true;
    this.retryTimer = setTimeout(async () => {
      try {
        await this.client.connect();
        if (this.disposed) return;
        if (this.client.socket.finchatParams?.calls?.provider !== 'livekit') throw new Error('Звонки недоступны на сервере.');
        await this.client.attach('me');
        const call = this.state.call;
        if (call?.seq) {
          const info = await this.note(call, 'status', 'status');
          if (!info.payload.active || info.payload.callId !== call.callId
            || ['expired', 'ending', 'idle'].includes(info.payload.state)) this.finish(call);
        }
        this.update({ ready: true, reason: '' });
      } catch (error) {
        this.update({ ready: false, reason: error.message });
      } finally {
        this.reconnecting = false;
        if (!this.state.ready && !this.disposed) this.scheduleReconnect();
      }
    }, 3000);
  }

  dispose() {
    const call = this.state.call;
    if (call?.seq && this.client.socket?.readyState === 1) {
      // Best effort on logout/unmount. Never keep microphone capture alive.
      this.client.socket.send(JSON.stringify({ note: { topic: call.topic, what: 'call', event: 'hang-up', seq: call.seq,
        payload: { action: 'leave', requestId: this.client.nextId('call-leave') } } }));
    }
    this.disposed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.expiryTimer);
    this.unsubscribe?.();
    this.stopMedia();
    for (const pending of [...this.pending.values()]) pending.finish(new Error('Звонки отключены.'));
  }
}
