export function isNearMessageBottom(container, tolerance = 64) {
  return !container || container.scrollHeight - container.scrollTop - container.clientHeight <= tolerance;
}

export function captureMessagePosition(container) {
  if (!container) return null;
  const top = container.getBoundingClientRect().top + (container.clientTop || 0);
  const visible = [];
  for (const element of container.querySelectorAll('[data-message-seq]')) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= top) continue;
    if (rect.top >= top + container.clientHeight) break;
    visible.push({ seq: element.dataset.messageSeq, offset: rect.top - top });
    if (visible.length === 3) break;
  }
  return { ...visible[0], visible, scrollTop: container.scrollTop, scrollHeight: container.scrollHeight };
}

export function restoreMessagePosition(container, position) {
  if (!container || !position) return false;
  const top = container.getBoundingClientRect().top + (container.clientTop || 0);
  const elements = container.querySelectorAll('[data-message-seq]');
  for (const anchor of position.visible || [position]) {
    const element = [...elements].find((item) => item.dataset.messageSeq === String(anchor.seq));
    if (!element) continue;
    container.scrollTop += element.getBoundingClientRect().top - top - anchor.offset;
    return true;
  }
  // Empty lists or removal of every visible message still have a conservative fallback.
  container.scrollTop = position.scrollTop + container.scrollHeight - position.scrollHeight;
  return false;
}
