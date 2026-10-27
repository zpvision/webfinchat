import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  confirmWordcolorResetSMS, normalizePhone, RecoveryError, recoveryConfig, requestWordcolorResetSMS,
} from './api/accessRecovery.js';
import './accessRecovery.css';

function RecoveryIcon({ kind }) {
  const paths = {
    key: <><circle cx="8" cy="15" r="5" /><path d="m11.5 11.5 9-9M16 7l3 3m-1-5 3 3" /></>,
    code: <path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0ZM7 10h10M7 14h7" />,
    success: <><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

export function AccessRecovery({ disabled = false }) {
  const [open, setOpen] = useState(false);
  // Keep only retry deadlines across dismissals, never the code or new password.
  const cooldowns = useRef(new Map());
  return <>
    <button className="recovery-link" type="button" disabled={disabled} onClick={() => setOpen(true)}>
      <span>или </span><span>Восстановить доступ</span>
    </button>
    {open && createPortal(<RecoveryDialog cooldowns={cooldowns.current} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function RecoveryDialog({ cooldowns, onClose }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [retryAt, setRetryAt] = useState(0);
  const dialog = useRef(null);
  const input = useRef(null);
  const request = useRef(null);
  const copyTimer = useRef(null);
  const mounted = useRef(false);
  const preparing = step === 'preparing';
  const locked = pending || preparing;
  const normalizedPhone = normalizePhone(phone);
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element.showModal();
    input.current?.focus();
    return () => {
      mounted.current = false;
      request.current?.abort();
      request.current = null;
      clearTimeout(copyTimer.current);
      element.close();
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (step === 'success') dialog.current?.querySelector('[data-copy-password]')?.focus();
    else if (step === 'preparing') dialog.current?.focus();
    else input.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== 'preparing') return;
    const timer = setTimeout(() => setStep('success'), 2000);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    const time = Date.now();
    for (const [number, deadline] of cooldowns) if (deadline <= time) cooldowns.delete(number);
    setRetryAt(normalizedPhone ? cooldowns.get(normalizedPhone) ?? 0 : 0);
    setNow(time);
  }, [normalizedPhone, cooldowns]);

  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  function startCooldown(duration) {
    const time = Date.now();
    // Never shorten an existing (possibly server-imposed) deadline.
    const deadline = Math.max(cooldowns.get(normalizedPhone) ?? 0, time + Math.max(60, duration) * 1000);
    cooldowns.set(normalizedPhone, deadline);
    setNow(time);
    setRetryAt(deadline);
  }

  async function submit(confirming) {
    if (request.current) return;
    setError('');
    setInvalidField(false);
    if (!normalizedPhone || (confirming && !/^\d{1,12}$/.test(code))) {
      setError(!normalizedPhone ? 'Введите номер с кодом страны, например +7 900 123-45-67.' : 'Введите код из SMS — только цифры.');
      setInvalidField(true);
      input.current?.focus();
      return;
    }
    // Check the absolute deadline too: a throttled timer must not bypass limits.
    if (!confirming && (cooldowns.get(normalizedPhone) ?? 0) > Date.now()) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const config = recoveryConfig();
      if (confirming) {
        const result = await confirmWordcolorResetSMS(normalizedPhone, code, config, controller.signal);
        if (controller.signal.aborted) return;
        setCredentials(result);
        setCode('');
        setStep('preparing');
      } else {
        // Also limit retries after a lost response: the SMS may have been sent.
        startCooldown(60);
        await requestWordcolorResetSMS(normalizedPhone, config, controller.signal);
        if (controller.signal.aborted) return;
        startCooldown(60);
        setCode('');
        setStep('code');
        input.current?.focus();
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Не удалось выполнить запрос. Попробуйте позже.');
      if (cause instanceof RecoveryError) {
        if (cause.retryAfter) startCooldown(cause.retryAfter);
        if (confirming && (cause.code === 401 || cause.code === 403)) {
          setInvalidField(true);
          input.current?.focus();
        }
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(`${credentials.word1}${credentials.word2}${credentials.digits}`);
      if (!mounted.current) return;
      setError('');
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 3000);
    } catch {
      if (mounted.current) setError('Не удалось скопировать. Выделите и сохраните слова и цифры вручную.');
    }
  }

  function close() {
    if (!request.current && !preparing) onClose();
  }

  function containFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)'));
    if (!controls.length) {
      event.preventDefault();
      dialog.current.focus();
      return;
    }
    const first = controls[0], last = controls.at(-1);
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  const title = preparing ? 'Готовим для вас данные' : step === 'success' ? 'Доступ восстановлен' : step === 'code' ? 'Проверьте SMS' : 'Восстановить доступ';
  const description = step === 'success'
    ? 'Ваш новый пароль — два слова и восемь цифр. Сохраните их перед закрытием окна.'
    : preparing ? 'Это займёт пару секунд.' : step === 'code' ? `Введите код из SMS для номера ${normalizedPhone}.`
      : 'Укажите подтверждённый номер телефона вашего аккаунта. Отправим SMS для восстановления.';
  const currentStep = step === 'phone' ? 0 : step === 'code' ? 1 : 2;

  return <dialog ref={dialog} className="recovery-dialog" tabIndex={-1} aria-labelledby="recovery-title" aria-describedby="recovery-description" aria-busy={locked}
    onKeyDown={containFocus} onCancel={(event) => { event.preventDefault(); close(); }}>
    <button className="recovery-close" type="button" aria-label="Закрыть восстановление" disabled={locked} onClick={close}>×</button>
    <div className={`recovery-symbol ${step === 'success' ? 'recovery-symbol-success' : ''}`}><RecoveryIcon kind={preparing ? 'key' : step === 'phone' ? 'key' : step} /></div>
    <h2 id="recovery-title">{title}</h2>
    <p id="recovery-description">{description}</p>
    <ol className="recovery-steps" aria-label="Этапы восстановления">
      {['Телефон', 'SMS-код', 'Новые данные'].map((label, index) => <li key={label} className={index <= currentStep ? 'reached' : ''} aria-current={index === currentStep ? 'step' : undefined}>{label}</li>)}
    </ol>
    {preparing ? <div className="recovery-preparing" role="status" aria-live="polite">
      <div className="recovery-loader" aria-hidden="true"><RecoveryIcon kind="success" /></div>
      <span className="sr-only">Готовим для вас данные</span>
      <div className="recovery-loader-dots" aria-hidden="true"><i /><i /><i /></div>
    </div> : step !== 'success' ? <form onSubmit={(event) => {
      event.preventDefault();
      // Portals still bubble React events to the surrounding login form.
      event.stopPropagation();
      void submit(step === 'code');
    }} noValidate aria-busy={pending}>
      <label htmlFor="recovery-input">{step === 'phone' ? 'Номер телефона' : 'Код из SMS'}</label>
      {step === 'phone' ? <input ref={input} id="recovery-input" name="phone" type="tel" inputMode="tel" autoComplete="tel"
        placeholder="+7 900 123-45-67" maxLength={32} value={phone} readOnly={pending} aria-invalid={invalidField}
        aria-describedby={error ? 'recovery-error' : 'recovery-phone-hint'} onChange={(event) => { setPhone(event.target.value); setError(''); setInvalidField(false); }} />
        : <input ref={input} id="recovery-input" name="sms-code" type="text" inputMode="numeric" autoComplete="one-time-code"
          placeholder="Код из сообщения" maxLength={12} value={code} readOnly={pending} aria-invalid={invalidField}
          aria-describedby={error ? 'recovery-error' : undefined} onChange={(event) => { setCode(event.target.value.replace(/\D/g, '')); setError(''); setInvalidField(false); }} />}
      {step === 'phone' && <p id="recovery-phone-hint" className="recovery-hint">Введите номер в международном формате с «+» и кодом страны.</p>}
      {error && <ErrorMessage message={error} />}
      <button className="recovery-primary" type="submit" disabled={pending || (step === 'phone' && seconds > 0)}>
        {pending ? (step === 'phone' ? 'Запрашиваем SMS…' : 'Проверяем код…')
          : step === 'phone' ? (seconds > 0 ? `Повторить через ${seconds} с` : 'Получить SMS-код') : 'Восстановить доступ'}
      </button>
      {step === 'code' ? <div className="recovery-secondary">
        <button type="button" disabled={pending || seconds > 0} onClick={() => void submit(false)}>
          {seconds > 0 ? `Отправить код повторно через ${seconds} с` : 'Отправить код повторно'}
        </button>
        <p className="recovery-hint">SMS придёт, если номер привязан к аккаунту и подтверждён.</p>
        <button type="button" disabled={pending} onClick={() => { setStep('phone'); setCode(''); setError(''); setInvalidField(false); }}>← Изменить номер</button>
      </div> : <p className="recovery-hint recovery-centered">Пароль изменится после проверки SMS-кода.</p>}
    </form> : credentials && <div className="recovery-success">
      <div className="recovery-credentials">
        <p>Ваши новые секретные слова</p>
        <div className="recovery-words">{[credentials.word1, credentials.word2].map((word, index) => <span key={index}>{word}</span>)}</div>
        <p>Ваши новые 8 цифр</p>
        <div className="recovery-digits" role="group" aria-label={`Восемь цифр: ${credentials.digits}`}>
          {credentials.digits.split('').map((digit, index) => <span key={index} aria-hidden="true">{digit}</span>)}
        </div>
      </div>
      <p>Ваши новые секретные слова. Сохраните их!</p>
      {error && <ErrorMessage message={error} />}
      <button className="recovery-primary" type="button" data-copy-password onClick={() => void copyCredentials()}>
        <span role="status">{copied ? 'Пароль скопирован' : 'Скопировать новый пароль'}</span>
      </button>
      <button className="recovery-saved" type="button" onClick={close}>✓ Я сохранил данные</button>
    </div>}
  </dialog>;
}

function ErrorMessage({ message }) {
  return <p id="recovery-error" role="alert" className="recovery-error">{message}</p>;
}
