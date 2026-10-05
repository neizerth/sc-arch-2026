import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { createDomain, clearNode } from 'effector';
import type { Chat, ChatModel, CreateChat } from './shared/contract';
import { createClock, createIds, createTimers } from './shared/runtime';
import { createSession, createTransport } from './shared/transport';
import { createConnectionSlice } from './entities/connection/model';
import { createMessagesSlice } from './entities/message/model';
import type { ActionMap, ChatState, Deps } from './features/deps';
import type { Events } from './features/events';
import { setupSend } from './features/send/send';
import { setupReceive } from './features/receive/receive';
import { setupFlush } from './features/outbox/flush';
import { setupLoadOlder } from './features/load-older/load-older';
import { setupConnection } from './features/connection-banner/changed';

export const createChat: CreateChat = (backend): Chat => {
  const domain = createDomain();
  const store = createStore<ChatState>()((set) => ({ ...createMessagesSlice(set), ...createConnectionSlice(set) }));
  const events: Events = {
    'message/send': domain.createEvent<ActionMap['message/send']>(),
    'message/retry': domain.createEvent<ActionMap['message/retry']>(),
    'message/resend': domain.createEvent<ActionMap['message/resend']>(),
    'message/receive': domain.createEvent<ActionMap['message/receive']>(),
    'outbox/flush': domain.createEvent<ActionMap['outbox/flush']>(),
    'history/loadOlder': domain.createEvent<ActionMap['history/loadOlder']>(),
    'connection/changed': domain.createEvent<ActionMap['connection/changed']>(),
  };
  const deps: Deps = {
    store,
    transport: createTransport(backend),
    session: createSession(),
    timers: createTimers(),
    ids: createIds(),
    clock: createClock(),
    // Единственное приведение: связь «type → событие» не выражается в TS, сигнатуру гарантирует Dispatch.
    dispatch: (type, ...args) => (events[type] as (payload?: ActionMap[typeof type]) => void)(args[0]),
  };
  setupSend(deps, events, domain);
  setupReceive(deps, events, domain);
  setupFlush(deps, events, domain);
  setupLoadOlder(deps, events, domain);
  setupConnection(deps, events, domain);

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
      unsubscribe = deps.transport.on((e) =>
        e.type === 'connection'
          ? deps.dispatch('connection/changed', { state: e.state })
          : deps.dispatch('message/receive', { message: e.message }),
      );
      deps.transport.start();
      deps.dispatch('history/loadOlder');
    },
    dispose() {
      unsubscribe();
      deps.session.stop();
      clearNode(domain);
    },
  };
};
