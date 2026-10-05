import type { Backend, BackendEvent, Message } from './contract';

// Транспорт — порт к бэкенду (в проде тут web: http+ws, webview: мост). Сценарии знают только его.
export interface Transport {
  start(): void;
  loadHistory(beforeId?: string): Promise<{ messages: Message[]; hasMore: boolean }>;
  send(clientId: string, text: string): Promise<Message>;
  on(listener: (e: BackendEvent) => void): () => void;
}

export const createTransport = (backend: Backend): Transport => ({
  start: () => backend.connect(),
  loadHistory: (beforeId) => backend.loadHistory(beforeId),
  send: (clientId, text) => backend.send(clientId, text),
  on: (listener) => backend.on(listener),
});

export type SessionState = 'idle' | 'ready' | 'reconnecting' | 'stopped';

// Сессия — поколение (epoch) + состояние. Результат асинхронной операции старого поколения отбрасываем.
export interface SessionApi {
  state(): SessionState;
  epoch(): number;
  connected(): void;
  reconnecting(): void; // обрыв связи начинает новое поколение: незавершённое со старого отбрасываем
  stop(): void;
  /** true, если операция, начатая в epoch, всё ещё актуальна. Вызывать после каждого await. */
  assertEpoch(epoch: number): boolean;
}

export function createSession(): SessionApi {
  let state: SessionState = 'idle';
  let epoch = 0;
  return {
    state: () => state,
    epoch: () => epoch,
    connected() { if (state !== 'stopped') state = 'ready'; },
    reconnecting() { if (state !== 'stopped') { state = 'reconnecting'; epoch++; } },
    stop() { state = 'stopped'; },
    assertEpoch: (e) => state !== 'stopped' && e === epoch,
  };
}
