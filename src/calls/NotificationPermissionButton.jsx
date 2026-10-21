export function NotificationPermissionButton({ calls, compact = false }) {
  const permission = calls.notificationPermission;
  if (!permission || permission === 'unsupported') return null;
  const label = permission === 'granted' ? 'Уведомления о звонках включены'
    : permission === 'denied' ? 'Уведомления заблокированы. Разрешите их в настройках сайта.' : 'Включить уведомления браузера';
  return <button type="button" className={compact ? 'theme-button' : 'group-call-notice-permission'}
    disabled={permission !== 'default'} title={label} aria-label={label} onClick={calls.requestNotifications}>
    <svg className="toolbar-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </svg>
    {!compact && <span>{permission === 'granted' ? 'Уведомления включены' : permission === 'denied' ? 'Уведомления заблокированы браузером' : 'Уведомлять в браузере'}</span>}
  </button>;
}
