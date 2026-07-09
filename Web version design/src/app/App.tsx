import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { LoginPage } from "./components/LoginPage";
import { ChatListSidebar } from "./components/ChatListSidebar";
import { ChatView } from "./components/ChatView";
import { CHATS } from "./data/chats";
import { ThemeProvider, useTheme, t } from "./context/ThemeContext";

type Screen = "login" | "messenger";

export default function App() {
  return (
    <ThemeProvider>
      <Messenger />
    </ThemeProvider>
  );
}

function Messenger() {
  const { isDark } = useTheme();
  const [screen, setScreen] = useState<Screen>("login");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chats] = useState(CHATS);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");

  const activeChat = chats.find(c => c.id === activeChatId) ?? null;

  if (screen === "login") {
    return <LoginPage onLogin={() => setScreen("messenger")} />;
  }

  const dividerClr = t(isDark, "rgba(255,255,255,0.05)", "rgba(124,58,237,0.1)");
  const outerBg    = t(isDark, "#0D0620", "#EDE9F8");

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ fontFamily: "'Inter', sans-serif", background: outerBg }}>
      <div
        className={`shrink-0 flex flex-col overflow-hidden transition-all duration-200
          ${activeChatId && mobileView === "chat" ? "hidden md:flex" : "flex"}
        `}
        style={{ width: "clamp(260px, 28vw, 340px)" }}
      >
        <ChatListSidebar
          chats={chats}
          activeChatId={activeChatId}
          onSelect={id => { setActiveChatId(id); setMobileView("chat"); }}
          onLogout={() => { setScreen("login"); setActiveChatId(null); }}
        />
      </div>

      <div className="w-px shrink-0" style={{ background: dividerClr }} />

      <div
        className={`flex-1 flex flex-col overflow-hidden
          ${!activeChatId || mobileView === "list" ? "hidden md:flex" : "flex"}
        `}
      >
        {activeChat ? (
          <ChatView key={activeChat.id} chat={activeChat} onBack={() => setMobileView("list")} />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  const { isDark } = useTheme();
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center"
      style={{ background: t(isDark, "linear-gradient(160deg,#0D0620,#130930)", "linear-gradient(160deg,#F0EDFB,#F7F5FF)") }}
    >
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5 shadow-xl"
        style={{ background: "linear-gradient(135deg, #7C3AED, #C026D3)", boxShadow: "0 8px 32px rgba(124,58,237,0.35)" }}
      >
        <MessageSquare size={36} className="text-white" />
      </div>
      <h2 className="text-xl font-semibold mb-2" style={{ color: t(isDark, "#fff", "#1A0D3D") }}>
        Добро пожаловать в FinChat
      </h2>
      <p className="text-sm text-center max-w-xs" style={{ color: t(isDark, "rgba(167,139,250,0.5)", "rgba(80,40,160,0.5)") }}>
        Выберите чат слева, чтобы начать общение
      </p>
    </div>
  );
}
