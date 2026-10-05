# Effect 4.0.1 — заметки по порту

## Где Effect упростил
- Жизненный цикл: один `ManagedRuntime` на инстанс; `dispose()` = `runtime.dispose()` закрывает scope и прерывает ВСЕ fiber'ы (отправки, баннер, подписку). Ни `Set` fiber'ов, ни флагов `disposed`, ни `timers.clearAll()`. Проверено временным тестом: send + reconnecting → dispose → +30 с → стор неизменен (без dispose — меняется).
- Ошибки типизированы (`Offline`, `AckTimeout`, `StaleEpoch`, `SendFailed`, `HistoryFailed`), разбор — `Effect.catchTags`; нет try/catch и `instanceof` в сценариях, кроме одного маппинга `Error('offline')` → `Offline` в `tryPromise.catch`.
- Таймаут ack — `Effect.timeoutOrElse` (прерывает и сам запрос), вместо ручного таймера `ack:<id>`.
- Баннер — процесс: `Effect.sleep(3 с)` → `showBanner` в `forkIn(scope)`, Fiber в реестре `BannerService` (Ref); `Fiber.interrupt` при смене состояния. `d.timers` не используется.
- Входящие — `Stream.callback` + `acquireRelease` (отписка) + `Stream.runForEach(dispatch)`; транспорт стартует после подписки.
- Зависимости — `Context.Service` + `Layer.succeed/effect`; тип R сценария показывает, что ему нужно. Сессия: `acquireRelease` → `session.stop()` при закрытии рантайма.

## Где усложнил / пришлось обходить
- `Effect.forkChild` (бывший `fork`) привязан к родителю: fiber завершившегося сценария `connection/changed` убил бы баннер. Нужен `forkIn(scope рантайма)`, scope берётся в Layer через `Effect.scope` — лишний сервис-реестр.
- Единственное приведение типа — payload в `dispatch` (create-chat.ts).
- `d.timers` остался в `Deps` (публичная форма менять нельзя), но фичи им не пользуются.
- loadOlder: защита от повтора — флаг `loadingOlder` среза (Semaphore не нужен).
- Outbox: `Effect.forEach(..., { discard: true })` + `dispatch('message/resend')` (фичи общаются только через dispatch).

## Расхождения v4 с v3 (проверено по `node_modules/effect/dist/*.d.ts`)
- `Context.Tag`/`Effect.Service` → `Context.Service<Self, Shape>()('key')` (класс) или `Context.Service<Shape>('key')`; `Service.useSync(f)` вместо `Effect.map(Tag, f)`.
- `Layer.succeed(Tag)(value)` — каррированная форма; `Layer.effect(Tag)(effect)` аналогично.
- `Effect.fork` → `Effect.forkChild`; `forkDaemon` → `forkDetach`; `forkIn(scope)`, `forkScoped` остались.
- `Data.TaggedError('Tag')<{fields}>` (вызов tag, затем generic), без `()()`.
- `Effect.catchAll` отсутствует; для ошибок — `catchTags`/`catchTag`/`catchCause`/`catchIf`.
- `Effect.tryPromise(thunk)` без `catch` даёт `Cause.UnknownError` (не `UnknownException`); `Effect.timeout` падает с `Cause.TimeoutError`.
- `Stream.async` → `Stream.callback(queue => Effect<_, _, Scope>)`; публикация в очередь — `Queue.offerUnsafe`.
- `Effect.runFork` → `ManagedRuntime.make(layer).runFork`; `runtime.dispose()` возвращает Promise.
- `Ref.make`, `Ref.getAndSet`, `Ref.set` — как в v3; `Semaphore` вынесен в модуль `Semaphore` (`Semaphore.make`).

## Размер
`npx vite build`: js 201.22 kB, gzip 66.62 kB.
