import { Effect, Queue, Stream } from 'effect';
import type { BackendEvent } from '../../shared/contract';
import { DispatchService, TransportService } from '../services';

/**
 * Входящие события транспорта как Stream. Подписка — acquireRelease в scope стрима:
 * при прерывании fiber'а (dispose рантайма) отписка выполняется сама. Соединение — после подписки.
 */
export const inbound = Effect.gen(function* () {
  const transport = yield* TransportService;
  const dispatch = yield* DispatchService;
  const events = Stream.callback<BackendEvent>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => transport.on((e) => Queue.offerUnsafe(queue, e))),
      (unsubscribe) => Effect.sync(unsubscribe),
    ).pipe(Effect.andThen(Effect.sync(() => transport.start()))),
  );
  yield* Stream.runForEach(events, (e) =>
    Effect.sync(() =>
      e.type === 'connection'
        ? dispatch('connection/changed', { state: e.state })
        : dispatch('message/receive', { message: e.message }),
    ),
  );
});
