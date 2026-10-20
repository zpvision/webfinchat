import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CallController } from './api/calls.js';
import { CallSounds } from './api/callSounds.js';
import { CallScenery } from './CallScenery.jsx';
import { VideoStage } from './calls/VideoStage.jsx';

export function useCalls(client) {
  const [state, setState] = useState({ ready: false, reason: 'Подключаем звонки…', call: null, error: '' });
  const controller = useRef(null);
  const sounds = useRef(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const soundMode = state.call?.phase === 'incoming' ? 'incoming'
    : state.call?.phase === 'outgoing' ? 'outgoing' : null;
  useEffect(() => {
    const instance = new CallSounds({ onBlocked: setSoundBlocked });
    sounds.current = instance;
    const unlock = () => instance.unlock();
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      instance.dispose();
      if (sounds.current === instance) sounds.current = null;
    };
  }, [client]);
  useEffect(() => { sounds.current?.setMode(soundMode); }, [soundMode, client]);
  useEffect(() => {
    const instance = new CallController(client, { onChange: setState });
    controller.current = instance;
    instance.initialize();
    return () => {
      instance.dispose();
      if (controller.current === instance) controller.current = null;
    };
  }, [client]);
  return {
    ...state,
    soundBlocked,
    enableCallSound: () => sounds.current?.unlock(),
    start: (chat, type) => controller.current?.start(chat, type),
    toggleCamera: () => controller.current?.toggleCamera(),
    switchCamera: () => controller.current?.switchCamera(),
    accept: () => controller.current?.accept(),
    hangUp: () => controller.current?.hangUp(),
    toggleMicrophone: () => controller.current?.toggleMicrophone(),
    enableAudio: () => controller.current?.enableAudio(),
    dismissError: () => controller.current?.update({ error: '' }),
  };
}

const phases = {
  incoming: 'Входящий аудиозвонок', preparing: 'Проверяем микрофон…', starting: 'Вызываем…',
  outgoing: 'Ожидаем ответа…', joining: 'Принимаем звонок…', connecting: 'Подключаем звук…',
  active: 'Разговор', reconnecting: 'Восстанавливаем звук…', ending: 'Завершаем…',
  'end-failed': 'Завершение не подтверждено',
};

function CallIcon({ name, ...props }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {name === 'phone' && <path d="m7 3 3 5-2 2c1.4 2.8 3.2 4.6 6 6l2-2 5 3-1 4C10 22 2 14 3 4Z" />}
    {name === 'camera' && <><rect x="2" y="5" width="13" height="14" rx="3" /><path d="m15 10 7-4v12l-7-4" /></>}
    {name === 'switch' && <><path d="M3 8h16l-4-4M21 16H5l4 4" /></>}
    {name === 'end' && <path d="M3 15v-4c5-5 13-5 18 0v4h-5v-3a12 12 0 0 0-8 0v3Z" />}
    {(name === 'mic' || name === 'muted') && <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4m-4 0h8" />{name === 'muted' && <path d="m3 3 18 18" strokeWidth="2.4" />}</>}
    {name === 'sound' && <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>}
    {name === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
    {name === 'alert' && <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></>}
  </svg>;
}

export function CallPanel({ calls }) {
  const [, tick] = useState(0);
  const panel = useRef(null);
  const call = calls.call;
  const visible = Boolean(call || calls.error);
  useEffect(() => {
    if (!visible) return;
    const previousFocus = document.activeElement;
    const root = document.getElementById('root');
    const wasInert = root?.inert;
    if (root) root.inert = true;
    panel.current?.focus();
    return () => {
      if (root) root.inert = wasInert;
      if (previousFocus?.isConnected) previousFocus.focus?.();
    };
  }, [visible]);
  useEffect(() => {
    if (!call?.connectedAt) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [call?.connectedAt]);
  if (!visible) return null;
  const duration = call?.connectedAt ? Math.max(0, Math.floor((Date.now() - call.connectedAt) / 1000)) : 0;
  const incoming = call?.phase === 'incoming';
  const initials = (call?.title || '?').trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase();
  const trapFocus = (event) => {
    if (event.key === 'Escape' && !call) calls.dismissError();
    if (event.key !== 'Tab') return;
    const buttons = [...panel.current.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
      event.preventDefault(); first.focus();
    }
  };
  return createPortal(
    <div className="call-overlay">
      <section className={`call-panel ${call ? '' : 'call-panel-message'} ${calls.localVideo || calls.remoteVideos?.length ? 'call-panel-video' : ''}`} role="dialog" aria-modal="true"
        aria-labelledby="call-title" aria-describedby={call ? 'call-status' : 'call-error-text'}
        ref={panel} tabIndex={-1} onKeyDown={trapFocus}>
        {call && <>
          <div className="call-artwork">
            <CallScenery />
            <div className="call-brand"><span className="call-brand-dot" /> FINCHAT <span>{call.type === 'video' || calls.cameraEnabled || calls.remoteVideos?.length ? 'ВИДЕОЗВОНОК' : 'АУДИОЗВОНОК'}</span></div>
            <div className={`call-avatar-wrap ${['incoming', 'outgoing', 'starting'].includes(call.phase) ? 'is-ringing' : ''}`}>
              <div className="call-avatar-ring" /><div className="call-avatar-ring" />
              <div className="call-avatar">{initials}<span className="call-avatar-badge"><CallIcon name="phone" /></span></div>
            </div>
            <VideoStage localVideo={calls.localVideo} remoteVideos={calls.remoteVideos} />
          </div>
          <div className="call-body">
            <span className="call-eyebrow">{incoming ? 'ВАМ ЗВОНЯТ' : call.phase === 'active' ? 'ВЫ НА СВЯЗИ' : 'БЛИЖЕ, ДАЖЕ НА РАССТОЯНИИ'}</span>
            <h2 id="call-title">{call.title || 'Собеседник'}</h2>
            <div className="call-status" id="call-status" role="status">
              <span className={`call-status-dot ${call.phase === 'active' ? 'is-active' : ''}`} />{incoming && call.type === 'video' ? 'Входящий видеозвонок' : phases[call.phase] || 'Звонок'}
            </div>
            <div className={`call-visualizer ${call.phase === 'active' && !calls.muted ? 'is-active' : ''}`} aria-hidden="true">
              {Array.from({ length: 19 }, (_, i) => <span key={i} />)}
            </div>
            {call.connectedAt ? <div className="call-duration">{Math.floor(duration / 60)}<span>:</span>{String(duration % 60).padStart(2, '0')}</div>
              : <p className="call-hint">{incoming ? 'Хороший разговор начинается с «привет»' : 'Самое важное — услышать друг друга'}</p>}
            <div className="call-actions">
              {['active', 'connecting', 'outgoing', 'reconnecting'].includes(call.phase) && <>
                <div className="call-control">
                  <button className={`call-control-button ${calls.cameraEnabled ? '' : 'is-muted'}`} type="button"
                    disabled={calls.cameraBusy} aria-pressed={Boolean(calls.cameraEnabled)}
                    aria-label={calls.cameraEnabled ? 'Выключить камеру' : 'Включить камеру'} onClick={calls.toggleCamera}>
                    <CallIcon name="camera" />
                  </button><span>{calls.cameraEnabled ? 'Камера' : 'Без видео'}</span>
                </div>
                {calls.cameraEnabled && calls.cameras?.length > 1 && <div className="call-control">
                  <button className="call-control-button" type="button" disabled={calls.cameraBusy}
                    aria-label="Переключить камеру" onClick={calls.switchCamera}><CallIcon name="switch" /></button>
                  <span>Сменить</span>
                </div>}
              </>}
              {['active', 'connecting', 'outgoing', 'reconnecting'].includes(call.phase) && <div className="call-control">
                <button className={`call-control-button ${calls.muted ? 'is-muted' : ''}`} type="button" aria-pressed={calls.muted}
                  aria-label={calls.muted ? 'Включить микрофон' : 'Выключить микрофон'} onClick={calls.toggleMicrophone}>
                  <CallIcon name={calls.muted ? 'muted' : 'mic'} />
                </button><span>{calls.muted ? 'Без микрофона' : 'Микрофон'}</span>
              </div>}
              <div className="call-control">
                <button className="call-control-button call-end" type="button" onClick={calls.hangUp}
                  aria-label={incoming ? 'Отклонить звонок' : call.phase === 'end-failed' ? 'Повторить завершение' : 'Завершить звонок'}
                  disabled={['starting', 'joining', 'ending'].includes(call.phase)}><CallIcon name="end" /></button>
                <span>{incoming ? 'Отклонить' : call.phase === 'end-failed' ? 'Повторить' : 'Завершить'}</span>
              </div>
              {incoming && <div className="call-control">
                <button className="call-control-button call-answer" type="button" onClick={calls.accept} aria-label="Ответить на звонок"><CallIcon name="phone" /></button>
                <span>Ответить</span>
              </div>}
            </div>
            {calls.soundBlocked && <button className="call-enable-audio" type="button" onClick={calls.enableCallSound}><CallIcon name="sound" />Включить звук вызова</button>}
            {calls.needsAudio && <button className="call-enable-audio" type="button" onClick={calls.enableAudio}><CallIcon name="sound" />Включить звук</button>}
            <div className="call-footer"><CallIcon name="phone" /><span>Личный разговор в Finchat</span></div>
          </div>
        </>}
        {!call && <div className="call-message-heading"><span className="call-message-icon"><CallIcon name="alert" /></span><h2 id="call-title">Не удалось продолжить звонок</h2></div>}
        {calls.error && <div className="call-error" role="alert">
          <span id="call-error-text">{calls.error}</span>
          <button type="button" onClick={calls.dismissError} aria-label="Закрыть сообщение о звонке"><CallIcon name="close" /></button>
        </div>
        }
      </section>
    </div>, document.body,
  );
}
