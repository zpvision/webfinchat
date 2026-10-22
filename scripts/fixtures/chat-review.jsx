import React from 'react';
import { createRoot } from 'react-dom/client';
import { MessengerScreen } from '__APP__';
import '/src/styles.css';

const metrics = { pending: 0, peakPending: 0, peakPendingMap: 0, framesParsed: 0, longTasks: [] };
window.__review = { ...window.__review, metrics, history: [] };
const parse = JSON.parse;
JSON.parse = (value, ...args) => {
  if (typeof value === 'string' && value.includes('"__review":true')) metrics.framesParsed++;
  return parse(value, ...args);
};
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) if (entry.startTime >= metrics.start) metrics.longTasks.push({ start: entry.startTime - metrics.start, duration: entry.duration });
});
observer.observe({ type: 'longtask' });
metrics.start = performance.now();
const listObserver = new MutationObserver(() => {
  if (document.querySelectorAll('.chat-item').length !== 100) return;
  listObserver.disconnect();
  requestAnimationFrame(() => { metrics.listPaintMs = performance.now() - metrics.start; });
});
listObserver.observe(document.getElementById('root'), { childList: true, subtree: true });
const root = createRoot(document.getElementById('root'));
root.render(<MessengerScreen session={{ token: 'review-token', user: 'usrMe' }} theme="light"
  onLogout={() => {}} onSessionExpired={() => {}} onToggleTheme={() => {}} />);
window.__review.unmount = () => root.unmount();
let noise = 0;
const traffic = setInterval(() => {
  const client = window.__review.client;
  if (!client) return;
  client.socket.packet({ __review: true, pres: { topic: 'me', what: 'on', src: 'usrNoise' }, pad: 'x'.repeat(1024) });
  if (++noise === 200) { clearInterval(traffic); metrics.trafficDone = true; }
}, 8);
window.__review.capture = () => {
  const area = document.querySelector('.message-area');
  const top = area.getBoundingClientRect().top;
  const element = [...area.querySelectorAll('[data-message-seq]')].find((node) => node.getBoundingClientRect().bottom > top);
  return { seq: element?.dataset.messageSeq, offset: element ? element.getBoundingClientRect().top - top : 0, top: area.scrollTop };
};
