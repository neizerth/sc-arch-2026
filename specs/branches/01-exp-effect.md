# ТЗ: ветка `exp/effect` — ядро и сценарии на Effect

> Версия 1 от 05.10.2026. Исполнитель — GigaCode (агент), ревью — архитектор и тимлид.
> База — `main` после выполнения `specs/02-main-alignment.md` (раскладка по доменам и слоям, ядро по `specs/01-demo-skeleton.md` v4, контрольная фича, метрики базы). Это ТЗ описывает только изменения; всё, что не сказано здесь, работает как в базе.
> Порядок работы: агент получает весь файл и номер этапа из раздела 6. Следующий этап — только после прохождения проверок предыдущего.

## 0. Цель ветки

Проверить Effect как парадигму ядра, а не как библиотеку для отдельных мест:
- зависимости сценариев (`Deps`) — сервисы и слои Effect вместо ручной сборки;
- ожидаемые ошибки — в типе эффекта вместо результатов-объединений;
- отмена — прерывание файберов вместо `signal`, `d.step` и `assertEpoch` в сценариях;
- повторы, таймауты, задержки — `Schedule`, `Effect.timeout`, `Effect.sleep` вместо самописных backoff и `d.timers`;
- политики канала команд — файберы, семафоры и прерывание;
- жизненный цикл инстанса — среда выполнения на инстанс, уничтожение которой закрывает всё.

Вопрос, на который отвечает ветка: оправдывает ли выигрыш в надёжности и выразительности смену парадигмы, вес и порог входа для команды из двух middle.

**Версия.** Effect 4 — актуальная стабильная мажорная версия; ветка делается на ней. Часть API в v4 переименована относительно v3 (например, `Context.Tag` → `Context.Service`, тип `Runtime` удалён, переименованы комбинаторы форка, `FiberRef` → `Context.Reference`). Перед этапом 1 агент читает `MIGRATION.md` и руководства из репозитория Effect и использует имена v4. Примеры кода ниже показывают устройство; точные имена API сверяются с документацией выбранной версии, расхождения фиксируются в отчёте.

## 1. Что не меняется (контракт сравнения)

Ветки сравниваются между собой и с `main` честно, только если всё, что не относится к проверяемой библиотеке, остаётся одинаковым.

- **Порты и транспорт:** `Transport`, `Platform`, их адаптеры и каналы, гарантии из `specs/01-demo-skeleton.md` разд. 5.7, фейковый бэкенд `dev/fake-backend`. Разрешено только то, что прямо указано в разделе изменений этого ТЗ.
- **Публичный API:** `ChatProvider`, `createChat`, `mount`, имена и форма возвращаемых значений хуков (`useThread`, `useFeed`, `useMessage`, `useComposer`, `useSessionStatus`), компоненты `Chat`, `Feed`, `Composer`, `SessionBanner`. Демо-страница и e2e-тесты работают без изменений.
- **Тесты:** `tests/contracts`, `tests/e2e`, `tests/fuzz`, `tests/memory` проходят без изменения самих проверок. Менять разрешено только харнесс, если поменялся способ собрать движок внутри теста; каждое такое изменение описать в отчёте.
- **Раскладка по доменам и слоям** (как в базе, разд. 2 и 4 `specs/01-demo-skeleton.md`):
  - `entities/<домен>/model` — внутреннее поведение домена: срез, его команды и обработчики, реакции на факты сервисов (`transport.*`, `platform.*`, `session.*`). Сущность вызывает только команды своего домена и не подписывается на факты и команды других доменов;
  - `features/<поведение>/model` — пользовательские действия, процессы через несколько доменов и внешние подписки: на доменные факты других доменов и на исходы чужих команд. Фича может вызывать команды любых доменов. Сервисные факты фича слушает только по явному списку (исключение — `features/recovery`, `transport.session.*`);
  - в реакциях нет логики и состояния; связи между доменами — только в `features`.
  Средство подписки в ветке меняется (`ctx.on`, `ctx.from`, `sample`), раскладка — нет.
- **Ограничения:** FSD без страниц и правила границ; запрет любого persist; маскирование текстов и токенов в логах, событиях и DevTools; одна лента DevTools на инстанс, только для чтения; несколько инстансов на странице и многократное монтирование без утечек.
- **Поведение:** все сквозные сценарии `specs/01-demo-skeleton.md` разд. 7 и критерии разд. 9.

## 2. Контрольная фича (одинаковая во всех ветках)

Нужна, чтобы сравнить логику со временем и несколькими событиями — именно там библиотеки отличаются сильнее всего.

- **Сущность `banner`:** срез `{ visible: Partial<Record<'connection' | 'delivery', true>> }`, действия `show(kind)` и `hide(kind)`; `entities/banner/ui` — плашка над лентой.
- **Фича `connection-banner`:** если соединение находится в `reconnecting` или `disconnected` 3 секунды подряд, показать баннер `connection`; при `connected` скрыть сразу. Короткий обрыв меньше 3 секунд баннер не показывает.
- **Фича `delivery-banner`:** если за скользящие 60 секунд случилось 3 и более `message.failed`, показать баннер `delivery`; скрыть после `message.sent` или `session.restored`.
- **Тесты** на виртуальном времени (фейковые таймеры или средство библиотеки): короткий обрыв без баннера; длинный обрыв с баннером; восстановление скрывает; 2 неудачи за минуту — нет баннера, 3 — есть, 3 за 61 секунду — нет; `dispose` во время ожидания 3 секунд — без срабатывания.

**Базовая реализация** делается в `main` по этапу 5 `specs/02-main-alignment.md`: срез `banner`, сценарии с `d.timers`, модули `domain.ts`, состояние окна неудач — в срезе. Это базовая линия для сравнения; в ветке фича переписывается средствами ветки.

## 3. Метрики и отчёт

Результат ветки — работающий код и отчёт `reports/<имя-ветки>.md` по шаблону ниже. Метрики `main` уже сняты на этапе 6 `specs/02-main-alignment.md`; в ветке снять те же метрики и сравнить с ними.

1. **Объём кода** (`cloc`, без тестов и UI) по группам: `app/engine` + `shared/engine` + `shared/lib`; `features/recovery`; `features/send-message`; `features/flush-outbox`; контрольная фича (сущность + две фичи). Для каждой группы — «main → ветка».
2. **Тесты:** все существующие зелёные; fuzz — 300 прогонов, число нарушений (должно быть 0); новые тесты ветки — перечислить.
3. **Вес:** `size-limit` для `web` и `webview`, gzip, прирост к `main` в КБ.
4. **Время запуска:** Playwright, Chromium, троттлинг CPU ×4 через CDP (`Emulation.setCPUThrottlingRate`), страница демо в режиме webview: время от вызова `mount` до первого кадра виджета и до статуса сессии `ready`; медиана и p90 из 20 прогонов.
5. **Память:** тест утечек — проходит или нет; размер кучи после GC до и после 500 циклов.
6. **Отмена:** число ручных проверок отмены в сценариях (`grep -c` по `assertEpoch|signal.aborted|d.step` или их аналогам в ветке); случаи устаревших данных в fuzz (должно быть 0).
7. **Качество кода:** сводка `npm run quality` по всем метрикам раздела 8.6 (приведения, сложность, размер, дублирование, циклы, мёртвый код, покрытие, отключения правил) и diff с `main`. Пороги обязательны и для ветки; исключения — только из раздела 8.8.
8. **DevTools:** цепочка рестарта из критерия 7 `specs/01-demo-skeleton.md` видна в ленте — да или нет, что пришлось сделать для этого.
9. **Наблюдения:** ловушки, на которые наткнулись; что пришлось писать самим поверх библиотеки; что стало проще и что сложнее по сравнению с `main` — конкретно, с ссылками на файлы.

## 4. Общие правила

- Ветка создаётся от `main` после выполнения `specs/02-main-alignment.md`. Один PR на этап; в конце этапа проходят `npm run lint`, `npm run typecheck`, `npm test`.
- Новые зависимости — только перечисленные в этом ТЗ. Версию зафиксировать точно (без `^`) и указать в отчёте.
- Не трогать файлы вне перечисленных в разделе изменений без описания причины в PR.
- Не оптимизировать `main` и другие ветки по ходу работы: если найдена проблема базы — описать в отчёте.
- Требования к коду — раздел 8: тот же конфиг ESLint и пороги, что в `main`, плюс исключение ветки из 8.8.
- Идентификаторы и код — по-английски; комментарии, README и отчёт — по-русски.

## 5. Изменения

### 5.1. Зависимости

`effect` 4.x (точная версия в `package.json` и отчёте). Пакет для тестов на Vitest из экосистемы Effect — если для v4 есть стабильная версия; иначе тесты через запуск эффектов с тестовыми слоями. Импорт `effect` разрешён в: `app/engine/`, `shared/engine/`, `shared/lib/`, `entities/*/model/`, `features/*/model/`. В UI, хуках, `shared/api` (порты, адаптеры, каналы) и `shared/ui-kit` — запрещён.

### 5.2. Что переходит на Effect, что остаётся

- **Переходит:** все сценарии, канал команд, сборка зависимостей, таймеры, повторы, таймауты.
- **Остаётся без изменений:** Zustand-стор и срезы, хуки и UI, шина `Bus` на nanoevents, модули доменов и их реакции (`ctx.on`, `ctx.onCommand`), порты и транспорт на промисах, машина состояний сессии, плагины, DevTools-лента.

Граница двух миров — в двух местах: канал команд запускает эффекты сценариев (5.5), сценарии вызывают промисные порты через обёртку с прерыванием (5.4).

### 5.3. Сервисы и слои вместо `Deps`

Каждый член `Deps` становится сервисом. Сервисы объявляются на уровне модуля (это неизменяемые описания); значения создаются на инстанс.

```ts
// shared/engine/services.ts (имена API — v4, сверить с документацией)
export class StoreService extends Context.Service<StoreService, { getState(): ChatState }>()('sc/Store') {}
export class TransportService extends Context.Service<TransportService, Transport>()('sc/Transport') {}
export class SessionService extends Context.Service<SessionService, SessionApi>()('sc/Session') {}
export class EventsService extends Context.Service<EventsService, Deps['events']>()('sc/Events') {}
// PlatformService, PublicEventsService, LoggerService, ClockService, IdsService — так же
```

```ts
// app/engine/create-engine.ts
const layer = Layer.mergeAll(
  Layer.succeed(StoreService, { getState: store.getState }),
  Layer.succeed(TransportService, transport),
  Layer.succeed(SessionService, session),
  // …
);
const runtime = makeRuntime(layer);   // среда выполнения на инстанс (в v4 — актуальный аналог ManagedRuntime)
// dispose: await runtime.dispose() — прерывает все файберы инстанса, закрывает области ресурсов
```

- Время (`ClockService`) — через сервис часов Effect, чтобы в тестах работало виртуальное время.
- `d.timers`, `d.step`, `d.signal` из сценариев убираются: их роль выполняют `Effect.sleep`, прерывание и обёртка портов.
- Среда выполнения создаётся только в `createEngine`; глобальной среды на уровне модуля нет.

### 5.4. Ошибки и вызов портов

```ts
// shared/engine/errors.ts
export class AbortedByRestart extends Data.TaggedError('AbortedByRestart')<{ epoch: number }> {}
export class TransportFailure extends Data.TaggedError('TransportFailure')<{ code: TransportErrorCode; retryable: boolean }> {}
export class AckTimeout extends Data.TaggedError('AckTimeout')<{ clientMessageId: ClientMessageId }> {}

// shared/lib/effect/port.ts — промисный порт → эффект с прерыванием
export const fromPort = <A>(fn: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: (signal) => fn(signal),                 // при прерывании файбера signal срабатывает — запрос прерывается
    catch: (e) => toTaggedError(e),              // TransportError → TransportFailure | AbortedByRestart
  });
```

- Ожидаемые неудачи — в канале ошибок с тегом; результат-объединение `{ ok, … }` из базы не используется.
- Проверка epoch остаётся там, где поколение может смениться извне (рестарт от хоста): `SessionService.assertEpoch` как эффект, падающий `AbortedByRestart`.
- Факт `command.failed` получает `code` = тег ошибки; `command.done` — значение успеха.

### 5.5. Канал команд на файберах

Внешний контракт канала (`dispatch` → `void`, `ctx.handle`, описатели политик, факты `command.*`, `cause`, хуки DevTools) не меняется. Внутри:

- **Запуск:** `dispatch` ставит вызов в очередь канала; канал запускает эффект сценария в среде инстанса как отдельный файбер (`runtime.runFork(...)` или аналог v4), с зависимостями из слоя.
- **`parallel`:** каждый вызов — свой файбер.
- **`latest`:** у слота (тип + ключ) хранится текущий файбер; новый вызов прерывает предыдущий (`Fiber.interrupt`) и запускает свой. Исход прерванного — `superseded`.
- **`leading`:** если в слоте есть живой файбер, новый вызов не запускается; исход — `deduplicated`.
- **`queue`:** семафор на один разрешённый вызов на слот; вызовы ждут по очереди.
- **Исходы:** успех → `command.done`; ошибка с тегом → `command.failed`; прерывание → `superseded` (или тишина при `stop`/`dispose`). Определяются по `Exit` файбера.
- **`stop`:** прерывает все файберы канала; `dispose` — уничтожает среду инстанса.
- Состояние слотов — изменяемые структуры внутри канала инстанса (или `Ref` в среде); на уровне модуля ничего.

### 5.6. Сценарии на Effect

Все сценарии из `specs/01-demo-skeleton.md` 5.4 переписываются в стиль `Effect.gen`. Генераторы в этой ветке разрешены — это основной синтаксис Effect.

```ts
// features/recovery/model/restart.ts
export const restart = (p: { reason: InvalidationReason }) =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const transport = yield* TransportService;
    const store = yield* StoreService;
    const events = yield* EventsService;

    const started = session.begin('restart');
    if (!started) return;
    const { epoch } = started;
    store.getState().sessionActions.setStatus('restarting');

    yield* Effect.gen(function* () {
      yield* fromPort((signal) => transport.restart({ epoch }, { signal })).pipe(
        Effect.retry(Schedule.exponential('500 millis').pipe(Schedule.compose(Schedule.recurs(3)))),
      );
      yield* restore({ epoch });                     // прямой вызов: прерывается вместе с родителем
      session.complete(epoch);
      events.emit('session.restored', { epoch });
    }).pipe(
      Effect.catchTag('TransportFailure', (e) => Effect.sync(() => session.fail(epoch, e.code))),
    );
  });
```

```ts
// features/send-message/model/send-message.ts — таймаут ack
yield* fromPort((signal) => transport.sendMessage(cmd, { signal })).pipe(
  Effect.timeoutFail({ duration: '15 seconds', onTimeout: () => new AckTimeout({ clientMessageId }) }),
);
```

- Типы ошибок и требований сценария видны в его сигнатуре `Effect<A, E, R>`; `R` — только сервисы, которые сценарий использует.
- Мутации стора — синхронные вызовы действий срезов внутри `Effect.sync` или прямо в генераторе (они синхронные и не бросают ожидаемых ошибок).
- `declare module` для `ActionMap` и объекты команд `defineCommand` из `main` (`specs/02-main-alignment.md` разд. 2.2) сохраняются: тип команды — функция `(payload) => Effect<…>`, `defineCommand('recovery/restart', restart)` связывает тип и эффект; `ctx.handle(takeLeading(restartCommand))`, `useCommand(command)` в хуках и `ctx.onCommand(command, …)` не меняются. `PayloadOf` и `ResultOf` в `shared/engine/registry.ts` адаптируются под эффект (результат — тип успеха `A`).
- Вызов `Effect.runPromise`, `runSync` и аналогов внутри сценариев запрещён; запуск — только каналом команд.

### 5.7. Контрольная фича на Effect

- `connection-banner`: команда `banner/connectionWatch` с политикой `latest`: при не-`connected` — `Effect.sleep('3 seconds')`, затем `banner/show`; при `connected` — `banner/hide` сразу. Новое состояние соединения прерывает ожидание предыдущего.
- `delivery-banner`: окно неудач — в срезе `banner` (как в базе) или в `Ref` сервиса фичи; решение — чистая функция; таймер — `Effect.sleep`.
- Тесты — на виртуальном времени Effect (`TestClock` или аналог v4).

### 5.8. DevTools и трассировка

Лента DevTools (факты, команды с исходами, действия срезов) сохраняется через те же хуки. Дополнительно: спаны Effect (`Effect.withSpan` на сценариях) выводятся в User Timing через собственный минимальный трассировщик; в ленту не пишутся.

## 6. Этапы

### Этап 1. Сервисы, слои, среда инстанса
- `shared/engine/services.ts`, `shared/engine/errors.ts`, `shared/lib/effect/port.ts`; среда на инстанс в `createEngine`, уничтожение в `dispose`.
- Проверки: тест «создать движок, запустить простой эффект, уничтожить» — все файберы прерваны; тест утечек (500 циклов) зелёный.

### Этап 2. Канал команд
- Переписать `app/engine/commands.ts` по 5.5.
- Проверки: существующие тесты политик и исходов без изменений по смыслу; тесты прерывания на `latest` (запрос предыдущего вызова прерван через `signal` — проверяется на фейковом бэкенде).

### Этап 3. Сценарии
- Переписать все сценарии по 5.6; убрать `d.step`, `d.timers`, `d.signal` из зависимостей.
- Проверки: `tests/scenarios`, `tests/fuzz` (300 прогонов), `tests/memory` — зелёные; типы ошибок каждого сценария перечислены в его сигнатуре; число ручных проверок отмены — только `assertEpoch` там, где поколение меняется извне.

### Этап 4. Контрольная фича
- По 5.7.
- Проверки: тесты раздела 2 на виртуальном времени Effect.

### Этап 5. Метрики и отчёт
- Снять метрики раздела 3 в ветке и в `main`, написать `reports/exp-effect.md`. Отдельно в наблюдениях: какие конструкции Effect понадобились (сервисы, слои, `Schedule`, файберы, семафоры, `Ref`), какие оказались лишними, где v4 разошёлся с документацией и примерами v3.

## 7. Чего не делать

- Не переносить на Effect порты, адаптеры, каналы сети и моста, стор, хуки и UI — граница проходит по 5.2.
- Не использовать модули `effect/unstable/*`.
- Не создавать среду выполнения или слои с изменяемым состоянием на уровне модуля.
- Не запускать эффекты внутри сценариев (`runPromise`, `runSync`, `runFork`); не смешивать `async/await` и `Effect.gen` в одном сценарии.
- Не заменять шину на `PubSub` и не переносить реакции модулей доменов в Effect — это вне цели ветки.
- Не добавлять сторонние пакеты экосистемы Effect, кроме тестового.

## 8. Требования к качеству кода

Принцип: правило, которое можно проверить машиной, проверяется машиной (ESLint, `tsc`, скрипты в CI); остальное — чеклистом ревью. Пороги — блокирующие для CI.

### 8.1. Цель

Код должен читаться middle-разработчиком без автора: один файл — одна роль, одна функция — один уровень абстракции, типы выражают намерение и не обходятся приведениями. Сложность допускается только в нескольких местах ядра (`shared/engine`, канал команд, каналы транспорта), и там она покрыта тестами и комментариями.

### 8.2. Приведения типов и небезопасные конструкции

**Норма — ноль приведений в прикладном коде.** Вместо приведений — сужение типов (type guards, `in`, дискриминированные объединения), разбор схемами valibot на границах, `satisfies`, явные аннотации.

Разрешено:
- `as const`;
- `satisfies`;
- приведения в списке разрешённых файлов (белый список ниже) — каждое с комментарием «почему без него нельзя»;
- приведения в тестах (`*.test.ts`, `tests/`).

Белый список:
- `app/engine/commands.ts` — один вызов `run` с типом, восстановленным из реестра;
- `shared/lib/brand.ts` — конструкторы брендированных типов после проверки;
- `shared/engine/domain.ts` — передача контекста модулю (`setup(ctx)`), если без него не выражается связь generic-параметров.

Запрещено везде, кроме тестов:
- `any` (явный и неявный), `as unknown as`, `!` (non-null assertion);
- `@ts-ignore`, `@ts-nocheck`; `@ts-expect-error` — только в тестах типов, с описанием;
- `Function`, `Object`, `{}` как тип; `object` без уточнения;
- небезопасные операции с `any` из внешних библиотек (`no-unsafe-*`) — оборачивать в типизированные адаптеры.

Настройки `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`.

### 8.3. SOLID в нашей архитектуре

Принципы переведены в проверяемые правила. Абстрактное «следовать SOLID» на ревью не принимается — только ссылки на пункты ниже.

**S — одна причина для изменения.**
- Один файл — одна роль: срез, сценарий, `domain.ts`, адаптер, канал, компонент, хук. Файл `model/<сценарий>.ts` экспортирует один сценарий и его `declare module`.
- Сценарий — один процесс; если в нём больше одного «и потом» на разных доменах, это процесс в `features` с прямыми вызовами шагов, каждый шаг — отдельная функция.
- Реакция — одна строка без логики (подписка → `dispatch`).
- Компонент — отображение; данные и действия — из хуков.
- Пороги длины и сложности (8.5) — машинная проверка этого принципа.

**O — расширение без правки чужого кода.**
- Новый домен или фича добавляется новым слайсом: `model/` + `domain.ts` + `index.ts` и одной строкой в списке модулей. Правка файлов других доменов при добавлении — признак нарушения.
- Реестры типов расширяются через `declare module`, а не правкой центрального типа.
- Новый тип сообщения — новый рендерер в карте `satisfies`, без `switch` по типам в компонентах.

**L — заменяемые реализации.**
- Все реализации порта (`BackendProtocolAdapter`, `BridgeProtocolAdapter`, `MockAdapter`) проходят один набор контрактных тестов; реализация, которой нужна проверка «если это web, то…» у потребителя, нарушает принцип.
- Фейки в тестах реализуют тот же интерфейс, что и боевые зависимости.

**I — узкие интерфейсы.**
- Сценарий объявляет зависимости как `Pick<Deps, …>`; аннотация параметра полным `Deps` запрещена правилом линтера.
- Порты разделены (`ThreadsPort`, `HistoryPort`, `MessagingPort`, …); хуки возвращают только то, что нужно компоненту.

**D — зависимость от абстракций.**
- Сценарии, модули доменов и хуки импортируют только порты и типы из `shared/api/*/port.ts`, `shared/engine`, `shared/contracts`; реализации (`network/`, `bridge/`, `mock/`) — только `app/entries` (Composition Root). Проверяется `eslint-plugin-boundaries`.
- Время, id, таймеры — через зависимости (`clock`, `ids`, `timers`), не через глобальные функции.

### 8.4. Удобочитаемость

- **Имена:** функции — глаголы (`sendMessage`, `mergeHistoryPage`); булевы — `is/has/can/should`; команды — `домен/глагол`; факты — `домен.сущность.прошедшее_время`; файлы — `kebab-case`; типы — `PascalCase`; константы-настройки — `UPPER_SNAKE_CASE` с единицей в имени (`ACK_TIMEOUT_MS`).
- **Числа:** таймауты, лимиты, размеры страниц — именованные константы рядом с местом использования или в конфиге; «магические» числа в логике запрещены (кроме `0`, `1`, `-1`).
- **Поток управления:** ранний выход вместо вложенных `if`; без вложенных тернарных операторов; `switch` по дискриминанту — с проверкой исчерпанности (`never`).
- **Функции:** не больше двух параметров (сценарий — `(deps, payload)`); больше — объект; без флагов-булевых параметров, меняющих поведение.
- **Сложные типы** (условные, сопоставленные, `infer`) — только в `shared/engine` и `shared/contracts`, у каждого — JSDoc с примером и тест типов.
- **Комментарии** объясняют «почему», а не «что». У экспорта `app/entries` и `shared/engine` — JSDoc.
- **Импорты:** упорядочены автоматически; без циклов; только именованные экспорты.
- **Шаблоны:** сценарий, `domain.ts`, срез, хук — по шаблонам из README; генератор шаблонов (`npm run gen:feature`, `gen:entity`).

Пример ожидаемого стиля сценария:

```ts
const ACK_TIMEOUT_MS = 15_000;

/** Отправляет сообщение; без соединения оставляет его в outbox. */
export async function sendMessage(
  d: Pick<Deps, 'store' | 'transport' | 'ids' | 'events' | 'timers' | 'signal'>,
  p: { threadId: ThreadId; text: string },
): Promise<SendResult> {
  const clientMessageId = d.ids.clientMessageId();
  d.store.getState().messagesActions.addPending({ ...p, clientMessageId });

  const ack = await waitForAck(d, { ...p, clientMessageId }, ACK_TIMEOUT_MS);
  if (!ack.ok) return markFailed(d, clientMessageId, ack.code);

  d.store.getState().messagesActions.ack(ack.value);
  d.events.emit('message.sent', { threadId: p.threadId, clientMessageId });
  return { ok: true, clientMessageId };
}
```

### 8.5. ESLint

Flat config, один для `main` и веток; ветки только добавляют исключения из 8.8.

Пакеты: `typescript-eslint` (наборы `strictTypeChecked` и `stylisticTypeChecked`), `eslint-plugin-sonarjs`, `eslint-plugin-unicorn` (выборочно), `eslint-plugin-import-x`, `eslint-plugin-boundaries`, `eslint-plugin-react-hooks`, `@eslint-community/eslint-plugin-eslint-comments`, `eslint-plugin-jsdoc` (выборочно). Steiger — отдельной командой.

```ts
// eslint.config.ts (фрагмент; полный список правил — в репозитории)
export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      // приведения и небезопасное
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],   // as const и satisfies остаются разрешены — проверить на версии плагина
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // сложность и размер
      complexity: ['error', 8],
      'sonarjs/cognitive-complexity': ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 2],
      'max-nested-callbacks': ['error', 3],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
      'no-nested-ternary': 'error',
      'sonarjs/no-identical-functions': 'error',

      // имена, файлы, импорты
      '@typescript-eslint/naming-convention': ['error', /* булевы is|has|can|should; типы PascalCase; константы UPPER_SNAKE_CASE */],
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      'import-x/no-default-export': 'error',
      'import-x/no-cycle': 'error',
      'import-x/order': ['error', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
      '@typescript-eslint/no-magic-numbers': ['error', { ignore: [0, 1, -1], ignoreEnums: true, ignoreTypeIndexes: true }],

      // отключения правил — только с причиной
      '@eslint-community/eslint-comments/require-description': 'error',
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',

      // архитектурные запреты
      'no-restricted-syntax': ['error',
        { selector: "Program > VariableDeclaration[kind='let']", message: 'Изменяемое состояние на уровне модуля запрещено' },
        { selector: "CallExpression[callee.name=/^(setTimeout|setInterval)$/]", message: 'Только через d.timers' },
        { selector: "TSTypeAnnotation > TSTypeReference[typeName.name='Deps']", message: 'Зависимости сценария — Pick<Deps, …>' },
      ],
    },
  },
  { files: ['shared/lib/timers.ts'], rules: { 'no-restricted-syntax': 'off' } },
  { files: ['app/engine/commands.ts', 'shared/lib/brand.ts', 'shared/engine/domain.ts'], rules: { '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'as' }] } },
  { files: ['**/*.test.ts', 'tests/**'], rules: { /* приведения, магические числа и длина функций — допускаются */ } },
  { files: ['**/ui/**/*.tsx', 'widgets/**/*.tsx'], rules: { 'max-lines': ['error', { max: 150 }] } },
  // + boundaries (слои FSD, реализации портов только в app/entries), react-hooks, jsdoc для app/entries и shared/engine
);
```

Запуск: `eslint . --max-warnings 0`. Предупреждений нет — правило либо ошибка, либо выключено.

### 8.6. Метрики и пороги CI

Команда `npm run quality` запускает всё ниже и пишет сводку в `reports/quality.json`; в PR выводится diff сводки с `main`.

1. **Линтер:** 0 ошибок, 0 предупреждений.
2. **Типы:** `tsc --noEmit` без ошибок; `type-coverage --strict` — не ниже 99 %.
3. **Приведения:** скрипт `scripts/count-casts.ts` (TypeScript Compiler API) считает `as` (кроме `as const`), `<T>x`, `!`, `any`, `@ts-expect-error` вне тестов. Порог: 0 вне белого списка; в белом списке — не больше числа, указанного в 8.2. Отчёт — по файлам.
4. **Сложность:** цикломатическая ≤ 8 и когнитивная ≤ 10 на функцию (правила ESLint); дополнительно в сводке — максимум и 95-й перцентиль по проекту.
5. **Размер:** функция ≤ 40 строк, файл ≤ 250 (UI ≤ 150), параметров ≤ 2; в сводке — максимум и 95-й перцентиль.
6. **Дублирование:** `jscpd` — не более 3 % (минимум 10 строк / 50 токенов на фрагмент).
7. **Циклы зависимостей:** 0 (`import-x/no-cycle`; дополнительно `madge --circular` в CI).
8. **Мёртвый код:** `knip` — 0 неиспользуемых файлов, экспортов и зависимостей.
9. **Покрытие тестами** (Vitest, v8): `shared/lib` и мутаторы — ≥ 90 % строк и ветвей; сценарии и `domain.ts` — ≥ 85 %; проект — ≥ 80 %.
10. **Отключения правил:** каждое `eslint-disable` — с причиной; общее число в `src/` — не больше 5, список — в сводке.
11. **Публичный API:** отчёт api-extractor без незапланированных изменений.

### 8.7. Чеклист ревью (то, что машина не проверит)

- Имя функции, файла, команды и факта понятно без чтения тела.
- Функция работает на одном уровне абстракции: шаги процесса — вызовы функций с говорящими именами, а не перемешанные детали.
- Нет «умных» конструкций там, где хватает простых (generic-магия, цепочки `reduce`, неочевидные операторы).
- Ошибки обрабатываются там, где есть что с ними делать; ожидаемые исходы — результатом, а не исключением.
- Новая связь между доменами видна в `routes:map` и лежит в `features`.
- Тест описывает поведение («повторный рестарт во время текущего отбрасывается»), а не реализацию.

Командный критерий (не для агента): middle, не писавший код, за 15 минут чтения объясняет поток рестарта и добавляет реакцию в новую фичу по README — замеряется на `main` и в каждой ветке.

### 8.8. Исключения ветки

Ветка использует тот же конфиг, что `main`; допустимо только исключение ниже — в `eslint.config.ts` ветки с комментарием.

- **`exp/effect`:** генераторы `Effect.gen` разрешены; классы — только для объявления сервисов и ошибок с тегами (`Context.Service`, `Data.TaggedError`); `explicit-module-boundary-types` для сценариев — тип `Effect<A, E, R>` обязателен.

Метрики 8.6 входят в отчёт ветки (раздел 3, пункт 7).
