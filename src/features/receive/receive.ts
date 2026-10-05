import { ignoreElements, tap } from 'rxjs/operators';
import type { Deps } from '../deps';
import { type Actions, ofType } from '../of-type';

/** message/receive: слияние входящего (чужое, эхо своего, дубликат) делает срез. */
export const receiveFeature = (d: Deps, actions$: Actions) =>
  actions$.pipe(
    ofType('message/receive'),
    tap(({ message }) => d.store.getState().receive(message)),
    ignoreElements(),
  );
