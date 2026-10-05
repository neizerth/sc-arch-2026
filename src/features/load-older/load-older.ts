import { EMPTY, defer, from, timer } from 'rxjs';
import { catchError, exhaustMap, finalize, retry, tap } from 'rxjs/operators';
import type { Deps } from '../deps';
import { type Actions, ofType } from '../of-type';

/**
 * history/loadOlder: exhaustMap игнорирует вызов во время загрузки; retry — 2 повтора с backoff;
 * finalize сбрасывает loadingOlder, если загрузку отменили (dispose).
 */
export const loadOlderFeature = (d: Deps, actions$: Actions) =>
  actions$.pipe(
    ofType('history/loadOlder'),
    exhaustMap(() => {
      const s = d.store.getState();
      if (!s.hasOlder) return EMPTY;
      s.loadOlderStarted();
      const epoch = d.session.epoch();
      const beforeId = s.messages.find((m) => m.status === 'sent')?.id; // самое старое серверное
      return defer(() => from(d.transport.loadHistory(beforeId))).pipe(
        retry({ count: 2, delay: (_, n) => timer(2 ** n * 100) }),
        tap((page) =>
          d.session.assertEpoch(epoch) ? s.loadOlderDone(page.messages, page.hasMore) : s.loadOlderFailed(),
        ),
        catchError(() => {
          s.loadOlderFailed();
          return EMPTY;
        }),
        finalize(() => d.store.getState().loadingOlder && s.loadOlderFailed()),
      );
    }),
  );
