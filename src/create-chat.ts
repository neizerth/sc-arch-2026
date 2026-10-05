import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Chat, ChatModel, CreateChat } from './shared/contract';
import { createClock, createIds, createTimers } from './shared/runtime';
import { createSession, createTransport } from './shared/transport';
import { createConnectionSlice } from './entities/connection/model';
import { createMessagesSlice } from './entities/message/model';
import type { ActionMap, ActionType, ChatState, Deps } from './features/deps';
import { connectionChanged } from './features/connection-banner/changed';
import { loadOlder } from './features/load-older/load-older';
import { flushOutbox } from './features/outbox/flush';
import { receiveMessage } from './features/receive/receive';
import { retryMessage } from './features/send/retry';
import { resendMessage } from './features/send/resend';
import { sendMessage } from './features/send/send';

// Реестр: команда → сценарий (deps, payload). Единственное место, где они собираются.
const scenarios: { [T in ActionType]: (d: Deps, p: ActionMap[T]) => unknown } = {
  'message/send': sendMessage,
  'message/retry': retryMessage,
  'message/resend': resendMessage,
  'message/receive': receiveMessage,
  'outbox/flush': flushOutbox,
  'history/loadOlder': loadOlder,
  'connection/changed': connectionChanged,
};

export const createChat: CreateChat = (backend): Chat => {
  const store = createStore<ChatState>()((set) => ({ ...createMessagesSlice(set), ...createConnectionSlice(set) }));
  const timers = createTimers();
  const transport = createTransport(backend);
  const session = createSession();

  const deps: Deps = {
    store, transport, session, timers,
    ids: createIds(),
    clock: createClock(),
    dispatch: (type, ...args) => run(type, ...args),
  };
  // Канал команд: ничего не возвращает; сценарий стартует сразу (до первого await), ошибка не роняет остальные.
  function run<T extends ActionType>(type: T, ...args: unknown[]): void {
    // Единственное приведение (как в ТЗ 5.4): тип payload восстановлен из реестра ActionMap.
    const scenario = scenarios[type] as (d: Deps, p: unknown) => unknown;
    const fail = (e: unknown) => console.error(`[${type}]`, e);
    try {
      Promise.resolve(scenario(deps, args[0])).catch(fail);
    } catch (e) {
      fail(e);
    }
  }

  const actions = {
    send: (text: string) => deps.dispatch('message/send', { text }),
    retry: (clientId: string) => deps.dispatch('message/retry', { clientId }),
    loadOlder: () => deps.dispatch('history/loadOlder'),
  };
  let unsubscribe = () => {};

  return {
    useChat(): ChatModel {
      const { messages, connection, showConnectionBanner, hasOlder, loadingOlder } = useStore(store);
      return { messages, connection, showConnectionBanner, hasOlder, loadingOlder, ...actions };
    },
    start() {
      unsubscribe = transport.on((e) =>
        e.type === 'connection'
          ? deps.dispatch('connection/changed', { state: e.state })
          : deps.dispatch('message/receive', { message: e.message }),
      );
      transport.start();
      deps.dispatch('history/loadOlder');
    },
    dispose() {
      unsubscribe();
      session.stop();
      timers.clearAll();
    },
  };
};
