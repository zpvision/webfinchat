import { useState } from "react";
import { Eye, EyeOff, Phone, X } from "lucide-react";
import Frame2 from "../../imports/Frame10/index";

interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [phone, setPhone] = useState("");
  const [word1, setWord1] = useState("");
  const [word2, setWord2] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRegModal, setShowRegModal] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !word1 || !word2 || code.length !== 8) {
      setError("Заполните все поля. Секретный код — 8 символов.");
      return;
    }
    setError("");
    setLoading(true);
    setTimeout(() => { setLoading(false); onLogin(); }, 1000);
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCode(e.target.value.replace(/\D/g, "").slice(0, 8));
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{ background: "linear-gradient(160deg, #4A2FA0 0%, #2D5BB5 50%, #3B2A8A 100%)" }}
    >
      {/* Centered card */}
      <div
        className="w-full mx-4 overflow-hidden"
        style={{
          maxWidth: 380,
          borderRadius: 28,
          /* Form section bg matches the deep violet of the arcs bottom */
          background: "#1B0F4E",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
          border: "1px solid rgba(124,58,237,0.2)",
        }}
      >
        {/* ── Header — Figma Frame10 scaled to card width ── */}
        <div
          className="relative overflow-hidden"
          style={{ height: 210 }}
        >
          {/*
            Center the 826px-wide frame inside the 380px card:
            - left:50% + translateX(-50%) centers the element horizontally
            - scale(0.46) from top-center shrinks it: 826*0.46≈380px, 435*0.46≈200px
          */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: "50%",
              width: 826,
              height: 460,
              transform: "translateX(-50%) scale(0.46)",
              transformOrigin: "top center",
            }}
          >
            <Frame2 />
          </div>
        </div>

        {/* ── Form ── */}
        <div className="px-7 pb-7 pt-4">
          <h2 className="text-white text-xl font-bold mb-0.5">Вход в аккаунт</h2>
          <p className="text-sm mb-5" style={{ color: "#9B8EC4" }}>Введите данные для входа</p>

          <form onSubmit={handleSubmit} className="space-y-3">

            <InputField
              label="Номер телефона"
              type="tel"
              value={phone}
              onChange={setPhone}
              placeholder="+7 (912) 345-67-89"
              icon={<Phone size={15} className="text-purple-400 shrink-0" />}
            />

            <InputField
              label="Первое слово"
              type="text"
              value={word1}
              onChange={setWord1}
              placeholder="Введите первое слово"
              autoComplete="off"
            />

            <InputField
              label="Второе слово"
              type="text"
              value={word2}
              onChange={setWord2}
              placeholder="Введите второе слово"
              autoComplete="off"
            />

            {/* Secret code */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#A78BFA" }}>
                Секретный код
              </label>
              <div
                className="flex items-center gap-2 rounded-2xl px-4 py-3 transition-all"
                style={{ background: "rgba(255,255,255,0.06)", border: "1.5px solid rgba(167,139,250,0.25)" }}
              >
                <input
                  type={showCode ? "text" : "password"}
                  inputMode="numeric"
                  value={code}
                  onChange={handleCodeChange}
                  placeholder="8-значный код"
                  className="bg-transparent outline-none w-full text-sm tracking-widest"
                  style={{ color: "#FFFFFF", caretColor: "#A78BFA" }}
                  onFocus={e => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = "#7C3AED"; }}
                  onBlur={e => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = "#3D2A7A"; }}
                />
                <button type="button" onClick={() => setShowCode(v => !v)} className="shrink-0" style={{ color: "#A78BFA" }}>
                  {showCode ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {/* 8-dot progress */}
              <div className="flex gap-1.5 ml-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-full transition-all duration-150"
                    style={{ width: 6, height: 6, background: i < code.length ? "#A78BFA" : "rgba(167,139,250,0.2)" }}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.12)", color: "#FCA5A5", border: "1px solid rgba(239,68,68,0.2)" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-2xl text-white font-semibold transition-all disabled:opacity-60 mt-1"
              style={{ background: "linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)", boxShadow: "0 4px 20px rgba(124,58,237,0.35)" }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Загрузка...
                </span>
              ) : "Войти"}
            </button>
          </form>

          <p className="text-center text-xs mt-5" style={{ color: "#3D2A7A" }}>
            <span
              className="cursor-pointer underline"
              style={{ color: "#7C5CBA" }}
              onClick={() => setShowRegModal(true)}
            >
              Регистрация
            </span>
          </p>
        </div>
      </div>

      {/* Registration modal */}
      {showRegModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setShowRegModal(false)}
        >
          <div
            className="w-full relative overflow-hidden"
            style={{ maxWidth: 340, background: "#1A0D3D", borderRadius: 24, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={() => setShowRegModal(false)}
              className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full transition-colors"
              style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}
            >
              <X size={15} />
            </button>

            <div className="px-7 py-8 flex flex-col items-center text-center">
              {/* Icon */}
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "linear-gradient(135deg, #7C3AED, #C026D3)" }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>

              <h3 className="text-white font-bold text-lg mb-2">Регистрация</h3>
              <p className="text-sm mb-6" style={{ color: "#8B7CC4" }}>
                Регистрация доступна только в мобильном приложении FinChat
              </p>

              {/* Google Play */}
              <a
                href="https://play.google.com/store/apps/details?id=com.finchat.android"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl mb-3 transition-opacity hover:opacity-80"
                style={{ background: "#2D1B69", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M3.18 23.76c.37.2.8.22 1.19.04l11.65-6.74-2.5-2.5L3.18 23.76z" fill="#EA4335"/>
                  <path d="M21.54 10.31c-.34-.52-.9-.85-1.54-.85H3.37L13.52 19.6l8.02-8.02c.02-.43-.02-.85-.31-1.27z" fill="#FBBC05" transform="translate(0 -1)"/>
                  <path d="M3.18.24C2.81.44 2.56.84 2.56 1.3v21.4c0 .46.25.86.62 1.06l11.84-11.84L3.18.24z" fill="#4285F4"/>
                  <path d="M3.18.24l10.34 10.34 2.5-2.5L4.37.2C4 .02 3.55.04 3.18.24z" fill="#34A853"/>
                </svg>
                <div className="text-left">
                  <p className="text-white/40 text-xs leading-none mb-0.5">Скачать в</p>
                  <p className="text-white font-semibold text-sm">Google Play</p>
                </div>
              </a>

              {/* App Store */}
              <a
                href="https://apps.apple.com/ru/app/finchat/id6772962709"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-opacity hover:opacity-80"
                style={{ background: "#2D1B69", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                <div className="text-left">
                  <p className="text-white/40 text-xs leading-none mb-0.5">Скачать в</p>
                  <p className="text-white font-semibold text-sm">App Store</p>
                </div>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InputField({
  label, type, value, onChange, placeholder, icon, autoComplete,
}: {
  label: string; type: string; value: string; onChange: (v: string) => void;
  placeholder: string; icon?: React.ReactNode; autoComplete?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#A78BFA" }}>
        {label}
      </label>
      <div
        className="flex items-center gap-2 rounded-2xl px-4 py-3 transition-all"
        style={{ background: "rgba(255,255,255,0.06)", border: "1.5px solid rgba(167,139,250,0.25)" }}
      >
        {icon}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="bg-transparent outline-none w-full text-sm"
          style={{ color: "#FFFFFF", caretColor: "#A78BFA" }}
          onFocus={e => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = "#7C3AED"; }}
          onBlur={e => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = "#3D2A7A"; }}
          required
        />
      </div>
    </div>
  );
}
