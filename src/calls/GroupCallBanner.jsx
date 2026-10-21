import { useEffect } from 'react';
import { canJoinGroup } from '../api/groupCalls.js';

export function GroupCallBadge({ status }) {
  return canJoinGroup(status) ? <span className="group-call-badge" title="Идёт групповой звонок" aria-label="Идёт групповой звонок">● Звонок</span> : null;
}

export function GroupCallBanner({ chat, calls, members = [] }) {
  const { watchGroup, ready, groupReady } = calls;
  useEffect(() => {
    if (!ready || !groupReady) return;
    return watchGroup({ topic: chat.topic, title: chat.title });
  }, [watchGroup, ready, groupReady, chat.topic, chat.title]);
  if (!ready || !groupReady) return null;
  const status = calls.groupCalls?.[chat.topic];
  const active = canJoinGroup(status);
  const current = calls.call?.topic === chat.topic;
  const occupied = Boolean(calls.call && !current);
  const otherSession = status?.participation === 'other-session';
  const groupChat = { ...chat, participantNames: Object.fromEntries(members.filter((member) => member.user)
    .map((member) => [member.user, member.title || member.user])) };
  return <aside className={`group-call-banner ${active || current ? 'is-active' : ''}`} aria-label="Групповой звонок">
    <div><strong>{current ? 'Вы в звонке' : active ? 'Идёт групповой звонок' : 'Групповой видеозвонок'}</strong>
      <span>{status?.error || (otherSession ? 'Вы подключены с другого устройства'
        : occupied ? 'Сначала завершите текущий звонок' : active ? 'Можно подключиться в любой момент'
          : 'Участники смогут присоединиться из чата')}</span></div>
    <button type="button" className="call-start" disabled={occupied || (!current && otherSession)}
      onClick={() => current ? calls.showCall() : active ? calls.joinGroup(groupChat) : calls.start(groupChat, 'video')}>
      {current ? 'Открыть звонок' : active ? 'Подключиться' : 'Начать звонок'}
    </button>
  </aside>;
}
