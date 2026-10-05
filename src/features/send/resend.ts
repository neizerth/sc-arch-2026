import { Duration, Effect } from 'effect';
import { AckTimeout, Offline, SendFailed, StaleEpoch } from '../errors';
import { SessionService, StoreService, TransportService } from '../services';

const ACK_TIMEOUT = Duration.seconds(10);

/**
 * Один шаг доставки: отправить pending-сообщение (идемпотентно по clientId).
 * Offline — остаётся pending (дошлёт outbox); нет ack за 10 с — failed; чужой epoch — отбросить.
 */
export const resendMessage = ({ clientId }: { clientId: string }) =>
  Effect.gen(function* () {
    const store = yield* StoreService;
    const transport = yield* TransportService;
    const session = yield* SessionService;
    const msg = store.getState().messages.find((m) => m.clientId === clientId);
    if (!msg || msg.status !== 'pending') return;

    const epoch = session.epoch();
    const ack = yield* Effect.tryPromise({
      try: () => transport.send(clientId, msg.text),
      catch: (cause) => (cause instanceof Error && cause.message === 'offline' ? new Offline() : new SendFailed({ cause })),
    }).pipe(Effect.timeoutOrElse({ duration: ACK_TIMEOUT, orElse: () => Effect.fail(new AckTimeout()) }));
    if (!session.assertEpoch(epoch)) return yield* Effect.fail(new StaleEpoch());
    store.getState().markSent(clientId, ack.id);
  }).pipe(
    Effect.catchTags({
      Offline: () => Effect.void,
      StaleEpoch: () => Effect.void, // связь рвалась: статус решит outbox после reconnect
      SendFailed: () => StoreService.useSync((s) => s.getState().markFailed(clientId)),
      AckTimeout: () => StoreService.useSync((s) => s.getState().markFailed(clientId)),
    }),
  );
