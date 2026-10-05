import { ignoreElements, tap } from 'rxjs/operators';
import type { Deps } from '../deps';
import { type Actions, ofType } from '../of-type';

/** message/retry: ручной повтор только для failed, затем команда доставки с тем же clientId. */
export const retryFeature = (d: Deps, actions$: Actions) =>
  actions$.pipe(
    ofType('message/retry'),
    tap(({ clientId }) => {
      if (d.store.getState().messages.find((m) => m.clientId === clientId)?.status !== 'failed') return;
      d.store.getState().markPending(clientId);
      d.dispatch('message/resend', { clientId });
    }),
    ignoreElements(),
  );
