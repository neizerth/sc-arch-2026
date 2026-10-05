import { Context } from 'effect';
import type { Fiber, Ref, Scope } from 'effect';
import type { Deps } from './deps';

// Сервисы = то, что раньше было полями Deps. Тип R эффекта перечисляет, что сценарию нужно.
export class TransportService extends Context.Service<TransportService, Deps['transport']>()('chat/Transport') {}
export class SessionService extends Context.Service<SessionService, Deps['session']>()('chat/Session') {}
export class StoreService extends Context.Service<StoreService, Deps['store']>()('chat/Store') {}
export class IdsService extends Context.Service<IdsService, Deps['ids']>()('chat/Ids') {}
export class ClockService extends Context.Service<ClockService, Deps['clock']>()('chat/Clock') {}
export class DispatchService extends Context.Service<DispatchService, Deps['dispatch']>()('chat/Dispatch') {}

/** Реестр баннера на инстанс: fiber отложенного showBanner и scope рантайма, в котором он живёт. */
export interface BannerRegistry {
  readonly fiber: Ref.Ref<Fiber.Fiber<void> | undefined>;
  readonly scope: Scope.Scope;
}
export class BannerService extends Context.Service<BannerService, BannerRegistry>()('chat/Banner') {}

export type ChatEnv =
  | TransportService | SessionService | StoreService | IdsService | ClockService | DispatchService | BannerService;
