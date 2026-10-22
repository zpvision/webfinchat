import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageNotifications } from './api/messageNotifications.js';
import { CallSounds } from './api/callSounds.js';
import { normalizeMessage } from './api/finchat.js';

const isFocused = () => document.visibilityState === 'visible' && document.hasFocus();

export function useMessageNotifications({ client, session, chats, selectedId, onOpen }) {
  const current = useRef({ chats, selectedId, onOpen });
  const manager = useRef(null);
  const sounds = useRef(null);
  const [notice, setNotice] = useState(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  useLayoutEffect(() => {
    current.current = { chats, selectedId, onOpen };
    manager.current?.seed(chats);
  }, [chats, selectedId, onOpen]);
  useEffect(() => {
    const audio = new CallSounds({ onBlocked: (blocked) => setSoundBlocked(blocked || audio.context?.state === 'suspended') });
    const instance = new MessageNotifications({ user: session.user, sounds: audio,
      onNotice: setNotice, onOpen: (item) => {
        current.current.onOpen(item.chatId);
        setNotice(null);
      },
    });
    manager.current = instance;
    sounds.current = audio;
    instance.seed(current.current.chats);
    const unsubscribe = client.onPacket((packet) => {
      const data = packet.data;
      if (!data?.topic) return;
      const state = current.current;
      const chat = state.chats.find((item) => item.topic === data.topic);
      instance.receive(data, normalizeMessage(data), chat, { selectedId: state.selectedId, focused: isFocused() });
    });
    const unlock = () => audio.unlock();
    const read = () => {
      if (!isFocused()) return;
      const chat = current.current.chats.find((item) => item.id === current.current.selectedId);
      instance.read(chat);
      setNotice((item) => item?.chatId === chat?.id ? null : item);
    };
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', read);
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', read);
      document.removeEventListener('visibilitychange', read);
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      instance.dispose();
      if (manager.current === instance) { manager.current = null; sounds.current = null; }
    };
  }, [client, session.user]);
  useEffect(() => {
    if (!isFocused()) return;
    manager.current?.read(chats.find((chat) => chat.id === selectedId));
    setNotice((item) => item?.chatId === selectedId ? null : item);
  }, [selectedId, client]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  return { notice, soundBlocked, enableSound: () => sounds.current?.unlock(),
    dismiss: () => setNotice(null), open: () => {
      if (!notice) return;
      onOpen(notice.chatId);
      manager.current?.read(chats.find((chat) => chat.id === notice.chatId));
      setNotice(null);
    } };
}
