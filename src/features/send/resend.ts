import { EMPTY, defer, from } from 'rxjs';
import { catchError, filter, groupBy, mergeMap, switchMap, tap, timeout } from 'rxjs/operators';
import type { Deps } from '../deps';
import { type Actions, ofType } from '../of-type';

const ACK_TIMEOUT_MS = 10_000;

/** Одна попытка доставки: offline — остаётся pending (дошлёт outbox), нет ack за 10 с или иная ошибка — failed. */
const deliver = (d: Deps, clientId: string) =>
  defer(() => {
    const msg = d.store.getState().messages.find((m) => m.clientId === clientId);
    if (msg?.status !== 'pending') return EMPTY;
    const epoch = d.session.epoch();
    return from(d.transport.send(clientId, msg.text)).pipe(
      timeout({ first: ACK_TIMEOUT_MS }),
      filter(() => d.session.assertEpoch(epoch)), // результат старого поколения отбрасываем
      tap((ack) => d.store.getState().markSent(clientId, ack.id)),
      catchError((e) => {
        if (!(e instanceof Error && e.message === 'offline')) d.store.getState().markFailed(clientId);
        return EMPTY;
      }),
    );
  });

/** message/resend: по каждому clientId своя ветка; повтор того же clientId отменяет предыдущую попытку (latest). */
export const resendFeature = (d: Deps, actions$: Actions) =>
  actions$.pipe(
    ofType('message/resend'),
    groupBy(({ clientId }) => clientId),
    mergeMap((group$) => group$.pipe(switchMap(({ clientId }) => deliver(d, clientId)))),
  );
