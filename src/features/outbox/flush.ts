import { type Observable, from, merge } from 'rxjs';
import { concatMap, filter, ignoreElements, tap } from 'rxjs/operators';
import type { Connection } from '../../shared/contract';
import type { Deps } from '../deps';
import { type Actions, ofType } from '../of-type';

/** Outbox: при connected (или явном outbox/flush) каждое pending независимо уходит на message/resend. */
export const outboxFeature = (d: Deps, actions$: Actions, connection$: Observable<Connection>) =>
  merge(connection$.pipe(filter((s) => s === 'connected')), actions$.pipe(ofType('outbox/flush'))).pipe(
    concatMap(() => from(d.store.getState().messages.filter((m) => m.status === 'pending'))),
    tap(({ clientId }) => clientId && d.dispatch('message/resend', { clientId })),
    ignoreElements(),
  );
