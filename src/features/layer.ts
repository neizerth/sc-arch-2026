import { Effect, Layer, Ref } from 'effect';
import type { Fiber } from 'effect';
import type { Deps } from './deps';
import {
  BannerService, ClockService, DispatchService, IdsService, SessionService, StoreService, TransportService,
} from './services';

/** Layer на инстанс чата: сервисы из Deps. Сессия останавливается финализатором при закрытии рантайма. */
export const chatLayer = (d: Deps) =>
  Layer.mergeAll(
    Layer.succeed(TransportService)(d.transport),
    Layer.succeed(StoreService)(d.store),
    Layer.succeed(IdsService)(d.ids),
    Layer.succeed(ClockService)(d.clock),
    Layer.succeed(DispatchService)(d.dispatch),
    Layer.effect(SessionService)(
      Effect.acquireRelease(Effect.succeed(d.session), (s) => Effect.sync(() => s.stop())),
    ),
    Layer.effect(BannerService)(
      Effect.gen(function* () {
        const fiber = yield* Ref.make<Fiber.Fiber<void> | undefined>(undefined);
        const scope = yield* Effect.scope;
        return { fiber, scope };
      }),
    ),
  );
