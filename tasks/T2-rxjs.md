# T2. Ветка `exp/rxjs` — процессы на RxJS

Прочитай `tasks/RULES.md`. Ветка создаётся от коммита T0 (`git worktree add ../mvp-rxjs -b exp/rxjs <sha T0>`), `npm i rxjs`. Состояние хранить в `BehaviorSubject`/`scan`, **Zustand не использовать**.

## Идиома

- **Состояние ленты = поток:** действия (`receive`, `sendRequested`, `acked`, `failed`, `olderLoaded`) — `Subject`; состояние — `scan` над объединением действий, `shareReplay({ bufferSize: 1, refCount: true })`. Хук `useChat` — `useSyncExternalStore` поверх `state$` (подписка/отписка, snapshot из последнего значения).
- **Политики — операторы:** отправка `mergeMap` (с `catchError` → pending/failed), `loadOlder` — `exhaustMap`, outbox — `concatMap`.
- **Таймаут ack:** оператор `timeout({ first: 10_000 })` на вызове `from(backend.send(...))`.
- **Баннер:** `connection$.pipe(switchMap(s => s === 'reconnecting' ? timer(3000).pipe(map(() => true), startWith(false)) : of(false)), distinctUntilChanged())`.
- **Отмена:** все подписки собираются в один `Subscription`; `dispose()` = `unsubscribe()`. Никаких ручных флагов `disposed`.
- Backend → поток: `new Observable(sub => backend.on(e => sub.next(e)))` (teardown = возвращённая отписка).
- Раскладка слоёв из RULES сохраняется: файл фичи экспортирует функцию, принимающую потоки и возвращающую поток действий или `Subscription`.

## Готово, когда

«Как сдавать» из RULES. Отдельно в `NOTES.md` — 3 строки: где RxJS упростил код, где усложнил, размер `npx vite build` (gzip js).
