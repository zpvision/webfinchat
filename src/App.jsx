import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FinchatRealtimeClient,
  createPdfViewUrl,
  downloadAttachmentFile,
  fetchAttachmentBlob,
  getDeletedRanges,
  hasApiKey,
  loadChatList,
  loadTopicMessageBySeq,
  loadTopicMessages,
  loginWithWordColor,
  normalizeMessage,
} from './api/finchat.js';
import attachIconSrc from '../attach.svg';
import logoSrc from './assets/logo_512.png';

const initialForm = {
  phone: '',
  word1: '',
  word2: '',
  digits: '',
};
const SESSION_STORAGE_KEY = 'finchatSession';
const TOKEN_STORAGE_KEY = 'finchatToken';
const INITIAL_MESSAGE_PAGE_SIZE = 10;
const MESSAGE_PAGE_SIZE = 30;
const MAX_QUOTED_MESSAGE_LOOKUP_PAGES = 20;

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

function formatMessageDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();

  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Сегодня';
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return 'Вчера';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function getMessageDateKey(value) {
  if (!value) {
    return '';
  }

  return new Date(value).toISOString().slice(0, 10);
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

function getAvatarTone(value) {
  const source = value || '';
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash + source.charCodeAt(index) * (index + 1)) % 6;
  }

  return `avatar-tone-${hash + 1}`;
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

function getAudioRecorderMimeType() {
  if (!window.MediaRecorder) {
    return '';
  }

  return [
    'audio/ogg;codecs=opus',
    'audio/webm;codecs=opus',
    'audio/mp4',
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

function getAudioFileExtension(mimeType) {
  if (mimeType.includes('ogg')) {
    return 'ogg';
  }

  if (mimeType.includes('mp4')) {
    return 'm4a';
  }

  return 'webm';
}

function formatRecordingTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function isPermissionDeniedError(error) {
  return error?.message?.toLowerCase().includes('permission denied');
}

function getChatPreview(chat) {
  return chat.preview || (chat.isGroup ? 'Группа' : 'Диалог');
}

function getReplyPreview(reply, messages, replyPreviews = {}) {
  if (!reply) {
    return '';
  }

  if (reply.text) {
    return reply.text;
  }

  const cachedPreview = replyPreviews[Number(reply.seq)];

  if (cachedPreview) {
    return cachedPreview;
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

function getMessageAttachmentKey(message) {
  return (message.attachments || [])
    .map((attachment) => attachment.ref || attachment.url || attachment.name)
    .filter(Boolean)
    .join('|');
}

function isSameMessage(left, right) {
  if (!left || !right) {
    return false;
  }

  if (left.id && right.id && left.id === right.id) {
    return true;
  }

  if (left.seq != null && right.seq != null && Number(left.seq) === Number(right.seq)) {
    return true;
  }

  const leftAttachmentKey = getMessageAttachmentKey(left);
  const rightAttachmentKey = getMessageAttachmentKey(right);

  return Boolean(
    leftAttachmentKey &&
      rightAttachmentKey &&
      leftAttachmentKey === rightAttachmentKey &&
      (left.text || '') === (right.text || '') &&
      left.topic === right.topic,
  );
}

function mergeMessageLists(left, right) {
  return [...left, ...right].reduce((items, message) => {
    if (!items.some((item) => isSameMessage(item, message))) {
      items.push(message);
    }

    return items;
  }, []).sort((leftMessage, rightMessage) => Number(leftMessage.seq || 0) - Number(rightMessage.seq || 0));
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
  const [zoom, setZoom] = useState(1);
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const isSideways = normalizedRotation === 90 || normalizedRotation === 270;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!image) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [image]);

  useEffect(() => {
    setRotation(0);
    setZoom(1);
  }, [image?.url]);

  if (!image) {
    return null;
  }

  return createPortal(
    <div className="image-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="image-modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="image-modal-toolbar">
          <strong>{image.name}</strong>
          <div>
            <button
              type="button"
              onClick={() => setZoom((current) => Math.max(0.5, Number((current - 0.25).toFixed(2))))}
              title="Уменьшить"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom((current) => Math.min(3, Number((current + 0.25).toFixed(2))))}
              title="Увеличить"
            >
              +
            </button>
            <button type="button" onClick={() => setRotation((current) => current - 90)} title="Повернуть влево">
              ↺
            </button>
            <button type="button" onClick={() => setRotation((current) => current + 90)} title="Повернуть вправо">
              ↻
            </button>
            <a className="modal-download-button" href={image.url} download={image.name}>
              Скачать
            </a>
            <button type="button" onClick={onClose} title="Закрыть">
              ×
            </button>
          </div>
        </div>
        <div className="image-modal-stage">
          <img
            alt={image.name}
            src={image.url}
            style={{
              '--image-zoom': zoom,
              '--image-rotation': `${rotation}deg`,
              maxHeight: isSideways ? 'min(62vw, 100%)' : '100%',
              maxWidth: isSideways ? 'min(62vh, 100%)' : '100%',
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AttachmentImage({ attachment, token, onOpen, onLoad }) {
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
    <button
      className="image-attachment"
      type="button"
      onClick={() => onOpen({ name: attachment.name, url: objectUrl })}
      style={
        attachment.width && attachment.height
          ? { aspectRatio: `${attachment.width} / ${attachment.height}` }
          : undefined
      }
    >
      <img
        alt={attachment.name}
        height={attachment.height || undefined}
        loading="lazy"
        onLoad={onLoad}
        src={objectUrl}
        width={attachment.width || undefined}
      />
    </button>
  );
}

function AttachmentAudio({ attachment, token }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let nextObjectUrl = '';

    async function loadAudio() {
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
          setError(requestError.message || 'Не удалось загрузить голосовое сообщение.');
        }
      }
    }

    loadAudio();

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
    return <span className="attachment-loading">Загружаем голосовое сообщение...</span>;
  }

  return (
    <div className="audio-attachment">
      <span className="audio-attachment-icon" aria-hidden="true" />
      <audio controls preload="metadata" src={objectUrl}>
        <track kind="captions" />
      </audio>
    </div>
  );
}

function ComposerAudioPreview({ file }) {
  const [objectUrl, setObjectUrl] = useState('');

  useEffect(() => {
    if (!file) {
      return undefined;
    }

    const nextObjectUrl = URL.createObjectURL(file);

    setObjectUrl(nextObjectUrl);

    return () => URL.revokeObjectURL(nextObjectUrl);
  }, [file]);

  if (!objectUrl) {
    return null;
  }

  return (
    <audio className="composer-audio-preview" controls preload="metadata" src={objectUrl}>
      <track kind="captions" />
    </audio>
  );
}

function isPdfAttachment(attachment) {
  return attachment?.mime === 'application/pdf' || /\.pdf$/i.test(attachment?.name || '');
}

function PdfViewer({ file, token, onClose }) {
  const [viewUrl, setViewUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!file) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [file]);

  useEffect(() => {
    let active = true;

    async function loadPdf() {
      setError('');
      setViewUrl('');

      try {
        const nextViewUrl = await createPdfViewUrl({ token, ref: file.ref, name: file.name });
        const checkResponse = await fetch(nextViewUrl, { cache: 'no-store' });

        if (!checkResponse.ok) {
          const errorText = await checkResponse.text();
          throw new Error(errorText || `Не удалось открыть PDF: ${checkResponse.status}.`);
        }

        const contentType = checkResponse.headers.get('content-type') || '';
        const preview = new Uint8Array(await checkResponse.clone().arrayBuffer()).slice(0, 5);
        const isPdf = contentType.includes('application/pdf') || String.fromCharCode(...preview) === '%PDF-';

        if (!isPdf) {
          throw new Error('Сервер вернул не PDF-файл.');
        }

        if (active) {
          setViewUrl(nextViewUrl);
        }
      } catch (requestError) {
        if (active) {
          setError(requestError.message || 'Не удалось открыть PDF.');
        }
      }
    }

    if (file) {
      loadPdf();
    }

    return () => {
      active = false;
    };
  }, [file, token]);

  if (!file) {
    return null;
  }

  return createPortal(
    <div className="image-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="image-modal-panel pdf-modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="image-modal-toolbar">
          <strong>{file.name}</strong>
          <div>
            <button
              className="modal-download-button"
              type="button"
              onClick={() => downloadAttachmentFile({ token, ref: file.ref, name: file.name })}
              title="Скачать"
            >
              Скачать
            </button>
            <button type="button" onClick={onClose} title="Закрыть">
              ×
            </button>
          </div>
        </div>
        <div className="pdf-modal-stage">
          {error && <span className="attachment-error">{error}</span>}
          {!error && !viewUrl && <span className="attachment-loading">Загружаем PDF...</span>}
          {viewUrl && <iframe title={file.name} src={viewUrl} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MessageAttachments({ attachments, token, onMediaLoad }) {
  const [downloadingId, setDownloadingId] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [viewerImage, setViewerImage] = useState(null);
  const [viewerPdf, setViewerPdf] = useState(null);

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
          <AttachmentImage
            attachment={attachment}
            key={attachment.id}
            token={token}
            onOpen={setViewerImage}
            onLoad={onMediaLoad}
          />
        ) : attachment.type === 'audio' ? (
          <AttachmentAudio attachment={attachment} key={attachment.id} token={token} />
        ) : (
          <button
            className={`file-attachment ${isPdfAttachment(attachment) ? 'pdf-attachment' : ''}`}
            key={attachment.id}
            type="button"
            onClick={() => (isPdfAttachment(attachment) ? setViewerPdf(attachment) : downloadFile(attachment))}
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
                  : [
                      isPdfAttachment(attachment) ? 'Открыть PDF' : attachment.mime,
                      formatFileSize(attachment.size),
                    ].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        ),
      )}
      {downloadError && <span className="attachment-error">{downloadError}</span>}
      <ImageViewer image={viewerImage} onClose={() => setViewerImage(null)} />
      <PdfViewer file={viewerPdf} token={token} onClose={() => setViewerPdf(null)} />
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
            Авторизация по схеме wordcolor через FinChat API. После входа откроется
            список ваших чатов.
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
  const [messagesVisible, setMessagesVisible] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [messageMenu, setMessageMenu] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sendStatus, setSendStatus] = useState('idle');
  const [recordingStatus, setRecordingStatus] = useState('idle');
  const [recordingStartedAt, setRecordingStartedAt] = useState(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [voiceLevels, setVoiceLevels] = useState(Array.from({ length: 44 }, () => 0.2));
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderStatus, setOlderStatus] = useState('idle');
  const [highlightedSeq, setHighlightedSeq] = useState(null);
  const [replyPreviews, setReplyPreviews] = useState({});
  const messageAreaRef = useRef(null);
  const messageEndRef = useRef(null);
  const messagesRef = useRef([]);
  const fileInputRef = useRef(null);
  const preserveScrollRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const hasOlderMessagesRef = useRef(false);
  const olderLoadingRef = useRef(false);
  const firstPaintRef = useRef(true);
  const initialBottomLockRef = useRef(false);
  const bottomLockTimerRef = useRef(null);
  const pendingScrollRestoreRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingShouldSendRef = useRef(false);
  const recordingStartedAtRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserFrameRef = useRef(null);
  const resolvedReplySeqsRef = useRef(new Set());
  const currentTopicRef = useRef(chat?.topic || '');

  const stopVoiceAnalyser = () => {
    if (analyserFrameRef.current) {
      window.cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }

    audioContextRef.current?.close?.();
    audioContextRef.current = null;
    setVoiceLevels(Array.from({ length: 44 }, () => 0.2));
  };

  useEffect(() => {
    currentTopicRef.current = chat?.topic || '';
  }, [chat?.topic]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    hasOlderMessagesRef.current = hasOlderMessages;
  }, [hasOlderMessages]);

  useEffect(() => {
    let active = true;

    async function loadMessages() {
      if (!chat?.topic) {
        return;
      }

      setStatus('loading');
      setMessagesVisible(false);
      setError('');
      setMessages([]);
      setReplyTo(null);
      setEditingMessage(null);
      setMessageMenu(null);
      setSelectedFiles([]);
      setRecordingStatus('idle');
      setRecordingStartedAt(null);
      setRecordingElapsedSeconds(0);
      setVoiceLevels(Array.from({ length: 44 }, () => 0.2));
      recordingShouldSendRef.current = false;
      recordingStartedAtRef.current = null;
      setHasOlderMessages(false);
      hasOlderMessagesRef.current = false;
      olderLoadingRef.current = false;
      setOlderStatus('idle');
      setHighlightedSeq(null);
      setReplyPreviews({});
      firstPaintRef.current = true;
      initialBottomLockRef.current = true;
      stickToBottomRef.current = true;
      pendingScrollRestoreRef.current = null;
      resolvedReplySeqsRef.current = new Set();

      try {
        const items = await loadMessagesWithRetry({
          token: session.token,
          topic: chat.topic,
          limit: INITIAL_MESSAGE_PAGE_SIZE,
        });

        if (!active) {
          return;
        }

        setMessages(items);
        setHasOlderMessages(items.length > 0 && Math.min(...items.map((message) => Number(message.seq || Infinity))) > 1);
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

        if (current.some((message) => isSameMessage(message, incomingMessage))) {
          return current;
        }

        return mergeMessageLists(current, [incomingMessage]);
      });
    });
  }, [chat?.topic, client]);

  useEffect(() => {
    if (status !== 'ready' || !chat?.topic || messages.length === 0) {
      return;
    }

    const requestTopic = chat.topic;
    const loadedSeqs = new Set(
        messages
          .map((message) => Number(message.seq))
          .filter((seq) => Number.isFinite(seq)),
    );
    const firstSeq = Math.min(...loadedSeqs);
    const missingReplySeqs = Array.from(
      new Set(
        messages
          .map((message) => Number(message.reply?.seq))
          .filter(
            (seq) =>
              Number.isFinite(seq) &&
              !loadedSeqs.has(seq) &&
              !replyPreviews[seq] &&
              !resolvedReplySeqsRef.current.has(seq),
          ),
      ),
    );

    if (missingReplySeqs.length === 0) {
      return;
    }

    missingReplySeqs.forEach((seq) => {
      resolvedReplySeqsRef.current.add(seq);

      loadTopicMessageBySeq(session.token, chat.topic, seq)
        .then(async (message) => {
          let quotedMessage = message;

          if (!quotedMessage && Number.isFinite(firstSeq) && seq < firstSeq) {
            let beforeSeq = firstSeq;

            for (let page = 0; page < MAX_QUOTED_MESSAGE_LOOKUP_PAGES; page += 1) {
              const olderItems = await loadMessagesWithRetry({
                token: session.token,
                topic: requestTopic,
                beforeSeq,
              });

              quotedMessage = olderItems.find((item) => Number(item.seq) === seq);

              if (quotedMessage || olderItems.length === 0) {
                break;
              }

              const nextBeforeSeq = Math.min(...olderItems.map((item) => Number(item.seq || Infinity)));

              if (!Number.isFinite(nextBeforeSeq) || nextBeforeSeq >= beforeSeq || seq >= nextBeforeSeq) {
                break;
              }

              beforeSeq = nextBeforeSeq;
            }
          }

          if (requestTopic !== currentTopicRef.current) {
            return;
          }

          if (!quotedMessage) {
            resolvedReplySeqsRef.current.delete(seq);
            return;
          }

          const preview = quotedMessage.text || quotedMessage.preview;

          if (preview) {
            setReplyPreviews((current) => ({
              ...current,
              [seq]: preview,
            }));
          } else {
            resolvedReplySeqsRef.current.delete(seq);
          }
        })
        .catch(() => {
          resolvedReplySeqsRef.current.delete(seq);
        });
    });
  }, [messages, replyPreviews, status, chat?.topic, session.token]);

  useEffect(() => () => {
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }

    if (bottomLockTimerRef.current) {
      window.clearTimeout(bottomLockTimerRef.current);
    }

    recordingShouldSendRef.current = false;
    stopVoiceAnalyser();
    mediaRecorderRef.current?.stop?.();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (recordingStatus !== 'recording' || !recordingStartedAt) {
      return undefined;
    }

    const updateElapsed = () => {
      setRecordingElapsedSeconds(Math.max(0, Math.floor((Date.now() - recordingStartedAt) / 1000)));
    };
    const intervalId = window.setInterval(updateElapsed, 250);

    updateElapsed();

    return () => window.clearInterval(intervalId);
  }, [recordingStartedAt, recordingStatus]);

  useLayoutEffect(() => {
    if (status !== 'ready' || messages.length === 0) {
      return;
    }

    const scrollContainer = messageAreaRef.current;

    if (!scrollContainer) {
      return;
    }

    if (preserveScrollRef.current) {
      preserveScrollRef.current = false;

      const restore = pendingScrollRestoreRef.current;
      pendingScrollRestoreRef.current = null;

      if (restore) {
        if (Number.isFinite(restore.bottomOffset)) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight - restore.bottomOffset;
        } else if (Number.isFinite(restore.scrollHeight) && Number.isFinite(restore.scrollTop)) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight - restore.scrollHeight + restore.scrollTop;
        }
      }

      if (!messagesVisible) {
        setMessagesVisible(true);
      }

      return;
    }

    stickToBottomRef.current = true;

    if (firstPaintRef.current) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      firstPaintRef.current = false;
    } else {
      messageEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }

    if (!messagesVisible) {
      setMessagesVisible(true);
    }

    if (initialBottomLockRef.current) {
      if (bottomLockTimerRef.current) {
        window.clearTimeout(bottomLockTimerRef.current);
      }

      bottomLockTimerRef.current = window.setTimeout(() => {
        initialBottomLockRef.current = false;
      }, 2500);
    }
  }, [messages.length, status]);

  useEffect(() => {
    if (status !== 'ready' || messages.length === 0 || !initialBottomLockRef.current) {
      return undefined;
    }

    const lockStartedAt = Date.now();
    const intervalId = window.setInterval(() => {
      if (!initialBottomLockRef.current || Date.now() - lockStartedAt > 2500) {
        window.clearInterval(intervalId);
        initialBottomLockRef.current = false;
        return;
      }

      if (stickToBottomRef.current) {
        const scrollContainer = messageAreaRef.current;

        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    }, 120);

    return () => window.clearInterval(intervalId);
  }, [messages.length, status]);

  const scrollToBottomIfNeeded = () => {
    if ((!stickToBottomRef.current && !initialBottomLockRef.current) || preserveScrollRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      messageEndRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
    });
  };

  const loadOlderMessages = async () => {
    const currentMessages = messagesRef.current;

    if (olderLoadingRef.current || !hasOlderMessagesRef.current || currentMessages.length === 0 || !chat?.topic) {
      return;
    }

    const firstSeq = Math.min(...currentMessages.map((message) => Number(message.seq || Infinity)));

    if (!Number.isFinite(firstSeq) || firstSeq <= 1) {
      setHasOlderMessages(false);
      hasOlderMessagesRef.current = false;
      return;
    }

    const scrollContainer = messageAreaRef.current;
    const previousScrollHeight = scrollContainer?.scrollHeight || 0;
    const previousScrollTop = scrollContainer?.scrollTop || 0;

    olderLoadingRef.current = true;
    setOlderStatus('loading');
    setError('');

    try {
      const olderItems = await loadMessagesWithRetry({
        token: session.token,
        topic: chat.topic,
        beforeSeq: firstSeq,
      });

      preserveScrollRef.current = true;
      pendingScrollRestoreRef.current = scrollContainer
        ? {
            scrollHeight: previousScrollHeight,
            scrollTop: previousScrollTop,
          }
        : null;
      setMessages((current) => {
        const knownKeys = new Set(current.map((message) => message.seq || message.id));
        const uniqueOlderItems = olderItems.filter((message) => !knownKeys.has(message.seq || message.id));

        return mergeMessageLists(uniqueOlderItems, current);
      });
      const nextMessages = mergeMessageLists(olderItems, currentMessages);
      const nextFirstSeq = Math.min(...nextMessages.map((message) => Number(message.seq || Infinity)));
      const stillHasOlder = olderItems.length > 0 && Number.isFinite(nextFirstSeq) && nextFirstSeq > 1 && nextFirstSeq < firstSeq;

      setHasOlderMessages(stillHasOlder);
      hasOlderMessagesRef.current = stillHasOlder;
      setOlderStatus('idle');
      olderLoadingRef.current = false;

      window.requestAnimationFrame(() => {
        const currentScrollContainer = messageAreaRef.current;

        if (currentScrollContainer && currentScrollContainer.scrollTop <= 160 && hasOlderMessagesRef.current) {
          loadOlderMessages();
        }
      });

    } catch (requestError) {
      setError(requestError.message || 'Не удалось загрузить предыдущие сообщения.');
      setOlderStatus('idle');
      olderLoadingRef.current = false;
    }
  };

  const scrollToMessage = (seq) => {
    const targetSeq = Number(seq);

    if (!Number.isFinite(targetSeq)) {
      return false;
    }

    const target = messageAreaRef.current?.querySelector(`[data-message-seq="${targetSeq}"]`);

    if (!target) {
      return false;
    }

    setHighlightedSeq(targetSeq);
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });

    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }

    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedSeq((current) => (Number(current) === targetSeq ? null : current));
    }, 1800);

    return true;
  };

  const jumpToQuotedMessage = async (reply) => {
    const targetSeq = Number(reply?.seq);

    if (!Number.isFinite(targetSeq) || !chat?.topic || olderStatus === 'loading') {
      return;
    }

    setError('');

    if (messages.some((message) => Number(message.seq) === targetSeq)) {
      scrollToMessage(targetSeq);
      return;
    }

    let loadedMessages = messages;
    let firstSeq = Math.min(...loadedMessages.map((message) => Number(message.seq || Infinity)));

    if (!Number.isFinite(firstSeq) || targetSeq >= firstSeq) {
      setError('Цитируемое сообщение не найдено в загруженной истории.');
      return;
    }

    setOlderStatus('loading');

    try {
      let found = false;

      for (let page = 0; page < MAX_QUOTED_MESSAGE_LOOKUP_PAGES; page += 1) {
        const olderItems = await loadMessagesWithRetry({
          token: session.token,
          topic: chat.topic,
          beforeSeq: firstSeq,
        });

        if (olderItems.length === 0) {
          setHasOlderMessages(false);
          setError('Цитируемое сообщение не найдено в истории чата.');
          break;
        }

        loadedMessages = mergeMessageLists(olderItems, loadedMessages);
        firstSeq = Math.min(...loadedMessages.map((message) => Number(message.seq || Infinity)));
        preserveScrollRef.current = true;
        setMessages(loadedMessages);
        setHasOlderMessages(olderItems.length === MESSAGE_PAGE_SIZE);

        if (loadedMessages.some((message) => Number(message.seq) === targetSeq)) {
          found = true;
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              scrollToMessage(targetSeq);
            });
          });
          break;
        }

        if (olderItems.length < MESSAGE_PAGE_SIZE || targetSeq >= firstSeq) {
          setError('Цитируемое сообщение не найдено в истории чата.');
          break;
        }
      }

      if (!found) {
        setError('Цитируемое сообщение не найдено в ближайшей истории чата.');
      }
    } catch (requestError) {
      setError(requestError.message || 'Не удалось загрузить цитируемое сообщение.');
    } finally {
      setOlderStatus('idle');
    }
  };

  const handleMessageScroll = (event) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;

    stickToBottomRef.current = distanceToBottom < 120;

    if (target.scrollTop <= 80) {
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

    if (
      (!trimmedDraft && selectedFiles.length === 0) ||
      sendStatus === 'loading' ||
      recordingStatus === 'recording' ||
      !chat.canWrite
    ) {
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

      const localSentMessage = {
        ...sentMessage,
        from: session.user || sentMessage.from,
      };

      setMessages((current) => {
        if (current.some((message) => isSameMessage(message, localSentMessage))) {
          return current;
        }

        return [...current, localSentMessage];
      });
      onChatActivity?.(localSentMessage);
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

  const sendVoiceFile = async (file) => {
    if (!file || !chat.canWrite) {
      return;
    }

    setSendStatus('loading');
    setError('');

    try {
      const sentMessage = await client.sendFiles({
        topic: chat.topic,
        files: [file],
        kind: 'voice',
        text: draft.trim(),
        replyTo,
      });
      const localSentMessage = {
        ...sentMessage,
        from: session.user || sentMessage.from,
      };

      setMessages((current) => {
        if (current.some((message) => isSameMessage(message, localSentMessage))) {
          return current;
        }

        return [...current, localSentMessage];
      });
      onChatActivity?.(localSentMessage);
      setDraft('');
      setReplyTo(null);
      setSendStatus('idle');
    } catch (requestError) {
      setError(requestError.message || 'Не удалось отправить голосовое сообщение.');
      setSendStatus('idle');
    }
  };

  const startVoiceRecording = async () => {
    if (!chat.canWrite || sendStatus === 'loading' || recordingStatus === 'recording' || editingMessage) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Браузер не поддерживает запись голосовых сообщений.');
      return;
    }

    setError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getAudioRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (AudioContextClass) {
        const audioContext = new AudioContextClass();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);

        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.42;
        const data = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);
        audioContext.resume?.();
        audioContextRef.current = audioContext;

        const updateVoiceLevels = () => {
          analyser.getByteFrequencyData(data);

          setVoiceLevels((current) => {
            const groups = current.length;
            const usableBins = Math.max(groups, Math.floor(data.length * 0.45));
            const binsPerGroup = Math.max(1, Math.floor(usableBins / groups));
            const multipliers = [0.75, 1.18, 0.88, 1.35, 0.96, 1.22, 0.82];

            return current.map((previous, index) => {
              const start = index * binsPerGroup;
              const end = Math.min(usableBins, start + binsPerGroup);
              let sum = 0;

              for (let bin = start; bin < end; bin += 1) {
                sum += data[bin] || 0;
              }

              const average = sum / Math.max(1, end - start);
              const rawLevel = Math.min(1, Math.pow(average / 92, 0.72) * multipliers[index % multipliers.length]);
              const activeLevel = Math.max(0.06, rawLevel);

              return previous * 0.35 + activeLevel * 0.65;
            });
          });
          analyserFrameRef.current = window.requestAnimationFrame(updateVoiceLevels);
        };

        updateVoiceLevels();
      }

      recordingChunksRef.current = [];
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingShouldSendRef.current = true;

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const chunks = recordingChunksRef.current;
        const currentMimeType = recorder.mimeType || mimeType || 'audio/webm';
        const shouldSend = recordingShouldSendRef.current;

        stream.getTracks().forEach((track) => track.stop());
        stopVoiceAnalyser();
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
        recordingChunksRef.current = [];
        recordingShouldSendRef.current = false;

        if (chunks.length > 0 && shouldSend) {
          const extension = getAudioFileExtension(currentMimeType);
          const blob = new Blob(chunks, { type: currentMimeType });
          const durationMs = recordingStartedAtRef.current
            ? Math.max(0, Date.now() - recordingStartedAtRef.current)
            : Math.max(0, recordingElapsedSeconds * 1000);
          const file = new File([blob], `voice.${extension}`, {
            type: currentMimeType,
            lastModified: Date.now(),
          });

          Object.defineProperty(file, 'durationMs', {
            configurable: true,
            value: durationMs,
          });

          sendVoiceFile(file);
        }

        setRecordingStatus('idle');
        setRecordingStartedAt(null);
        recordingStartedAtRef.current = null;
        setRecordingElapsedSeconds(0);
      });

      recorder.start();
      const startedAt = Date.now();
      recordingStartedAtRef.current = startedAt;
      setRecordingStartedAt(startedAt);
      setRecordingElapsedSeconds(0);
      setRecordingStatus('recording');
    } catch (requestError) {
      setRecordingStatus('idle');
      setRecordingStartedAt(null);
      recordingStartedAtRef.current = null;
      setRecordingElapsedSeconds(0);
      recordingShouldSendRef.current = false;
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setError(
        requestError.name === 'NotAllowedError'
          ? 'Доступ к микрофону запрещен браузером.'
          : requestError.message || 'Не удалось начать запись голосового сообщения.',
      );
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      recordingShouldSendRef.current = true;
      mediaRecorderRef.current.stop();
    }
  };

  const cancelVoiceRecording = () => {
    recordingShouldSendRef.current = false;

    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      return;
    }

    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    recordingChunksRef.current = [];
    stopVoiceAnalyser();
    setRecordingStatus('idle');
    setRecordingStartedAt(null);
    recordingStartedAtRef.current = null;
    setRecordingElapsedSeconds(0);
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
        {status === 'loading' && (
          <div className="message-list message-list-loading" aria-busy="true">
            <div className="message-skeleton incoming" />
            <div className="message-skeleton incoming short" />
            <div className="message-skeleton outgoing" />
          </div>
        )}

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
          <div className={`message-list ${messagesVisible ? 'message-list-visible' : 'message-list-preparing'}`}>
            {olderStatus === 'loading' && <div className="history-loader">Загружаем предыдущие сообщения...</div>}
            {messages.map((message, index) => {
              const mine = message.from === session.user;
              const dateKey = getMessageDateKey(message.createdAt);
              const previousDateKey = getMessageDateKey(messages[index - 1]?.createdAt);
              const showDate = dateKey && dateKey !== previousDateKey;

              return (
                <div className="message-item-group" key={message.id}>
                  {showDate && <div className="message-date-label">{formatMessageDate(message.createdAt)}</div>}
                  <article
                    className={`message-bubble ${mine ? 'mine' : ''} ${messageMenu?.message?.id === message.id ? 'menu-open' : ''} ${Number(highlightedSeq) === Number(message.seq) ? 'message-highlight' : ''}`}
                    data-message-seq={message.seq || undefined}
                    onContextMenu={(event) => openMessageMenu(event, message)}
                  >
                    {message.reply && (
                      <button
                        className="reply-preview reply-preview-clickable"
                        type="button"
                        onClick={() => jumpToQuotedMessage(message.reply)}
                        title="Перейти к цитируемому сообщению"
                      >
                        <strong>Ответ на сообщение</strong>
                        <span>{getReplyPreview(message.reply, messages, replyPreviews)}</span>
                      </button>
                    )}
                    {message.text && <p>{message.text}</p>}
                    <MessageAttachments
                      attachments={message.attachments}
                      token={session.token}
                      onMediaLoad={scrollToBottomIfNeeded}
                    />
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
                </div>
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
              <div className={`composer-file-preview ${file.type.startsWith('audio/') ? 'voice-preview' : ''}`} key={getSelectedFileId(file, index)}>
                <span className="composer-file-icon" aria-hidden="true">
                  {file.type.startsWith('audio/') ? 'MIC' : getFileBadge(file.name)}
                </span>
                <span className="composer-file-meta">
                  <strong>{file.type.startsWith('audio/') ? 'Голосовое сообщение' : file.name}</strong>
                  <span>{[file.type || 'Файл', formatFileSize(file.size)].filter(Boolean).join(' · ')}</span>
                  {file.type.startsWith('audio/') && <ComposerAudioPreview file={file} />}
                </span>
                <button type="button" onClick={() => removeSelectedFile(index)} aria-label={`Убрать ${file.name}`}>
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {recordingStatus === 'recording' ? (
          <div className="voice-recording-row" role="status">
            <span className="voice-recording-spacer" aria-hidden="true" />
            <button
              className="voice-button recording"
              type="button"
              onClick={stopVoiceRecording}
              aria-label="Остановить и отправить запись"
              title="Остановить и отправить запись"
            >
              <span className="voice-stop-icon" aria-hidden="true" />
            </button>
            <button className="voice-cancel-button" type="button" onClick={cancelVoiceRecording}>
              Не отправлять
            </button>
            <strong>{formatRecordingTime(recordingElapsedSeconds)}</strong>
            <div className="voice-activity" aria-hidden="true">
              {voiceLevels.map((level, index) => (
                <span key={index} style={{ '--voice-level': level }} />
              ))}
            </div>
            <span>Идет запись</span>
          </div>
        ) : (
          <div className="composer-row">
            <button
              className="attach-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendStatus === 'loading' || !chat.canWrite || Boolean(editingMessage)}
              aria-label="Прикрепить файл"
              title="Прикрепить файл"
            >
              <img className="attach-icon" src={attachIconSrc} alt="" aria-hidden="true" />
            </button>
            <button
              className="voice-button"
              type="button"
              onClick={startVoiceRecording}
              disabled={sendStatus === 'loading' || !chat.canWrite || Boolean(editingMessage)}
              aria-label="Записать голосовое сообщение"
              title="Записать голосовое сообщение"
            >
              <span className="voice-icon" aria-hidden="true" />
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
        )}
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
              {theme === 'dark' ? (
                <svg className="toolbar-svg-icon" aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2.5M12 19.5V22M4.93 4.93 6.7 6.7M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07 6.7 17.3M17.3 6.7l1.77-1.77" />
                </svg>
              ) : (
                <svg className="toolbar-svg-icon" aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M20.5 14.3A7.8 7.8 0 0 1 9.7 3.5 8.6 8.6 0 1 0 20.5 14.3Z" />
                </svg>
              )}
            </button>
            <button className="logout-button" type="button" onClick={onLogout} title="Выйти" aria-label="Выйти">
              <svg className="toolbar-svg-icon" aria-hidden="true" viewBox="0 0 24 24">
                <path d="M10 6H6.8A2.8 2.8 0 0 0 4 8.8v6.4A2.8 2.8 0 0 0 6.8 18H10" />
                <path d="M14 8l4 4-4 4" />
                <path d="M18 12H9" />
              </svg>
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
              <span className={`avatar ${getAvatarTone(chat.topic || chat.title)}`} aria-hidden="true">
                {getInitials(chat.title)}
              </span>
              <span className="chat-main">
                <span className="chat-topline">
                  <strong>
                    {chat.title}
                    {chat.isGroup && <span className="group-chat-icon" aria-label="Группа" title="Группа" />}
                  </strong>
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
            <p>После загрузки ваши чаты появятся в списке слева.</p>
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

