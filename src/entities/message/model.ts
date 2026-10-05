import type { ChatItem, Delivery, Message } from '../../shared/contract';

type Set<S> = (fn: (s: S) => Partial<S>) => void;

export interface MessagesSlice {
  messages: ChatItem[];
  hasOlder: boolean;
  loadingOlder: boolean;
  addPending(item: ChatItem): void;
  receive(message: Message): void;
  markSent(clientId: string, id: string): void;
  markFailed(clientId: string): void;
  markPending(clientId: string): void;
  loadOlderStarted(): void;
  loadOlderDone(page: Message[], hasMore: boolean): void;
  loadOlderFailed(): void;
}

// Статус сообщения — мини-FSM: pending → sent | failed, failed → pending | sent. Остальное игнорируем.
const allowed: Record<Delivery, Delivery[]> = { pending: ['sent', 'failed'], failed: ['pending', 'sent'], sent: [] };

const byTime = (a: ChatItem, b: ChatItem) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** Слияние по id, а собственных — по clientId (эхо и ack не создают дубль). */
const upsert = (list: ChatItem[], item: ChatItem): ChatItem[] => {
  const i = list.findIndex((m) => m.id === item.id || (!!item.clientId && m.clientId === item.clientId));
  return (i < 0 ? [...list, item] : list.map((m, j) => (j === i ? item : m))).sort(byTime);
};

const transition = (list: ChatItem[], clientId: string, to: Delivery, id?: string): ChatItem[] =>
  list.map((m) => (m.clientId === clientId && allowed[m.status].includes(to) ? { ...m, status: to, id: id ?? m.id } : m));

export const createMessagesSlice = (set: Set<MessagesSlice>): MessagesSlice => ({
  messages: [],
  hasOlder: true,
  loadingOlder: false,
  addPending: (item) => set((s) => ({ messages: upsert(s.messages, item) })),
  receive: (m) => set((s) => ({ messages: upsert(s.messages, { ...m, status: 'sent' }) })),
  markSent: (clientId, id) => set((s) => ({ messages: transition(s.messages, clientId, 'sent', id) })),
  markFailed: (clientId) => set((s) => ({ messages: transition(s.messages, clientId, 'failed') })),
  markPending: (clientId) => set((s) => ({ messages: transition(s.messages, clientId, 'pending') })),
  loadOlderStarted: () => set(() => ({ loadingOlder: true })),
  loadOlderDone: (page, hasMore) =>
    set((s) => ({
      messages: page.reduce((list, m) => upsert(list, { ...m, status: 'sent' }), s.messages),
      hasOlder: hasMore,
      loadingOlder: false,
    })),
  loadOlderFailed: () => set(() => ({ loadingOlder: false })),
});
