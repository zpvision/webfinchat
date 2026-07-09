import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FinchatRealtimeClient,
  downloadAttachmentFile,
  fetchAttachmentBlob,
  getDeletedRanges,
  hasApiKey,
  loadChatList,
  loadTopicMessages,
  loginWithWordColor,
  normalizeMessage,
} from './api/finchat.js';
import logoSrc from './assets/logo_512.png';

const initialForm = {
  phone: '',
  word1: '',
  word2: '',
  digits: '',
};
const SESSION_STORAGE_KEY = 'finchatSession';
const TOKEN_STORAGE_KEY = 'finchatToken';
const MESSAGE_PAGE_SIZE = 30;

function loadStoredSession() {
  try {
    const rawSession = sessionStorage.getItem(SESSION_STORAGE_KEY);

    if (rawSession) {
      const storedSession = JSON.parse(rawSession);

      if (storedSession?.token) {
        return storedSession;
      }
    }

    const token =
      sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
      localStorage.getItem(TOKEN_STORAGE_KEY);

    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);

    return token ? { token } : null;
  } catch {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    return null;
  }
}

function saveStoredSession(session) {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  sessionStorage.setItem(TOKEN_STORAGE_KEY, session.token);
  localStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function clearStoredSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function normalizeWord(value) {
  return value.trim().toLowerCase();
}

function validate(form) {
  const errors = {};

  if (!form.phone.trim()) {
    errors.phone = 'Введите номер телефона.';
  }

  if (!normalizeWord(form.word1)) {
    errors.word1 = 'Введите первое слово.';
  }

  if (!normalizeWord(form.word2)) {
    errors.word2 = 'Введите второе слово.';
  }

  if (!/^\d{8}$/.test(form.digits)) {
    errors.digits = 'Введите ровно 8 цифр.';
  }

  return errors;
}

function formatChatDate(value) {
  if (!value) {
    return '';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatMessageTime(value) {
  if (!value) {
    return '';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getInitials(title) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatFileSize(value) {
  if (!value) {
    return '';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function getFileBadge(name) {
  const extension = name?.split('.').pop();

  if (!extension || extension === name) {
    return 'FILE';
  }

  return extension.slice(0, 4).toUpperCase();
}

function getSelectedFileId(file, index) {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

function isPermissionDeniedError(error) {
  return error?.message?.toLowerCase().includes('permission denied');
}

function getChatPreview(chat) {
  return chat.preview || (chat.isGroup ? 'Группа' : 'Диалог');
}

function getReplyPreview(reply, messages) {
  if (!reply) {
    return '';
  }

  if (reply.text) {
    return reply.text;
  }

  const quotedMessage = messages.find((message) => Number(message.seq) === Number(reply.seq));

  return quotedMessage?.text || quotedMessage?.preview || `Сообщение #${reply.seq}`;
}

function applyMessageToChat(chat, message, { selectedId, currentUser, incrementUnread = true } = {}) {
  const isSelected = chat.id === selectedId;
  const isOwnMessage = currentUser && message.from === currentUser;
  const nextSeq = Number(message.seq || chat.raw?.seq || 0);
  const previousSeq = Number(chat.raw?.seq || 0);
  const unreadDelta = nextSeq > previousSeq ? nextSeq - previousSeq : 1;

  if (nextSeq && previousSeq && nextSeq < previousSeq) {
    return chat;
  }

  return {
    ...chat,
    preview: message.preview || message.text || chat.preview,
    unread:
      !incrementUnread || isSelected || isOwnMessage
        ? chat.unread
        : chat.unread + unreadDelta,
    updatedAt: message.createdAt || new Date().toISOString(),
    raw: {
      ...chat.raw,
      seq: Math.max(nextSeq, previousSeq),
    },
  };
}

function getMessageCopyText(message) {
  return [
    message.text,
    ...(message.attachments || []).map((attachment) => attachment.name),
  ]
    .filter(Boolean)
    .join('\n');
}

async function loadMessagesWithRetry({ token, topic, beforeSeq, limit = MESSAGE_PAGE_SIZE }) {
  let lastError = null;

  for (const delayMs of [0, 700]) {
    if (delayMs > 0) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, delayMs);
      });
    }

    try {
      return await loadTopicMessages(token, topic, { beforeSeq, limit });
    } catch (error) {
      lastError = error;

      if (!isPermissionDeniedError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

function ImageViewer({ image, onClose }) {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!image) {
    return null;
  }

  return (
    <div className="image-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="image-modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="image-modal-toolbar">
          <strong>{image.name}</strong>
          <div>
            <button type="button" onClick={() => setRotation((current) => current - 90)} title="Повернуть влево">
              ↺
            </button>
            <button type="button" onClick={() => setRotation((current) => current + 90)} title="Повернуть вправо">
              ↻
            </button>
            <button type="button" onClick={onClose} title="Закрыть">
              ×
            </button>
          </div>
        </div>
        <div className="image-modal-stage">
          <img alt={image.name} src={image.url} style={{ transform: `rotate(${rotation}deg)` }} />
        </div>
      </div>
    </div>
  );
}

function AttachmentImage({ attachment, token, onOpen }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let nextObjectUrl = '';

    async function loadImage() {
      setError('');
      setObjectUrl('');

      try {
        const blob = await fetchAttachmentBlob({ token, ref: attachment.ref });

        if (!active) {
          return;
        }

        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      } catch (requestError) {
        if (active) {
          setError(requestError.message || 'Не удалось загрузить изображение.');
        }
      }
    }

    loadImage();

    return () => {
      active = false;

      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [attachment.ref, token]);

  if (error) {
    return <span className="attachment-error">{error}</span>;
  }

  if (!objectUrl) {
    return <span className="attachment-loading">Загружаем изображение...</span>;
  }

  return (
    <button className="image-attachment" type="button" onClick={() => onOpen({ name: attachment.name, url: objectUrl })}>
      <img
        alt={attachment.name}
        height={attachment.height || undefined}
        loading="lazy"
        src={objectUrl}
        width={attachment.width || undefined}
      />
    </button>
  );
}

function MessageAttachments({ attachments, token }) {
  const [downloadingId, setDownloadingId] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [viewerImage, setViewerImage] = useState(null);

  if (!attachments?.length) {
    return null;
  }

  const downloadFile = async (attachment) => {
    setDownloadingId(attachment.id);
    setDownloadError('');

    try {
      await downloadAttachmentFile({
        token,
        ref: attachment.ref,
        name: attachment.name,
      });
    } catch (error) {
      setDownloadError(error.message || 'Не удалось скачать файл.');
    } finally {
      setDownloadingId('');
    }
  };

  return (
    <div className="message-attachments">
      {attachments.map((attachment) =>
        attachment.type === 'image' ? (
          <AttachmentImage attachment={attachment} key={attachment.id} token={token} onOpen={setViewerImage} />
        ) : (
          <button
            className="file-attachment"
            key={attachment.id}
            type="button"
            onClick={() => downloadFile(attachment)}
            disabled={downloadingId === attachment.id}
          >
            <span className="file-icon" aria-hidden="true">
              {getFileBadge(attachment.name)}
            </span>
            <span className="file-details">
              <strong>{attachment.name}</strong>
              <span>
                {downloadingId === attachment.id
                  ? 'Скачиваем...'
                  : [attachment.mime, formatFileSize(attachment.size)].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        ),
      )}
      {downloadError && <span className="attachment-error">{downloadError}</span>}
      <ImageViewer image={viewerImage} onClose={() => setViewerImage(null)} />
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [form, setForm] = useState(initialForm);
  const [touched, setTouched] = useState({});
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const errors = useMemo(() => validate(form), [form]);
  const canSubmit = Object.keys(errors).length === 0 && status !== 'loading';

  const updateField = (field, value) => {
    const nextValue = field === 'digits' ? value.replace(/\D/g, '').slice(0, 8) : value;

    setForm((current) => ({
      ...current,
      [field]: nextValue,
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setTouched({ phone: true, word1: true, word2: true, digits: true });

    if (Object.keys(errors).length > 0) {
      return;
    }

    setStatus('loading');
    setMessage('');

    try {
      const ctrl = await loginWithWordColor({
        phone: form.phone.trim(),
        word1: normalizeWord(form.word1),
        word2: normalizeWord(form.word2),
        digits: form.digits,
      });

      if (!ctrl.params?.token) {
        throw new Error('API не вернул токен авторизации.');
      }

      setMessage('Вход выполнен.');
      setStatus('success');
      onLogin(ctrl.params || null);
    } catch (error) {
      setMessage(error.message || 'Не удалось выполнить вход.');
      setStatus('error');
    }
  };

  return (
    <main className="page auth-page">
      <section className="auth-shell" aria-labelledby="auth-title">
        <div className="auth-copy auth-visual">
          <div className="auth-logo-mark">
            <img src={logoSrc} alt="" />
          </div>
          <p className="eyebrow">FinChat</p>
          <h1 id="auth-title">Вход в аккаунт</h1>
          <p>
            Авторизация по схеме wordcolor через FinChat WebSocket API. После входа откроется
            список чатов из Tinode topic `me`.
          </p>
        </div>

        <form className="auth-form" onSubmit={submit} noValidate>
          {!hasApiKey() && (
            <div className="notice" role="status">
              API key не задан. Создайте `.env` по примеру `.env.example`, иначе сервер может
              отклонить подключение.
            </div>
          )}

          <label className="field">
            <span>Номер телефона</span>
            <input
              type="tel"
              value={form.phone}
              autoComplete="tel"
              placeholder="+79990000000"
              onBlur={() => setTouched((current) => ({ ...current, phone: true }))}
              onChange={(event) => updateField('phone', event.target.value)}
              aria-invalid={Boolean(touched.phone && errors.phone)}
            />
            {touched.phone && errors.phone && <small>{errors.phone}</small>}
          </label>

          <label className="field">
            <span>Слово 1</span>
            <input
              type="text"
              value={form.word1}
              autoComplete="off"
              onBlur={() => setTouched((current) => ({ ...current, word1: true }))}
              onChange={(event) => updateField('word1', event.target.value)}
              aria-invalid={Boolean(touched.word1 && errors.word1)}
            />
            {touched.word1 && errors.word1 && <small>{errors.word1}</small>}
          </label>

          <label className="field">
            <span>Слово 2</span>
            <input
              type="text"
              value={form.word2}
              autoComplete="off"
              onBlur={() => setTouched((current) => ({ ...current, word2: true }))}
              onChange={(event) => updateField('word2', event.target.value)}
              aria-invalid={Boolean(touched.word2 && errors.word2)}
            />
            {touched.word2 && errors.word2 && <small>{errors.word2}</small>}
          </label>

          <label className="field">
            <span>8 цифр</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{8}"
              value={form.digits}
              autoComplete="one-time-code"
              placeholder="12345678"
              onBlur={() => setTouched((current) => ({ ...current, digits: true }))}
              onChange={(event) => updateField('digits', event.target.value)}
              aria-invalid={Boolean(touched.digits && errors.digits)}
            />
            <span className="code-dots" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, index) => (
                <i className={index < form.digits.length ? 'filled' : ''} key={index} />
              ))}
            </span>
            {touched.digits && errors.digits && <small>{errors.digits}</small>}
          </label>

          <button className="submit-button" type="submit" disabled={!canSubmit}>
            {status === 'loading' ? 'Подключение...' : 'Войти'}
          </button>

          {message && (
            <div className={`result ${status}`} role="status">
              <strong>{message}</strong>
            </div>
          )}

          <a className="official-link" href="https://finchat.club/" target="_blank" rel="noreferrer">
            Официальный сайт FinChat
          </a>
        </form>
      </section>
    </main>
  );
}

function Conversation({ chat, client, session, onChatActivity }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [messageMenu, setMessageMenu] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sendStatus, setSendStatus] = useState('idle');
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderStatus, setOlderStatus] = useState('idle');
  const messageAreaRef = useRef(null);
  const messageEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const preserveScrollRef = useRef(false);

  useEffect(() => {
    let active = true;

    async function loadMessages() {
      if (!chat?.topic) {
        return;
      }

      setStatus('loading');
      setError('');
      setMessages([]);
      setReplyTo(null);
      setEditingMessage(null);
      setMessageMenu(null);
      setSelectedFiles([]);
      setHasOlderMessages(false);
      setOlderStatus('idle');

      try {
        const items = await loadMessagesWithRetry({ token: session.token, topic: chat.topic });

        if (!active) {
          return;
        }

        setMessages(items);
        setHasOlderMessages(items.length === MESSAGE_PAGE_SIZE);
        if (items.length > 0) {
          onChatActivity?.(items[items.length - 1]);
        }
        setStatus('ready');
      } catch (requestError) {
        if (!active) {
          return;
        }

        setError(requestError.message || 'Не удалось загрузить историю сообщений.');
        setStatus('error');
      }
    }

    loadMessages();

    return () => {
      active = false;
    };
  }, [chat?.topic, client]);

  useEffect(() => {
    if (!chat?.topic) {
      return undefined;
    }

    return client.onPacket((packet) => {
      const deleteTopic = packet.pres?.src || packet.pres?.topic || packet.meta?.topic || packet.ctrl?.topic;
      const deletedRanges = getDeletedRanges(packet);

      if (deleteTopic === chat.topic && deletedRanges.length > 0) {
        setMessages((current) =>
          current.filter(
            (message) =>
              !deletedRanges.some((range) => {
                const seq = Number(message.seq);
                const low = Number(range.low);
                const hi = Number(range.hi || low + 1);

                return seq >= low && seq < hi;
              }),
          ),
        );

        return;
      }

      if (packet.data?.topic !== chat.topic) {
        return;
      }

      const incomingMessage = normalizeMessage(packet.data, session.token);

      setMessages((current) => {
        if (incomingMessage.replaceSeq) {
          return current.map((message) =>
            Number(message.seq) === Number(incomingMessage.replaceSeq)
              ? {
                  ...message,
                  text: incomingMessage.text,
                  content: incomingMessage.content,
                  preview: incomingMessage.preview,
                  editedAt: incomingMessage.createdAt,
                }
              : message,
          );
        }

        if (
          current.some(
            (message) =>
              message.id === incomingMessage.id ||
              (incomingMessage.seq != null && message.seq === incomingMessage.seq),
          )
        ) {
          return current;
        }

        return [...current, incomingMessage].sort(
          (left, right) => Number(left.seq || 0) - Number(right.seq || 0),
        );
      });
    });
  }, [chat?.topic, client]);

  useEffect(() => {
    if (preserveScrollRef.current) {
      preserveScrollRef.current = false;
      return;
    }

    messageEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, status]);

  const loadOlderMessages = async () => {
    if (olderStatus === 'loading' || !hasOlderMessages || messages.length === 0 || !chat?.topic) {
      return;
    }

    const firstSeq = Math.min(...messages.map((message) => Number(message.seq || Infinity)));

    if (!Number.isFinite(firstSeq)) {
      setHasOlderMessages(false);
      return;
    }

    const scrollContainer = messageAreaRef.current;
    const previousScrollHeight = scrollContainer?.scrollHeight || 0;
    const previousScrollTop = scrollContainer?.scrollTop || 0;

    setOlderStatus('loading');
    setError('');

    try {
      const olderItems = await loadMessagesWithRetry({
        token: session.token,
        topic: chat.topic,
        beforeSeq: firstSeq,
      });

      preserveScrollRef.current = true;
      setMessages((current) => {
        const knownKeys = new Set(current.map((message) => message.seq || message.id));
        const uniqueOlderItems = olderItems.filter((message) => !knownKeys.has(message.seq || message.id));

        return [...uniqueOlderItems, ...current].sort(
          (left, right) => Number(left.seq || 0) - Number(right.seq || 0),
        );
      });
      setHasOlderMessages(olderItems.length === MESSAGE_PAGE_SIZE);
      setOlderStatus('idle');

      window.requestAnimationFrame(() => {
        if (!scrollContainer) {
          return;
        }

        scrollContainer.scrollTop = scrollContainer.scrollHeight - previousScrollHeight + previousScrollTop;
      });
    } catch (requestError) {
      setError(requestError.message || 'Не удалось загрузить предыдущие сообщения.');
      setOlderStatus('idle');
    }
  };

  const handleMessageScroll = (event) => {
    if (event.currentTarget.scrollTop <= 80) {
      loadOlderMessages();
    }
  };

  useEffect(() => {
    if (!messageMenu) {
      return undefined;
    }

    const closeMenu = () => setMessageMenu(null);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('contextmenu', closeMenu);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', closeMenu, true);

    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('contextmenu', closeMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [messageMenu]);

  const sendMessage = async (event) => {
    event.preventDefault();

    const trimmedDraft = draft.trim();

    if ((!trimmedDraft && selectedFiles.length === 0) || sendStatus === 'loading' || !chat.canWrite) {
      return;
    }

    setSendStatus('loading');
    setError('');

    try {
      if (editingMessage) {
        const editedMessage = await client.editMessage({
          topic: chat.topic,
          message: editingMessage,
          text: trimmedDraft,
        });

        setMessages((current) =>
          current.map((message) =>
            message.id === editingMessage.id || Number(message.seq) === Number(editingMessage.seq)
              ? editedMessage
              : message,
          ),
        );
        onChatActivity?.(editedMessage);
        setDraft('');
        setEditingMessage(null);
        setSendStatus('idle');
        return;
      }

      const sentMessage =
        selectedFiles.length > 0
          ? await client.sendFiles({
              topic: chat.topic,
              files: selectedFiles,
              text: trimmedDraft,
              replyTo,
            })
          : await client.sendMessage({
              topic: chat.topic,
              text: trimmedDraft,
              replyTo,
            });

      setMessages((current) => [
        ...current,
        {
          ...sentMessage,
          from: session.user || sentMessage.from,
        },
      ]);
      onChatActivity?.({
        ...sentMessage,
        from: session.user || sentMessage.from,
      });
      setDraft('');
      setReplyTo(null);
      setSelectedFiles([]);
      setSendStatus('idle');
    } catch (requestError) {
      setError(requestError.message || 'Не удалось отправить сообщение.');
      setSendStatus('idle');
    }
  };

  const selectFiles = (event) => {
    const files = Array.from(event.target.files || []);

    event.target.value = '';

    if (files.length === 0 || !chat.canWrite) {
      return;
    }

    setSelectedFiles((current) => [...current, ...files]);
  };

  const removeSelectedFile = (indexToRemove) => {
    setSelectedFiles((current) => current.filter((_, index) => index !== indexToRemove));
  };

  const openMessageMenu = (event, message) => {
    event.preventDefault();
    event.stopPropagation();

    const width = 184;
    const height = 190;

    setMessageMenu({
      message,
      x: Math.min(event.clientX, window.innerWidth - width - 12),
      y: Math.min(event.clientY, window.innerHeight - height - 12),
    });
  };

  const startReply = (message) => {
    setReplyTo(message);
    setEditingMessage(null);
    setMessageMenu(null);
  };

  const startEdit = (message) => {
    setDraft(message.text || '');
    setSelectedFiles([]);
    setReplyTo(null);
    setEditingMessage(message);
    setMessageMenu(null);
  };

  const cancelEdit = () => {
    setDraft('');
    setEditingMessage(null);
  };

  const copyMessage = async (message) => {
    const text = getMessageCopyText(message);

    setMessageMenu(null);

    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  const deleteMessage = async (message) => {
    setMessageMenu(null);

    if (!window.confirm('Удалить сообщение?')) {
      return;
    }

    setSendStatus('loading');
    setError('');

    try {
      await client.deleteMessage({ topic: chat.topic, message });
      setMessages((current) => current.filter((item) => item.id !== message.id && item.seq !== message.seq));
      setSendStatus('idle');
    } catch (requestError) {
      setError(requestError.message || 'Не удалось удалить сообщение.');
      setSendStatus('idle');
    }
  };

  return (
    <section className="conversation-panel" aria-label="Текущий чат">
      <header className="conversation-header">
        <span className="avatar large" aria-hidden="true">
          {getInitials(chat.title)}
        </span>
        <div>
          <h2>{chat.title}</h2>
          <p>{chat.isGroup ? 'Группа' : 'Диалог'}</p>
        </div>
      </header>

      <div className="message-area" ref={messageAreaRef} onScroll={handleMessageScroll}>
        {status === 'loading' && <div className="conversation-empty">Загружаем сообщения...</div>}

        {status === 'error' && (
          <div className="conversation-empty error-line">
            <h3>Не удалось открыть чат</h3>
            <p>{error}</p>
          </div>
        )}

        {status === 'ready' && messages.length === 0 && (
          <div className="conversation-empty">
            <h3>Сообщений пока нет</h3>
            <p>Напишите первое сообщение в этот чат.</p>
          </div>
        )}

        {status === 'ready' && messages.length > 0 && (
          <div className="message-list">
            {olderStatus === 'loading' && <div className="history-loader">Загружаем предыдущие сообщения...</div>}
            {messages.map((message) => {
              const mine = message.from === session.user;

              return (
                <article
                  className={`message-bubble ${mine ? 'mine' : ''} ${messageMenu?.message?.id === message.id ? 'menu-open' : ''}`}
                  key={message.id}
                  onContextMenu={(event) => openMessageMenu(event, message)}
                >
                  {message.reply && (
                    <div className="reply-preview">
                      <strong>Ответ на сообщение</strong>
                      <span>{getReplyPreview(message.reply, messages)}</span>
                    </div>
                  )}
                  {message.text && <p>{message.text}</p>}
                  <MessageAttachments attachments={message.attachments} token={session.token} />
                  {!message.text && !message.attachments?.length && <p>Сообщение без текста</p>}
                  <footer>
                    <time>
                      {formatMessageTime(message.createdAt)}
                      {message.editedAt && ' · изменено'}
                    </time>
                    <button type="button" onClick={() => setReplyTo(message)}>
                      Ответить
                    </button>
                  </footer>
                </article>
              );
            })}
            <div ref={messageEndRef} />
          </div>
        )}
      </div>

      {messageMenu && (
        <div
          className="message-context-menu"
          role="menu"
          style={{ left: `${messageMenu.x}px`, top: `${messageMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={() => startReply(messageMenu.message)}>
            <span className="action-icon reply-action" aria-hidden="true" />
            Ответить
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => startEdit(messageMenu.message)}
            disabled={messageMenu.message.from !== session.user || !messageMenu.message.text}
          >
            <span className="action-icon edit-action" aria-hidden="true" />
            Изменить
          </button>
          <button type="button" role="menuitem" onClick={() => copyMessage(messageMenu.message)}>
            <span className="action-icon copy-action" aria-hidden="true" />
            Копировать
          </button>
          <span className="message-context-divider" aria-hidden="true" />
          <button
            className="danger"
            type="button"
            role="menuitem"
            onClick={() => deleteMessage(messageMenu.message)}
            disabled={sendStatus === 'loading'}
          >
            <span className="action-icon delete-action" aria-hidden="true" />
            Удалить
          </button>
        </div>
      )}

      <form className="composer" onSubmit={sendMessage}>
        {editingMessage && (
          <div className="composer-edit">
            <span className="action-icon edit-action" aria-hidden="true" />
            <div>
              <strong>Изменение</strong>
              <span>{editingMessage.text}</span>
            </div>
            <button type="button" onClick={cancelEdit} aria-label="Отменить изменение">
              x
            </button>
          </div>
        )}

        {replyTo && (
          <div className="composer-reply">
            <div>
              <strong>Ответ</strong>
              <span>{replyTo.text || replyTo.preview || 'Сообщение без текста'}</span>
            </div>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Отменить ответ">
              x
            </button>
          </div>
        )}

        {error && status !== 'error' && <div className="composer-error">{error}</div>}

        {selectedFiles.length > 0 && (
          <div className="composer-files" aria-label="Прикрепленные файлы">
            {selectedFiles.map((file, index) => (
              <div className="composer-file-preview" key={getSelectedFileId(file, index)}>
                <span className="composer-file-icon" aria-hidden="true">
                  {getFileBadge(file.name)}
                </span>
                <span className="composer-file-meta">
                  <strong>{file.name}</strong>
                  <span>{[file.type || 'Файл', formatFileSize(file.size)].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" onClick={() => removeSelectedFile(index)} aria-label={`Убрать ${file.name}`}>
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="composer-row">
          <button
            className="attach-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sendStatus === 'loading' || !chat.canWrite || Boolean(editingMessage)}
            aria-label="Прикрепить файл"
            title="Прикрепить файл"
          >
            <span className="composer-icon paperclip-icon" aria-hidden="true" />
          </button>
          <input ref={fileInputRef} className="file-input" type="file" multiple onChange={selectFiles} />
          <textarea
            value={draft}
            placeholder="Написать сообщение"
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            className="send-button"
            type="submit"
            disabled={(!draft.trim() && selectedFiles.length === 0) || sendStatus === 'loading' || !chat.canWrite}
          >
            <span className="composer-icon send-icon" aria-hidden="true" />
            <span className="sr-only">{sendStatus === 'loading' ? 'Отправляем' : 'Отправить'}</span>
          </button>
        </div>
      </form>
    </section>
  );
}

function MessengerScreen({ session, onLogout, theme, onToggleTheme }) {
  const [chats, setChats] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const client = useMemo(() => new FinchatRealtimeClient(session.token), [session.token]);
  const selectedIdRef = useRef(selectedId);
  const subscribedTopicsRef = useRef(new Set());

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    return () => {
      client.close();
    };
  }, [client]);

  useEffect(() => {
    let active = true;

    async function load() {
      setStatus('loading');
      setError('');

      try {
        const items = await loadChatList(session?.token);

        if (!active) {
          return;
        }

        setChats(items);
        setSelectedId((currentId) => {
          if (items.some((chat) => chat.id === currentId)) {
            return currentId;
          }

          return items[0]?.id || '';
        });
        setStatus('ready');
      } catch (requestError) {
        if (!active) {
          return;
        }

        setError(requestError.message || 'Не удалось загрузить список чатов.');
        setStatus('error');
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [session?.token]);

  const chatTopicsKey = useMemo(() => chats.map((chat) => chat.topic).join('|'), [chats]);

  useEffect(() => {
    if (status !== 'ready' || chats.length === 0) {
      return undefined;
    }

    chats.forEach((chat) => {
      if (subscribedTopicsRef.current.has(chat.topic)) {
        return;
      }

      subscribedTopicsRef.current.add(chat.topic);
      client.attach(chat.topic, { optional: true }).catch(() => {
        subscribedTopicsRef.current.delete(chat.topic);
      });
    });
  }, [chatTopicsKey, chats, client, status]);

  useEffect(() => {
    return client.onPacket((packet) => {
      if (!packet.data?.topic) {
        return;
      }

      const incomingMessage = normalizeMessage(packet.data, session.token);

      setChats((current) =>
        current
          .map((chat) => {
            if (chat.topic !== incomingMessage.topic) {
              return chat;
            }

            return applyMessageToChat(chat, incomingMessage, {
              selectedId: selectedIdRef.current,
              currentUser: session.user,
            });
          })
          .sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0)),
      );
    });
  }, [client, session.user]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    setChats((current) =>
      current.map((chat) => (chat.id === selectedId ? { ...chat, unread: 0 } : chat)),
    );
  }, [selectedId]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleChats = normalizedSearch
    ? chats.filter((chat) =>
        [chat.title, getChatPreview(chat)]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(normalizedSearch)),
      )
    : chats;
  const selectedChat = visibleChats.find((chat) => chat.id === selectedId);
  const updateChatActivity = (message) => {
    setChats((current) =>
      current
        .map((chat) =>
          chat.topic === message.topic
            ? applyMessageToChat(chat, message, {
                selectedId: selectedIdRef.current,
                currentUser: session.user,
                incrementUnread: false,
              })
            : chat,
        )
        .sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0)),
    );
  };

  return (
    <main className="messenger-page">
      <aside className="chat-sidebar" aria-label="Список чатов">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img src={logoSrc} alt="" />
            <p className="eyebrow">FinChat</p>
            <h1>FinChat</h1>
          </div>
          <div className="sidebar-actions">
            <button className="theme-button" type="button" onClick={onToggleTheme} title="Сменить тему" aria-label="Сменить тему">
              <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
            </button>
            <button className="logout-button" type="button" onClick={onLogout} title="Выйти" aria-label="Выйти">
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>

        <div className="search-box">
          <input
            type="search"
            placeholder="Поиск"
            aria-label="Поиск по чатам"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="chat-list">
          {status === 'loading' && <div className="state-line">Загружаем список чатов...</div>}

          {status === 'error' && (
            <div className="state-line error-line">
              <strong>Не удалось загрузить чаты</strong>
              <span>{error}</span>
            </div>
          )}

          {status === 'ready' && chats.length === 0 && (
            <div className="state-line">У аккаунта пока нет активных чатов.</div>
          )}

          {status === 'ready' && chats.length > 0 && visibleChats.length === 0 && (
            <div className="state-line">Чаты не найдены.</div>
          )}

          {visibleChats.map((chat) => (
            <button
              className={`chat-item ${chat.id === selectedId ? 'active' : ''}`}
              key={chat.id}
              type="button"
              onClick={() => setSelectedId(chat.id)}
            >
              <span className="avatar" aria-hidden="true">
                {getInitials(chat.title)}
              </span>
              <span className="chat-main">
                <span className="chat-topline">
                  <strong>{chat.title}</strong>
                  <time>{formatChatDate(chat.updatedAt)}</time>
                </span>
                <span className="chat-subline">
                  <span>{getChatPreview(chat)}</span>
                  {chat.online && <span className="online-dot">онлайн</span>}
                </span>
              </span>
              {chat.unread > 0 && <span className="unread-badge">{chat.unread}</span>}
            </button>
          ))}
        </div>
      </aside>

      {selectedChat ? (
        <Conversation chat={selectedChat} client={client} session={session} onChatActivity={updateChatActivity} />
      ) : (
        <section className="conversation-panel" aria-label="Текущий чат">
          <div className="conversation-empty">
            <h3>Выберите чат</h3>
            <p>После загрузки подписок Tinode они появятся в списке слева.</p>
          </div>
        </section>
      )}
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState(loadStoredSession);
  const [theme, setTheme] = useState(() => localStorage.getItem('finchatTheme') || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('finchatTheme', theme);
  }, [theme]);

  const handleLogin = (nextSession) => {
    if (!nextSession?.token) {
      clearStoredSession();
      setSession(null);
      return;
    }

    saveStoredSession(nextSession);
    setSession(nextSession);
  };

  const handleLogout = () => {
    clearStoredSession();
    setSession(null);
  };

  if (session?.token) {
    return (
      <MessengerScreen
        session={session}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      />
    );
  }

  return <LoginScreen onLogin={handleLogin} />;
}

