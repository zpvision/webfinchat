import { createSocketUrl } from './finchat.js';

// Reuse login's env-configured host/key, including its same-origin proxy fallback.
export function recoveryConfig() {
    return { url: createSocketUrl() };
}

export class RecoveryError extends Error {
    code;
    retryAfter;
    constructor(message, code, retryAfter){
        super(message);
        this.name = "RecoveryError";
        this.code = code;
        this.retryAfter = retryAfter;
    }
}
export function normalizePhone(value) {
    const phone = value.replace(/[\s().-]/g, "");
    return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null;
}
function encodeSecret(value) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}
// Every operation completes hi in its own unauthenticated session. Never retry:
// SMS consumes an attempt, and confirmation may change the password before a disconnect.
function sendCommand(config, command, payload, signal) {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    if (!config.url) {
        return Promise.reject(new RecoveryError("Восстановление пока недоступно. Пожалуйста, попробуйте позже."));
    }
    return new Promise((resolve, reject)=>{
        let socket;
        try {
            const url = new URL(config.url);
            if (url.protocol !== "wss:" && url.protocol !== "ws:") throw new Error("Invalid WebSocket URL");
            if (config.apiKey) url.searchParams.set("apikey", config.apiKey);
            socket = new WebSocket(url);
        } catch  {
            reject(new RecoveryError("Не удалось подключиться к сервису восстановления. Попробуйте позже."));
            return;
        }
        const handshakeId = crypto.randomUUID();
        const commandId = crypto.randomUUID();
        let handshaken = false;
        let settled = false;
        let timeout;
        function finish(error, response) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            signal.removeEventListener("abort", abort);
            socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
            try { socket.close(); } catch { /* Already disconnected. */ }
            if (error) reject(error);
            else resolve(response);
        }
        function networkError() {
            finish(new RecoveryError(handshaken && command === "acc" ? "Соединение прервалось, результат проверки неизвестен. Если код больше не принимается, запросите новый SMS-код." : "Нет ответа от сервера. Проверьте подключение к интернету и попробуйте позже."));
        }
        function armTimeout() {
            clearTimeout(timeout);
            timeout = setTimeout(networkError, 20_000);
        }
        function abort() {
            finish(new DOMException("Aborted", "AbortError"));
        }
        signal.addEventListener("abort", abort, {
            once: true
        });
        armTimeout();
        socket.onopen = ()=>{
            try { socket.send(JSON.stringify({
                hi: {
                    id: handshakeId,
                    ver: "0.22",
                    ua: "FinChat Web/1.0",
                    platf: "web",
                    lang: "ru"
                }
            })); } catch { networkError(); }
        };
        socket.onerror = networkError;
        socket.onclose = networkError;
        socket.onmessage = (event)=>{
            let ctrl;
            try {
                ctrl = JSON.parse(event.data)?.ctrl;
            } catch  {
                finish(new RecoveryError("Сервис вернул некорректный ответ. Попробуйте позже."));
                return;
            }
            if (!ctrl || typeof ctrl.code !== "number") return;
            if (!handshaken && (ctrl.id === handshakeId || !ctrl.id && ctrl.code >= 400)) {
                if (ctrl.code < 200 || ctrl.code >= 300) {
                    finish(new RecoveryError("Сервис восстановления временно недоступен. Попробуйте позже."));
                    return;
                }
                handshaken = true;
                armTimeout();
                try { socket.send(JSON.stringify({
                    [command]: {
                        id: commandId,
                        ...payload
                    }
                })); } catch { networkError(); }
            } else if (handshaken && ctrl.id === commandId) {
                finish(undefined, ctrl);
            }
        };
    });
}
function responseError(ctrl, confirming) {
    if (ctrl.code === 429) {
        const seconds = ctrl.params?.retry_after;
        const retryAfter = typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
        return new RecoveryError("Достигнут лимит попыток. Дождитесь окончания таймера и попробуйте снова.", 429, retryAfter);
    }
    if (confirming && (ctrl.code === 401 || ctrl.code === 403)) {
        return new RecoveryError("Код неверный, истёк или больше не действует. Проверьте его или запросите новый.", ctrl.code);
    }
    return new RecoveryError("Не удалось выполнить запрос. Пожалуйста, попробуйте позже.", ctrl.code);
}
export async function requestWordcolorResetSMS(phone, config, signal) {
    const ctrl = await sendCommand(config, "login", {
        scheme: "reset",
        secret: encodeSecret(`wordcolor:tel:${phone}`)
    }, signal);
    if (ctrl.code !== 301) throw responseError(ctrl, false);
}
export async function confirmWordcolorResetSMS(phone, code, config, signal) {
    const ctrl = await sendCommand(config, "acc", {
        scheme: "wordcolor",
        tmpscheme: "code",
        tmpsecret: encodeSecret(`${code}:tel:${phone}`)
    }, signal);
    if (ctrl.code !== 200) throw responseError(ctrl, true);
    const { word1, word2, digits } = ctrl.params ?? {};
    if (typeof word1 !== "string" || !word1.trim() || typeof word2 !== "string" || !word2.trim() || typeof digits !== "string" || !/^\d{8}$/.test(digits)) {
        throw new RecoveryError("Пароль изменён, но новые данные получены не полностью. Запросите новый SMS-код для восстановления.");
    }
    return {
        word1,
        word2,
        digits
    };
}
