import { type Observable, merge } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import type { BackendEvent, Connection } from '../shared/contract';
import type { Deps } from './deps';
import type { Actions } from './of-type';
import { ingestFeature } from './ingest';
import { sendFeature } from './send/send';
import { retryFeature } from './send/retry';
import { resendFeature } from './send/resend';
import { receiveFeature } from './receive/receive';
import { outboxFeature } from './outbox/flush';
import { loadOlderFeature } from './load-older/load-older';
import { bannerFeature, connectionFeature } from './connection-banner/changed';

export interface Streams {
  actions$: Actions;
  events$: Observable<BackendEvent>;
  connection$: Observable<Connection>;
  stop$: Observable<void>;
}

/** Все фичи одним потоком; каждая обрывается по stop$. Подписка снаружи — одна. */
export const rootFeature = (d: Deps, { actions$, events$, connection$, stop$ }: Streams) => {
  const features: Observable<unknown>[] = [
    ingestFeature(d, events$),
    connectionFeature(d, actions$),
    bannerFeature(d, connection$),
    outboxFeature(d, actions$, connection$),
    sendFeature(d, actions$),
    retryFeature(d, actions$),
    resendFeature(d, actions$),
    receiveFeature(d, actions$),
    loadOlderFeature(d, actions$),
  ];
  return merge(...features.map((f$) => f$.pipe(takeUntil(stop$))));
};
