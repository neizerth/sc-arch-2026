# T1. Ветка `main` — Zustand + обычные async-функции

Прочитай `tasks/RULES.md`. База (T0) уже в ветке. Реализуй `src/model/` по раскладке из RULES. Дополнительная зависимость: `zustand` (`npm i zustand@5`).

## Идиома (так и пиши)

- **Один стор на инстанс:** `createStore` из `zustand/vanilla` в `create-chat.ts`; хук — `useStore(store, selector)` из `zustand`. Модульного состояния нет.
- **Срез = файл** в `entities/*/model`: тип состояния + именованные действия (`receive`, `markSent`, `markFailed`, `prepend`…), мутаторы — чистые функции. Сценарии стор не мутируют напрямую (`setState` вне срезов запрещён) — только действия.
- **Сценарий = обычная `async` функция `(deps, payload)`**: `send(deps, { text })`, `retry`, `flushOutbox`, `loadOlder`. `deps = { store, backend, ids, timers? }` — собираются вручную в `create-chat.ts`, без DI-контейнера. Никаких классов.
- **Подписка на backend — в `create-chat.ts`/`features/receive`**: `backend.on(e => …)` вызывает действие стора или сценарий; в обработчике нет логики, только перекладка.
- **Баннер:** `features/connection-banner` — функция `watchConnection(deps)`: при `reconnecting` ставит `setTimeout(3000)` → `showBanner`, при `connected` — `clearTimeout` + `hideBanner`. Возвращает отписку.
- `loadingOlder` — флаг в сторе, он же защита от повторного вызова.
- Генераторы, шину, каналы команд, политики **не делать**: это переусложнение для MVP.

## Готово, когда

Выполнены «Как сдавать» из RULES. `npm test` зелёный (4 теста `describeChat`).
