import { type Observable, of, timer } from 'rxjs';
import { distinctUntilChanged, ignoreElements, map, switchMap, tap } from 'rxjs/operators';
import type { Connection } from '../../shared/contract';
import type { Deps } from '../deps';
import { type Actions, ofType } from '../of-type';

const BANNER_DELAY_MS = 3_000;

/** connection/changed: только статус в стор и сессия. */
export const connectionFeature = (d: Deps, actions$: Actions) =>
  actions$.pipe(
    ofType('connection/changed'),
    tap(({ state }) => {
      if (state === 'reconnecting') d.session.reconnecting();
      if (state === 'connected') d.session.connected();
      d.store.getState().setConnection(state);
    }),
    ignoreElements(),
  );

/** Баннер: reconnecting 3 с подряд → показать; любой другой статус → скрыть сразу (switchMap отменяет таймер). */
export const bannerFeature = (d: Deps, connection$: Observable<Connection>) =>
  connection$.pipe(
    switchMap((s) => (s === 'reconnecting' ? timer(BANNER_DELAY_MS).pipe(map(() => true)) : of(false))),
    distinctUntilChanged(),
    tap((show) => (show ? d.store.getState().showBanner() : d.store.getState().hideBanner())),
    ignoreElements(),
  );
