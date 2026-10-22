import { useLayoutEffect, useRef, useState } from 'react';
import { captureMessagePosition, restoreMessagePosition, isNearMessageBottom } from './messageScroll.js';

export function useMessageScroll({ containerRef, topic, messages, status, setVisible }) {
  const following = useRef(true);
  const firstPaint = useRef(true);
  const anchor = useRef(null);
  const pending = useRef(null);
  const frame = useRef(null);
  const active = useRef(false);
  const observer = useRef(null);
  const observedList = useRef(null);
  const [atBottom, setAtBottom] = useState(true);

  const remember = () => { anchor.current = captureMessagePosition(containerRef.current); };
  const settle = () => {
    const container = containerRef.current;
    if (!container || !active.current || firstPaint.current) return;
    if (following.current) container.scrollTop = container.scrollHeight;
    else restoreMessagePosition(container, anchor.current);
    remember();
  };
  const schedule = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; settle(); });
  };

  useLayoutEffect(() => {
    active.current = true;
    observer.current = new ResizeObserver(settle);
    if (containerRef.current) observer.current.observe(containerRef.current);
    return () => {
      active.current = false;
      observer.current.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [topic]);

  // Run after any layout-affecting commit, including loader, reply previews and profile names.
  useLayoutEffect(() => {
    if (status !== 'ready' || !messages.length) return;
    const container = containerRef.current;
    if (!container) return;
    if (firstPaint.current) {
      container.scrollTop = container.scrollHeight;
      firstPaint.current = false;
    } else if (pending.current) {
      const position = pending.current;
      if (position.follow) container.scrollTop = container.scrollHeight;
      else restoreMessagePosition(container, position.anchor);
    } else {
      settle();
    }
    pending.current = null;
    remember();
    const list = container.querySelector('.message-list');
    if (list !== observedList.current) {
      if (observedList.current) observer.current.unobserve(observedList.current);
      observedList.current = list;
      if (list) observer.current.observe(list);
    }
    setVisible(true);
  });

  const prepare = () => {
    const container = containerRef.current;
    // Capture at mutation time, not request time: the reader may have moved meanwhile.
    pending.current = { anchor: captureMessagePosition(container), follow: following.current };
  };
  const jumpToBottom = () => {
    following.current = true;
    pending.current = null;
    setAtBottom(true);
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
    remember();
  };
  const onScroll = () => {
    following.current = isNearMessageBottom(containerRef.current);
    setAtBottom(following.current);
    remember();
    if (pending.current) pending.current = { anchor: anchor.current, follow: following.current };
  };
  return { prepare, onScroll, onMediaLoad: schedule, jumpToBottom, atBottom,
    stopFollowing: () => { following.current = false; setAtBottom(false); remember(); } };
}
