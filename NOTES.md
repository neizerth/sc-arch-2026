# Effector: заметки по порту

## Что сделано (пп. 1–5)
1. Изоляция: все юниты (события, эффекты, служебный `$inflight`, таймеры задержки) создаются в `createChat` из `createDomain()` на инстанс; `dispose()` = `unsubscribe` + `session.stop()` + `clearNode(domain)`. Данные чата только в Zustand; `d.timers` в фичах не используется.
2. Канал: `events: Events` (по одному `domain.createEvent` на ключ `ActionMap`); `dispatch` вызывает событие, одно узкое приведение с комментарием, `any` нет.
3. Побочки только в эффектах-портах: `sendFx`, `loadHistoryFx`, плюс мелкие эффекты над действиями срезов (`addPendingFx`, `markSentFx`, ...). Логика — цепочки `sample`: send -> addPendingFx.done -> resend -> sendFx; `sendFx.done` + filter `assertEpoch` -> markSentFx; `sendFx.fail` + filter «не offline» -> markFailedFx; retry: filter failed -> markPendingFx -> resend.
4. Ack-таймаут и баннер: `delay` -> `sample` с filter «ещё актуально» (ack: есть запрос в полёте и статус pending; баннер: `connection === 'reconnecting'`); connected -> hideBannerFx сразу.
5. outbox: `connected -> outbox/flush -> resendAllFx` (независимый `message/resend` на каждый pending); load-older: filter по `loadingOlder/hasOlder`, `[startedFx, loadHistoryFx]`, `loadHistoryFx.finally` -> doneFx / failedFx (в т.ч. старый epoch).

## Важно: `delay` в effector 23 нет
`import { delay } from 'effector'` не существует (это `patronum`; `package.json` менять нельзя). Сделан `features/delay.ts` (14 строк): эффект-таймер в домене, `doneData` — выход. Это единственный `setTimeout` в фичах; он живёт в домене, после `clearNode` результат не доходит до графа (сам таймер дотикает до конца, <= 10 с, но ничего не меняет).

## Где Effector упростил / усложнил
+ Процесс виден как связи: ack/failed/offline/epoch — отдельные `sample` с `filter`, а не ветки try/catch; ack-таймаут и баннер без ручного clear/set.
+ Изоляция и dispose одним `clearNode(domain)`.
- Многословность: каждое чтение/запись среза — отдельный эффект-порт; `filter` и `fn` приходится дублировать поиск сообщения (фильтр и map не делят вычисление).
- Фан-аут (flush -> N resend) в графе не выражается — один эффект с циклом.
- Типизация `sample` с `fn` + `filter` хрупкая (сужение типа через `filter` не работает после `fn`; `finally` разбираем по `status`).
- Отличия от оригинала: ack-таймер не отменяется, а проверяется при срабатывании (счётчик `$inflight`: offline-ответ снимает ожидание); баннерный таймер не сбрасывается повторным `reconnecting` (проверка «всё ещё reconnecting» при срабатывании) — при двух `reconnecting` подряд баннер может появиться чуть раньше 3 с от последнего.

## Память / dispose (временный тест, удалён)
- (а) send -> dispose -> drop connection + send/loadOlder + advance 30 с: стор не меняется — ок.
- (б) два `createChat` независимы (send в одном не виден в другом; dispose первого не мешает второму) — ок.
- (в) 300 циклов create -> start -> send/load -> dispose под `node --expose-gc` (gc доступен), прогрев 30 циклов: heapUsed до/после — 28 459 728 / 28 551 304 B (+89 КБ), 28 417 712 / 28 551 576 (+131 КБ), 28 414 736 / 28 549 072 (+131 КБ) в трёх запусках, т.е. ~0.3–0.4 КБ на цикл (шум), роста по циклам нет. Утечки не видно.

## Сборка
`npx vite build`: index js 171.89 kB, gzip 58.02 kB.
