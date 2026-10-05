# T7. Переписать features/* под свою библиотеку (поведение не менять)

Ты в worktree СВОЕЙ ветки. Она уже синхронизирована с `main`: `npm test` = 4/4, typecheck = 0 ошибок. Образец — текущий код (это и есть `main`, на обычных async-функциях). Твоя задача — выразить те же процессы идиоматично в **своей** библиотеке. Состояние остаётся в Zustand-срезах, библиотека управляет только процессами.

## Менять можно ТОЛЬКО
- `src/features/*/**` (содержимое фич, имена файлов внутри папки)
- `src/create-chat.ts` — собирает фичи и реализует канал `dispatch` (≤ 80 строк)
- `NOTES.md` (создать)

## Менять НЕЛЬЗЯ (проверь `git diff --stat` перед коммитом)
`src/shared/**`, `src/entities/**`, `src/features/deps.ts`, `src/main.tsx`, `src/chat.test.ts`, `package.json`. Публичная форма `Deps` и `ActionMap` не меняется: `dispatch(type, payload)` по-прежнему ничего не возвращает; сценарий читает стор только через `d.store.getState()` и меняет его только действиями среза (`addPending`, `markSent`, …).

## Запрещено (за это вернут)
- `any`, `as any`, `as unknown`, `!` (non-null), `@ts-ignore`. Одно приведение допустимо — в канале `dispatch` в `create-chat.ts`, с комментарием.
- `store.setState` в фичах. Прятать функции в свойства стора/глобалы для связи фич — нельзя; фичи общаются только через `d.dispatch`.
- Файлы-заглушки (`// feature`), пустые папки, дубли логики между `send` и `outbox`.
- Глобальное состояние на уровне модуля: всё создаётся внутри `createChat(backend)` на инстанс. Два вызова `createChat` не должны делить состояние.
- `Date.now()`, голый `setTimeout` в фичах — только `d.clock`, `d.timers`, `d.ids` (кроме случаев, где библиотека даёт свой аналог: `timer`, `Effect.sleep`, `delay` — тогда НЕ используй `d.timers` для этого процесса, и `dispose()` обязан его снять).

## Что сохранить (поведение, проверяют 4 теста)
1. Старт: `history/loadOlder` грузит первую страницу (30), `hasOlder`.
2. `message/send`: pending сразу (синхронно до первого await), затем `transport.send`. Успех → `markSent`. `offline` → остаётся `pending`. Нет ack за 10 с → `markFailed`. Результат со старого epoch (`session.assertEpoch`) отбросить.
3. `message/retry` (только failed) → `markPending` → отправка.
4. Outbox: `connection/changed` → connected → `outbox/flush` → для каждого pending независимо `message/resend` (через `d.dispatch`, не ждём).
5. Баннер: `reconnecting` ≥ 3 с подряд → `showBanner`; `connected` скрывает сразу и отменяет ожидание.
6. `history/loadOlder`: повторный вызов во время загрузки игнорируется.
7. `dispose()`: всё отписано/прервано, после него нет обновлений стора.

## Порядок работы
1. Прочитай `src/features/*`, `src/features/deps.ts`, `src/create-chat.ts`.
2. Переписывай по одной фиче; после КАЖДОЙ фичи `npm test && npm run typecheck` — зелёные. Если красные и не чинится за 2 попытки — откати эту фичу (`git checkout -- src/features/<фича>`), запиши в `NOTES.md` и иди дальше.
3. Библиотека должна реально использоваться в **каждой** фиче (send, retry, receive, outbox, load-older, connection-banner), а не в одной.
4. `NOTES.md`: 5–8 строк — где библиотека упростила код, где усложнила, какие места пришлось обходить, размер `npx vite build` (gzip js).
5. Коммит `refactor(<lib>): features ported`. Не пушить.

## В ответ — только проверяемые факты
Выведи вывод этих команд как есть: `npm test 2>&1 | grep Tests`, `npm run typecheck 2>&1 | grep -c "error TS"`, `git diff --stat main -- src/shared src/entities src/features/deps.ts src/main.tsx src/chat.test.ts` (должен быть пустым; `main` = ветка `main` из ../mvp, если ветки нет — `git diff --stat HEAD~2`), `grep -rnE "\bany\b|setState|as unknown" src/features src/create-chat.ts | wc -l` (0), `grep -rl "from '<lib>'" src/features`, `wc -l src/create-chat.ts`.
