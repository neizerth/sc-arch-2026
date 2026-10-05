import type { Backend, BackendEvent, Connection, Message } from './contract';

export function createFakeBackend(): Backend {
  const messages: Message[] = Array.from({ length: 120 }, (_, i) => ({
    id: `m${i + 1}`,
    author: 'other',
    createdAt: i * 1000,
    text: `Сообщение ${i + 1}`,
  }));

  let latency = 100;
  let connected = false;
  let connection: Connection = 'connecting';
  const listeners: ((e: BackendEvent) => void)[] = [];
  const sentByClientId = new Map<string, Message>();

  function emit(e: BackendEvent) {
    listeners.forEach((fn) => fn(e));
  }

  function setConnection(newConnection: Connection) {
    connection = newConnection;
    connected = newConnection === 'connected';
    emit({ type: 'connection', state: newConnection });
  }

  const backend: Backend = {
    connect() {
      setTimeout(() => {
        setConnection('connected');
      }, latency);
    },

    loadHistory(beforeId?: string) {
      return new Promise((resolve) => {
        setTimeout(() => {
          const idx = beforeId
            ? messages.findIndex((m) => m.id === beforeId)
            : messages.length;
          const page = messages.slice(Math.max(0, idx - 30), idx);
          resolve({
            messages: page,
            hasMore: idx > 30,
          });
        }, latency);
      });
    },

    send(clientId: string, text: string) {
      return new Promise((resolve, reject) => {
        if (!connected) {
          reject(new Error('offline'));
          return;
        }

        if (sentByClientId.has(clientId)) {
          resolve(sentByClientId.get(clientId)!);
          return;
        }

        setTimeout(() => {
          const message: Message = {
            id: `m${messages.length + 1}`,
            clientId,
            author: 'me',
            text,
            createdAt: Date.now(),
          };
          sentByClientId.set(clientId, message);
          messages.push(message);
          emit({ type: 'message', message });
          resolve(message);
        }, latency);
      });
    },

    on(listener: (e: BackendEvent) => void) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },

    chaos: {
      dropConnection(downMs = 5000) {
        setConnection('reconnecting');
        setTimeout(() => {
          setConnection('connected');
        }, downMs);
      },

      burst(n: number) {
        let createdAt = Math.max(...messages.map((m) => m.createdAt)) + 1000;
        for (let i = 0; i < n; i++) {
          const message: Message = {
            id: `m${messages.length + 1}`,
            author: 'other',
            text: `Burst message ${i + 1}`,
            createdAt,
          };
          messages.push(message);
          emit({ type: 'message', message });
          createdAt += 1000;
        }
      },

      setLatency(ms: number) {
        latency = ms;
      },
    },
  };

  return backend;
}
