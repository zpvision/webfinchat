const PROTOCOL_VERSION = '0.22';

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function createSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${window.location.host}/finchat-channels`;
}

function normalizeFileRef(ref) {
  if (!ref) {
    return '';
  }

  if (ref.startsWith('http')) {
    return ref;
  }

  if (!ref.startsWith('/')) {
    return `/v0/file/s/${ref}`;
  }

  if (!ref.startsWith('/v0/')) {
    return `/v0/file/s${ref}`;
  }

  return ref;
}

function createFileUrl(ref, { includeApiKey = false, token = '' } = {}) {
  const normalizedRef = normalizeFileRef(ref);

  if (!normalizedRef) {
    return '';
  }

  const url = new URL(normalizedRef, window.location.origin);

  return url.toString();
}

export async function fetchAttachmentBlob({ token, ref }) {
  if (!token) {
    throw new Error('Нет токена авторизации для скачивания файла.');
  }

  if (!ref) {
    throw new Error('У файла нет ссылки для скачивания.');
  }

  const downloadUrl = new URL('/file-download-proxy', window.location.origin);

  downloadUrl.searchParams.set('ref', ref);

  const response = await fetch(downloadUrl, {
    headers: {
      'X-Finchat-Token': token,
    },
  });

  if (!response.ok) {
    throw new Error(`Не удалось скачать файл: ${response.status}.`);
  }

  const contentType = response.headers.get('content-type') || '';
  const blob = await response.blob();

  if (contentType.includes('application/json')) {
    const text = await blob.text();

    try {
      const parsed = JSON.parse(text);
      const errorText =
        parsed?.error || parsed?.err || parsed?.ctrl?.text || 'API вернул JSON вместо файла.';

      throw new Error(errorText);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(text || 'API вернул JSON вместо файла.');
      }

      throw error;
    }
  }

  return blob;
}

export async function downloadAttachmentFile({ token, ref, name }) {
  const blob = await fetchAttachmentBlob({ token, ref });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = objectUrl;
  link.download = name || 'download';
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function createPdfViewUrl({ token, ref, name }) {
  if (!token) {
    throw new Error('Нет токена авторизации для просмотра PDF.');
  }

  if (!ref) {
    throw new Error('У PDF нет ссылки для просмотра.');
  }

  const response = await fetch('/pdf-view-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Finchat-Token': token,
    },
    body: JSON.stringify({ ref, name }),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(responseText || `Не удалось открыть PDF: ${response.status}.`);
  }

  let payload;

  try {
    payload = JSON.parse(responseText);
  } catch {
    const preview = responseText.replace(/\s+/g, ' ').trim().slice(0, 120);

    throw new Error(
      preview.startsWith('<!doctype') || preview.startsWith('<html')
        ? 'Сервер вернул HTML вместо JSON. Проверьте, что Node-сервер обновлен и маршрут /pdf-view-proxy доступен.'
        : `Сервер вернул некорректный ответ для PDF: ${preview || 'пустой ответ'}.`,
    );
  }

  if (!payload.url) {
    throw new Error('Сервер не вернул ссылку для просмотра PDF.');
  }

  return payload.url;
}

function getFileExtension(name) {
  const extension = name?.split('.').pop();

  if (!extension || extension === name) {
    return '';
  }

  return extension;
}

async function getImageDimensions(file) {
  if (!file.type.startsWith('image/')) {
    return {};
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = objectUrl;
    });

    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadAttachmentFileDirect({ token, file }) {
  if (!token) {
    throw new Error('Нет токена авторизации для загрузки файла.');
  }

  if (!file) {
    throw new Error('Файл не выбран.');
  }

  const uploadUrl = new URL('/file-upload-proxy', window.location.origin);
  const mime = file.type || 'application/octet-stream';
  const extension = getFileExtension(file.name);

  uploadUrl.searchParams.set('direct', 'true');

  if (extension) {
    uploadUrl.searchParams.set('ext', extension);
  } else {
    uploadUrl.searchParams.set('mime', mime);
  }

  const presignResponse = await fetch(uploadUrl.toString(), {
    method: 'POST',
    headers: {
      'X-Finchat-Auth': `Token ${token}`,
    },
  });

  if (!presignResponse.ok) {
    throw new Error(`Не удалось подготовить загрузку файла: ${presignResponse.status}.`);
  }

  const presignPacket = await presignResponse.json();

  if (presignPacket?.ctrl?.code !== 200) {
    throw new Error(presignPacket.ctrl.text || `API вернул код ${presignPacket.ctrl.code}.`);
  }

  const params = presignPacket?.ctrl?.params;

  if (!params?.upload_url || !params?.url || !params?.content_type || !params?.cache_control) {
    throw new Error('API не вернул ссылку для загрузки файла.');
  }

  const putHeaders = {
    'Content-Type': params.content_type,
    'Cache-Control': params.cache_control,
  };

  let putResponse;

  try {
    putResponse = await fetch(params.upload_url, {
      method: params.upload_method || 'PUT',
      headers: putHeaders,
      body: file,
    });
  } catch (error) {
    putResponse = await fetch('/upload-proxy', {
      method: 'PUT',
      headers: {
        ...putHeaders,
        'X-Upload-Url': params.upload_url,
      },
      body: file,
    });
  }

  if (!putResponse.ok) {
    throw new Error(`Не удалось загрузить файл в хранилище: ${putResponse.status}.`);
  }

  return {
    mime,
    name: file.name,
    ref: params.url,
    size: file.size,
    ...(await getImageDimensions(file)),
  };
}

export async function uploadAttachmentFile({ token, file }) {
  if (!token) {
    throw new Error('Нет токена авторизации для загрузки файла.');
  }

  if (!file) {
    throw new Error('Файл не выбран.');
  }

  const mime = file.type || 'application/octet-stream';
  const extension = getFileExtension(file.name);
  const uploadResponse = await fetch('/file-upload-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': mime,
      'X-File-Ext': extension,
      'X-File-Mime': mime,
      'X-Finchat-Token': token,
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(errorText || `Не удалось загрузить файл: ${uploadResponse.status}.`);
  }

  const uploaded = await uploadResponse.json();

  if (!uploaded.url) {
    throw new Error('API не вернул ссылку загруженного файла.');
  }

  return {
    mime,
    name: file.name,
    ref: uploaded.url,
    size: file.size,
    ...(await getImageDimensions(file)),
  };
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Не удалось подключиться к FinChat API.')), {
      once: true,
    });
  });
}

function waitForMessage(socket, timeoutMs = 12000) {
  return waitForPacket(socket, () => true, timeoutMs);
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForPacket(socket, predicate, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('API не ответил вовремя.'));
    }, timeoutMs);

    const handleMessage = (event) => {
      let packet;

      try {
        packet = JSON.parse(event.data);
      } catch {
        cleanup();
        reject(new Error('API вернул ответ в неизвестном формате.'));
        return;
      }

      if (predicate(packet)) {
        cleanup();
        resolve(packet);
      }
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Ошибка соединения с FinChat API.'));
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('error', handleError);
    };

    socket.addEventListener('message', handleMessage);
    socket.addEventListener('error', handleError);
  });
}

function collectPacketsUntilCtrl(socket, requestId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const packets = [];
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('API не ответил вовремя.'));
    }, timeoutMs);

    const handleMessage = (event) => {
      let packet;

      try {
        packet = JSON.parse(event.data);
      } catch {
        cleanup();
        reject(new Error('API вернул ответ в неизвестном формате.'));
        return;
      }

      if (packet.ctrl?.id === requestId) {
        cleanup();

        if (packet.ctrl.code >= 300) {
          reject(new Error(packet.ctrl.text || `API вернул код ${packet.ctrl.code}.`));
          return;
        }

        resolve(packets);
        return;
      }

      packets.push(packet);
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Ошибка соединения с FinChat API.'));
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('error', handleError);
    };

    socket.addEventListener('message', handleMessage);
    socket.addEventListener('error', handleError);
  });
}

function assertOk(response, expectedCode) {
  const ctrl = response?.ctrl;

  if (!ctrl) {
    throw new Error('API вернул ответ без блока ctrl.');
  }

  if (ctrl.code !== expectedCode) {
    throw new Error(ctrl.text || `API вернул код ${ctrl.code}.`);
  }

  return ctrl;
}

function isAlreadySubscribed(ctrl) {
  return ctrl?.text?.toLowerCase().includes('already subscribed');
}

function isPermissionDenied(ctrl) {
  return ctrl?.text?.toLowerCase().includes('permission denied');
}

function isMustAttachFirst(ctrl) {
  return ctrl?.text?.toLowerCase().includes('must attach first');
}

async function openAuthenticatedSocketWithToken(token) {
  const socket = new WebSocket(createSocketUrl());

  try {
    await waitForOpen(socket);

    socket.send(
      JSON.stringify({
        hi: {
          id: 'chats-hi',
          ver: PROTOCOL_VERSION,
          ua: navigator.userAgent,
          platf: 'web',
          lang: navigator.language || 'ru-RU',
        },
      }),
    );

    assertOk(await waitForPacket(socket, (packet) => packet.ctrl?.id === 'chats-hi'), 201);

    socket.send(
      JSON.stringify({
        login: {
          id: 'chats-login',
          scheme: 'token',
          secret: token,
        },
      }),
    );

    assertOk(await waitForPacket(socket, (packet) => packet.ctrl?.id === 'chats-login'), 200);

    return socket;
  } catch (error) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }

    throw error;
  }
}

function normalizeChat(subscription) {
  const topic = subscription.topic || subscription.user;
  const title =
    subscription.public?.fn ||
    subscription.public?.title ||
    subscription.private?.comment ||
    subscription.private?.title ||
    topic;
  const seq = Number(subscription.seq || 0);
  const read = Number(subscription.read || 0);
  const access = subscription.acs?.mode || '';

  return {
    id: topic,
    title,
    topic,
    isGroup: topic?.startsWith('grp'),
    online: Boolean(subscription.online),
    unread: Math.max(seq - read, 0),
    preview:
      subscription.public?.note ||
      subscription.private?.note ||
      subscription.public?.subtitle ||
      subscription.private?.subtitle ||
      '',
    updatedAt: subscription.touched || subscription.updated || subscription.seen?.when || '',
    seenAt: subscription.seen?.when || '',
    access,
    canWrite: !access || access.includes('W'),
    raw: subscription,
  };
}

function getMessageText(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (content?.txt) {
    if (!Array.isArray(content.fmt) || !Array.isArray(content.ent)) {
      return content.txt;
    }

    const hiddenRanges = content.fmt
      .filter((format) => {
        const entity = content.ent[format.key];

        return entity?.tp === 'IM' || entity?.tp === 'EX';
      })
      .map((format) => ({
        at: Number(format.at),
        len: Number(format.len || 0),
      }))
      .filter((range) => range.at >= 0 && range.len > 0)
      .sort((left, right) => right.at - left.at);

    return hiddenRanges
      .reduce(
        (text, range) => `${text.slice(0, range.at)}${text.slice(range.at + range.len)}`,
        content.txt,
      )
      .trim();
  }

  if (content?.text) {
    return content.text;
  }

  if (content == null) {
    return '';
  }

  if (Array.isArray(content.ent)) {
    return '';
  }

  return JSON.stringify(content);
}

function getMessagePreview(message) {
  if (message.text) {
    return message.text;
  }

  if (message.attachments?.length) {
    const firstAttachment = message.attachments[0];

    return firstAttachment.type === 'image'
      ? 'Изображение'
      : firstAttachment.name || 'Файл';
  }

  return 'Сообщение';
}

function getAttachmentUrl(data, token = '') {
  if (data?.val && data?.mime) {
    return `data:${data.mime};base64,${data.val}`;
  }

  return createFileUrl(data?.ref, { includeApiKey: true, token });
}

function normalizeAttachments(content, token = '') {
  if (!Array.isArray(content?.ent)) {
    return [];
  }

  return content.ent
    .map((entity, index) => {
      const data = entity?.data || {};
      const mime = data.mime || '';
      const url = getAttachmentUrl(data, token);

      if (!url) {
        return null;
      }

      return {
        id: `${entity.tp || 'attachment'}-${data.ref || data.name || index}`,
        type: mime.startsWith('image/') ? 'image' : 'file',
        mime,
        name: data.name || (mime.startsWith('image/') ? 'Изображение' : 'Файл'),
        size: Number(data.size || 0),
        width: Number(data.width || 0),
        height: Number(data.height || 0),
        ref: data.ref || '',
        url,
        raw: entity,
      };
    })
    .filter(Boolean);
}

function parseReply(head) {
  if (!head?.reply) {
    return null;
  }

  if (typeof head.reply === 'object') {
    return head.reply;
  }

  const replyValue = String(head.reply).replace(/^:/, '');

  if (typeof head.reply === 'number' || /^\d+$/.test(replyValue)) {
    return {
      seq: Number(replyValue),
      text: '',
    };
  }

  try {
    return JSON.parse(head.reply);
  } catch {
    return null;
  }
}

function parseReplaceSeq(head) {
  if (!head?.replace) {
    return null;
  }

  const value = String(head.replace).replace(/^:/, '');

  return /^\d+$/.test(value) ? Number(value) : null;
}

export function getDeletedRanges(packet) {
  return (
    packet?.pres?.delseq ||
    packet?.pres?.del_seq ||
    packet?.meta?.del?.delseq ||
    packet?.meta?.del?.del_seq ||
    packet?.ctrl?.params?.delseq ||
    packet?.ctrl?.params?.del_seq ||
    []
  );
}

function createReplyHead(replyTo) {
  if (!replyTo?.seq) {
    return undefined;
  }

  return {
    reply: Number(replyTo.seq),
  };
}

function createLocalReply(replyTo) {
  if (!replyTo) {
    return null;
  }

  return {
    seq: replyTo.seq,
    from: replyTo.from,
    text: replyTo.text || replyTo.preview || '',
  };
}

export function normalizeMessage(packet, token = '') {
  const message = {
    id: `${packet.topic}-${packet.seq || packet.ts || Math.random()}`,
    topic: packet.topic,
    seq: packet.seq,
    from: packet.from || '',
    text: getMessageText(packet.content),
    attachments: normalizeAttachments(packet.content, token),
    content: packet.content,
    head: packet.head || {},
    reply: parseReply(packet.head),
    replaceSeq: parseReplaceSeq(packet.head),
    createdAt: packet.ts || '',
    deletedAt: packet.deleted || packet.deletedAt || '',
    raw: packet,
  };

  return {
    ...message,
    preview: getMessagePreview(message),
  };
}

export class FinchatRealtimeClient {
  constructor(token) {
    this.token = token;
    this.socket = null;
    this.listeners = new Set();
    this.subscribedTopics = new Set();
    this.pendingSubscriptions = new Map();
    this.requestCounter = 0;
    this.handleMessage = this.handleMessage.bind(this);
  }

  nextId(prefix) {
    this.requestCounter += 1;
    return `${prefix}-${this.requestCounter}`;
  }

  emit(packet) {
    this.listeners.forEach((listener) => listener(packet));
  }

  handleMessage(event) {
    try {
      this.emit(JSON.parse(event.data));
    } catch {
      this.emit({ error: 'API вернул ответ в неизвестном формате.' });
    }
  }

  onPacket(listener) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    this.socket = await openAuthenticatedSocketWithToken(this.token);
    this.socket.addEventListener('message', this.handleMessage);
  }

  close() {
    if (!this.socket) {
      return;
    }

    this.socket.removeEventListener('message', this.handleMessage);

    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }

    this.socket = null;
    this.subscribedTopics.clear();
    this.pendingSubscriptions.clear();
  }

  async attach(topic, { optional = false } = {}) {
    await this.connect();

    if (this.subscribedTopics.has(topic)) {
      return null;
    }

    if (this.pendingSubscriptions.has(topic)) {
      const pendingResult = await this.pendingSubscriptions.get(topic);

      if (optional || this.subscribedTopics.has(topic)) {
        return pendingResult;
      }
    }

    const id = this.nextId('sub');

    const attachRequest = (async () => {
      this.socket.send(
        JSON.stringify({
          sub: {
            id,
            topic,
          },
        }),
      );

      const packet = await waitForPacket(this.socket, (message) => message.ctrl?.id === id, 15000);

      if (packet.ctrl.code >= 300) {
        if (isAlreadySubscribed(packet.ctrl)) {
          this.subscribedTopics.add(topic);
          return packet.ctrl;
        }

        if (optional && isPermissionDenied(packet.ctrl)) {
          return packet.ctrl;
        }

        throw new Error(packet.ctrl.text || `API вернул код ${packet.ctrl.code}.`);
      }

      this.subscribedTopics.add(topic);

      return packet.ctrl;
    })();

    this.pendingSubscriptions.set(topic, attachRequest);

    try {
      return await attachRequest;
    } finally {
      this.pendingSubscriptions.delete(topic);
    }
  }

  async ensureAttached(topic) {
    await this.attach(topic);

    if (this.subscribedTopics.has(topic)) {
      return;
    }

    await delay(500);
    await this.attach(topic);

    if (!this.subscribedTopics.has(topic)) {
      throw new Error('Не удалось подключиться к чату для отправки сообщения.');
    }
  }

  async publish(topic, pub) {
    await this.ensureAttached(topic);

    const sendPub = async () => {
      const id = this.nextId(pub.idPrefix || 'pub');
      const { extra, ...payload } = pub.payload || {};
      const clientPacket = {
        pub: {
          ...payload,
          id,
          topic,
        },
      };

      if (pub.extra || extra) {
        clientPacket.extra = pub.extra || extra;
      }

      this.socket.send(JSON.stringify(clientPacket));

      const packet = await waitForPacket(this.socket, (message) => message.ctrl?.id === id, 15000);

      if (packet.ctrl.code >= 300) {
        if (isMustAttachFirst(packet.ctrl)) {
          this.subscribedTopics.delete(topic);
        }

        throw new Error(packet.ctrl.text || `API вернул код ${packet.ctrl.code}.`);
      }

      return packet;
    };

    try {
      return await sendPub();
    } catch (error) {
      if (!error.message?.toLowerCase().includes('must attach first')) {
        throw error;
      }

      await this.ensureAttached(topic);
      return sendPub();
    }
  }

  async loadChats() {
    await this.attach('me');

    const id = this.nextId('get-me');

    this.socket.send(
      JSON.stringify({
        get: {
          id,
          topic: 'me',
          what: 'sub desc',
          sub: {
            limit: 100,
          },
        },
      }),
    );

    const packet = await waitForPacket(
      this.socket,
      (message) =>
        message.meta?.id === id && Array.isArray(message.meta.sub) ||
        message.ctrl?.id === id && message.ctrl.code >= 300,
      15000,
    );

    if (packet.ctrl?.code >= 300) {
      throw new Error(packet.ctrl.text || `API вернул код ${packet.ctrl.code}.`);
    }

    return (packet.meta?.sub || [])
      .filter((subscription) => {
        const topic = subscription.topic || subscription.user;

        return topic && topic !== 'me';
      })
      .map(normalizeChat)
      .sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
  }

  async loadMessages(topic, options = {}) {
    await this.attach(topic, { optional: true });

    try {
      return await this.getMessages(topic, options);
    } catch (error) {
      if (!error.message?.toLowerCase().includes('permission denied')) {
        throw error;
      }

      await delay(600);
      await this.attach(topic, { optional: true });

      return this.getMessages(topic, options);
    }
  }

  async getMessages(topic, { limit = 30, beforeSeq, sinceSeq } = {}) {
    const id = this.nextId('get-data');
    const data = {
      limit,
    };

    if (sinceSeq) {
      data.since = sinceSeq;
      data.since_id = sinceSeq;
    }

    if (beforeSeq) {
      data.before = beforeSeq;
      data.before_id = beforeSeq;
    }

    this.socket.send(
      JSON.stringify({
        get: {
          id,
          topic,
          what: 'data',
          data,
        },
      }),
    );

    const packets = await collectPacketsUntilCtrl(this.socket, id, 15000);

    return packets
      .filter((packet) => packet.data?.topic === topic)
      .map((packet) => normalizeMessage(packet.data, this.token))
      .filter((message) => !message.deletedAt)
      .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0));
  }

  async sendMessage({ topic, text, replyTo }) {
    const trimmedText = text.trim();

    if (!trimmedText) {
      throw new Error('Введите текст сообщения.');
    }

    const head = createReplyHead(replyTo);

    const packet = await this.publish(topic, {
      idPrefix: 'pub',
      payload: {
        noecho: true,
        head,
        content: {
          txt: trimmedText,
        },
      },
    });

    const message = {
      id: `${topic}-${packet.ctrl.params?.seq || Date.now()}`,
      topic,
      seq: packet.ctrl.params?.seq,
      from: packet.ctrl.params?.user || '',
      text: trimmedText,
      content: { txt: trimmedText },
      head: head || {},
      reply: createLocalReply(replyTo),
      createdAt: packet.ctrl.ts || new Date().toISOString(),
      raw: packet,
    };

    return {
      ...message,
      preview: getMessagePreview(message),
    };
  }

  async sendFiles({ topic, files, text = '', replyTo }) {
    await this.ensureAttached(topic);

    const selectedFiles = Array.from(files || []);
    const trimmedText = text.trim();

    if (selectedFiles.length === 0) {
      throw new Error('Р’С‹Р±РµСЂРёС‚Рµ С„Р°Р№Р»С‹ РґР»СЏ РѕС‚РїСЂР°РІРєРё.');
    }

    const uploadedFiles = [];

    for (const file of selectedFiles) {
      uploadedFiles.push(
        await uploadAttachmentFile({
          token: this.token,
          file,
        }),
      );
    }

    const attachmentMarkers = uploadedFiles.map(() => ' ').join('');
    const contentText = `${trimmedText}${attachmentMarkers}`;
    const attachmentOffset = trimmedText.length;
    const content = {
      ent: uploadedFiles.map((uploadedFile) => ({
        data: uploadedFile,
        tp: uploadedFile.mime.startsWith('image/') ? 'IM' : 'EX',
      })),
      fmt: uploadedFiles.map((_, index) => ({
        at: attachmentOffset + index,
        key: index,
        len: 1,
      })),
      txt: contentText,
    };
    const head = createReplyHead(replyTo);

    const packet = await this.publish(topic, {
      idPrefix: 'pub-file',
      extra: {
        attachments: uploadedFiles.map((uploadedFile) => uploadedFile.ref),
      },
      payload: {
        noecho: true,
        head,
        content,
      },
    });

    const message = {
      id: `${topic}-${packet.ctrl.params?.seq || Date.now()}`,
      topic,
      seq: packet.ctrl.params?.seq,
      from: packet.ctrl.params?.user || '',
      text: trimmedText,
      attachments: normalizeAttachments(content, this.token),
      content,
      head: head || {},
      reply: createLocalReply(replyTo),
      createdAt: packet.ctrl.ts || new Date().toISOString(),
      raw: packet,
    };

    return {
      ...message,
      preview: getMessagePreview(message),
    };
  }

  async sendFile({ topic, file }) {
    return this.sendFiles({ topic, files: [file] });
  }

  async editMessage({ topic, message, text }) {
    const trimmedText = text.trim();
    const seq = Number(message?.seq);

    if (!seq) {
      throw new Error('РќРµС‚ РЅРѕРјРµСЂР° СЃРѕРѕР±С‰РµРЅРёСЏ РґР»СЏ СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёСЏ.');
    }

    if (!trimmedText) {
      throw new Error('Р’РІРµРґРёС‚Рµ С‚РµРєСЃС‚ СЃРѕРѕР±С‰РµРЅРёСЏ.');
    }

    const head = {
      replace: `:${seq}`,
    };

    const packet = await this.publish(topic, {
      idPrefix: 'pub-edit',
      payload: {
        noecho: true,
        head,
        content: {
          txt: trimmedText,
        },
      },
    });

    const editedMessage = {
      ...message,
      text: trimmedText,
      content: { txt: trimmedText },
      head: {
        ...(message.head || {}),
        ...head,
      },
      editedAt: packet.ctrl.ts || new Date().toISOString(),
    };

    return {
      ...editedMessage,
      preview: getMessagePreview(editedMessage),
    };
  }

  async deleteMessage({ topic, message }) {
    const seq = Number(message?.seq);

    if (!seq) {
      throw new Error('РќРµС‚ РЅРѕРјРµСЂР° СЃРѕРѕР±С‰РµРЅРёСЏ РґР»СЏ СѓРґР°Р»РµРЅРёСЏ.');
    }

    await this.ensureAttached(topic);

    const id = this.nextId('del-msg');

    this.socket.send(
      JSON.stringify({
        del: {
          id,
          topic,
          what: 'msg',
          delseq: [
            {
              low: seq,
              hi: seq + 1,
            },
          ],
          hard: true,
        },
      }),
    );

    const packet = await waitForPacket(this.socket, (messagePacket) => messagePacket.ctrl?.id === id, 15000);

    if (packet.ctrl.code >= 300) {
      throw new Error(packet.ctrl.text || `API РІРµСЂРЅСѓР» РєРѕРґ ${packet.ctrl.code}.`);
    }

    return packet.ctrl;
  }
}

export async function loginWithWordColor({ phone, word1, word2, digits }) {
  const socket = new WebSocket(createSocketUrl());

  try {
    await waitForOpen(socket);

    socket.send(
      JSON.stringify({
        hi: {
          id: '1',
          ver: PROTOCOL_VERSION,
          ua: navigator.userAgent,
          platf: 'web',
          lang: navigator.language || 'ru-RU',
        },
      }),
    );

    assertOk(await waitForMessage(socket), 201);

    socket.send(
      JSON.stringify({
        login: {
          id: '2',
          scheme: 'wordcolor',
          secret: encodeBase64(`${phone}:${word1}${word2}${digits}`),
        },
      }),
    );

    const ctrl = assertOk(await waitForMessage(socket), 200);

    return ctrl;
  } finally {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

export async function loadChatList(token) {
  if (!token) {
    throw new Error('Нет токена авторизации для загрузки чатов.');
  }

  const socket = await openAuthenticatedSocketWithToken(token);

  try {
    socket.send(
      JSON.stringify({
        sub: {
          id: 'chats-sub-me',
          topic: 'me',
        },
      }),
    );

    const attachPacket = await waitForPacket(
      socket,
      (message) => message.ctrl?.id === 'chats-sub-me',
      15000,
    );

    if (attachPacket.ctrl && attachPacket.ctrl.code >= 300) {
      throw new Error(attachPacket.ctrl.text || `API вернул код ${attachPacket.ctrl.code}.`);
    }

    socket.send(
      JSON.stringify({
        get: {
          id: 'chats-get-me',
          topic: 'me',
          what: 'sub desc',
          sub: {
            limit: 100,
          },
        },
      }),
    );

    const packet = await waitForPacket(
      socket,
      (message) =>
        message.meta?.id === 'chats-get-me' && Array.isArray(message.meta.sub) ||
        message.ctrl?.id === 'chats-get-me' && message.ctrl.code >= 300,
      15000,
    );

    if (packet.ctrl && packet.ctrl.code >= 300) {
      throw new Error(packet.ctrl.text || `API вернул код ${packet.ctrl.code}.`);
    }

    const subscriptions = packet.meta?.sub || [];

    return subscriptions
      .filter((subscription) => {
        const topic = subscription.topic || subscription.user;

        return topic && topic !== 'me';
      })
      .map(normalizeChat)
      .sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
  } finally {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

export async function loadTopicMessages(token, topic, { limit = 30, beforeSeq, sinceSeq } = {}) {
  if (!token) {
    throw new Error('Нет токена авторизации для загрузки сообщений.');
  }

  if (!topic) {
    return [];
  }

  const socket = await openAuthenticatedSocketWithToken(token);

  try {
    socket.send(
      JSON.stringify({
        sub: {
          id: 'topic-sub',
          topic,
        },
      }),
    );

    const attachPacket = await waitForPacket(socket, (message) => message.ctrl?.id === 'topic-sub');

    if (attachPacket.ctrl.code >= 300) {
      throw new Error(attachPacket.ctrl.text || `API вернул код ${attachPacket.ctrl.code}.`);
    }

    const data = {
      limit,
    };

    if (sinceSeq) {
      data.since = sinceSeq;
      data.since_id = sinceSeq;
    }

    if (beforeSeq) {
      data.before = beforeSeq;
      data.before_id = beforeSeq;
    }

    socket.send(
      JSON.stringify({
        get: {
          id: 'topic-data',
          topic,
          what: 'data',
          data,
        },
      }),
    );

    const packets = await collectPacketsUntilCtrl(socket, 'topic-data', 15000);

    return packets
      .filter((packet) => packet.data?.topic === topic)
      .map((packet) => normalizeMessage(packet.data, token))
      .filter((message) => !message.deletedAt)
      .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0));
  } finally {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

export async function loadTopicMessageBySeq(token, topic, seq) {
  const targetSeq = Number(seq);

  if (!Number.isFinite(targetSeq)) {
    return null;
  }

  const messages = await loadTopicMessages(token, topic, {
    sinceSeq: targetSeq,
    beforeSeq: targetSeq + 1,
    limit: 1,
  });

  return messages.find((message) => Number(message.seq) === targetSeq) || null;
}

export async function sendTopicMessage({ token, topic, text, replyTo }) {
  if (!token) {
    throw new Error('Нет токена авторизации для отправки сообщения.');
  }

  if (!topic) {
    throw new Error('Чат не выбран.');
  }

  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new Error('Введите текст сообщения.');
  }

  const socket = await openAuthenticatedSocketWithToken(token);

  try {
    socket.send(
      JSON.stringify({
        sub: {
          id: 'send-sub',
          topic,
        },
      }),
    );

    const attachPacket = await waitForPacket(socket, (message) => message.ctrl?.id === 'send-sub');

    if (attachPacket.ctrl.code >= 300) {
      throw new Error(attachPacket.ctrl.text || `API вернул код ${attachPacket.ctrl.code}.`);
    }

    const head = createReplyHead(replyTo);

    socket.send(
      JSON.stringify({
        pub: {
          id: 'send-pub',
          topic,
          noecho: false,
          head,
          content: {
            txt: trimmedText,
          },
        },
      }),
    );

    const packet = await waitForPacket(socket, (message) => message.ctrl?.id === 'send-pub', 15000);

    if (packet.ctrl.code >= 300) {
      throw new Error(packet.ctrl.text || `API вернул код ${packet.ctrl.code}.`);
    }

    const message = {
      id: `${topic}-${packet.ctrl.params?.seq || Date.now()}`,
      topic,
      seq: packet.ctrl.params?.seq,
      from: packet.ctrl.params?.user || '',
      text: trimmedText,
      content: { txt: trimmedText },
      head: head || {},
      reply: createLocalReply(replyTo),
      createdAt: packet.ctrl.ts || new Date().toISOString(),
      raw: packet,
    };

    return {
      ...message,
      preview: getMessagePreview(message),
    };
  } finally {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

export function hasApiKey() {
  return true;
}
