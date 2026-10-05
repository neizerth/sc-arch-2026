import { ignoreElements, tap } from 'rxjs/operators';
import type { Deps } from '../deps';
import { type Actions, ofType } from '../of-type';

/** message/send: оптимистичное pending в стор (синхронно), затем команда доставки. */
export const sendFeature = (d: Deps, actions$: Actions) =>
  actions$.pipe(
    ofType('message/send'),
    tap(({ text }) => {
      const clientId = d.ids.clientId();
      d.store.getState().addPending({ id: clientId, clientId, text, author: 'me', createdAt: d.clock.now(), status: 'pending' });
      d.dispatch('message/resend', { clientId });
    }),
    ignoreElements(),
  );
