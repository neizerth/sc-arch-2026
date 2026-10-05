# RxJS: итоги порта features

Состояние остаётся в Zustand; RxJS управляет только процессами. Тесты 4/4, typecheck 0 ошибок.

## Что сделано из пп. 1–7 (всё)
1. Источники. `transport.on` обёрнут в `new Observable` (teardown = отписка) + `share()` — один общий `events$` (`features/sources.ts`). `connection$` — `new Observable` поверх `store.subscribe` (значение из `getState()`) + `distinctUntilChanged()`. Мост `events$ → dispatch` — `features/ingest.ts`.
2. Жизненный цикл. Один `stop$`; `takeUntil(stop$)` навешен на каждый поток фич в `features/index.ts`; подписка в `start()` одна (`merge`). `dispose()` = `stop$.next()` + `complete()` + `session.stop()`. `d.timers` не используется: `timer`/`timeout` снимаются отпиской. Проверено временным тестом: send → dispose → +30 с — стор не изменился; два `createChat` независимы.
3. Канал команд: `actions$ = Subject<Action>`, `dispatch` кладёт в него (одно приведение, с комментарием), `ofType` без приведений: `Action` — объединение, выведенное из `ActionMap`. Фичи — функции `(d, actions$, ...) => Observable`.
4. Доставка: `groupBy(clientId)` + `mergeMap(g$ => g$.pipe(switchMap(deliver)))` — повтор того же clientId отменяет прошлую попытку. `defer(from(send))` + `timeout({ first: 10_000 })` + `catchError` (offline → остаётся pending, иное → failed); устаревший epoch отбрасывается `filter(assertEpoch)`.
5. Баннер: `connection$ → switchMap(reconnecting ? timer(3000) : of(false)) → distinctUntilChanged → tap`. `connection/changed` делает только `setConnection` + `session.*`.
6. Outbox: `connection$` (connected) или `outbox/flush` → `concatMap(from(pending))` → `dispatch('message/resend')`.
7. loadOlder: `exhaustMap` + `retry({ count: 2, delay: timer(2**n*100) })` + `finalize` (сброс loadingOlder при отмене).

## Где RxJS упростил
- Баннер и ack-таймаут: отмена по смене статуса / по повтору делается `switchMap`, без ручных ключей таймеров (`timers.clear('banner')`, `ack:<id>`).
- Политика latest по ключу — `groupBy + switchMap` в одну композицию; `exhaustMap` заменяет флаг `loadingOlder` в проверке.
- Один `stop$` вместо ручного учёта отписок и таймеров.

## Где усложнил / подводные камни
- `Deps.store` без `subscribe` (deps.ts менять нельзя), поэтому `connection$` строится в `create-chat.ts` и пробрасывается отдельным аргументом фич — сигнатуры неоднородны.
- Порядок подписки важен: `events$` (hot-ish, `share`) надо подписать до `transport.start()`, иначе потеряется первое `connected`.
- Порядок в `connection/changed`: сначала `session.*`, потом `setConnection` — подписчики `connection$` срабатывают синхронно внутри `set`, а им нужен свежий epoch.
- `groupBy` без `duration` держит группу на каждый clientId до `stop$` (небольшая утечка на долгой сессии).
- `finalize` в loadOlder при dispose тоже сбрасывает `loadingOlder` — синхронно внутри `dispose()`, после него стор не меняется.
- Типизация `ofType`/`Action` потребовала выводимого union из `ActionMap`; ошибки типов у `Observable` объединений — сообщения длинные.

## Размер
`npx vite build`: js gzip 57.48 kB (прошлая поверхностная версия: 56.56 kB). create-chat.ts: 51 строка, все файлы ≤ 80.
