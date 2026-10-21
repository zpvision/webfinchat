import { useCallback, useEffect, useRef, useState } from 'react';
import { CallNotifications } from '../api/callNotifications.js';

export function useBrowserCallNotifications(client) {
  const manager = useRef(null);
  const [permission, setPermission] = useState('unsupported');
  const [error, setError] = useState('');
  useEffect(() => {
    const instance = new CallNotifications();
    manager.current = instance;
    const refresh = () => setPermission(instance.permission);
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      instance.dispose();
      if (manager.current === instance) manager.current = null;
    };
  }, [client]);
  const request = useCallback(async () => {
    const instance = manager.current;
    if (!instance) return;
    try {
      const result = await instance.requestPermission();
      if (manager.current === instance) { setPermission(result); setError(''); }
    } catch {
      if (manager.current === instance) setError('Не удалось включить уведомления браузера.');
    }
  }, []);
  const show = useCallback((notice, onOpen) => {
    const message = manager.current?.show(notice, onOpen);
    if (message) setError(message);
  }, []);
  const retain = useCallback((callIds) => manager.current?.retain(callIds), []);
  return { notificationPermission: permission, notificationError: error,
    requestNotifications: request, showBrowserNotification: show, retainBrowserNotifications: retain };
}
