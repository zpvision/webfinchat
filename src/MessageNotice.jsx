export function MessageNotice({ notifications }) {
  const { notice, soundBlocked, enableSound, dismiss, open } = notifications;
  return <>
    {notice && <aside className="message-notice" aria-label="Новое сообщение">
      <button className="message-notice-open" type="button" onClick={open}>
        <span aria-live="polite"><strong>{notice.title}</strong><span>{notice.body}</span></span>
      </button>
      <button className="message-notice-close" type="button" onClick={dismiss} aria-label="Скрыть уведомление">×</button>
    </aside>}
    {soundBlocked && <button className="message-sound-enable" type="button" onClick={enableSound}>Включить звук сообщений</button>}
  </>;
}
