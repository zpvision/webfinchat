import { useEffect, useRef, useState } from 'react';
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

export function CallPanel({ calls }) {
  const [, tick] = useState(0);
  const call = calls.call;
  useEffect(() => {
    if (!call?.connectedAt) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [call?.connectedAt]);
  if (!call && !calls.error) return null;
  const duration = call?.connectedAt ? Math.max(0, Math.floor((Date.now() - call.connectedAt) / 1000)) : 0;
  return (
    <aside className="call-panel" aria-label="Аудиозвонок">
      {call && <>
        <strong>{call.title}</strong>
        <p role="status">{phases[call.phase] || 'Звонок'}{call.connectedAt && ` · ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`}</p>
        <div className="call-actions">
          {call.phase === 'incoming' && <button className="call-answer" type="button" onClick={calls.accept}>Ответить</button>}
          {['active', 'connecting', 'outgoing', 'reconnecting'].includes(call.phase) && <button
            type="button" aria-pressed={calls.muted} onClick={calls.toggleMicrophone}
          >{calls.muted ? 'Включить микрофон' : 'Выключить микрофон'}</button>}
          {calls.needsAudio && <button type="button" onClick={calls.enableAudio}>Включить звук</button>}
          <button className="call-end" type="button" onClick={calls.hangUp}
            disabled={['starting', 'joining', 'ending'].includes(call.phase)}>
            {call.phase === 'incoming' ? 'Отклонить' : call.phase === 'end-failed' ? 'Повторить завершение' : 'Завершить'}
          </button>
        </div>
      </>}
      {calls.error && <div className="call-error" role="alert">
        <span>{calls.error}</span>
        <button type="button" onClick={calls.dismissError} aria-label="Закрыть сообщение о звонке">×</button>
      </div>}
    </aside>
  );
}
