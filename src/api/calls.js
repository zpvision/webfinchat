import { canJoinGroup, groupStatus } from './groupCalls.js';

const REQUEST_TIMEOUT = 12000;
const idle = () => ({ ready: false, groupReady: false, groupCalls: {}, groupNotices: [], reason: 'Подключаем звонки…', call: null, error: '', muted: false, needsAudio: false, remoteParticipants: [] });

// Tinode carries signalling; the same LiveKit room handles audio and camera tracks.
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
    this.audioTracks = new Map();
    this.unsubscribe = null;
    this.disposed = false;
    this.reconnecting = false;
    this.groupRequests = new Map();
    this.groupWatchers = new Map();
    this.groupRevisions = new Map();
    this.dismissedGroupNotices = new Set();
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
      this.update({ ready: true, groupReady: params.calls?.group === true,
        groupNotifications: params.calls?.groupNotifications || 'notify',
        maxParticipants: Number(params.calls?.maxParticipants) || null, reason: '' });
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

  setGroupStatus(topic, status) {
    if (!topic?.startsWith('grp')) return;
    this.groupRevisions.set(topic, (this.groupRevisions.get(topic) || 0) + 1);
    const groupCalls = { ...this.state.groupCalls, [topic]: status };
    const groupNotices = this.state.groupNotices.filter((notice) => {
      if (notice.topic !== topic) return true;
      return notice.callId === status.callId && canJoinGroup(status) && status.participation !== 'other-session';
    });
    this.update({ groupCalls, groupNotices });
    const call = this.state.call;
    if (call?.group && call.topic === topic && call.callId === status.callId) {
      this.updateCall(call, { canEnd: status.canEnd === true });
    }
  }

  showGroupNotice(status) {
    if (!canJoinGroup(status) || this.dismissedGroupNotices.has(status.callId)
      || this.closed.has(status.callId) || this.state.call?.topic === status.topic
      || this.state.groupNotices.some((notice) => notice.callId === status.callId)) return;
    this.update({ groupNotices: [...this.state.groupNotices, {
      callId: status.callId, topic: status.topic, title: status.title,
    }].slice(-5) });
  }

  dismissGroupNotice(callId) {
    this.dismissedGroupNotices.add(callId);
    if (this.dismissedGroupNotices.size > 500) this.dismissedGroupNotices.delete(this.dismissedGroupNotices.values().next().value);
    this.update({ groupNotices: this.state.groupNotices.filter((notice) => notice.callId !== callId) });
  }

  refreshGroup(chat) {
    if (this.disposed) return Promise.reject(new Error('Звонки отключены.'));
    if (this.groupRequests.has(chat.topic)) return this.groupRequests.get(chat.topic);
    const revision = this.groupRevisions.get(chat.topic) || 0;
    const request = this.note({ topic: chat.topic, seq: 0 }, 'status', 'status').then((info) => {
      if (info.topic !== chat.topic && info.src !== chat.topic) throw new Error('Статус относится к другому чату.');
      const status = groupStatus(info, chat.title);
      if ((this.groupRevisions.get(chat.topic) || 0) === revision) {
        this.setGroupStatus(chat.topic, status);
        return status;
      }
      // A newer invite/ended event may have arrived while status was in flight.
      return this.state.groupCalls[chat.topic] || status;
    }).finally(() => {
      if (this.groupRequests.get(chat.topic) === request) this.groupRequests.delete(chat.topic);
    });
    this.groupRequests.set(chat.topic, request);
    return request;
  }

  watchGroup(chat) {
    if (!chat.topic?.startsWith('grp') || !this.state.groupReady) return () => {};
    const refresh = () => {
      if (!this.state.ready || this.disposed) return;
      this.refreshGroup(chat).catch((error) => {
        if (!this.disposed) this.setGroupStatus(chat.topic, {
          ...this.state.groupCalls[chat.topic], error: error.message || 'Не удалось проверить звонок.',
        });
      });
    };
    // The open group also recovers calls whose invite was received while offline.
    const timer = setInterval(refresh, 15000);
    const onFocus = () => refresh();
    globalThis.window?.addEventListener('focus', onFocus);
    const entry = { refresh, dispose: () => {
      clearInterval(timer);
      globalThis.window?.removeEventListener('focus', onFocus);
    } };
    this.groupWatchers.set(chat.topic, entry);
    refresh();
    return () => {
      entry.dispose();
      if (this.groupWatchers.get(chat.topic) === entry) this.groupWatchers.delete(chat.topic);
    };
  }

  async joinGroup(chat, expectedCallId) {
    return this.start(chat, 'video', { joinOnly: true, expectedCallId });
  }

  async joinGroupMedia(call) {
    await this.checkMicrophone();
    if (this.state.call !== call) return;
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
    this.updateCall(call, { phase: 'connecting', accepted: true });
    await this.connectMedia(call, info);
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
    const topic = payload.topic || info.src || info.topic;
    const group = payload.group === true || topic?.startsWith('grp');
    if (group && this.state.groupReady) {
      const previous = this.state.groupCalls[topic];
      if (event === 'invite') {
        this.setGroupStatus(topic, { ...payload, topic, callId, seq: Number(payload.seq || info.seq),
          title: payload.title || topic, type: payload.audioOnly === false ? 'video' : 'audio',
          state: 'ringing', active: true, canEnd: false, error: '' });
        if (payload.ring === false || (payload.ring !== true && this.state.groupNotifications !== 'ring')) {
          this.showGroupNotice(this.state.groupCalls[topic]);
        }
      } else if (event === 'ended' && (!previous || previous.callId === callId)) {
        this.setGroupStatus(topic, { ...previous, callId, active: false, state: 'idle' });
      } else if (['accepted', 'cancelled', 'declined', 'left'].includes(event)) {
        if (event === 'accepted' && previous?.callId === callId) {
          this.setGroupStatus(topic, { ...previous, active: true, state: 'connecting' });
        }
        this.groupWatchers.get(topic)?.refresh();
      }
    }
    if (event === 'invite') {
      if (!this.state.ready || this.closed.has(callId) || (group && !this.state.groupReady)) return;
      if (group && (payload.ring === false || (payload.ring !== true && this.state.groupNotifications !== 'ring'))) return;
      const expiresAt = Date.parse(payload.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || this.state.call) return;
      const seq = Number(payload.seq || info.seq);
      if (!(group ? topic?.startsWith('grp') : topic?.startsWith('usr')) || !seq) return;
      const call = { callId, topic, seq, group, type: payload.audioOnly === false ? 'video' : 'audio', title: payload.title || topic, phase: 'incoming', expiresAt, incoming: true };
      this.update({ call, error: '', muted: false });
      this.armTimeout(call, expiresAt - Date.now());
      this.note(call, 'ringing').catch((error) => this.update({ error: error.message }));
      return;
    }
    const call = this.state.call;
    if (call && !call.incoming && !call.callId && call.seq === info.seq
      && call.topic === (payload.topic || info.src || info.topic)) call.callId = callId;
    if (['cancelled', 'ended', 'declined', 'answered_elsewhere', 'left'].includes(event)) {
      if (group) this.dismissGroupNotice(callId);
      // Closing a group invitation must not end an already accepted local participation.
      if (call?.group && call.callId === callId && call.accepted
        && ['declined', 'answered_elsewhere'].includes(event)) return;
      if (call?.group && call.callId === callId && call.accepted && event === 'cancelled') {
        this.reconcileGroup(call);
        return;
      }
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

  async reconcileGroup(call) {
    try {
      const info = await this.note(call, 'status', 'status');
      if (this.state.call !== call) return;
      if (!info.payload.active || info.payload.callId !== call.callId
        || info.payload.participation !== 'this-session'
        || ['idle', 'expired', 'ending'].includes(info.payload.state)) this.finish(call);
    } catch { /* The existing reconnect/status path will retry when signalling recovers. */ }
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

  async start(chat, type = 'audio', { joinOnly = false, expectedCallId } = {}) {
    const group = chat.topic?.startsWith('grp');
    if (!this.state.ready || this.state.call || (group ? !this.state.groupReady : !chat.topic?.startsWith('usr'))) return;
    const call = { group, participantNames: chat.participantNames, type: type === 'video' ? 'video' : 'audio', topic: chat.topic, title: chat.title, seq: 0, phase: 'preparing', incoming: false };
    this.update({ call, error: '', muted: false });
    try {
      if (group) {
        const status = await this.refreshGroup(chat);
        if (this.state.call !== call) return;
        if (expectedCallId && status.callId !== expectedCallId) throw new Error('Этот звонок уже завершился.');
        if (status.participation === 'other-session' && canJoinGroup(status)) {
          throw new Error('Этот звонок уже открыт на другом устройстве. Сначала выйдите из него там.');
        }
        if (canJoinGroup(status)) {
          Object.assign(call, { callId: status.callId, seq: status.seq, type: status.type,
            canEnd: status.canEnd === true });
          // Explicit rejoin is allowed after leaving or dismissing the same group call.
          this.closed.delete(call.callId);
          await this.joinGroupMedia(call);
          return;
        }
        if (joinOnly) throw new Error('Звонок уже завершился. Можно начать новый.');
        if (status.active || status.state === 'ending') throw new Error('Предыдущий звонок ещё завершается. Попробуйте немного позже.');
      }
      await this.checkMicrophone();
      if (this.state.call !== call) return;
      await this.client.attach(call.topic);
      if (this.state.call !== call) return;
      const id = this.client.nextId('call-start');
      this.updateCall(call, { phase: 'starting' });
      let info;
      try {
        info = await this.request({ pub: { id, topic: call.topic, head: { webrtc: 'started', aonly: call.type === 'audio' }, content: call.type === 'video' ? 'Видеозвонок' : 'Аудиозвонок' } }, id, 'start', call);
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
    const room = this.createRoom ? this.createRoom() : new Room(call.group ? { adaptiveStream: true, dynacast: true } : undefined);
    this.room = room;
    const current = () => this.state.call === call && this.room === room && !this.disposed;
    const syncVideo = () => {
      if (!current()) return;
      const camera = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const localVideo = camera && !camera.isMuted ? camera.track || null : null;
      const remoteParticipants = [...room.remoteParticipants.values()].map((participant) => {
        const publication = participant.getTrackPublication(Track.Source.Camera);
        const audio = participant.getTrackPublication(Track.Source.Microphone);
        return { identity: participant.identity, name: participant.name || participant.identity.split(':')[0],
          track: publication?.track && publication.isSubscribed && !publication.isMuted ? publication.track : null,
          microphoneMuted: !audio || audio.isMuted, speaking: participant.isSpeaking === true };
      });
      const remoteVideos = remoteParticipants.filter((participant) => participant.track);
      this.update({ localVideo, cameraEnabled: Boolean(localVideo), remoteVideos, remoteParticipants });
    };
    this.syncVideo = syncVideo;
    for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ParticipantNameChanged]) room.on(event, syncVideo);
    const devicesChanged = () => this.refreshCameras(room);
    navigator.mediaDevices?.addEventListener?.('devicechange', devicesChanged);
    this.removeDeviceListener = () => navigator.mediaDevices?.removeEventListener?.('devicechange', devicesChanged);
    const markActive = () => {
      if (!current()) return;
      const hasAudio = [...room.remoteParticipants.values()].some((participant) =>
        [...participant.audioTrackPublications.values()].some((publication) => publication.isSubscribed));
      if (hasAudio || (call.group && (call.accepted || room.remoteParticipants.size > 0))) {
        clearTimeout(this.expiryTimer);
        this.updateCall(call, { phase: 'active', accepted: true, connectedAt: call.connectedAt || Date.now() });
      }
    };
    room.on(RoomEvent.ParticipantConnected, markActive);
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (!current() || track.kind !== Track.Kind.Audio) return;
      if (this.audioTracks.has(track)) { markActive(); return; }
      const element = track.attach();
      element.hidden = true;
      document.body.appendChild(element);
      this.audioElements.add(element);
      this.audioTracks.set(track, element);
      markActive();
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      this.audioTracks.delete(track);
      track.detach().forEach((element) => {
      element.srcObject = null;
      // React owns video elements; only controller-owned audio nodes are removed here.
      if (this.audioElements.delete(element)) element.remove();
      });
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (current()) this.update({ needsAudio: !room.canPlaybackAudio });
    });
    room.on(RoomEvent.Reconnecting, () => { if (current()) this.updateCall(call, { phase: 'reconnecting' }); });
    room.on(RoomEvent.Reconnected, () => {
      if (current()) { this.updateCall(call, { phase: call.accepted ? 'connecting' : 'outgoing' }); markActive(); syncVideo(); }
    });
    room.on(RoomEvent.Disconnected, () => {
      if (current()) this.fail(call, new Error('Медиасоединение потеряно. Попробуйте позвонить снова.'));
    });
    await room.connect(url, token);
    if (!current()) { await room.disconnect(); return; }
    await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true });
    if (!current()) { await room.disconnect(); return; }
    if (call.type === 'video') await this.setCamera(true);
    if (!current()) { await room.disconnect(); return; }
    syncVideo();
    await room.startAudio().catch(() => { if (current()) this.update({ needsAudio: true }); });
    markActive();
    if (call.group) this.refreshGroup({ topic: call.topic, title: call.title }).catch(() => {});
  }

  async refreshCameras(room = this.room) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (this.room === room) this.update({ cameras: devices.filter((device) => device.kind === 'videoinput') });
    } catch { /* Enumeration must not interrupt audio. */ }
  }

  async setCamera(enabled) {
    const room = this.room;
    if (!room || this.state.cameraBusy) return;
    this.update({ cameraBusy: true });
    try {
      const publication = await room.localParticipant.setCameraEnabled(enabled);
      if (this.room !== room || this.disposed) {
        await room.localParticipant.setCameraEnabled(false);
        room.localParticipant.getTrackPublication('camera')?.track?.stop();
        return;
      }
      this.syncVideo?.();
      if (enabled && (!publication?.track || publication.isMuted)) {
        throw new Error('Camera publication is not active');
      }
      this.update({ error: '' });
      await this.refreshCameras(room);
    } catch (error) {
      if (this.room === room) {
        this.update({ error: error.name === 'PublishTrackError' && error.status === 403
          ? 'Сервер не разрешил публикацию камеры в этом звонке. Звонок продолжится без видео.'
          : error.name === 'NotAllowedError'
          ? 'Нет доступа к камере. Звонок продолжится без видео.'
          : error.name === 'NotFoundError' ? 'Камера не найдена. Звонок продолжится без видео.'
            : error.name === 'NotReadableError' ? 'Камера занята или недоступна. Звонок продолжится без видео.'
            : 'Не удалось включить камеру. Звонок продолжится без видео.' });
        this.syncVideo?.();
      }
    } finally {
      if (this.room === room) this.update({ cameraBusy: false });
    }
  }

  toggleCamera() { return this.setCamera(!this.state.cameraEnabled); }

  async switchCamera() {
    const room = this.room;
    if (!room || !this.state.cameraEnabled || this.state.cameraBusy || this.state.cameras.length < 2) return;
    this.update({ cameraBusy: true });
    try {
      const track = room.localParticipant.getTrackPublication('camera')?.track;
      const deviceId = await track?.getDeviceId();
      if (this.room !== room) return;
      const devices = this.state.cameras;
      const next = devices[(devices.findIndex((device) => device.deviceId === deviceId) + 1) % devices.length];
      if (!await room.switchActiveDevice('videoinput', next.deviceId)) throw new Error('camera');
      if (this.room === room) this.syncVideo?.();
    } catch {
      if (this.room === room) this.update({ error: 'Не удалось переключить камеру.' });
    } finally {
      if (this.room === room) this.update({ cameraBusy: false });
      else room.localParticipant.getTrackPublication('camera')?.track?.stop();
    }
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

  async hangUp(action = 'leave') {
    const call = this.state.call;
    if (!call || ['starting', 'joining', 'ending'].includes(call.phase)) return;
    if (action === 'end' && (!call.group || !call.canEnd)) return;
    action = call.endAction || action;
    call.endAction = action;
    this.updateCall(call, { phase: 'ending' });
    this.stopMedia();
    clearTimeout(this.expiryTimer);
    if (!call.seq) { this.finish(call); return; }
    try {
      const result = await this.note(call, action);
      if (call.group && (action === 'end' || result.params?.state === 'ended')) {
        const status = this.state.groupCalls[call.topic];
        if (status?.callId === call.callId) this.setGroupStatus(call.topic, { ...status, active: false, state: 'idle' });
      }
      this.finish(call);
      if (call.group) this.groupWatchers.get(call.topic)?.refresh();
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
    this.removeDeviceListener?.();
    this.removeDeviceListener = null;
    this.syncVideo = null;
    if (room) {
      for (const participant of [room.localParticipant, ...(room.remoteParticipants?.values() || [])]) {
        for (const publication of participant?.trackPublications?.values() || []) {
          publication.track?.detach().forEach((element) => { element.srcObject = null; });
          if (participant === room.localParticipant) publication.track?.stop();
        }
      }
      room.removeAllListeners();
      Promise.resolve(room.disconnect()).catch(() => {});
    }
    this.audioElements.forEach((element) => element.remove());
    this.audioElements.clear();
    this.audioTracks.clear();
    this.update({ needsAudio: false, cameraEnabled: false, cameraBusy: false, cameras: [], localVideo: null, remoteVideos: [], remoteParticipants: [] });
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
        const params = this.client.socket.finchatParams.calls;
        this.update({ ready: true, groupReady: params.group === true,
          groupNotifications: params.groupNotifications || 'notify',
          maxParticipants: Number(params.maxParticipants) || null, reason: '' });
        this.groupWatchers.forEach((watcher) => watcher.refresh());
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
    this.groupWatchers.forEach((watcher) => watcher.dispose());
    this.groupWatchers.clear();
    this.stopMedia();
    for (const pending of [...this.pending.values()]) pending.finish(new Error('Звонки отключены.'));
  }
}
