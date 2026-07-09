export interface Message {
  id: string;
  text: string;
  time: string;
  isOwn: boolean;
  sender?: { name: string; color: string; avatar: string };
  status?: "sent" | "delivered" | "read";
  replyTo?: { id: string; text: string; author: string };
  forwarded?: { from: string };
  file?: { name: string; size: string; type: "image" | "document" | "audio" };
}

export interface Chat {
  id: string;
  name: string;
  avatar: string;
  avatarColor: string;
  lastMessage: string;
  lastTime: string;
  unread: number;
  isOnline: boolean;
  isGroup: boolean;
  members?: number;
  messages: Message[];
}

export const CHATS: Chat[] = [
  {
    id: "1",
    name: "Валерий",
    avatar: "В",
    avatarColor: "#6B3FA0",
    lastMessage: "Я так не думаю",
    lastTime: "12:32",
    unread: 3,
    isOnline: true,
    isGroup: false,
    messages: [
      { id: "m1", text: "Привет", time: "12:30", isOwn: false },
      { id: "m2", text: "Ну как там?", time: "12:32", isOwn: false },
      {
        id: "m3",
        text: "С документами",
        time: "12:32",
        isOwn: false,
        forwarded: { from: "Василий Иванович" },
      },
      { id: "m4", text: "С какими документами?", time: "12:33", isOwn: true, status: "read" },
      { id: "m5", text: "Вы ошиблись номером", time: "12:33", isOwn: true, status: "read" },
      { id: "m6", text: "Я так не думаю", time: "12:34", isOwn: false },
      {
        id: "m7",
        text: "Хорошо, позвоните в поддержку и там вам помогут.",
        time: "12:35",
        isOwn: true,
        status: "delivered",
      },
      {
        id: "m8",
        text: "У меня скоро не будет интернета решать этот вопрос сейчас",
        time: "12:36",
        isOwn: true,
        status: "sent",
      },
    ],
  },
  {
    id: "2",
    name: "Бухгалтерия ООО «Сервис»",
    avatar: "Б",
    avatarColor: "#2E86AB",
    lastMessage: "Родион: Принято, спасибо!",
    lastTime: "12:48",
    unread: 2,
    isOnline: false,
    isGroup: true,
    members: 16,
    messages: [
      { id: "g1", text: "Доброе утро всем! Сегодня дедлайн по квартальному отчёту.", time: "09:00", isOwn: false, sender: { name: "Инесса", color: "#8338EC", avatar: "И" } },
      { id: "g2", text: "Доброе! Уже готовлю цифры по зарплатному фонду.", time: "09:03", isOwn: false, sender: { name: "Марина", color: "#06D6A0", avatar: "М" } },
      { id: "g3", text: "Я тоже подключаюсь, скину данные по командировкам через полчаса.", time: "09:05", isOwn: false, sender: { name: "Родион Петрович", color: "#FB5607", avatar: "Р" } },
      { id: "g4", text: "Хорошо, жду от всех до 12:00. Николай Алексеевич, вы сегодня на месте?", time: "09:07", isOwn: true, status: "read" },
      { id: "g5", text: "Да, я здесь. Посмотрел черновик — нужно скорректировать раздел 3.", time: "09:15", isOwn: false, sender: { name: "Николай Алексеевич", color: "#E63946", avatar: "Н" } },
      { id: "g6", text: "Какие именно правки?", time: "09:16", isOwn: false, sender: { name: "Инесса", color: "#8338EC", avatar: "И" } },
      { id: "g7", text: "Суммы по кварталу не сходятся с банковской выпиской. Василий, проверь, пожалуйста.", time: "09:18", isOwn: false, sender: { name: "Николай Алексеевич", color: "#E63946", avatar: "Н" } },
      { id: "g8", text: "Сейчас смотрю... да, вижу расхождение на 14 200 ₽.", time: "09:25", isOwn: false, sender: { name: "Василий", color: "#FB8500", avatar: "В" } },
      { id: "g9", text: "Нашёл причину — дублирующая проводка от 3 октября.", time: "09:28", isOwn: false, sender: { name: "Василий", color: "#FB8500", avatar: "В" } },
      { id: "g10", text: "Понял, исправляю. Спасибо, Василий!", time: "09:30", isOwn: true, status: "read" },
      { id: "g11", text: "Счёт_октябрь.pdf", time: "10:15", isOwn: false, sender: { name: "Марина", color: "#06D6A0", avatar: "М" }, file: { name: "Счёт_октябрь.pdf", size: "245 КБ", type: "document" } },
      { id: "g12", text: "Марина, получила! Всё ок, подпишу и отправлю контрагенту.", time: "10:20", isOwn: true, status: "read" },
      { id: "g13", text: "Коллеги, не забудьте — авансовые отчёты по командировкам нужны до пятницы.", time: "11:00", isOwn: false, sender: { name: "Инесса", color: "#8338EC", avatar: "И" } },
      { id: "g14", text: "У меня готов, принесу сегодня после обеда.", time: "11:04", isOwn: false, sender: { name: "Родион Петрович", color: "#FB5607", avatar: "Р" } },
      { id: "g15", text: "Я сдам завтра с утра.", time: "11:06", isOwn: false, sender: { name: "Василий", color: "#FB8500", avatar: "В" } },
      { id: "g16", text: "Хорошо, принято.", time: "11:08", isOwn: true, status: "read" },
      { id: "g17", text: "Отчёт готов, загружаю финальную версию.", time: "12:10", isOwn: false, sender: { name: "Николай Алексеевич", color: "#E63946", avatar: "Н" } },
      { id: "g18", text: "Отчёт_Q3_финал.xlsx", time: "12:12", isOwn: false, sender: { name: "Николай Алексеевич", color: "#E63946", avatar: "Н" }, file: { name: "Отчёт_Q3_финал.xlsx", size: "1.8 МБ", type: "document" } },
      { id: "g19", text: "Супер! Я отправляю в налоговую. Всем спасибо за работу 👍", time: "12:45", isOwn: true, status: "delivered" },
      { id: "g20", text: "Принято, спасибо! Хорошего дня всем 🎉", time: "12:48", isOwn: false, sender: { name: "Марина", color: "#06D6A0", avatar: "М" } },
    ],
  },
  {
    id: "3",
    name: "Инесса",
    avatar: "И",
    avatarColor: "#8338EC",
    lastMessage: "Завтра в 10 встреча",
    lastTime: "Вчера",
    unread: 1,
    isOnline: true,
    isGroup: false,
    messages: [
      { id: "i1", text: "Привет! Как дела?", time: "Вчера 17:00", isOwn: false },
      { id: "i2", text: "Всё хорошо, спасибо", time: "Вчера 17:05", isOwn: true, status: "read" },
      { id: "i3", text: "Завтра в 10 встреча", time: "Вчера 18:30", isOwn: false },
    ],
  },
  {
    id: "4",
    name: "Николай Алексеевич",
    avatar: "Н",
    avatarColor: "#E63946",
    lastMessage: "Принято, спасибо",
    lastTime: "Вчера",
    unread: 0,
    isOnline: false,
    isGroup: false,
    messages: [
      {
        id: "n1",
        text: "Николай, пожалуйста ознакомьтесь с договором",
        time: "Вчера 14:00",
        isOwn: true,
        status: "read",
      },
      { id: "n2", text: "Принято, спасибо", time: "Вчера 15:30", isOwn: false },
    ],
  },
  {
    id: "5",
    name: "Марина",
    avatar: "М",
    avatarColor: "#06D6A0",
    lastMessage: "Файл получила 👍",
    lastTime: "Пн",
    unread: 0,
    isOnline: false,
    isGroup: false,
    messages: [
      {
        id: "ma1",
        text: "Отчёт_финансы.xlsx",
        time: "Пн 11:00",
        isOwn: true,
        status: "read",
        file: { name: "Отчёт_финансы.xlsx", size: "1.2 МБ", type: "document" },
      },
      { id: "ma2", text: "Файл получила 👍", time: "Пн 11:10", isOwn: false },
    ],
  },
  {
    id: "6",
    name: "Родион Петрович",
    avatar: "Р",
    avatarColor: "#FB5607",
    lastMessage: "На совещании",
    lastTime: "Пн",
    unread: 0,
    isOnline: false,
    isGroup: false,
    messages: [
      { id: "r1", text: "Родион, вы сейчас доступны?", time: "Пн 09:00", isOwn: true, status: "read" },
      { id: "r2", text: "На совещании", time: "Пн 09:15", isOwn: false },
    ],
  },
];
