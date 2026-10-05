import { Observable, share, distinctUntilChanged } from 'rxjs';
import type { StoreApi } from 'zustand/vanilla';
import type { BackendEvent, Connection } from '../shared/contract';
import type { Transport } from '../shared/transport';
import type { ChatState } from './deps';

/** Один общий поток событий бэкенда: отписка от transport.on — teardown, share() — единственная подписка. */
export const transportEvents = (t: Transport): Observable<BackendEvent> =>
  new Observable<BackendEvent>((sub) => t.on((e) => sub.next(e))).pipe(share());

/** Статус соединения из zustand (свежее значение из getState), без повторов. */
export const connectionOf = (store: Pick<StoreApi<ChatState>, 'getState' | 'subscribe'>): Observable<Connection> =>
  new Observable<Connection>((sub) => {
    const emit = () => sub.next(store.getState().connection);
    emit();
    return store.subscribe(emit);
  }).pipe(distinctUntilChanged());
