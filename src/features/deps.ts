import type { Connection, Message } from '../shared/contract';
import type { Clock, Ids, Timers } from '../shared/runtime';
import type { SessionApi, Transport } from '../shared/transport';
import type { ConnectionSlice } from '../entities/connection/model';
import type { MessagesSlice } from '../entities/message/model';

export type ChatState = MessagesSlice & ConnectionSlice;

/** Команды: тип → payload. Каждая — сценарий (deps, payload) в features/*. */
export interface ActionMap {
  'message/send': { text: string };
  'message/retry': { clientId: string };
  'message/resend': { clientId: string };
  'message/receive': { message: Message };
  'outbox/flush': void;
  'history/loadOlder': void;
  'connection/changed': { state: Connection };
}
export type ActionType = keyof ActionMap;
export type Dispatch = <T extends ActionType>(type: T, ...args: ActionMap[T] extends void ? [] : [ActionMap[T]]) => void;

/**
 * Всё, что видит сценарий: стор — только чтение и действия срезов (без setState),
 * dispatch запускает другой сценарий и ничего не возвращает и не ждёт.
 */
export interface Deps {
  store: { getState(): ChatState };
  transport: Transport;
  session: SessionApi;
  dispatch: Dispatch;
  timers: Timers;
  ids: Ids;
  clock: Clock;
}
