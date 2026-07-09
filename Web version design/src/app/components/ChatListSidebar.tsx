import { useState } from "react";
import { Search, Plus, LogOut, MessageSquare, Sun, Moon } from "lucide-react";
import { Chat } from "../data/chats";
import logoSrc from "../../imports/logo_512.png";
import { useTheme, t } from "../context/ThemeContext";

interface Props {
  chats: Chat[];
  activeChatId: string | null;
  onSelect: (id: string) => void;
  onLogout: () => void;
}

export function ChatListSidebar({ chats, activeChatId, onSelect, onLogout }: Props) {
  const [search, setSearch] = useState("");
  const { isDark, toggle } = useTheme();

  const filtered = chats.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const bg       = t(isDark, "#0D0620", "#F7F5FF");
  const border   = t(isDark, "rgba(167,139,250,0.1)", "rgba(124,58,237,0.1)");
  const inputBg  = t(isDark, "rgba(255,255,255,0.05)", "rgba(124,58,237,0.06)");
  const inputBdr = t(isDark, "rgba(167,139,250,0.1)", "rgba(124,58,237,0.12)");
  const iconClr  = t(isDark, "rgba(255,255,255,0.35)", "rgba(80,40,160,0.4)");
  const placeholderClr = t(isDark, "rgba(255,255,255,0.2)", "rgba(80,40,160,0.3)");
  const searchTextClr  = t(isDark, "#fff", "#1A0D3D");

  return (
    <div className="flex flex-col h-full" style={{ background: bg }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3.5 shrink-0"
        style={{ borderBottom: `1px solid ${border}` }}
      >
        <div className="flex items-center gap-2.5">
          <img src={logoSrc} alt="FinChat" className="w-7 h-7 object-contain" />
          <div>
            <p className="font-bold text-sm" style={{ color: t(isDark, "#fff", "#1A0D3D") }}>FinChat</p>
            <p className="text-xs leading-none" style={{ color: t(isDark, "rgba(255,255,255,0.3)", "rgba(80,40,160,0.5)") }}>
              Бизнес мессенджер
            </p>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          {/* Theme toggle */}
          <SideBtn onClick={toggle} isDark={isDark} title={isDark ? "Светлая тема" : "Тёмная тема"}>
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </SideBtn>
          <SideBtn isDark={isDark} title="Новый чат">
            <Plus size={17} />
          </SideBtn>
          <SideBtn onClick={onLogout} isDark={isDark} title="Выйти" danger>
            <LogOut size={15} />
          </SideBtn>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-2.5">
        <div
          className="flex items-center gap-2 rounded-full px-3.5 py-2"
          style={{ background: inputBg, border: `1px solid ${inputBdr}` }}
        >
          <Search size={14} style={{ color: iconClr }} className="shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск"
            className="bg-transparent outline-none text-sm w-full"
            style={{ color: searchTextClr }}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2" style={{ color: iconClr }}>
            <MessageSquare size={28} className="opacity-40" />
            <span className="text-xs">Чаты не найдены</span>
          </div>
        ) : (
          filtered.map(chat => (
            <ChatItem
              key={chat.id}
              chat={chat}
              isActive={chat.id === activeChatId}
              isDark={isDark}
              onClick={() => onSelect(chat.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SideBtn({
  children, onClick, isDark, title, danger,
}: {
  children: React.ReactNode; onClick?: () => void;
  isDark: boolean; title?: string; danger?: boolean;
}) {
  const base   = t(isDark, "rgba(255,255,255,0.35)", "rgba(80,40,160,0.4)");
  const hover  = danger
    ? "#F87171"
    : t(isDark, "rgba(255,255,255,0.8)", "#7C3AED");
  const hoverBg = t(isDark, "rgba(255,255,255,0.07)", "rgba(124,58,237,0.08)");

  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
      style={{ color: base }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.color = hover;
        (e.currentTarget as HTMLElement).style.background = hoverBg;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.color = base;
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function ChatItem({
  chat, isActive, isDark, onClick,
}: {
  chat: Chat; isActive: boolean; isDark: boolean; onClick: () => void;
}) {
  const activeBg    = t(isDark, "rgba(124,58,237,0.2)",  "rgba(124,58,237,0.1)");
  const hoverBg     = t(isDark, "rgba(255,255,255,0.04)", "rgba(124,58,237,0.05)");
  const nameClr     = t(isDark, "#fff",                  "#1A0D3D");
  const previewClr  = t(isDark, "rgba(255,255,255,0.4)", "rgba(80,40,160,0.55)");
  const timeClr     = t(isDark, "rgba(255,255,255,0.3)", "rgba(80,40,160,0.4)");

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-all"
      style={{
        background: isActive ? activeBg : "transparent",
        borderLeft: isActive ? "3px solid #7C3AED" : "3px solid transparent",
      }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = hoverBg; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold text-base"
          style={{
            background: `linear-gradient(135deg, ${chat.avatarColor}, ${chat.avatarColor}99)`,
            boxShadow: isActive ? `0 0 10px ${chat.avatarColor}44` : "none",
          }}
        >
          {chat.avatar}
        </div>
        {chat.isOnline && (
          <span
            className="absolute bottom-0 right-0 w-3 h-3 rounded-full"
            style={{
              background: "#4ADE80",
              border: `2px solid ${t(isDark, "#0D0620", "#F7F5FF")}`,
            }}
          />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-sm font-semibold truncate" style={{ color: nameClr }}>{chat.name}</span>
          <span className="text-xs shrink-0 ml-2" style={{ color: timeClr }}>{chat.lastTime}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs truncate" style={{ color: previewClr }}>{chat.lastMessage}</span>
          {chat.unread > 0 && (
            <span
              className="ml-2 shrink-0 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-white text-[10px] font-bold px-1"
              style={{ background: "#7C3AED" }}
            >
              {chat.unread}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
