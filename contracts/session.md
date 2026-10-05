# Контракт сессии sc-sdk

> Черновик от 05.10.2026 (ред. 1). Источник правды для порта `shared/contracts/session.ts` и реализации `createSession({ emit, logger })` в `app/engine/session.ts`. Связанные документы: `contracts/transport.md` (epoch, события `session.*`), FINDINGS.md, раздел 7, `specs/01-demo-skeleton.md`, разд. 5.6.
> Форму задают типы и таблица переходов, поведение — гарантии из раздела 6. Гарантии проверяет набор тестов таблицей, без моков и без сети.

Сессия — машина состояний без ввода-вывода: статус, epoch, single-flight. Она не вызывает транспорт, не пишет в стор, не подписывается на шину, не держит таймеров. Ввод-вывод (старт, рестарт, восстановление, реакция на соединение и фон) — сценарии, которые дёргают методы сессии.

## 1. Типы

```ts
export type SessionState =
  | 'idle' | 'starting' | 'ready' | 'reconnecting' | 'restarting' | 'failed' | 'stopped' | 'disposed';

export type SessionKind = 'start' | 'restart';

export type SessionFailReason = 'auth_required' | 'start_failed' | 'restart_failed' | 'unknown';

export interface SessionStatusChanged {
  from: SessionState;
  to: SessionState;
  epoch: number;                    // epoch после перехода
  reason?: SessionFailReason;       // только при to === 'failed'
}

export interface SessionEvents {
  'session.status.changed': SessionStatusChanged;
}
```

`SessionState` — единственный источник правды о статусе. Срез `session` в сторе только копирует его для UI.

## 2. Таблица переходов

```ts
export const transitions = {
  idle:         ['starting', 'disposed'],
  starting:     ['ready', 'failed', 'stopped', 'disposed'],
  ready:        ['reconnecting', 'restarting', 'stopped', 'disposed'],
  reconnecting: ['ready', 'restarting', 'failed', 'stopped', 'disposed'],
  restarting:   ['ready', 'failed', 'stopped', 'disposed'],
  failed:       ['starting', 'stopped', 'disposed'],
  stopped:      ['starting', 'disposed'],
  disposed:     [],
} as const satisfies Record<SessionState, readonly SessionState[]>;
```

Всё, чего в таблице нет, отбрасывается и логируется. Таблица — готовая диаграмма и вход для табличных тестов.

- `stopped` — обратимая остановка (StrictMode, размонтирование провайдера). `disposed` — окончательная.
- Восстановление из `failed` — только через `begin('start')`: рестарт из `failed` запрещён.

## 3. Операции

```ts
export interface SessionApi {
  state(): SessionState;
  epoch(): number;
  /** Переход + новый epoch. null — переход запрещён или уже идёт (single-flight). */
  begin(kind: SessionKind): { epoch: number } | null;
  /** starting | restarting → ready, если epoch актуален. Иначе игнорируется. */
  complete(epoch: number): void;
  /** starting | reconnecting | restarting → failed, если epoch актуален. Иначе игнорируется. */
  fail(epoch: number, reason: SessionFailReason): void;
  /** Состояние соединения от канала. Epoch не меняет. */
  connection(state: 'connected' | 'reconnecting'): void;
  stop(): void;
  dispose(): void;
  /** Бросает TransportError, если epoch устарел или сессия остановлена. Вызывать после каждого await. */
  assertEpoch(epoch: number): void;
}

export type CreateSession = (deps: {
  emit: <K extends keyof SessionEvents>(type: K, e: SessionEvents[K]) => void;
  logger: Logger;
}) => SessionApi;
```

| Метод | Из состояния | В состояние | Побочный эффект |
|---|---|---|---|
| `begin('start')` | `idle`, `failed`, `stopped` | `starting` | `epoch += 1` |
| `begin('restart')` | `ready`, `reconnecting` | `restarting` | `epoch += 1` |
| `complete(e)` | `starting`, `restarting` | `ready` | — |
| `fail(e, r)` | `starting`, `reconnecting`, `restarting` | `failed` | — |
| `connection('reconnecting')` | `ready` | `reconnecting` | — |
| `connection('connected')` | `reconnecting` | `ready` | — |
| `stop()` | любое, кроме `idle`, `stopped`, `disposed` | `stopped` | — |
| `dispose()` | любое, кроме `disposed` | `disposed` | — |

Прочее:
- `connection(...)` в остальных состояниях — no-op: во время `starting` и `restarting` канал всё равно пересоздаётся, а `connected` в `ready` уже ничего не меняет.
- Недопустимый вызов не бросает: возвращает `null` (`begin`) или `void`, пишет в лог `session.transition.rejected` с `{ from, method, epoch }`.
- Единственный метод, который бросает, — `assertEpoch`.

## 4. События

Сессия публикует один факт: `session.status.changed` в `internal`-шину. Публикуется только при реальной смене состояния, синхронно после перехода, с `epoch` после перехода. Подписчик, который вызывает метод сессии из обработчика, видит уже новое состояние.

Именование: `домен.сущность` + прошедшее время (`session.status.changed`). Доменные факты `session.connected` и `session.restored` публикуют сценарии (`entities/session`, `features/recovery`), не сессия.

## 5. Epoch

- Целое число, владелец — сессия. Начинается с `0` для каждого инстанса; первый `begin` даёт `1`.
- Растёт только в `begin` при успешном переходе. `reconnecting` его не меняет: это тот же сеанс с теми же учётными данными, переподключает канал. Отклонённый `begin` (`null`) не меняет epoch.
- Transport получает его параметром (`Ctx.epoch`) и помечает всё входящее (`contracts/transport.md`, разд. 5). Сессия о транспорте не знает.
- Сценарии держат epoch, который вернул `begin`, и после каждого ожидания вызывают `assertEpoch(epoch)` (обычно через `d.step`).
- `assertEpoch(e)` бросает:
  - `TransportError('aborted_by_restart', false)` — `e !== epoch()`;
  - `TransportError('disposed', false)` — состояние `disposed`;
  - `TransportError('aborted', false)` — состояние `stopped`.
  Порядок проверки — как в списке.
- В стор epoch не попадает. Persist запрещён.

## 6. Поведенческие гарантии

Переходы:
1. Состояние меняется только по таблице из разд. 2. Недопустимый вызов — no-op с записью в лог.
2. `disposed` терминально: после него `begin` возвращает `null`, остальные методы — no-op, событий нет.
3. Переходы атомарны и синхронны: после возврата метода `state()` уже новое.

Single-flight:
4. `begin('start')` в `starting` и `begin('restart')` в `restarting` возвращают `null`. Пока идёт одно поколение, второе не начинается.
5. `begin('restart')` в `starting` и `failed` возвращает `null`.

Epoch:
6. `epoch()` монотонно не убывает. Растёт ровно на единицу при каждом успешном `begin`.
7. `complete(e)` и `fail(e, r)` с `e !== epoch()` — no-op: опоздавший результат старого поколения не меняет состояние.
8. `complete` и `fail` после `stop` и `dispose` — no-op (состояния `stopped` и `disposed` не входят в их исходные).

Остановка:
9. `stop()` из `stopped` и `idle` — no-op; из `failed` — переход в `stopped`.
10. После `stop()` `assertEpoch` любого epoch бросает; `begin('start')` снова разрешён.
11. Отмену выполняет не сессия: канал команд по факту `session.status.changed` с `to` равным `stopped` или `disposed` прерывает активные `AbortController`.

События:
12. На каждый успешный переход — ровно один `session.status.changed`. Отклонённый — ноль.
13. У `reason` значение только при `to === 'failed'`.

Границы:
14. Сессия не вызывает транспорт, платформу, стор и шину на чтение; не держит таймеров и промисов.
15. Нет изменяемого состояния на уровне модуля: всё создаётся `createSession` на инстанс.

## 7. Связь с транспортом и сценариями

Сессия и транспорт встречаются только в сценариях:

| Источник | Сценарий | Вызов сессии |
|---|---|---|
| `chat.start()` | `lifecycle/start` | `begin('start')` → `transport.start({ epoch })` → загрузка → `complete(epoch)`; ошибка → `fail(epoch, 'start_failed')` |
| `transport.connection.changed` | `session/connectionChanged` | `connection('connected' \| 'reconnecting')` |
| `transport.session.invalidated` | `recovery/restart` (`takeLeading`) | `begin('restart')` → `transport.restart({ epoch })` с backoff → `restore` → `complete(epoch)`; три неудачи → `fail(epoch, 'restart_failed')`; `reason: 'auth_required'` → `fail(epoch, 'auth_required')` |
| `transport.session.restarted` (webview) | `recovery/hostRestarted` | то же восстановление; `transport.restart({ epoch })` в webview только переключает epoch в адаптере, хост не вызывается |
| `platform.app.resumed` | `session/resumed` | `connection(...)` по состоянию канала |
| `chat.stop()`, размонтирование | `lifecycle/stop` | `stop()` |
| `chat.dispose()` | `lifecycle/dispose` | `dispose()` |

Для всех сценариев: если `begin` вернул `null` — результат `{ ok: false, code: 'deduplicated' }`, ничего не делаем.

## 8. Контрактные тесты (таблицами, без моков)

- по всем парам `(состояние, метод)` результат совпадает с таблицей из разд. 2 и 3; выход за таблицу — no-op;
- `begin` повышает epoch ровно на единицу; отклонённый `begin` его не меняет;
- второй `begin('start')` при `starting` и второй `begin('restart')` при `restarting` возвращают `null`;
- `complete` и `fail` со старым epoch ничего не меняют;
- `assertEpoch`: устаревший epoch → `aborted_by_restart`; `stopped` → `aborted`; `disposed` → `disposed`;
- `session.status.changed`: одно событие на переход, ноль на отклонённый вызов, `reason` только у `failed`;
- `connection('connected')` в `starting` и `restarting` ничего не меняет;
- `stop` → `begin('start')` работает, `dispose` → ничего не работает;
- два инстанса не делят состояние.

## 9. Расхождения с другими документами (исправить при утверждении)

1. FINDINGS, разд. 7.1: в таблице нет `stopped`; ТЗ, разд. 5.6, его содержит. Контракт следует ТЗ: обновить FINDINGS.
2. `src/shared/transport.ts` (MVP): `reconnecting()` начинает новое поколение, а `assertEpoch` возвращает `boolean`. Контракт: `reconnecting` epoch не меняет, `assertEpoch` бросает. Привести MVP при переносе.
3. ТЗ, разд. 5.7 и `specs/01-demo-skeleton.md` (строки с `connection.changed`): состояние `'disconnected'` — убрать, оно относится только к сокету (см. разд. 10).
4. ТЗ, разд. 5.6: `fail(epoch, reason: string)`. Контракт: закрытый список `SessionFailReason`.

## 10. Решения

- Webview: epoch ведёт только SDK (`BridgeProtocolAdapter`), хост его не видит. `session.restarted` от хоста приходит с текущим epoch; после `begin('restart')` адаптер переключается на новый (`transport.restart({ epoch })` — локальная операция). Подробности — `contracts/transport.md`, разд. 5 и 7.
- `disconnected` — только состояние сокета внутри канала. В сессии и в публичном событии `transport.connection.changed` его нет: канал наружу сообщает `connected` или `reconnecting`. Обрыв, из которого не вернуться, выходит как `session.invalidated` или как ошибка старта и рестарта, а решение о `failed` принимает сценарий.

## 11. Открытые вопросы

1. Мост: гарантирует ли порядок уведомлений и ответов (см. `contracts/transport.md`, разд. 7 и 9). Без этого epoch в webview не отследить.
2. Состав `SessionFailReason`: хватает ли четырёх причин для UI (плашка, колбэк хосту; FINDINGS, вопрос 39).
3. Нужен ли публичный `subscribe` на сессии для хуков или достаточно среза `session` в сторе (предложение: достаточно среза).
4. Число и интервалы попыток рестарта (3 попытки с backoff — допущение ТЗ) — параметр сценария `recovery/restart` или опция `createChat`.
