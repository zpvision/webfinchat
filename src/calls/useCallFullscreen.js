import { useEffect, useRef, useState } from 'react';

export function useCallFullscreen(panel, call) {
  const [largeCall, setLargeCall] = useState(null);
  const currentCall = useRef(call);
  const requestVersion = useRef(0);
  currentCall.current = call;
  const large = Boolean(call && largeCall === call);

  useEffect(() => {
    const element = panel.current;
    const changed = () => {
      if (document.fullscreenElement !== element) setLargeCall(null);
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      requestVersion.current++;
      document.removeEventListener('fullscreenchange', changed);
      if (element && document.fullscreenElement === element) document.exitFullscreen().catch(() => {});
    };
  }, [call, panel]);

  const exit = () => {
    requestVersion.current++;
    setLargeCall(null);
    if (document.fullscreenElement === panel.current) document.exitFullscreen().catch(() => {});
  };

  const toggle = async () => {
    if (large) { exit(); return; }
    const element = panel.current;
    if (!call || !element) return;
    const version = ++requestVersion.current;
    setLargeCall(call);
    try {
      await element.requestFullscreen?.();
      if ((currentCall.current !== call || requestVersion.current !== version) && document.fullscreenElement === element) {
        await document.exitFullscreen();
      }
    } catch { /* Keep the viewport-sized layout when native fullscreen is unavailable. */ }
  };

  return { large, toggle, exit };
}
