# T3. Ветка `exp/effect` — Effect

Прочитай `tasks/RULES.md`. Ветка от коммита T0 (`git worktree add ../mvp-effect -b exp/effect <sha T0>`), `npm i effect`. Zustand не использовать.

**Версия Effect:** установленная (4.x). API отличается от v3 и от твоей памяти. Прежде чем писать, найди в `node_modules/effect` типы/доки и проверяй каждое имя через `grep` по `.d.ts`. Не угадывай имена. Нужный минимум: `Effect`, `Fiber`, `Schedule` (если есть), `Ref` или `SubscriptionRef`, `Scope`/`Runtime`-аналог для жизненного цикла. Если какая-то возможность в v4 называется иначе — найди и используй актуальное имя.

## Идиома

- **Сценарии — `Effect`**, ошибки в типе: `send` возвращает `Effect<…, Offline | AckTimeout>` (классы-ошибки через `Data.TaggedError` или аналог v4), без результатов-объединений.
- **Состояние:** `SubscriptionRef` (или `Ref` + ручная нотификация), хук `useChat` — `useSyncExternalStore` поверх него.
- **Таймаут ack** — `Effect.timeout`; **баннер** — `Effect.sleep` в форке, отменяется прерыванием файбера при `connected`.
- **Отмена и жизненный цикл:** весь инстанс — один `Scope`/рантайм; `dispose()` закрывает его, все файберы прерываются. Ручных флагов и `AbortController` нет.
- **Мост с React и backend:** `backend.on` оборачивается в `Effect.acquireRelease`/`Stream` — как позволяет v4; граница `Effect.runFork` — только в `create-chat.ts`.
- Раскладка слоёв из RULES сохраняется.
- Слои/сервисы Effect (`Layer`, `Context`) — **только если упрощают**; `deps` можно передавать параметром, как в main.

## Готово, когда

«Как сдавать» из RULES. В `NOTES.md` — 5 строк: какие имена API v4 отличались от ожидаемых, где Effect помог, где мешал, размер `npx vite build` (gzip js).
