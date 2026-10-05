# T4. Ветка `exp/effector` — Effector

Прочитай `tasks/RULES.md`. Ветка от коммита T0 (`git worktree add ../mvp-effector -b exp/effector <sha T0>`), `npm i effector effector-react`. Zustand не использовать.

## Идиома

- **Домены/юниты в `model/`:** `createEvent`, `createStore`, `createEffect`, связи — `sample`. Логики в `.watch` нет; побочные эффекты — только в `createEffect`.
- **Инстанс = scope:** граф юнитов объявлен на уровне модуля **(это допустимо для Effector, здесь это единственное исключение из «нет модульного состояния»)**, а `createChat(backend)` делает `fork({ values: … })`, `useChat` читает через `useUnit` внутри `<Provider value={scope}>` или через `scopeBind`/`allSettled` — как проще. Два вызова `createChat` не должны делить состояние (проверь: добавь в `NOTES.md`, сработало ли).
- **Фичи — `sample`:** `sendFx.done` → `markSent`; `sendFx.fail` с `Error('offline')` → оставить `pending`; `connected` → `sample({ clock: connected, source: $pending, target: flushFx })`.
- **Политики:** `loadOlder` — `sample({ clock: loadOlder, filter: $canLoadMore, … })` (`$canLoadMore = hasOlder && !loadingOlder`).
- **Таймаут ack и баннер** — через `createEffect` с `setTimeout`/`delay` из effector; баннер: `delay({ source: reconnecting, timeout: 3000 })` + `sample` с фильтром `$connection === 'reconnecting'`; `connected` → `hideBanner`.
- **dispose:** сброс подписки на backend (`unsubscribe`) + таймеры; граф не удаляется — это ожидаемо и фиксируется в `NOTES.md`.
- Раскладка слоёв из RULES сохраняется (юниты объявляются в `entities/*/model` и `features/*/model`).

## Готово, когда

«Как сдавать» из RULES. В `NOTES.md` — 5 строк: как решён изоляция инстансов, что с dispose, где `sample` упростил код, где запутал, размер `npx vite build` (gzip js).
