import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { canJoinGroup } from '../api/groupCalls.js';

function GroupCallNotice({ notice, calls, chats }) {
  const { refreshGroup, ready } = calls;
  const chat = chats.find((item) => item.topic === notice.topic) || { topic: notice.topic, title: notice.title };
  const title = chat.title || notice.topic;
  useEffect(() => {
    if (!ready) return;
    const refresh = () => refreshGroup({ topic: notice.topic, title });
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [ready, refreshGroup, notice.topic, title]);
  const occupied = Boolean(calls.call);
  return <section className="group-call-notice" aria-label={`Групповой звонок: ${title}`}>
    <div className="group-call-notice-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="5" width="13" height="14" rx="3" /><path d="m15 10 7-4v12l-7-4" /></svg>
    </div>
    <div className="group-call-notice-body">
      <strong>{title}</strong>
      <p>Начался групповой звонок</p>
      <button type="button" className="group-call-notice-join" disabled={!ready || occupied}
        onClick={() => {
          calls.dismissGroupNotice(notice.callId);
          calls.joinGroup(chat, notice.callId);
        }}>Подключиться</button>
      {occupied && <small>Сначала завершите текущий звонок</small>}
    </div>
    <button type="button" className="group-call-notice-close" aria-label={`Закрыть уведомление: ${title}`}
      onClick={() => calls.dismissGroupNotice(notice.callId)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>
  </section>;
}

export function GroupCallNotifications({ calls, chats = [] }) {
  const [, tick] = useState(0);
  const count = calls.groupNotices?.length || 0;
  useEffect(() => {
    if (!count) return;
    // Expire unanswered invitations even if the terminal notification was lost.
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [count]);
  if (!calls.groupReady) return null;
  const notices = (calls.groupNotices || []).filter((notice) => {
    const status = calls.groupCalls?.[notice.topic];
    return status?.callId === notice.callId && canJoinGroup(status)
      && status.participation !== 'other-session' && calls.call?.topic !== notice.topic;
  }).slice(-3);
  return createPortal(<div className="group-call-notifications" aria-live="polite" aria-relevant="additions removals">
    {notices.map((notice) => <GroupCallNotice key={notice.callId} notice={notice} calls={calls} chats={chats} />)}
  </div>, document.body);
}
