# T6. Доделать фичи и довести тесты до зелёных

Прочитай `tasks/RULES.md` (в `../mvp/tasks/`). Ты в worktree СВОЕГО проекта. Менять нельзя: `src/shared/contract.ts`, `src/shared/backend.ts`, `src/shared/ui/*`, `src/shared/chat.contract.ts` (тест уже исправлен и корректен — подгонять под него код, не наоборот).

## Цель
1. `npm test` — все 4 теста зелёные. `npm run typecheck` — 0 ошибок.
2. **Логика живёт в `src/features/*` и `src/entities/*`, а не в `create-chat.ts`.** `create-chat.ts` только собирает: создаёт стор/состояние, подписывается на `backend.on`, возвращает `{ useChat, start, dispose }`, ≤ 80 строк.
3. Заглушки из одной строки-комментария (`// send feature`) недопустимы: каждая папка в `features/` содержит реальный код своей фичи.
4. Минимум один сценарий полностью в своей фиче — **send**: `features/send` (optimistic pending → `backend.send` → sent по ack; ошибка `offline` остаётся pending; нет ack 10 с → failed) + `retry` для failed. Остальные фичи (receive, outbox, load-older, connection-banner) — тоже в своих папках, если успеваешь; тесты их проверяют все.

## Поведение (напоминание, детали в RULES.md)
- Входящее с `clientId`, который уже есть локально, **заменяет** локальное (не дублирует); дубль по `id` игнорируется.
- Отправка `offline` → остаётся `pending`, при `connected` outbox досылает с тем же `clientId`.
- Таймеры только `setTimeout` (работают с `vi.useFakeTimers`). После `dispose()` — никаких обновлений.
- Один стор/состояние **на инстанс** `createChat` (два вызова не делят состояние).

## Известные симптомы в твоём проекте
(см. ниже; проверь `npx vitest run` сам, лечи причину, а не симптом)

Коммит `feat: features (<lib>)`, не пушить. В ответ: сколько тестов зелёных, строки `wc -l` по `src/create-chat.ts` и по `src/features/*/*.ts`, что не удалось.
