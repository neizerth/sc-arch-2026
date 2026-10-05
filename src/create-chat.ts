import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Subject, type Subscription } from 'rxjs';
import type { Chat, ChatModel, CreateChat } from './shared/contract';
import { createClock, createIds, createTimers } from './shared/runtime';
import { createSession, createTransport } from './shared/transport';
import { createConnectionSlice } from './entities/connection/model';
import { createMessagesSlice } from './entities/message/model';
import type { ChatState, Deps } from './features/deps';
import type { Action } from './features/of-type';
import { connectionOf, transportEvents } from './features/sources';
import { rootFeature } from './features/index';

export const createChat: CreateChat = (backend): Chat => {
  const store = createStore<ChatState>()((set) => ({ ...createMessagesSlice(set), ...createConnectionSlice(set) }));
  const transport = createTransport(backend);
  const session = createSession();
  const actions$ = new Subject<Action>(); // канал команд
  const stop$ = new Subject<void>();

  const deps: Deps = {
    store, transport, session, timers: createTimers(), ids: createIds(), clock: createClock(),
    // Единственное приведение: сигнатура Dispatch уже связывает type и payload, а Action — их объединение.
    dispatch: (type, ...args) => actions$.next({ type, payload: args[0] } as Action),
  };
  const actions = {
    send: (text: string) => deps.dispatch('message/send', { text }),
    retry: (clientId: string) => deps.dispatch('message/retry', { clientId }),
    loadOlder: () => deps.dispatch('history/loadOlder'),
  };
  let subscription: Subscription | undefined;

  return {
    useChat(): ChatModel {
      const { messages, connection, showConnectionBanner, hasOlder, loadingOlder } = useStore(store);
      return { messages, connection, showConnectionBanner, hasOlder, loadingOlder, ...actions };
    },
    start() {
      const streams = { actions$, stop$, events$: transportEvents(transport), connection$: connectionOf(store) };
      subscription = rootFeature(deps, streams).subscribe({ error: (e) => console.error('[feature]', e) });
      transport.start(); // подписка уже есть: первое connected не потеряется
      deps.dispatch('history/loadOlder');
    },
    dispose() {
      stop$.next();
      stop$.complete();
      subscription?.unsubscribe();
      session.stop();
    },
  };
};
