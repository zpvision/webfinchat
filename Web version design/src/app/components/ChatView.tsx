import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft, MoreVertical, Paperclip, Mic, Send,
  Reply, X, FileText, Check, CheckCheck, Download,
  Image as ImageIcon, Users, Search, Copy, Trash2, Phone, Video,
} from "lucide-react";
import { Chat, Message } from "../data/chats";
import { useTheme, t } from "../context/ThemeContext";

interface Props {
  chat: Chat;
  onBack?: () => void;
}

export function ChatView({ chat, onBack }: Props) {
  const { isDark } = useTheme();
  const [messages, setMessages] = useState<Message[]>(chat.messages);
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Theme tokens
  const chatBg     = t(isDark, "linear-gradient(160deg,#0D0620 0%,#130930 60%,#0D0620 100%)", "linear-gradient(160deg,#F0EDFB 0%,#F7F5FF 60%,#EDE9F8 100%)");
  const hdrBg      = t(isDark, "rgba(19,9,48,0.85)",   "rgba(255,255,255,0.88)");
  const hdrBdr     = t(isDark, "rgba(167,139,250,0.1)", "rgba(124,58,237,0.12)");
  const hdrName    = t(isDark, "#fff",                  "#1A0D3D");
  const hdrSub     = t(isDark, "rgba(255,255,255,0.35)","rgba(80,40,160,0.5)");
  const inputBarBg = t(isDark, "rgba(13,6,32,0.9)",     "rgba(255,255,255,0.92)");
  const inputBarBdr= t(isDark, "rgba(167,139,250,0.08)","rgba(124,58,237,0.1)");
  const inputPillBg= t(isDark, "rgba(255,255,255,0.07)","rgba(124,58,237,0.06)");
  const inputPillBdr=t(isDark, "rgba(167,139,250,0.15)","rgba(124,58,237,0.15)");
  const inputClr   = t(isDark, "#fff",                  "#1A0D3D");
  const attachClr  = t(isDark, "rgba(167,139,250,0.7)", "rgba(124,58,237,0.6)");
  const replyBg    = t(isDark, "rgba(124,58,237,0.15)", "rgba(124,58,237,0.08)");
  const replyBdr   = t(isDark, "rgba(124,58,237,0.25)", "rgba(124,58,237,0.2)");

  useEffect(() => {
    setMessages(chat.messages);
    setReplyTo(null);
    setInput("");
  }, [chat.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    const newMsg: Message = {
      id: `msg-${Date.now()}`,
      text: input.trim(),
      time: new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
      isOwn: true,
      status: "sent",
      replyTo: replyTo
        ? { id: replyTo.id, text: replyTo.text, author: replyTo.isOwn ? "Вы" : chat.name }
        : undefined,
    };
    setMessages(prev => [...prev, newMsg]);
    setInput("");
    setReplyTo(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const size = file.size > 1024 * 1024
      ? `${(file.size / 1024 / 1024).toFixed(1)} МБ`
      : `${Math.round(file.size / 1024)} КБ`;
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}`, text: "", isOwn: true, status: "sent",
      time: new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
      file: { name: file.name, size, type: isImage ? "image" : "document" },
    }]);
    setShowFileMenu(false);
    e.target.value = "";
  };

  return (
    <div
      className="flex flex-col h-full relative"
      style={{ background: chatBg }}
      onClick={() => setShowFileMenu(false)}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 shrink-0 relative z-10"
        style={{ background: hdrBg, backdropFilter: "blur(20px)", borderBottom: `1px solid ${hdrBdr}` }}
      >
        {onBack && (
          <button onClick={onBack} className="text-white/50 hover:text-white transition-colors mr-0.5">
            <ArrowLeft size={19} />
          </button>
        )}

        {/* Avatar */}
        <div className="relative shrink-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${chat.avatarColor}, ${chat.avatarColor}99)`,
              boxShadow: `0 0 12px ${chat.avatarColor}55`,
            }}
          >
            {chat.avatar}
          </div>
          {chat.isOnline && (
            <span
              className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full"
              style={{ background: "#4ADE80", border: "2px solid #130930", boxShadow: "0 0 6px #4ADE8088" }}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: hdrName }}>{chat.name}</p>
          <p className="text-xs" style={{ color: chat.isOnline ? "#4ADE80" : hdrSub }}>
            {chat.isGroup
              ? `${chat.members} участников`
              : chat.isOnline ? "в сети" : "был(а) недавно"}
          </p>
        </div>

        <div className="flex items-center gap-0.5">
          {!chat.isGroup && (
            <>
              <HdrBtn isDark={isDark}><Phone size={17} /></HdrBtn>
              <HdrBtn isDark={isDark}><Video size={17} /></HdrBtn>
            </>
          )}
          {chat.isGroup && (
            <HdrBtn isDark={isDark} onClick={() => setShowMembersPanel(v => !v)}>
              <Users size={17} />
            </HdrBtn>
          )}
          <HdrBtn isDark={isDark}><MoreVertical size={17} /></HdrBtn>
        </div>
      </div>

      {/* ── Messages ── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-5"
        style={{ scrollbarWidth: "none", display: "flex", flexDirection: "column", gap: 2 }}
      >
        {messages.map((msg, idx) => {
          const prevMsg = messages[idx - 1];
          const nextMsg = messages[idx + 1];
          const prevSender = prevMsg?.isOwn ? "__own__" : (prevMsg?.sender?.name ?? "__in__");
          const curSender = msg.isOwn ? "__own__" : (msg.sender?.name ?? "__in__");
          const nextSender = nextMsg?.isOwn ? "__own__" : (nextMsg?.sender?.name ?? "__in__");
          const isFirst = prevSender !== curSender;
          const isLast = nextSender !== curSender;

          return (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isDark={isDark}
              chatName={chat.name}
              chatColor={chat.avatarColor}
              chatAvatar={chat.avatar}
              isFirst={isFirst}
              isLast={isLast}
              showSenderName={!msg.isOwn && isFirst && !!chat.isGroup}
              onReply={() => { setReplyTo(msg); inputRef.current?.focus(); }}
              onDelete={() => setMessages(prev => prev.filter(m => m.id !== msg.id))}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* ── Reply preview ── */}
      {replyTo && (
        <div
          className="flex items-center gap-3 px-4 py-2.5 shrink-0"
          style={{ background: replyBg, borderTop: `1px solid ${replyBdr}`, backdropFilter: "blur(8px)" }}
        >
          <div className="w-0.5 h-8 rounded-full" style={{ background: "linear-gradient(to bottom, #A78BFA, #7C3AED)" }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: "#C4B5FD" }}>
              {replyTo.isOwn ? "Вы" : chat.name}
            </p>
            <p className="text-xs truncate" style={{ color: "rgba(196,181,253,0.6)" }}>
              {replyTo.file ? replyTo.file.name : replyTo.text}
            </p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-white/30 hover:text-white/70 transition-colors">
            <X size={15} />
          </button>
        </div>
      )}

      {/* ── Input bar ── */}
      <div
        className="shrink-0 px-3 py-3 relative"
        style={{ background: inputBarBg, backdropFilter: "blur(20px)", borderTop: `1px solid ${inputBarBdr}` }}
      >
        <div className="flex items-center gap-2">
          {/* Attach */}
          <div className="relative">
            <button
              onClick={e => { e.stopPropagation(); setShowFileMenu(v => !v); }}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
              style={{ color: attachClr }}
              onMouseEnter={e => (e.currentTarget.style.background = t(isDark, "rgba(167,139,250,0.1)", "rgba(124,58,237,0.08)"))}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <Paperclip size={19} />
            </button>
            {showFileMenu && (
              <div
                className="absolute bottom-12 left-0 py-1.5 overflow-hidden"
                style={{
                  background: "rgba(25,12,60,0.95)",
                  backdropFilter: "blur(20px)",
                  border: "1px solid rgba(167,139,250,0.15)",
                  borderRadius: 16,
                  minWidth: 190,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                }}
                onClick={e => e.stopPropagation()}
              >
                {[
                  { icon: <ImageIcon size={16} />, label: "Фото или видео" },
                  { icon: <FileText size={16} />, label: "Документ" },
                ].map(item => (
                  <button
                    key={item.label}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
                    style={{ color: "rgba(255,255,255,0.8)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(167,139,250,0.1)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span style={{ color: "#A78BFA" }}>{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <input type="file" ref={fileInputRef} onChange={handleFile} className="hidden" />

          {/* Text input */}
          <div
            className="flex-1 flex items-center rounded-full px-4 py-2.5"
            style={{ background: inputPillBg, border: `1px solid ${inputPillBdr}` }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Сообщение..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: inputClr, caretColor: "#A78BFA" }}
            />
          </div>

          {/* Send / Mic */}
          {input.trim() ? (
            <button
              onClick={send}
              className="w-10 h-10 rounded-full flex items-center justify-center text-white transition-all"
              style={{
                background: "linear-gradient(135deg, #7C3AED, #A855F7)",
                boxShadow: "0 0 16px rgba(124,58,237,0.5)",
              }}
            >
              <Send size={17} />
            </button>
          ) : (
            <button
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all"
              style={{ color: "rgba(167,139,250,0.7)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(167,139,250,0.1)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <Mic size={19} />
            </button>
          )}
        </div>
      </div>

      {showMembersPanel && chat.isGroup && (
        <MembersPanel chat={chat} onClose={() => setShowMembersPanel(false)} />
      )}
    </div>
  );
}

function HdrBtn({ children, onClick, isDark }: { children: React.ReactNode; onClick?: () => void; isDark: boolean }) {
  const base  = t(isDark, "rgba(255,255,255,0.45)", "rgba(80,40,160,0.45)");
  const hover = t(isDark, "rgba(255,255,255,0.9)",  "#7C3AED");
  const hoverBg = t(isDark, "rgba(167,139,250,0.12)", "rgba(124,58,237,0.08)");
  return (
    <button
      onClick={onClick}
      className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
      style={{ color: base }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = hoverBg;
        (e.currentTarget as HTMLElement).style.color = hover;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
        (e.currentTarget as HTMLElement).style.color = base;
      }}
    >
      {children}
    </button>
  );
}

function MessageBubble({
  msg, isDark, chatName, chatColor, chatAvatar,
  isFirst, isLast, showSenderName, onReply, onDelete,
}: {
  msg: Message; isDark: boolean; chatName: string; chatColor: string; chatAvatar: string;
  isFirst: boolean; isLast: boolean; showSenderName?: boolean;
  onReply: () => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const avatarColor = msg.sender?.color ?? chatColor;
  const avatarLetter = msg.sender?.avatar ?? chatAvatar;

  const openMenu = (e: React.MouseEvent) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); };
  const closeMenu = () => setMenu(null);
  const handleCopy = () => { if (msg.text) navigator.clipboard.writeText(msg.text); };

  const ownRadius = isLast
    ? "18px 18px 4px 18px"
    : isFirst ? "18px 18px 18px 18px" : "18px 18px 18px 18px";
  const inRadius = isLast
    ? "18px 18px 18px 4px"
    : "18px 18px 18px 18px";

  return (
    <>
      <div
        className={`flex items-end gap-2 ${msg.isOwn ? "justify-end" : "justify-start"}`}
        style={{ marginTop: isFirst ? 10 : 2 }}
        onContextMenu={openMenu}
      >
        {/* Incoming avatar */}
        {!msg.isOwn && (
          <div className="w-8 shrink-0 self-end mb-0.5">
            {isLast ? (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md"
                style={{
                  background: `linear-gradient(135deg, ${avatarColor}, ${avatarColor}bb)`,
                  boxShadow: `0 2px 8px ${avatarColor}55`,
                }}
              >
                {avatarLetter}
              </div>
            ) : (
              <div className="w-8 h-8" />
            )}
          </div>
        )}

        <div style={{ maxWidth: "68%" }}>
          {/* Sender name */}
          {showSenderName && msg.sender && (
            <p
              className="text-xs font-semibold mb-1 ml-1"
              style={{ color: avatarColor, textShadow: `0 0 12px ${avatarColor}66` }}
            >
              {msg.sender.name}
            </p>
          )}

          {/* Forwarded */}
          {msg.forwarded && (
            <p className="text-xs mb-1 ml-1" style={{ color: "#A78BFA" }}>
              ↩ Переслано от: {msg.forwarded.from}
            </p>
          )}

          {/* Reply preview */}
          {msg.replyTo && (
            <div
              className="flex items-stretch gap-2 px-3 pt-2 pb-1 -mb-1"
              style={{
                background: msg.isOwn ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.06)",
                borderRadius: "14px 14px 0 0",
              }}
            >
              <div
                className="w-0.5 rounded-full shrink-0"
                style={{ background: msg.isOwn ? "rgba(255,255,255,0.4)" : "#A78BFA" }}
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: msg.isOwn ? "rgba(255,255,255,0.6)" : "#C4B5FD" }}>
                  {msg.replyTo.author}
                </p>
                <p className="text-xs truncate" style={{ color: msg.isOwn ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.35)" }}>
                  {msg.replyTo.text}
                </p>
              </div>
            </div>
          )}

          {/* Bubble */}
          <div
            className="px-4 py-2.5"
            style={{
              ...(msg.isOwn
                ? {
                    background: "linear-gradient(135deg, #7C3AED 0%, #9D4EDD 100%)",
                    boxShadow: "0 4px 20px rgba(124,58,237,0.35)",
                    color: "#fff",
                  }
                : {
                    background: t(isDark, "rgba(255,255,255,0.07)", "#FFFFFF"),
                    backdropFilter: "blur(12px)",
                    border: t(isDark, "1px solid rgba(255,255,255,0.1)", "1px solid rgba(124,58,237,0.12)"),
                    color: t(isDark, "#fff", "#1A0D3D"),
                    boxShadow: t(isDark, "none", "0 2px 12px rgba(124,58,237,0.08)"),
                  }),
              borderRadius: msg.replyTo
                ? (msg.isOwn ? "0 0 4px 18px" : "0 0 18px 4px")
                : (msg.isOwn ? ownRadius : inRadius),
            }}
          >
            {/* File */}
            {msg.file && (
              <div
                className="flex items-center gap-3 mb-1 p-2 rounded-xl"
                style={{ background: msg.isOwn ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.06)" }}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: msg.isOwn
                      ? "rgba(255,255,255,0.2)"
                      : "linear-gradient(135deg, #7C3AED, #A855F7)",
                  }}
                >
                  {msg.file.type === "image"
                    ? <ImageIcon size={18} className="text-white" />
                    : <FileText size={18} className="text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{msg.file.name}</p>
                  <p className="text-xs opacity-50">{msg.file.size}</p>
                </div>
                <Download size={15} className="opacity-40 shrink-0" />
              </div>
            )}

            {msg.text && (
              <p className="text-sm leading-relaxed">{msg.text}</p>
            )}

            {/* Time + ticks */}
            <div className="flex items-center gap-1 mt-1 justify-end">
              <span className="text-xs" style={{ opacity: 0.45 }}>{msg.time}</span>
              {msg.isOwn && (
                <span style={{ opacity: 0.6 }}>
                  {msg.status === "read"
                    ? <CheckCheck size={13} style={{ color: "#C4B5FD" }} />
                    : msg.status === "delivered"
                    ? <CheckCheck size={13} />
                    : <Check size={13} />}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x} y={menu.y} hasText={!!msg.text}
          onReply={() => { onReply(); closeMenu(); }}
          onCopy={() => { handleCopy(); closeMenu(); }}
          onDelete={() => { onDelete(); closeMenu(); }}
          onClose={closeMenu}
        />
      )}
    </>
  );
}

function ContextMenu({ x, y, hasText, onReply, onCopy, onDelete, onClose }: {
  x: number; y: number; hasText: boolean;
  onReply: () => void; onCopy: () => void; onDelete: () => void; onClose: () => void;
}) {
  const menuW = 185;
  const menuH = hasText ? 136 : 100;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 py-1.5"
        style={{
          left: Math.min(x, window.innerWidth - menuW - 8),
          top: Math.min(y, window.innerHeight - menuH - 8),
          width: menuW,
          background: "rgba(20,10,50,0.96)",
          backdropFilter: "blur(24px)",
          border: "1px solid rgba(167,139,250,0.15)",
          borderRadius: 16,
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
        }}
      >
        <MenuItem icon={<Reply size={15} />} label="Ответить" onClick={onReply} />
        {hasText && <MenuItem icon={<Copy size={15} />} label="Скопировать" onClick={onCopy} />}
        <div style={{ height: 1, background: "rgba(167,139,250,0.1)", margin: "4px 8px" }} />
        <MenuItem icon={<Trash2 size={15} />} label="Удалить" onClick={onDelete} danger />
      </div>
    </>
  );
}

function MenuItem({ icon, label, onClick, danger }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-all"
      style={{ color: danger ? "#F87171" : "rgba(255,255,255,0.8)" }}
      onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? "rgba(248,113,113,0.1)" : "rgba(167,139,250,0.1)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {icon}{label}
    </button>
  );
}

const GROUP_MEMBERS = [
  { name: "Николай Алексеевич", color: "#E63946", avatar: "Н", status: "в сети", role: "владелец" },
  { name: "Инесса", color: "#8338EC", avatar: "И", status: "в сети", role: "администратор" },
  { name: "Василий", color: "#FB8500", avatar: "В", status: "был(а) 5 минут назад", role: "только чтение" },
  { name: "Неизвестный номер", color: "#6C757D", avatar: "U", status: "был(а) недавно", role: "" },
  { name: "Марина", color: "#06D6A0", avatar: "М", status: "был(а) недавно", role: "" },
  { name: "Родион Петрович", color: "#FB5607", avatar: "Р", status: "был(а) недавно", role: "" },
];

function MembersPanel({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const { isDark } = useTheme();
  const [search, setSearch] = useState("");
  const filtered = GROUP_MEMBERS.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div
      className="absolute top-0 right-0 h-full w-72 flex flex-col z-30"
      style={{
        background: t(isDark, "rgba(13,6,32,0.95)", "rgba(255,255,255,0.96)"),
        backdropFilter: "blur(24px)",
        borderLeft: `1px solid ${t(isDark, "rgba(167,139,250,0.12)", "rgba(124,58,237,0.1)")}`,
        boxShadow: "-8px 0 32px rgba(0,0,0,0.2)",
      }}
    >
      <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(167,139,250,0.08)" }}>
        <h3 className="font-semibold text-sm" style={{ color: t(isDark, "#fff", "#1A0D3D") }}>Участники группы</h3>
        <button onClick={onClose} style={{ color: t(isDark, "rgba(255,255,255,0.3)", "rgba(80,40,160,0.4)") }} className="hover:opacity-80 transition-opacity"><X size={17} /></button>
      </div>

      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid rgba(167,139,250,0.08)" }}>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
          style={{ background: `linear-gradient(135deg, ${chat.avatarColor}, ${chat.avatarColor}88)`, border: `2px solid ${t(isDark, "#0D0620", "#F7F5FF")}` }}
        >
          {chat.avatar}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: t(isDark, "#fff", "#1A0D3D") }}>{chat.name}</p>
          <p className="text-xs" style={{ color: t(isDark, "rgba(167,139,250,0.5)", "rgba(80,40,160,0.5)") }}>{chat.members} участников</p>
        </div>
      </div>

      <p className="px-5 pt-4 pb-2 text-xs uppercase tracking-widest font-semibold" style={{ color: "rgba(167,139,250,0.4)" }}>Администраторы</p>
      {GROUP_MEMBERS.filter(m => m.role === "владелец" || m.role === "администратор").map(m => (
        <MemberRow key={m.name} member={m} />
      ))}

      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: "rgba(167,139,250,0.4)" }}>
          Участники ({chat.members})
        </p>
        <button className="text-xs font-medium" style={{ color: "#A78BFA" }}>+ Добавить</button>
      </div>

      <div className="px-4 pb-3">
        <div
          className="flex items-center gap-2 rounded-full px-3 py-2"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.1)" }}
        >
          <Search size={13} style={{ color: "rgba(167,139,250,0.4)" }} className="shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск"
            className="bg-transparent text-white placeholder-white/20 outline-none text-xs w-full"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {filtered.filter(m => m.role !== "владелец" && m.role !== "администратор").map(m => (
          <MemberRow key={m.name} member={m} />
        ))}
      </div>
    </div>
  );
}

function MemberRow({ member }: { member: typeof GROUP_MEMBERS[0] }) {
  const { isDark } = useTheme();
  return (
    <div
      className="flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-all"
      onMouseEnter={e => (e.currentTarget.style.background = t(isDark, "rgba(167,139,250,0.06)", "rgba(124,58,237,0.05)"))}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
        style={{ background: `linear-gradient(135deg, ${member.color}, ${member.color}88)` }}
      >
        {member.avatar}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: t(isDark, "#fff", "#1A0D3D") }}>{member.name}</p>
        <p className="text-xs truncate" style={{ color: t(isDark, "rgba(255,255,255,0.3)", "rgba(80,40,160,0.4)") }}>{member.status}</p>
      </div>
      {member.role === "владелец" && <span className="text-xs shrink-0" style={{ color: "#A78BFA" }}>владелец</span>}
      {member.role === "только чтение" && <span className="text-xs shrink-0" style={{ color: "#FB923C" }}>только чтение</span>}
      <button className="transition-colors shrink-0" style={{ color: t(isDark, "rgba(255,255,255,0.2)", "rgba(80,40,160,0.25)") }}>
        <MoreVertical size={14} />
      </button>
    </div>
  );
}
