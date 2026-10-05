import { Duration, Effect, Fiber, Ref } from 'effect';
import type { Connection } from '../../shared/contract';
import { BannerService, DispatchService, SessionService, StoreService } from '../services';

const BANNER_DELAY = Duration.seconds(3);

/** Снять ожидающий баннер: достать Fiber из реестра и прервать. */
const cancelBanner = Effect.gen(function* () {
  const { fiber } = yield* BannerService;
  const pending = yield* Ref.getAndSet(fiber, undefined);
  if (pending) yield* Fiber.interrupt(pending);
});

/** reconnecting: форк «спим 3 с → showBanner» в scope рантайма; Fiber — в реестре. */
const armBanner = Effect.gen(function* () {
  const { fiber, scope } = yield* BannerService;
  const store = yield* StoreService;
  const waiting = yield* Effect.sleep(BANNER_DELAY).pipe(
    Effect.andThen(Effect.sync(() => store.getState().showBanner())),
    Effect.forkIn(scope),
  );
  yield* Ref.set(fiber, waiting);
});

/** connection/changed: статус в стор и сессию, баннер (reconnecting 3 с подряд), при connected — outbox/flush. */
export const connectionChanged = ({ state }: { state: Connection }) =>
  Effect.gen(function* () {
    const store = yield* StoreService;
    const session = yield* SessionService;
    yield* cancelBanner;
    store.getState().setConnection(state);
    if (state === 'reconnecting') {
      session.reconnecting();
      yield* armBanner;
    } else if (state === 'connected') {
      session.connected();
      store.getState().hideBanner();
      (yield* DispatchService)('outbox/flush');
    }
  });
