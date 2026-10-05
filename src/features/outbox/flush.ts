import { Effect } from 'effect';
import { DispatchService, StoreService } from '../services';

/** outbox/flush: для каждого pending — независимый запуск message/resend (dispatch не ждёт). */
export const flushOutbox = () =>
  Effect.gen(function* () {
    const store = yield* StoreService;
    const dispatch = yield* DispatchService;
    const pending = store.getState().messages.filter((m) => m.status === 'pending' && m.clientId);
    yield* Effect.forEach(
      pending,
      (m) => Effect.sync(() => dispatch('message/resend', { clientId: m.clientId ?? m.id })),
      { discard: true },
    );
  });
