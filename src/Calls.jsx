import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CallController } from './api/calls.js';

export function useCalls(client) {
  const [state, setState] = useState({ ready: false, reason: 'Подключаем звонки…', call: null, error: '' });
  const controller = useRef(null);
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
    start: (chat) => controller.current?.start(chat),
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
    {name === 'end' && <path d="M3 15v-4c5-5 13-5 18 0v4h-5v-3a12 12 0 0 0-8 0v3Z" />}
    {(name === 'mic' || name === 'muted') && <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4m-4 0h8" />{name === 'muted' && <path d="m3 3 18 18" strokeWidth="2.4" />}</>}
    {name === 'sound' && <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>}
    {name === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
    {name === 'alert' && <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></>}
  </svg>;
}

function CallLandscape() {
  return <svg className="call-landscape" viewBox="0 0 480 300" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="call-sky" x1="240" y1="0" x2="240" y2="300" gradientUnits="userSpaceOnUse"><stop stopColor="#3b336c" /><stop offset="1" stopColor="#a584b5" /></linearGradient>
      <linearGradient id="call-mountains" x1="240" y1="115" x2="240" y2="300" gradientUnits="userSpaceOnUse"><stop stopColor="#7d709f" /><stop offset="1" stopColor="#2b284d" /></linearGradient>
      <radialGradient id="call-moon"><stop stopColor="#fff4dc" /><stop offset="1" stopColor="#f0d7eb" /></radialGradient>
    </defs>
    <path fill="url(#call-sky)" d="M0 0h480v300H0z" />
    <circle cx="348" cy="81" r="55" fill="#f4d6f1" opacity=".05" /><circle cx="348" cy="81" r="41" fill="#f4d6f1" opacity=".08" /><circle cx="348" cy="81" r="27" fill="url(#call-moon)" />
    <g fill="#f8edff" opacity=".7"><circle cx="70" cy="44" r="1.3" /><circle cx="170" cy="68" r="1" /><circle cx="254" cy="32" r="1.2" /><circle cx="409" cy="49" r="1" /><circle cx="291" cy="111" r="1" /><circle cx="113" cy="110" r="1" /><path d="m210 29 1.2 3.8L215 34l-3.8 1.2L210 39l-1.2-3.8L205 34l3.8-1.2Z" /></g>
    <path d="m0 208 69-59 38 29 69-78 72 93 49-44 50 37 54-56 79 66v104H0Z" fill="url(#call-mountains)" />
    <path d="m145 135 31-35 37 48-29-16-12 8-8-10Z" fill="#d0bad8" opacity=".58" />
    <path d="m0 237 83-58 75 61 63-39 86 38 80-58 93 48v71H0Z" fill="#403959" /><path d="m0 268 100-32 92 35 112-21 89 17 87-27v60H0Z" fill="#27263f" />
    <path d="M203 300c-24-23 77-23 56-44-9-9-34-12-38-21" stroke="#b8a7d1" strokeWidth="2" opacity=".35" />
    <g fill="#25253e"><path d="m39 199-13 28h8l-14 26h14v23h10v-23h14l-14-26h8Zm401 1-12 25h7l-14 27h14v26h10v-26h14l-14-27h7Z" /></g>
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
      <section className={`call-panel ${call ? '' : 'call-panel-message'}`} role="dialog" aria-modal="true"
        aria-labelledby="call-title" aria-describedby={call ? 'call-status' : 'call-error-text'}
        ref={panel} tabIndex={-1} onKeyDown={trapFocus}>
        {call && <>
          <div className="call-artwork">
            <CallLandscape />
            <div className="call-brand"><span className="call-brand-dot" /> FINCHAT <span>АУДИОЗВОНОК</span></div>
            <div className={`call-avatar-wrap ${['incoming', 'outgoing', 'starting'].includes(call.phase) ? 'is-ringing' : ''}`}>
              <div className="call-avatar-ring" /><div className="call-avatar-ring" />
              <div className="call-avatar">{initials}<span className="call-avatar-badge"><CallIcon name="phone" /></span></div>
            </div>
          </div>
          <div className="call-body">
            <span className="call-eyebrow">{incoming ? 'ВАМ ЗВОНЯТ' : call.phase === 'active' ? 'ВЫ НА СВЯЗИ' : 'БЛИЖЕ, ДАЖЕ НА РАССТОЯНИИ'}</span>
            <h2 id="call-title">{call.title || 'Собеседник'}</h2>
            <div className="call-status" id="call-status" role="status">
              <span className={`call-status-dot ${call.phase === 'active' ? 'is-active' : ''}`} />{phases[call.phase] || 'Звонок'}
            </div>
            <div className={`call-visualizer ${call.phase === 'active' && !calls.muted ? 'is-active' : ''}`} aria-hidden="true">
              {Array.from({ length: 19 }, (_, i) => <span key={i} />)}
            </div>
            {call.connectedAt ? <div className="call-duration">{Math.floor(duration / 60)}<span>:</span>{String(duration % 60).padStart(2, '0')}</div>
              : <p className="call-hint">{incoming ? 'Хороший разговор начинается с «привет»' : 'Самое важное — услышать друг друга'}</p>}
            <div className="call-actions">
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
