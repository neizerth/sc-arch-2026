import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Effect, ManagedRuntime } from 'effect';
import type { Chat, ChatModel, CreateChat } from './shared/contract';
import { createClock, createIds, createTimers } from './shared/runtime';
import { createSession, createTransport } from './shared/transport';
import { createConnectionSlice } from './entities/connection/model';
import { createMessagesSlice } from './entities/message/model';
import type { ActionMap, ActionType, ChatState, Deps } from './features/deps';
import { chatLayer } from './features/layer';
import type { ChatEnv } from './features/services';
import { inbound } from './features/receive/inbound';
import { connectionChanged } from './features/connection-banner/changed';
import { loadOlder } from './features/load-older/load-older';
import { flushOutbox } from './features/outbox/flush';
import { receiveMessage } from './features/receive/receive';
import { retryMessage } from './features/send/retry';
import { resendMessage } from './features/send/resend';
import { sendMessage } from './features/send/send';

// Реестр: команда → сценарий (payload) со своими сервисами в типе R.
const scenarios: { [T in ActionType]: (p: ActionMap[T]) => Effect.Effect<void, never, ChatEnv> } = {
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
    dispatch: (type, ...args) => {
      // Единственное приведение (как в ТЗ 5.4): тип payload восстановлен из реестра ActionMap.
      const scenario = scenarios[type] as (p: unknown) => Effect.Effect<void, never, ChatEnv>;
      runtime.runFork(scenario(args[0]));
    },
  };
  // Один рантайм на инстанс: dispose() закрывает scope → все fiber'ы (отправки, баннер, подписка) прерваны.
  const runtime = ManagedRuntime.make(chatLayer(deps));

  const actions = {
    send: (text: string) => deps.dispatch('message/send', { text }),
    retry: (clientId: string) => deps.dispatch('message/retry', { clientId }),
    loadOlder: () => deps.dispatch('history/loadOlder'),
  };

  return {
    useChat(): ChatModel {
      const { messages, connection, showConnectionBanner, hasOlder, loadingOlder } = useStore(store);
      return { messages, connection, showConnectionBanner, hasOlder, loadingOlder, ...actions };
    },
    start() {
      runtime.runFork(inbound);
      deps.dispatch('history/loadOlder');
    },
    dispose() {
      void runtime.dispose();
    },
  };
};
