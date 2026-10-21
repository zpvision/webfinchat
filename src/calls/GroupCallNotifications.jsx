import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { canJoinGroup } from '../api/groupCalls.js';
import { NotificationPermissionButton } from './NotificationPermissionButton.jsx';

function GroupCallNotice({ notice, calls, chats, remaining }) {
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
  return <section className="group-call-notice" id={`group-notice-${notice.callId}`} tabIndex={-1}
    aria-label={`Групповой звонок: ${title}`} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); calls.dismissGroupNotice(notice.callId); }
    }}>
    <div className="group-call-notice-brand"><span /> FINCHAT</div>
    <div className="group-call-notice-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="5" width="13" height="14" rx="3" /><path d="m15 10 7-4v12l-7-4" /></svg>
    </div>
    <div className="group-call-notice-body">
      <span className="group-call-notice-eyebrow">ВАС ПРИГЛАШАЮТ В РАЗГОВОР</span>
      <strong>{title}</strong>
      <p>Начался групповой звонок</p>
      <div className="group-call-notice-actions"><button type="button" className="group-call-notice-join" disabled={!ready || occupied}
        onClick={() => {
          calls.dismissGroupNotice(notice.callId);
          calls.joinGroup(chat, notice.callId);
        }}>Подключиться</button>
        <button type="button" className="group-call-notice-later" onClick={() => calls.dismissGroupNotice(notice.callId)}>Позже</button>
      </div>
      {occupied && <small>Сначала завершите текущий звонок</small>}
      <small className="group-call-notice-hint">Можно присоединиться позже — кнопка останется в шапке группы.</small>
      {remaining > 0 && <small>Ещё приглашений: {remaining}</small>}
      <div className="group-call-notice-preferences">
        {calls.soundBlocked && <button className="group-call-notice-permission" type="button" onClick={calls.enableCallSound}>Включить звук приглашений</button>}
        <NotificationPermissionButton calls={calls} />
        {calls.notificationError && <small role="status">{calls.notificationError}</small>}
      </div>
    </div>
    <button type="button" className="group-call-notice-close" aria-label={`Закрыть уведомление: ${title}`}
      onClick={() => calls.dismissGroupNotice(notice.callId)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>
  </section>;
}

export function GroupCallNotifications({ calls, chats = [] }) {
  const [, tick] = useState(0);
  const [focusedCallId, setFocusedCallId] = useState(null);
  const count = calls.groupNotices?.length || 0;
  useEffect(() => {
    if (!count) return;
    // Expire unanswered invitations even if the terminal notification was lost.
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [count]);
  const notices = (calls.groupReady ? calls.groupNotices || [] : []).filter((notice) => {
    const status = calls.groupCalls?.[notice.topic];
    return status?.callId === notice.callId && canJoinGroup(status)
      && status.participation !== 'other-session' && calls.call?.topic !== notice.topic;
  });
  const { showBrowserNotification, retainBrowserNotifications } = calls;
  useEffect(() => {
    for (const item of calls.groupNotices || []) {
      const status = calls.groupCalls?.[item.topic];
      if (status?.callId === item.callId && status.state === 'ringing' && !canJoinGroup(status)) {
        calls.dismissGroupNotice(item.callId);
      }
    }
    retainBrowserNotifications(notices.map((notice) => notice.callId));
    for (const notice of notices) {
      const title = chats.find((chat) => chat.topic === notice.topic)?.title || notice.title || notice.topic;
      showBrowserNotification({ ...notice, title }, () => setFocusedCallId(notice.callId));
    }
  });
  useEffect(() => () => retainBrowserNotifications([]), [retainBrowserNotifications]);
  useEffect(() => {
    if (focusedCallId) document.getElementById(`group-notice-${focusedCallId}`)?.focus();
  }, [focusedCallId]);
  const notice = notices.find((item) => item.callId === focusedCallId) || notices.at(-1);
  return createPortal(<div className="group-call-notifications" aria-live="polite" aria-relevant="additions removals">
    {notice && <GroupCallNotice key={notice.callId} notice={notice} calls={calls} chats={chats} remaining={notices.length - 1} />}
  </div>, document.body);
}
