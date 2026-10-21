import { useEffect } from 'react';
import { canJoinGroup } from '../api/groupCalls.js';

export function GroupCallBadge({ status }) {
  return canJoinGroup(status) ? <span className="group-call-badge" title="Идёт групповой звонок" aria-label="Идёт групповой звонок">● Звонок</span> : null;
}

export function GroupCallButton({ chat, calls, members = [] }) {
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
  const label = current ? 'Открыть звонок' : active ? 'Подключиться' : 'Начать звонок';
  const hint = status?.error || (otherSession ? 'Вы подключены с другого устройства'
    : occupied ? 'Сначала завершите текущий звонок' : active ? 'Идёт групповой звонок'
      : 'Начать групповой видеозвонок');
  return <button type="button" className="call-start group-call-start" title={hint} aria-label={label}
      disabled={occupied || (!current && otherSession)}
      onClick={() => current ? calls.showCall() : active ? calls.joinGroup(groupChat) : calls.start(groupChat, 'video')}>
      <span className="call-start-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="2" y="5" width="13" height="14" rx="3" /><path d="m15 10 7-4v12l-7-4" />
      </svg></span>
      <span>{label}</span>
  </button>;
}
