// Контракт одинаков во всех четырёх проектах. Не менять.

export interface Message {
  id: string;
  clientId?: string; // есть у собственных сообщений
  text: string;
  author: 'me' | 'other';
  createdAt: number;
}

export type Delivery = 'pending' | 'sent' | 'failed';
export type Connection = 'connecting' | 'connected' | 'reconnecting';

/** Сообщение в ленте: чужие всегда 'sent'. */
export interface ChatItem extends Message {
  status: Delivery;
}

/** Всё, что нужно UI. Реализуется моделью каждого проекта. */
export interface ChatModel {
  messages: ChatItem[]; // от старых к новым
  connection: Connection;
  showConnectionBanner: boolean; // reconnecting >= 3 с подряд; connected скрывает сразу
  hasOlder: boolean;
  loadingOlder: boolean;
  send(text: string): void;
  retry(clientId: string): void;
  loadOlder(): void;
}

/** Что возвращает createChat. */
export interface Chat {
  useChat(): ChatModel; // React-хук
  start(): void; // подключиться и загрузить первую страницу истории
  dispose(): void; // отписаться от всего, остановить таймеры
}

// ---------- Бэкенд (фейк в памяти, реализация — shared/backend.ts) ----------

export type BackendEvent =
  | { type: 'connection'; state: Connection }
  | { type: 'message'; message: Message }; // новые чужие + эхо своих

export interface Backend {
  connect(): void; // эмитит connected
  /** Страница истории от новых к старым, по 30. beforeId — id самого старого из уже загруженных. */
  loadHistory(beforeId?: string): Promise<{ messages: Message[]; hasMore: boolean }>;
  /** Идемпотентно по clientId. Отклоняется, если нет соединения или за 1 с ответа нет (ошибка Error('offline')). */
  send(clientId: string, text: string): Promise<Message>;
  on(listener: (e: BackendEvent) => void): () => void; // возвращает отписку
  chaos: {
    dropConnection(downMs?: number): void; // reconnecting, через downMs (5000) снова connected
    burst(n: number): void; // n входящих сообщений подряд
    setLatency(ms: number): void;
  };
}

export type CreateChat = (backend: Backend) => Chat;
