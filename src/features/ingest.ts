import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { BackendEvent } from '../shared/contract';
import type { Deps } from './deps';

/** События бэкенда → команды: connection/changed и message/receive. */
export const ingestFeature = (d: Deps, events$: Observable<BackendEvent>) =>
  events$.pipe(
    tap((e) =>
      e.type === 'connection'
        ? d.dispatch('connection/changed', { state: e.state })
        : d.dispatch('message/receive', { message: e.message }),
    ),
  );
