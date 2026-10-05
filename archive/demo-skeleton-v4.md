# ТЗ: демо-приложение sc-sdk (ходячий скелет)

> Версия 4 от 05.10.2026. Исполнитель — GigaCode (агент), ревью — архитектор и тимлид.
> Документ самодостаточен: всё, что нужно для работы, включая контракт транспорта, находится в этом файле. Внешние документы читать не требуется.
> Порядок работы: агент получает весь файл и номер этапа из раздела 8. Следующий этап — только после прохождения проверок предыдущего.
> Допущения о бэкенде и мобильном мосте помечены как **[Д1]…[Д8]** и перечислены в разделе 11.

## 0. Контекст продукта

- **sc-sdk** — SDK чата, встраиваемый в продукты двух видов:
  - **web** — React-библиотека внутри web-хоста (React в `peerDependencies`). SDK сам работает с бэкендом по HTTP + WebSocket и защищает запросы DPoP;
  - **webview** — статическая сборка внутри мобильного приложения (React в бандле, точка входа `mount()`). SDK в сеть не ходит: мобильное приложение («хост») держит соединение с бэкендом, а SDK вызывает у него доменные операции через мост JSON-RPC 2.0 (режим relay). Опции инициализации тоже приходят через мост.
- Поставка: готовый виджет `<Chat />` и конструктор (компоненты + хуки).
- **DPoP (RFC 9449)** — каждый HTTP-запрос и подключение WS подписываются proof-JWT ключом клиента; в proof входит одноразовое значение `nonce`, выданное сервером. Значение расходуется одним запросом, поэтому запросы, тратящие nonce, нельзя выполнять параллельно: нужна одна последовательная очередь. Кадры по уже открытому WS proof не требуют.
- **Epoch** — номер поколения сессии, растёт при каждом старте и рестарте. Всё асинхронное помечается epoch; результаты и события старого поколения отбрасываются. Отмена (`AbortController`) останавливает то, что можно остановить; epoch отбрасывает то, что остановить не успели.
- Два уровня восстановления: **переподключение** (WS с теми же учётными данными, делает канал) и **рестарт** (новые токены и соединение, повторная загрузка данных, переотправка неподтверждённых сообщений). При рестарте клиентский стор не очищается — данные сливаются по id.
- Команда сопровождения: 4 человека (архитектор, тимлид, 2 middle). Решения в коде должны быть простыми и однотипными.

## 1. Цель и границы

Собрать минимальный, но архитектурно полный SDK чата и демо-страницу к нему, чтобы проверить гипотезы:

1. FSD без страниц и правила границ работают, включая `@x` и модули доменов по слоям.
2. Канал команд + сценарии `(deps, payload)` + описатели политик + реестры типов не дают лишнего шаблонного кода и сохраняют типизацию.
3. Один Zustand-стор на инстанс не вызывает лишних перерисовок.
4. Единая очередь DPoP исключает гонки за nonce.
5. Машина состояний сессии, epoch, `signal` и политики переживают обрывы и рестарты без ручных ошибок отмены.
6. Общий `Transport` над двумя адаптерами (web и webview) взаимозаменяем.
7. DevTools и логи отвечают на вопрос «почему не ушло сообщение».

**Входит:** одна ветка; текстовые сообщения; отправка, приём, история с подгрузкой вверх; статусы `pending / sent / failed` и ручной повтор; переподключение и полный рестарт; оба режима (web и webview); лента с разделителями по дням и виртуализацией; `ChatProvider`, хуки, виджет `<Chat />`; плагины logging, telemetry, devtools, debug-panel; фейковый бэкенд в памяти; демо-страница с панелью хаоса.

**Не входит:** файлы и Platform.pickFiles (вторая итерация, но порт `Platform` создаётся); несколько веток в UI; баннер; удалённый конфиг; реальный бэкенд и реальный мост; дизайн и темы; SSR; публикация пакета.

## 2. Архитектурные решения (обязательны)

1. **Канал команд.** UI и подписки вызывают `dispatch(type, payload)`; он ничего не возвращает и ставит команду в канал. Канал держит реестр «ровно один обработчик на команду», исполняет политику обработчика, даёт вызову свои зависимости (`signal`, `cause`) и публикует факты `command.started` / `command.done` / `command.failed`. Результат для UI — в сторе.
2. **Сценарий — обычная функция `(deps, payload)`.** Без функций высшего порядка, классов и генераторов. Доступ к стору (только через `getState().<действие среза>`), сессии, транспорту, платформе, `dispatch`, `events`, таймерам, логгеру.
3. **Последовательность — прямым вызовом.** Шаг процесса, который должен завершиться до следующего, — `await` функции другого сценария. `d.dispatch` только запускает независимую работу в другом домене и не ждёт её.
4. **Мутации стора — только именованные действия срезов.** Сценарий не вызывает `setState`; в `Deps` стор виден как `{ getState(): ChatState }`.
5. **Реестры типов через declaration merging.** В `shared/engine` объявлены пустые `ChatState`, `ActionMap`, `DomainEventMap`; сущности и фичи дописывают свои срезы, сценарии и доменные факты через `declare module`.
6. **Модули доменов.** Каждый слайс с поведением экспортирует модуль из `model/domain.ts`: `defineEntity(domain, setup)` или `defineFeature(name, opts, setup)`. В `setup(ctx)` модуль регистрирует обработчики команд (`ctx.handle`), подписки на факты (`ctx.on`) и на исходы чужих команд (`ctx.onCommand`). Всё снимается `teardown`. Центрального реестра сценариев и отдельных файлов маршрутов нет.
7. **Слои подписок.** Сущность регистрирует только свои команды и слушает только факты сервисов. Фича регистрирует свои команды, слушает доменные факты и исходы команд, вызывает любые команды; сервисные факты — только из явного списка `serviceFacts` (исключение — `features/recovery`). В реакциях нет логики и состояния.
8. **Политики — описатели:** `takeEvery` (по умолчанию), `takeLatest`, `takeLeading`, `takeQueued`, `silent`. Описатель — данные без состояния; исполняет политику канал команд.
9. **Шина** — наш интерфейс `Bus` (`emit`, `on`, `onAny`, `dispose`) на nanoevents с изоляцией ошибок. Факты сервисов, доменные факты и факты команд — в `internal`; стабильная проекция — в `public`.
10. **Транспорт в три слоя:** `Transport` (общий: жизненный цикл, epoch, `signal`, таймауты, ошибки, capabilities, публикация фактов) → адаптер чужого протокола (`BackendProtocolAdapter` / `BridgeProtocolAdapter`) → канал (`NetworkChannel` / `BridgeChannel`). Все операции принимают `signal`.
11. **Контракт моста публикует мобильная поверхность** (один, согласованный). Наши схемы моста — копия этого контракта, `BridgeProtocolAdapter` переводит его в наш порт **[Д7]**.
12. **DI без контейнера.** `createEngine(options)` собирает зависимости вручную на каждый инстанс; на уровне модуля нет изменяемого состояния. `ChatProvider` кладёт ссылку на движок в контекст. `stop()` — обратимо (StrictMode), `dispose()` — окончательно.
13. **DevTools — свой плагин с одной лентой на инстанс** (факты, команды с исходами, действия срезов), только для чтения. Middleware `devtools` Zustand не используется.

## 3. Стек и ограничения

- React 18, Zustand 5 (`zustand/vanilla` + контекст), nanoevents (эмиттер шины), styled-components 6 (только `shared/ui-kit` и `*/ui`), TypeScript 5 `strict`, valibot, Vite, Vitest (+ happy-dom), Playwright (Chromium и WebKit), MSW 2.x (HTTP и WebSocket), `@tanstack/react-virtual`, ESLint 9 + `eslint-plugin-boundaries`, Steiger, size-limit.
- Другие зависимости — только с обоснованием в PR. Запрещены: Redux/RTK, RxJS, MobX, xstate, DI-контейнеры, lodash, moment/dayjs, axios, reselect.
- **Запрещён любой persist**: `localStorage`, `sessionStorage`, IndexedDB, cookies, Cache API.
- **В логах, событиях и телеметрии нет текстов сообщений и токенов**; логгер маскирует поля `text`, `token`, `accessToken`, `refreshToken`, `dpop`, `authorization`.
- Код: именованные экспорты, без `default`; без `any` и `as unknown as` (исключение — вызов `run` в канале команд, разд. 5.4); фабрики вместо классов (исключение — `TransportError`); время и id — через `Clock` и `Ids` из зависимостей, не `Date.now()` и `crypto.randomUUID()` напрямую в логике.
- Идентификаторы и код — по-английски; комментарии и README — по-русски.

## 4. Структура репозитория

```
sc-sdk-skeleton/
├─ src/
│  ├─ app/
│  │  ├─ engine/
│  │  │  ├─ create-engine.ts       сборка Deps, стора, шины, канала команд, сессии, транспорта; установка модулей и плагинов
│  │  │  ├─ store.ts               createChatStore: композиция срезов
│  │  │  ├─ commands.ts            канал команд: реестр, политики, cause, факты command.*, хуки для DevTools
│  │  │  ├─ modules.ts             список модулей из index.ts слайсов, installModule, проверка полноты, routes:map
│  │  │  ├─ session.ts             машина состояний сессии (без IO)
│  │  │  └─ plugins.ts             запуск плагинов, изоляция ошибок
│  │  ├─ plugins/                  logging/, telemetry/, devtools/, debug-panel/
│  │  ├─ providers/                ChatProvider.tsx
│  │  └─ entries/                  web.ts, webview.ts — Composition Root и публичный экспорт
│  ├─ widgets/
│  │  ├─ feed/                     лента: виртуализация, разделители, подгрузка вверх
│  │  ├─ composer/                 поле ввода и кнопка отправки
│  │  └─ chat/                     виджет по умолчанию = статус + feed + composer
│  ├─ features/                    ← каждая: model/<сценарий>.ts (+ declare module), model/domain.ts, ui/, index.ts
│  │  ├─ lifecycle/                lifecycle/start, lifecycle/stop
│  │  ├─ recovery/                 recovery/restart, recovery/hostRestarted, restore; serviceFacts: transport.session.*
│  │  ├─ open-thread/              thread/open
│  │  ├─ load-older/               history/loadOlder
│  │  ├─ send-message/             message/send
│  │  ├─ retry-message/            message/retry
│  │  ├─ flush-outbox/             outbox/flush; session.connected → outbox/flush
│  │  └─ composer-clear/           только domain.ts: message/send started → composer/clear
│  ├─ entities/
│  │  ├─ session/                  model/ (срез статуса, сценарии connectionChanged и resumed, domain.ts), ui/ (плашка)
│  │  ├─ thread/                   model/ (срез веток, активная ветка)
│  │  ├─ message/                  model/ (срез, мутаторы, селекторы, buildFeed, статус-FSM, сценарии receive и ack, domain.ts), ui/, @x/
│  │  └─ composer/                 model/ (черновики по веткам, сценарии setDraft и clear, domain.ts)
│  └─ shared/
│     ├─ engine/                   registry.ts, events.ts, deps.ts, bus.ts (интерфейс), domain.ts (defineEntity, defineFeature),
│     │                            policies.ts (take*, silent), slice.ts (фабрика действий срезов), context.ts, hooks.ts
│     ├─ api/
│     │  ├─ transport/             port.ts, create-transport.ts, adapter.ts, errors.ts,
│     │  │                         network/ (channel.ts, dpop.ts, queue.ts, backend-protocol-adapter.ts),
│     │  │                         bridge/ (bridge-protocol-adapter.ts), mock/ (mock-adapter.ts)
│     │  ├─ platform/              port.ts, web/, bridge/
│     │  └─ bridge-channel/        запрос-ответ и уведомления поверх BridgeLike
│     ├─ contracts/                transport.schema.ts, bridge.schema.ts (копия контракта поверхности), backend.schema.ts
│     ├─ lib/                      emitter (nanoevents + изоляция), fsm, backoff, single-flight, timers, step, memoize-last, brand, clock, ids, logger
│     └─ ui-kit/                   Button, TextArea, Stack, Spinner; тема; ничего о чате
├─ dev/
│  ├─ fake-backend/                model.ts, chaos.ts, adapters/ (msw-http.ts, ws.ts, fake-host.ts), fixtures/
│  └─ demo/                        Vite-приложение демо-страницы
├─ tests/
│  ├─ contracts/                   transport.contract.ts + прогон на 3 реализациях
│  ├─ scenarios/                   сценарии движка на фейковом бэкенде
│  ├─ fuzz/                        случайное чередование хаоса
│  ├─ memory/                      утечки при создании и удалении движка
│  └─ e2e/                         Playwright по демо-странице
└─ README.md
```

Правила границ (проверяются `eslint-plugin-boundaries` и Steiger):
- Слои импортируют только вниз: `app` → `widgets` → `features` → `entities` → `shared`. `dev/` может импортировать `src/`, обратное запрещено.
- Между слайсами одного слоя — только через `index.ts`; между сущностями — только через `@x` (например, `entities/thread/@x/message.ts`).
- `zustand` импортируется только в `app/engine`, `entities/*/model`, `shared/engine/hooks.ts` и `shared/engine/slice.ts`.
- `nanoevents` импортируется только в `shared/lib/emitter.ts`.
- `fetch`, `XMLHttpRequest`, `WebSocket` — только в `shared/api/transport/network/channel.ts`.
- `shared/api/*` не импортирует `entities`, `features`, `app`.
- Подписки на шину и `ctx.handle` — только в `model/domain.ts` слайса.
- Изменяемые переменные верхнего уровня модуля в `src/` запрещены; `setTimeout` и `setInterval` вне `shared/lib/timers.ts` запрещены.

## 5. Ключевые интерфейсы

### 5.1. Реестры типов (`shared/engine/registry.ts`)

```ts
/** Состояние стора. Каждая сущность дописывает свой срез через declare module. */
export interface ChatState {}
/** Команды. Каждый слайс дописывает свои сценарии через declare module. */
export interface ActionMap {}

export type ActionType = keyof ActionMap;
export type PayloadOf<T extends ActionType> = Parameters<ActionMap[T]>[1];
export type ResultOf<T extends ActionType> = Awaited<ReturnType<ActionMap[T]>>;
export type DispatchArgs<T extends ActionType> = PayloadOf<T> extends void | undefined ? [] : [PayloadOf<T>];
/** Ничего не возвращает: команда ставится в канал. */
export type Dispatch = <T extends ActionType>(type: T, ...args: DispatchArgs<T>) => void;
export type Domain = ActionType extends `${infer D}/${string}` ? D : never;
export type DomainAction<D extends Domain> = Extract<ActionType, `${D}/${string}`>;
```

Пример наполнения:

```ts
// entities/message/model/slice.ts
export interface MessagesSlice { messages: MessagesState; messagesActions: MessagesActions }
declare module '@/shared/engine/registry' { interface ChatState extends MessagesSlice {} }

// features/send-message/model/send-message.ts
export async function sendMessage(
  d: Pick<Deps, 'store' | 'transport' | 'ids' | 'events' | 'timers' | 'signal'>,
  p: { threadId: ThreadId; text: string },
): Promise<{ ok: true; clientMessageId: ClientMessageId } | { ok: false; code: string }> { /* … */ }
declare module '@/shared/engine/registry' { interface ActionMap { 'message/send': typeof sendMessage } }
```

Правила для сценариев: один конкретный тип payload, без перегрузок и generic; ожидаемые исходы — результатом-объединением `{ ok: true, … } | { ok: false; code }` (он попадает в факт `command.done`); исключения — только для багов и `TransportError` (факт `command.failed`).

### 5.2. Зависимости (`shared/engine/deps.ts`)

```ts
export interface Deps {
  store: { getState(): ChatState };   // только чтение и действия срезов, без setState
  session: SessionApi;                 // разд. 5.6
  transport: Transport;                // разд. 5.7
  platform: Platform;
  events: { emit<K extends keyof DomainEventMap>(type: K, e: DomainEventMap[K]): void };   // только доменные факты
  publicEvents: { emit<K extends keyof PublicEventMap>(type: K, e: PublicEventMap[K]): void };
  dispatch: Dispatch;                  // запуск независимой работы; cause = id текущей команды
  signal: AbortSignal;                 // отмена политикой takeLatest, stop или dispose
  step: <T>(p: Promise<T>) => Promise<T>;   // ожидание с проверкой signal и epoch после него
  timers: Timers;                      // setTimeout/clear, снимаются при stop и dispose
  logger: Logger;
  clock: Clock;                        // now(): number, monotonic(): number
  ids: Ids;                            // clientMessageId(), uploadId()
}
```

Сценарий объявляет только нужное: `d: Pick<Deps, …>`. `signal`, `step` и `dispatch` канал команд создаёт свои для каждого вызова. Вложенный шаг процесса — прямой вызов функции сценария с теми же `d`: он разделяет `signal` внешнего процесса и отменяется вместе с ним.

```ts
// shared/lib/step.ts
export const createStep = (signal: AbortSignal, session: SessionApi, epoch: () => number) =>
  async <T>(p: Promise<T>): Promise<T> => {
    const e = epoch();
    const v = await Promise.race([p, abortPromise(signal)]);
    session.assertEpoch(e);   // бросает TransportError('aborted_by_restart'), если поколение сменилось
    return v;
  };
```

### 5.3. Стор

- `createChatStore(deps)` в `app/engine/store.ts`: `createStore` из `zustand/vanilla` + `devtools` (только dev, `name: 'sc-sdk:store:<instanceId>'`), композиция срезов.
- Срез экспортирует `create<Name>Slice: StateCreator<ChatState, [['zustand/devtools', never]], [], <Name>Slice>`.
- Каждое действие среза синхронное: `set((s) => mutator(s, args), false, { type: 'messages/receive', … })`. Мутаторы — чистые функции рядом со срезом, тестируются таблицами.
- Срезы демо: `session` (статус для UI, причина ошибки), `threads` (список, активная), `messages` (byId, порядок по ветке, статусы, outbox), `history` (`hasNext`, `loading` по ветке), `composer` (черновики по ветке), `ui` (последняя прочитанная позиция — опционально).
- Слияние сообщений — по `id`; собственные — по `clientMessageId` (pending → sent при ack или эхо). Порядок — `createdAt`, при равенстве — `id`.
- Статус сообщения — мини-FSM: `pending → sent | failed`, `failed → pending`; прочие переходы отбрасываются и логируются.

### 5.4. Канал команд (`app/engine/commands.ts`) и политики (`shared/engine/policies.ts`)

```ts
// shared/engine/policies.ts — описатели без состояния
export type Concurrency = 'parallel' | 'latest' | 'leading' | 'queue';
export interface Policied<S extends (d: any, p: any) => unknown> {
  readonly [POLICY]: true;
  run: S;
  concurrency: Concurrency;
  key?: (p: Parameters<S>[1]) => string;
  silent?: boolean;
}
export const takeEvery   = <S extends Scenario>(s: S | Policied<S>) => wrap(s, { concurrency: 'parallel' });
export const takeLatest  = <S extends Scenario>(s: S | Policied<S>, key?: KeyOf<S>) => wrap(s, { concurrency: 'latest', key });
export const takeLeading = <S extends Scenario>(s: S | Policied<S>, key?: KeyOf<S>) => wrap(s, { concurrency: 'leading', key });
export const takeQueued  = <S extends Scenario>(s: S | Policied<S>, key?: KeyOf<S>) => wrap(s, { concurrency: 'queue', key });
export const silent      = <S extends Scenario>(s: S | Policied<S>) => wrap(s, { silent: true });
```

Регистрация в модулях (полный список демо):

```ts
ctx.handle('lifecycle/start', takeLeading(start));
ctx.handle('lifecycle/stop', takeLeading(stop));
ctx.handle('recovery/restart', takeLeading(restart));
ctx.handle('recovery/hostRestarted', takeLeading(hostRestarted));
ctx.handle('session/connectionChanged', takeQueued(connectionChanged));
ctx.handle('session/resumed', takeLeading(resumed));
ctx.handle('thread/open', takeLatest(openThread));
ctx.handle('history/loadOlder', takeLeading(loadOlder, (p) => p.threadId));
ctx.handle('message/send', sendMessage);
ctx.handle('message/retry', takeLeading(retryMessage, (p) => p.clientMessageId));
ctx.handle('message/receive', receiveMessage);
ctx.handle('message/ack', ackMessage);
ctx.handle('outbox/flush', takeQueued(flushOutbox));
ctx.handle('composer/setDraft', silent(setDraft));
ctx.handle('composer/clear', clearDraft);
```

Поведение канала:
- **Реестр:** ровно один обработчик на команду. Повторная регистрация — ошибка; `dispatch` команды без обработчика — ошибка в dev, лог в prod. При `createEngine` в dev — сверка зарегистрированных обработчиков с полным списком команд (список генерируется из `ActionMap` скриптом сборки или задаётся в тесте); расхождение — ошибка.
- **`parallel`** — каждый вызов независим.
- **`latest`** — новый вызов (по ключу, если задан) отменяет предыдущий через его `signal`; исход предыдущего — `superseded`.
- **`leading`** — пока вызов (по ключу) идёт, новые не запускаются; исход — `deduplicated`.
- **`queue`** — вызовы выполняются строго по одному в порядке поступления.
- **Факты:** `command.started` перед запуском; `command.done` с `result` (возвращаемое значение сценария) или `command.failed` с `code` после. `superseded` и `deduplicated` не публикуют `done`/`failed`, их исход виден только в DevTools.
- **`cause`:** у вызова от UI — `ui`; от реакции — id факта; от `d.dispatch` в сценарии — id текущей команды. Глубина цепочки больше 5 или повтор типа команды в одной цепочке — ошибка в dev, лог в prod.
- **Ошибка сценария** логируется, превращается в `command.failed` и не останавливает канал.
- **Хуки для DevTools:** `onCommandStart(c)`, `onCommandEnd(c, outcome, ms)`.
- **`stop` и `dispose`** отменяют все текущие вызовы через их `signal`; `dispose` дополнительно снимает реестр.
- Объём — около 80 строк с хуками; внутри нет приведения типов, кроме вызова `run`.

### 5.5. Шина и модули доменов

```ts
// shared/engine/events.ts
export interface InternalEventMap {                            // факты сервисов
  'transport.message.received': { epoch: number; message: Message };
  'transport.message.acked': { epoch: number; ack: Ack };
  'transport.connection.changed': { epoch: number; state: 'connected' | 'reconnecting' | 'disconnected' };
  'transport.session.invalidated': { epoch: number; reason: InvalidationReason };
  'transport.session.restarted': { epoch: number };          // webview
  'platform.app.resumed': {};
  'platform.app.paused': {};
  'session.status.changed': { from: SessionState; to: SessionState; epoch: number };
}
export interface DomainEventMap {}                             // факты сценариев; наполняется через declare module
// в демо: message.received, message.sent, message.failed (entities/message, features/send-message),
//         session.connected (entities/session), session.restored (features/recovery)

export type CommandFact<T extends ActionType> = { id: string; cause: string; type: T; payload: PayloadOf<T> };
export interface CommandFactMap {
  'command.started': CommandFact<ActionType>;
  'command.done': CommandFact<ActionType> & { result: unknown };   // сужается по type в ctx.onCommand
  'command.failed': CommandFact<ActionType> & { code: string };
}

export interface PublicEventMap {                              // под semver, без текстов и токенов
  'session.statusChanged': { status: SessionState };
  'message.sent': { threadId: ThreadId; clientMessageId: ClientMessageId };
  'message.received': { threadId: ThreadId; messageId: MessageId };
  'message.failed': { threadId: ThreadId; clientMessageId: ClientMessageId; code: string };
}

// shared/engine/bus.ts — наш интерфейс, реализация — shared/lib/emitter.ts (nanoevents)
type Facts = InternalEventMap & DomainEventMap & CommandFactMap;
export interface Bus {
  emit<K extends keyof Facts>(type: K, payload: Facts[K]): void;     // присваивает id
  on<K extends keyof Facts>(type: K, fn: (payload: Facts[K], meta: { id: string }) => void): () => void;
  onAny(fn: (fact: { id: string; type: keyof Facts; payload: unknown }) => void): () => void;
  dispose(): void;
}
```

```ts
// shared/engine/domain.ts
type Reaction<E> = (event: E, r: { dispatch: Dispatch; factId: string }) => void;
type Handled<T extends ActionType> = ActionMap[T] | Policied<ActionMap[T]>;

export interface EntityContext<D extends Domain> {
  handle<T extends DomainAction<D>>(type: T, run: Handled<T>): void;
  on<K extends keyof InternalEventMap>(type: K, fn: Reaction<InternalEventMap[K]>): void;   // dispatch в реакции — только DomainAction<D> (проверка в dev)
}
export interface FeatureContext<F extends Domain, S extends keyof InternalEventMap> {
  handle<T extends DomainAction<F>>(type: T, run: Handled<T>): void;
  on<K extends keyof DomainEventMap | S>(type: K, fn: Reaction<(DomainEventMap & InternalEventMap)[K]>): void;
  onCommand<T extends ActionType, P extends 'started' | 'done' | 'failed'>(type: T, phase: P, fn: Reaction<CommandPhase<T, P>>): void;
}
export function defineEntity<D extends Domain>(domain: D, setup: (ctx: EntityContext<D>) => void): DomainModule;
export function defineFeature<F extends Domain, S extends keyof InternalEventMap = never>(
  name: F, opts: { serviceFacts?: readonly S[] }, setup: (ctx: FeatureContext<F, S>) => void,
): DomainModule;
// CommandPhase<T, 'done'> = CommandFact<T> & { result: ResultOf<T> }; 'failed' — & { code: string }; 'started' — CommandFact<T>
```

Модули демо:

```ts
// entities/message/model/domain.ts
export const messageEntity = defineEntity('message', (ctx) => {
  ctx.handle('message/receive', receiveMessage);
  ctx.handle('message/ack', ackMessage);
  ctx.on('transport.message.received', ({ message }, { dispatch }) => dispatch('message/receive', { message }));
  ctx.on('transport.message.acked', ({ ack }, { dispatch }) => dispatch('message/ack', { ack }));
});
// entities/session/model/domain.ts
export const sessionEntity = defineEntity('session', (ctx) => {
  ctx.handle('session/connectionChanged', takeQueued(connectionChanged));
  ctx.handle('session/resumed', takeLeading(resumed));
  ctx.on('transport.connection.changed', ({ state }, { dispatch }) => dispatch('session/connectionChanged', { state }));
  ctx.on('platform.app.resumed', (_, { dispatch }) => dispatch('session/resumed'));
});
// entities/composer/model/domain.ts
export const composerEntity = defineEntity('composer', (ctx) => {
  ctx.handle('composer/setDraft', silent(setDraft));
  ctx.handle('composer/clear', clearDraft);
});
// features/recovery/model/domain.ts
export const recovery = defineFeature('recovery', { serviceFacts: ['transport.session.invalidated', 'transport.session.restarted'] as const }, (ctx) => {
  ctx.handle('recovery/restart', takeLeading(restart));
  ctx.handle('recovery/hostRestarted', takeLeading(hostRestarted));
  ctx.on('transport.session.invalidated', ({ reason }, { dispatch }) => dispatch('recovery/restart', { reason }));
  ctx.on('transport.session.restarted', ({ epoch }, { dispatch }) => dispatch('recovery/hostRestarted', { epoch }));
});
// features/flush-outbox/model/domain.ts
export const flushOutbox = defineFeature('outbox', {}, (ctx) => {
  ctx.handle('outbox/flush', takeQueued(flushOutboxScenario));
  ctx.on('session.connected', (_, { dispatch }) => dispatch('outbox/flush'));
});
// features/composer-clear/model/domain.ts
export const composerClear = defineFeature('composer-clear', {}, (ctx) => {
  ctx.onCommand('message/send', 'started', ({ payload }, { dispatch }) => dispatch('composer/clear', { threadId: payload.threadId }));
});
```

Остальные фичи (`lifecycle`, `open-thread`, `load-older`, `send-message`, `retry-message`) регистрируют свои команды через `defineFeature` без подписок.

Правила:
- В шине только факты. Сервисы публикуют `transport.*`, `platform.*`, `session.*`; сценарии — доменные факты через `d.events` и публичные события через `d.publicEvents`; канал команд — `command.*`.
- Подписываются на `internal` только модули доменов внутри `setup(ctx)`; на `public` — только плагины. Сервисы и сценарии не подписываются.
- У `ctx` нет своего `dispatch`: при установке модуль ничего не запускает. `dispatch` приходит вторым аргументом реакции с `cause` = id факта.
- В реакции нет логики и состояния: подписка, перекладка полей, `dispatch`. Условия, счётчики и решения — в срезах, мутаторах и сценариях; время — в сценариях через `d.timers`.
- `ctx.onCommand` — по умолчанию `done` и `failed`; `started` — только для оптимистичного UI. Подписка на исход — реакция, а не шаг процесса.
- Если смысл — «в домене что-то произошло» независимо от источника — явный доменный факт; если «завершилась конкретная операция» — факт команды.
- `app/engine/modules.ts` устанавливает модули из `index.ts` слайсов (`installModule` на инстанс): оборачивает каждую реакцию в `try/catch`, проверяет в dev, что сущность вызывает только свои команды, записывает пары «факт → команда» для `npm run routes:map`, снимает всё при `dispose`.

### 5.6. Сессия (`app/engine/session.ts`)

```ts
type SessionState = 'idle' | 'starting' | 'ready' | 'reconnecting' | 'restarting' | 'failed' | 'stopped' | 'disposed';
const transitions = {
  idle:         ['starting', 'disposed'],
  starting:     ['ready', 'failed', 'stopped', 'disposed'],
  ready:        ['reconnecting', 'restarting', 'stopped', 'disposed'],
  reconnecting: ['ready', 'restarting', 'failed', 'stopped', 'disposed'],
  restarting:   ['ready', 'failed', 'stopped', 'disposed'],
  failed:       ['starting', 'stopped', 'disposed'],
  stopped:      ['starting', 'disposed'],
  disposed:     [],
} as const satisfies Record<SessionState, readonly SessionState[]>;

export interface SessionApi {
  state(): SessionState;
  epoch(): number;
  /** Переход + новый epoch. null — переход запрещён или уже идёт (single-flight). */
  begin(kind: 'start' | 'restart'): { epoch: number } | null;
  complete(epoch: number): void;              // → ready, если epoch актуален
  fail(epoch: number, reason: string): void;  // → failed
  connection(state: 'connected' | 'reconnecting'): void;
  stop(): void; dispose(): void;
  /** Бросает TransportError('aborted_by_restart'), если epoch устарел. Вызывать после каждого await. */
  assertEpoch(epoch: number): void;
}
```

Сессия не вызывает транспорт и не пишет в стор: она публикует `session.status.changed` в `internal`, а срез `session` обновляют сценарии `lifecycle/*`, `recovery/*` и `session/*`.

### 5.7. Транспорт

#### 5.7.1. Доменные типы (`shared/contracts/transport.ts`, схемы — `transport.schema.ts`)

```ts
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type ThreadId = Brand<string, 'ThreadId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ClientMessageId = Brand<string, 'ClientMessageId'>;

export interface Author { id: string; kind: 'user' | 'operator' | 'bot'; name?: string }
export interface Message {
  id: MessageId;
  clientMessageId?: ClientMessageId;   // есть у собственных сообщений
  threadId: ThreadId;
  author: Author;
  text?: string;
  createdAt: string;                   // ISO; в демо — время модели фейкового бэкенда
}
export interface Thread { id: ThreadId; title?: string; createdAt: string }
export interface HistoryPage { threadId: ThreadId; messages: Message[]; hasNext: boolean }   // от новых к старым
export interface SendMessageCmd { threadId: ThreadId; clientMessageId: ClientMessageId; text: string }
export interface Ack { clientMessageId: ClientMessageId; message: Message }
export interface Ctx { epoch: number }
export type FileRef =                                   // объявить; в демо не используется
  | { kind: 'blob'; blob: Blob; name: string; mime: string }
  | { kind: 'host'; hostFileId: string; name: string; mime: string; size: number };
```

Файлы в демо не реализуются **[Д6]**: `FileRef` объявлен для порта Platform, операции `uploadFile` в порту нет, `capabilities.uploadFile = false`.

#### 5.7.2. Порт

```ts
export interface TransportLifecycle {
  start(ctx: Ctx): Promise<void>;
  restart(ctx: Ctx): Promise<void>;          // идемпотентен для одного epoch
  dispose(): void;
}
export interface CallOpts { signal?: AbortSignal }
export interface ThreadsPort   { loadThreads(opts?: CallOpts): Promise<Thread[]> }
export interface HistoryPort   { loadHistory(threadId: ThreadId, opts?: CallOpts & { fromStart?: boolean }): Promise<HistoryPage> }
export interface MessagingPort { sendMessage(cmd: SendMessageCmd, opts?: CallOpts): Promise<Ack> }
export interface TransportCapabilities { uploadFile: boolean; requestRestart: boolean; maxFileSizeBytes?: number }

export type Transport = TransportLifecycle & ThreadsPort & HistoryPort & MessagingPort & {
  readonly capabilities: TransportCapabilities;
};
```

Сценарии объявляют в `Pick<Deps, …>` полный `Transport`, но вызывают только нужные методы.

#### 5.7.3. События транспорта

```ts
export interface TransportEventMap {
  'message.received':    { epoch: number; message: Message };
  'message.acked':       { epoch: number; ack: Ack };
  'connection.changed':  { epoch: number; state: 'connected' | 'reconnecting' | 'disconnected' };
  'session.invalidated': { epoch: number; reason: InvalidationReason };   // web: «перезапусти меня»
  'session.restarted':   { epoch: number };                               // webview: хост уже перезапустил
}
export type InvalidationReason = 'update_token_error' | 'token_error' | 'auth_required';
```

Транспорт публикует их в `bus.internal` с префиксом `transport.` (разд. 5.5).

#### 5.7.4. Ошибки

```ts
export type TransportErrorCode =
  | 'not_started' | 'disposed' | 'aborted_by_restart' | 'aborted' | 'not_connected'
  | 'timeout' | 'network' | 'rate_limited'
  | 'unauthorized' | 'not_supported' | 'invalid_response' | 'server';

export class TransportError extends Error {
  constructor(readonly code: TransportErrorCode, readonly retryable: boolean, readonly cause?: unknown) { super(code); }
}
```

#### 5.7.5. Поведенческие гарантии

Жизненный цикл:
1. До завершения `start` операции отклоняются с `not_started`, после `dispose` — с `disposed`.
2. `start` и `restart` идемпотентны: повторный вызов с тем же epoch возвращает тот же промис.
3. После `dispose` событий нет, подписки очищены.
4. После завершения `restart` события старого epoch не приходят; вызовы, начатые в старом epoch, отклоняются с `aborted_by_restart`.

Сообщения:
5. `sendMessage` идемпотентен по `clientMessageId`. Ack и эхо собственного сообщения в `message.received` несут тот же `clientMessageId`.
6. `message.received` может прийти повторно с тем же `id`; дедупликация — у потребителя.
7. Порядок между событиями и результатами вызовов не гарантируется; упорядочивание — по `createdAt`, затем `id`, у потребителя.

История:
8. `loadHistory` выдаёт страницы от новых к старым, пагинация независима для каждой ветки.
9. `fromStart: true` сбрасывает позицию ветки. После `hasNext: false` следующий вызов возвращает пустую страницу с `hasNext: false`.

Ошибки и время:
10. Любой сбой — `TransportError` с кодом и `retryable`; сырых исключений наружу нет.
11. У каждой операции есть таймаут → `timeout`. Сработавший `signal` прерывает операцию (HTTP-запрос, ожидание ack, вызов моста) → `aborted`; повторная отправка с тем же `clientMessageId` после отмены безопасна (гарантия 5).
12. Операции, которых нет в `capabilities`, дают `not_supported`.

Данные:
13. Всё внешнее проверено схемами valibot и переведено в доменные типы. Неизвестное событие логируется и отбрасывается; неверный ответ на вызов — `invalid_response`.

Параллельность и границы:
14. Методы можно вызывать параллельно; транспорт сам выстраивает их так, как требует протокол (очередь DPoP в web).
15. Транспорт не читает и не пишет стор и не подписывается на шину. Данные приложения получает параметрами фабрики или аргументами методов.

#### 5.7.6. Устройство: Transport → Adapter → Channel

```ts
// shared/api/transport/adapter.ts — то, что пишется под каждый режим
export interface OperationMap {
  loadThreads:  { params: void; result: Thread[] };
  loadHistory:  { params: { threadId: ThreadId; fromStart?: boolean }; result: HistoryPage };
  sendMessage:  { params: SendMessageCmd; result: Ack };
}
export type AdapterEvent = { [K in keyof TransportEventMap]: { type: K; data: Omit<TransportEventMap[K], 'epoch'>; epoch: number } }[keyof TransportEventMap];

export interface TransportAdapter {
  capabilities(): Promise<TransportCapabilities>;
  start(ctx: Ctx): Promise<void>;
  restart(ctx: Ctx): Promise<void>;
  close(): void;
  call<K extends keyof OperationMap>(op: K, params: OperationMap[K]['params'], ctx: Ctx & { signal: AbortSignal }): Promise<OperationMap[K]['result']>;
  onEvent(fn: (e: AdapterEvent) => void): () => void;
}

// shared/api/transport/create-transport.ts — одна реализация порта
export function createTransport(adapter: TransportAdapter, d: { bus: Bus; logger: Logger; timeoutMs: number }): Transport;
```

`createTransport` отвечает за гарантии 1–4 и 10–14 из 5.7.5: `not_started` / `disposed`; идемпотентность `start` / `restart` по epoch; таймаут каждой операции; отмена вызовов старого epoch с `aborted_by_restart`; отбрасывание событий с устаревшим epoch; приведение любых ошибок к `TransportError`; передача `signal` адаптеру и отклонение с `aborted`; `not_supported` по capabilities; публикация событий в `bus.internal` с префиксом `transport.`.

Адаптеры:
- **`BackendProtocolAdapter(channel: NetworkChannel)`** — протокол фейкового бэкенда (разд. 6): эндпоинты, схемы valibot, кадры WS → события, ожидание ack по `clientMessageId`, `token_error` → один refresh → повтор → иначе `session.invalidated`.
- **`BridgeProtocolAdapter(channel: BridgeChannel)`** — переводчик контракта моста, который публикует мобильная поверхность **[Д7]**: операция порта → метод контракта с проверкой результата схемой из `shared/contracts/bridge.schema.ts`; уведомления контракта → `AdapterEvent`; ошибки контракта → `TransportErrorCode`. В демо форма контракта совпадает с портом (разд. 6.4), поэтому перевод — таблица соответствия имён без ручного кода на каждую операцию; при расхождении реального контракта меняется только эта таблица и схемы.
- **`MockAdapter`** — в памяти, управляемый из тестов; проходит те же контрактные тесты.

Контрактные тесты (`tests/contracts/transport.contract.ts`, общие для всех трёх реализаций; автор реализации пишет только харнесс удалённой стороны):
- ack приходит с тем же `clientMessageId`; повторная отправка с тем же id не создаёт второе сообщение;
- до `start` — `not_started`; после `dispose` нет событий, вызовы отклоняются с `disposed`;
- `restart` с тем же epoch выполняется один раз; события старого epoch не приходят после рестарта;
- вызовы, прерванные рестартом, отклоняются с `aborted_by_restart`;
- `fromStart` сбрасывает пагинацию; после `hasNext: false` — пустая страница;
- неизвестное событие не роняет транспорт; неверный ответ даёт `invalid_response`;
- таймаут операции даёт `timeout`; операция без поддержки даёт `not_supported`.

Каналы:

```ts
export interface NetworkChannel {
  http<T>(req: HttpRequest, opts: { priority: Priority; epoch: number; signal?: AbortSignal }): Promise<T>;  // через очередь DPoP
  send(frame: WsFrame): void;                         // мимо очереди; нет сокета → TransportError('not_connected')
  onFrame(fn: (f: WsFrame, epoch: number) => void): () => void;
  onState(fn: (s: WsState, epoch: number) => void): () => void;
  start(ctx: Ctx): Promise<void>;                     // подключение WS — задача очереди до DPOP_NONCE
  restart(ctx: Ctx): Promise<void>;                   // отмена очереди (aborted_by_restart), закрытие сокета, новое подключение
  close(): void;
}
type Priority = 'restart' | 'connect' | 'refresh' | 'data' | 'upload';   // порядок ожидающих задач

export interface BridgeChannel {
  request<T>(method: string, params: unknown, opts: { timeoutMs?: number; signal?: AbortSignal }): Promise<T>;
  onNotification(fn: (method: string, params: unknown) => void): () => void;
  dispose(): void;
}
export interface BridgeLike { send(json: string): void; onMessage(fn: (json: string) => void): () => void }
```

Требования к `NetworkChannel`:
- одна последовательная очередь для всех HTTP и подключений WS (включая переподключение); выполняющаяся задача не прерывается; ожидающие упорядочены по `Priority`, внутри приоритета — FIFO;
- DPoP: пара ECDSA P-256 `extractable: false`, thumbprint по RFC 7638, proof ES256 с `htm`, `htu`, `iat`, `jti`, `nonce`, `ath`; nonce берётся из заголовка `DPoP-Nonce` любого ответа и из кадра `DPOP_NONCE`; первый запрос без nonce → `401 use_dpop_nonce` → повтор с nonce (без выхода из очереди);
- задача подключения WS завершается только после кадра `DPOP_NONCE` или по таймауту (10 с);
- переподключение WS с теми же учётными данными с backoff (0.5, 1, 2, 4, 8 с, потолок 15 с, джиттер), состояние — через `onState`;
- каждый сокет и каждый HTTP-запрос помнят epoch; кадры и ответы чужого epoch отбрасываются;
- плановый refresh access-токена **[Д5]** за 30 с до истечения (по `performance.now()` + `expires_in`) — задача с приоритетом `refresh`; single-flight;
- User Timing: `queue-wait`, `http`, `ws-connect`, `restart`.

### 5.8. Platform (минимум для демо)

```ts
export interface Platform {
  readonly capabilities: { customFilePicker: boolean };
  pickFiles(opts: { multiple: boolean; accept?: string }): Promise<FileRef[]>;   // в демо: web — <input type=file>, webview — not_supported
  openLink(url: string): void;
  on<K extends 'app.resumed' | 'app.paused'>(type: K, fn: () => void): () => void;
}
```

Web: `visibilitychange` / `pageshow`. Webview: уведомление `platform.event` по общему `BridgeChannel`. Платформа публикует факты в `bus.internal` с префиксом `platform.`.

### 5.9. Плагины

```ts
export interface EnginePlugin {
  name: string;
  setup(ctx: { events: Pick<Emitter<PublicEventMap>, 'on' | 'onAny'>; select<T>(sel: (s: ChatState) => T): T; logger: Logger }): () => void;
}
// служебные плагины (devtools, debug-panel) получают дополнительно:
export interface EngineInspector {
  onSliceAction(fn: (a: { type: string; payload: unknown }) => void): () => void;
  onCommandStart(fn: (c: { id: string; type: ActionType; cause: string; payload: unknown; silent: boolean }) => void): () => void;
  onCommandEnd(fn: (c: { id: string; type: ActionType; cause: string; outcome: 'done' | 'failed' | 'superseded' | 'deduplicated'; ms: number }) => void): () => void;
  onFact(fn: (f: { id: string; type: string; payload: unknown }) => void): () => void;
  getState(): ChatState;
}
```

- `logging` — пишет публичные события через логгер с пространством `sc:public`.
- `telemetry` — считает `message.sent`, `message.failed`, время от `message.sent` до ack; в демо отправляет в `console.table` раз в 10 с через переданный `sink`.
- `devtools` (только dev) — одно соединение Redux DevTools `sc-sdk:<instanceId>` на инстанс, одна лента:
  - `• <факт>` с `id` и payload;
  - `▶ <команда>` с `id`, `cause`, payload и `■ <команда> · <исход>` с длительностью;
  - действия срезов (`messages/ack` и т. п.) с состоянием после них.
  Маскирование текстов и токенов, `silent`-команды не пишутся, `latency: 100`. Только чтение: `JUMP_TO_STATE` и `IMPORT_STATE` игнорируются. Публичные события, кадры WS и очередь DPoP в ленту не пишутся.
- `debug-panel` (dev и debug-сборка webview) — та же лента поверх чата (последние 200 записей, фильтр по типу, без текстов), источник — тот же `EngineInspector`.
- Плагины не пишут в стор и не вызывают `dispatch`; ошибка плагина логируется и не ломает движок.

### 5.10. React-слой

```tsx
// app/providers/ChatProvider.tsx
export function ChatProvider({ engine, children }: { engine: Engine; children: ReactNode }) {
  useEffect(() => { engine.start(); return () => engine.stop(); }, [engine]);
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}
// app/entries/web.ts
export function createChat(options: WebChatOptions): Engine;    // хост: const [chat] = useState(() => createChat(opts))
// app/entries/webview.ts
export async function mount(el: HTMLElement, bridge: BridgeLike): Promise<() => void>;  // мост → опции (таймаут 5 с) → createEngine → render
```

- `engine.start()` и `engine.stop()` — обёртки над `dispatch('lifecycle/start')` и `dispatch('lifecycle/stop')`; `engine.dispose()` — окончательная очистка.
- `shared/engine/hooks.ts`: `useChatStore(selector)` (через контекст и `useStore` из zustand), `useDispatch()`.
- Хуки сущностей и фич: `useThread(threadId)` → `{ status, hasNext, loading, error, loadOlder }`; `useFeed(threadId)` → строки ленты (мемоизированный `buildFeed`); `useMessage(id)` → одно сообщение со статусом; `useComposer(threadId)` → `{ draft, setDraft, send }`; `useSessionStatus()`.
- Действия хуков ничего не возвращают; результат — в возвращаемых значениях хука (статус сообщения, `loading`, `error`).
- Хук возвращает уже выбранные значения и стабильные действия (`useCallback` по `dispatch` и аргументам); несколько полей — `useShallow`. Методы-селекторы в возвращаемом объекте запрещены.
- `<Chat threadId? />` в `widgets/chat` — сборка по умолчанию. Конструктор — экспорт `Feed`, `Composer`, `SessionBanner` и хуков.
- Публичный экспорт — явный список в `app/entries/*.ts`. `ChatState`, `useChatStore`, `dispatch` наружу не уходят.

## 6. Фейковый бэкенд и протокол

Реального API нет, поэтому протокол ниже — **допущение**, изолированное в `BackendProtocolAdapter`, `shared/contracts/backend.schema.ts` и `dev/fake-backend`. При появлении реального протокола меняются только они.

### 6.1. Модель (`dev/fake-backend/model.ts`)

Чистое состояние без сети: ветки, сообщения по веткам, курсор пагинации на (сессию, ветку), текущий nonce (один на сессию, одноразовый), выданные токены с `cnf.jkt` и сроком, множество обработанных `clientMessageId`, открытые WS-подключения. Время — из переданного `Clock`. Сид — фикстура: одна ветка, 120 сообщений за 3 дня.

### 6.2. REST (адаптер `msw-http.ts`)

- `POST /auth/token` `{ hostToken }` + `DPoP` → `{ accessToken, refreshToken, expiresIn }`. **[Д1]** стартовый обмен делает SDK по `hostToken` из опций хоста.
- `POST /auth/refresh` `{ refreshToken }` + `DPoP` → то же.
- `GET /threads` → `Thread[]`.
- `GET /threads/:id/messages?fromStart=1` → `{ messages, hasNext }`, страница 30, от новых к старым; курсор хранится на сервере; после `hasNext: false` — пустая страница.
- Каждый запрос: `Authorization: DPoP <access>` и `DPoP: <proof>`. Модель проверяет подпись (WebCrypto), `htm`/`htu`, `ath`, `nonce === текущий`, совпадение thumbprint с `cnf.jkt`; при успехе выдаёт новый nonce в `DPoP-Nonce`.
- Ошибки: нет nonce → `401 { error: 'use_dpop_nonce' }` + `DPoP-Nonce`; неверный/использованный nonce или proof → `401 { error: 'token_error' }`; истёк токен → `401 { error: 'token_error' }` **[Д4]**; rate limit не моделируется.

### 6.3. WebSocket (адаптер `ws.ts`, перехват MSW 2.x)

- Подключение: `wss://fake/ws?access_token=…&dpop=…` **[Д2]**; проверка как в REST; сразу после открытия сервер шлёт `{ type: 'DPOP_NONCE', dpopNonce }` и обновляет nonce.
- Клиент → сервер: `{ type: 'SEND_MESSAGE', threadId, clientMessageId, text }`.
- Сервер → клиент: `{ type: 'MESSAGE_ACK', clientMessageId, message }`; `{ type: 'NEW_MESSAGE', message }` (включая эхо собственного с `clientMessageId`); `{ type: 'ERROR', code: 'update_token_error' }` + закрытие 4001.
- Повтор `SEND_MESSAGE` с тем же `clientMessageId` — повторный ack, без нового сообщения.

### 6.4. Мост (адаптер `fake-host.ts`)

Реализует `BridgeLike` поверх модели, без DPoP (хост держит соединение сам) и эмулирует контракт моста мобильной поверхности **[Д7]**. Пока реального контракта нет, его форма ниже совпадает с нашим портом. Протокол JSON-RPC 2.0:
- вызов `{ jsonrpc: '2.0', id, method, params }` → `{ jsonrpc: '2.0', id, result }` или `{ jsonrpc: '2.0', id, error: { code, message, data: { code: TransportErrorCode } } }`;
- методы: `init.getOptions`, `transport.capabilities`, `transport.start` / `transport.restart` `{ epoch }`, `transport.loadThreads`, `transport.loadHistory` `{ threadId, fromStart? }`, `transport.sendMessage` `SendMessageCmd`, `platform.openLink` `{ url }`;
- уведомления без `id`: `transport.event` `{ type, epoch, data }` (`type` — ключ `TransportEventMap`), `platform.event` `{ type: 'app.resumed' | 'app.paused' }`;
- epoch SDK передаёт хосту в `start` и `restart`, хост возвращает его в уведомлениях;
- нет ответа на `transport.capabilities` за таймаут — минимальный набор (`uploadFile: false`, `requestRestart: false`);
- задержка ответа настраивается.

### 6.5. Хаос (`chaos.ts`)

`dropWs()`, `failNextHttp(n, error)`, `invalidateNonce()` (провоцирует `token_error`), `expireAccessToken()`, `updateTokenError()`, `delay(ms)`, `burst(n)` (n входящих сообщений подряд), `restartFromHost()` (webview: хост сам рестартует и шлёт `session.restarted`), `setOffline(bool)`, `freezeAcks(bool)`.

## 7. Сквозные сценарии (поведение, которое проверяем)

1. **Старт (web):** `lifecycle/start` → `session.begin('start')` → `transport.start(epoch)` (канал: `/auth/token`, подключение WS, `DPOP_NONCE`) → `loadThreads` → `await openThread(d, …)` первой ветки прямым вызовом → первая страница истории → `session.complete(epoch)`.
2. **Отправка:** `message/send` → факт `command.started` → модуль `composer-clear` очищает черновик → pending в сторе (с `clientMessageId`) → `transport.sendMessage` → ack → sent, доменный факт `message.sent`, `command.done` с `{ ok: true, clientMessageId }`. Нет соединения → остаётся в outbox (pending). Ack не пришёл за 15 с (`d.timers`) → failed, факт `message.failed`. Повтор — `message/retry` с тем же `clientMessageId`.
3. **Доставка outbox:** `transport.connection.changed: connected` → модуль `entities/session` → `session/connectionChanged` → факт `session.connected` → модуль `flush-outbox` → `outbox/flush` (`takeQueued`).
4. **Приём:** `NEW_MESSAGE` → `transport.message.received` → модуль `entities/message` → `message/receive` → слияние по `id` / `clientMessageId`; новое — факт `message.received`. Дубликаты не создают строк.
5. **Подгрузка вверх:** `history/loadOlder` при `hasNext`; якорение скролла; повторный вызов для той же ветки, пока идёт первый, — исход `deduplicated` (`takeLeading` по ключу).
6. **Быстрое переключение ветки** (в тесте сценариев): второй `thread/open` отменяет первый (`takeLatest`), запрос первого прерывается через `signal`, его страница не попадает в стор.
7. **Обрыв WS:** канал переподключается сам → `reconnecting` → `ready`; outbox дошлётся по п. 3; история не перезагружается.
8. **Рестарт (web):** `update_token_error` или повторный `token_error` → `transport.session.invalidated` → модуль `recovery` → `recovery/restart` (`takeLeading`: повторный во время рестарта — `deduplicated`) → `session.begin('restart')` → статус `restarting` → `transport.restart(epoch)` с backoff (3 попытки, затем `failed`) → `await restore(d, { epoch })` прямым вызовом: ветки → история открытой ветки с `fromStart` (слияние, стор не очищается) → outbox с теми же `clientMessageId` → `session.complete(epoch)` → факт `session.restored`. Каждое ожидание — через `d.step`.
9. **Рестарт (webview):** `restartFromHost()` → `transport.session.restarted` → `recovery/hostRestarted` → то же восстановление.
10. **Фон:** `platform.app.resumed` → `session/resumed`: если access-токен истёк или WS закрыт — refresh / переподключение.
11. **StrictMode и жизненный цикл:** `start → stop → start` не создаёт второго соединения и не теряет данные; `dispose` во время рестарта — тишина (ни событий, ни записей в стор, ни сработавших таймеров), текущие команды отменены через `signal`.

## 8. Этапы

Каждый этап — отдельный PR. В конце этапа должны проходить `npm run lint`, `npm run typecheck`, `npm test`; дополнительно — проверки этапа.

### Этап 0. Каркас
- Vite-проект, TS strict, алиас `@/` → `src/`, ESLint 9 flat config с `eslint-plugin-boundaries` по разд. 4, Steiger, Vitest (happy-dom), Playwright (chromium, webkit), size-limit.
- Скрипты: `dev` (демо), `build:web`, `build:webview`, `typecheck`, `lint`, `test`, `test:contracts`, `test:fuzz`, `e2e`, `size`.
- Проверки: пустые слайсы проходят Steiger; тестовый файл `tests/boundaries/bad-import.ts` с импортом `entities → features` даёт ошибку линтера (тест проверяет это через ESLint API).

### Этап 1. `shared`
- `lib`: emitter (обёртка nanoevents: `on` с изоляцией ошибок, `onAny`, `emit`, `clear`), fsm (таблица переходов → `can`, `transition`), backoff, single-flight, timers (`set`, `clear`, `clearAll`), step, memoize-last, brand, clock, ids, logger (уровни, пространства, маскирование).
- `contracts`: valibot-схемы и выведенные типы домена, бэкенда (разд. 6) и моста.
- `engine`: `registry.ts`, `events.ts`, `deps.ts`, `bus.ts`, `domain.ts`, `policies.ts`, `slice.ts`, `context.ts`, `hooks.ts`.
- `api/transport/errors.ts`: `TransportError`, коды из контракта.
- Проверки: юнит-тесты таблицами для fsm, backoff, single-flight, step, маскирования логгера, изоляции ошибок эмиттера; `expectTypeOf` для `Dispatch` (нет второго аргумента у `void`-действия, ошибка на неверный payload, возвращает `void`), для описателей (`takeLeading(restart)` сохраняет тип payload) и для контекстов (`EntityContext.on` не принимает доменный факт).

### Этап 2. Фейковый бэкенд
- `model.ts`, `chaos.ts`, `adapters/msw-http.ts`, `adapters/ws.ts`, `adapters/fake-host.ts`, фикстуры.
- Проверки: тесты модели — одноразовый nonce, `DPOP_NONCE` после подключения, `token_error` на старый nonce, пагинация с курсором и `fromStart`, дедупликация `clientMessageId`, `update_token_error`.

### Этап 3. Каналы
- `NetworkChannel` (очередь, приоритеты, DPoP, WS, backoff, epoch, refresh), `BridgeChannel` (JSON-RPC 2.0, таймауты, уведомления).
- Проверки: тесты канала на MSW — параллельные `http` и подключение WS выполняются строго по одному; ожидающие идут по приоритету; `restart` отклоняет очередь с `aborted_by_restart`; кадры старого сокета отбрасываются; первый запрос получает nonce и повторяется внутри очереди. Для `BridgeChannel` — сопоставление по `id`, таймаут, неизвестное уведомление не роняет канал.

### Этап 4. Транспорт
- `createTransport`, `BackendProtocolAdapter`, `BridgeProtocolAdapter`, `MockAdapter`.
- `tests/contracts/transport.contract.ts` — функция `describeTransportContract(name, makeHarness)` с проверками из разд. 5.7.6; три прогона: web (+ MSW), webview (+ fake-host), mock.
- Проверки: `npm run test:contracts` зелёный для всех трёх; в сборке webview нет кода `network/` (проверка импорт-графа).

### Этап 5. Движок
- Сессия, шина, канал команд с политиками и фактами `command.*`, стор и срезы сущностей (через фабрику действий из `shared/engine/slice.ts`), сценарии сущностей и фич, `domain.ts` всех слайсов, `modules.ts` (установка, проверка полноты, `routes:map`), `createEngine` (`start`, `stop`, `dispose`), плагины `logging`, `telemetry`, `devtools`.
- Проверки (`tests/scenarios/` на фейковом бэкенде, оба режима одним набором): все сценарии разд. 7 — прямым вызовом функций сценариев и через `dispatch` с ожиданием факта `command.done`; мутаторы и `buildFeed` — таблицами; каждый `domain.ts` — на фейковой шине со шпионом на `dispatch`; четыре политики и исходы `superseded` / `deduplicated` — отдельными тестами канала команд; цепочка `cause` глубже 5 и повтор типа в цепочке дают ошибку; дубль `ctx.handle` и команда без обработчика дают ошибку; инварианты в dev после каждого действия среза: нет дублей `clientMessageId`, переходы статусов по таблицам.
- Тесты типов (`expectTypeOf` / `@ts-expect-error`): `defineEntity` не может подписаться на доменный факт и зарегистрировать чужую команду; `defineFeature` не может подписаться на сервисный факт вне `serviceFacts`; сценарий не может вызвать `setState`.

### Этап 6. UI
- `shared/ui-kit` (Button, TextArea, Stack, Spinner, тема через CSS-переменные, `StyleSheetManager` с `namespace`), `entities/message/ui` (пузырь со статусом и кнопкой повтора), `entities/session/ui` (плашка), `widgets/feed` (виртуализация, разделители дней, подгрузка вверх с якорем), `widgets/composer`, `widgets/chat`, `ChatProvider`, `entries/web.ts`, `entries/webview.ts`.
- Проверки: компонентный тест — пачка `burst(50)` перерисовывает `Feed` и только новые строки (счётчик рендеров через `React.Profiler`); существующие пузыри не перерисовываются при вводе в composer.

### Этап 7. Демо-страница (`dev/demo`)
- Переключатель режима: web (MSW в браузере) / webview (fake-host).
- Два инстанса чата рядом — проверка изоляции (разные соединения, ключи, сторы, ленты DevTools).
- Панель хаоса — кнопки на все функции разд. 6.5.
- Панель состояния: статус сессии, epoch, длина очереди DPoP, размер outbox.
- Плагин `debug-panel` включён в режиме webview (имитация debug-сборки).
- Пример конструктора: своя раскладка из `Feed`, `Composer`, `SessionBanner` и хуков.
- Приложение в `<React.StrictMode>`.

### Этап 8. Итоговые проверки
- `tests/fuzz/`: 300 прогонов случайной последовательности (отправка, подгрузка, переключение ветки, `dropWs`, `updateTokenError`, `delay`, `burst`) с фиксированным сидом, без `invalidateNonce` (он провоцирует ошибку намеренно) — ни одного `token_error` из-за гонки nonce; каждое отправленное сообщение доставлено ровно один раз; в сторе нет данных чужого epoch.
- `tests/memory/`: 500 циклов `createEngine → start → отправка → dispose` в Node с `--expose-gc`; `FinalizationRegistry` подтверждает сбор всех движков; число слушателей на `window` и `document` и активных таймеров возвращается к исходному.
- `e2e/` (Chromium и WebKit): отправка и приём; обрыв WS с доставкой outbox; рестарт с сообщением, отправленным во время рестарта; webview-рестарт от хоста; `dispose` во время рестарта.
- `npm run size` — фиксирует вес `web` и `webview` (порог выставит архитектор после первого замера).
- README: как запустить демо, где что лежит, как добавить фичу (шаблон: `model/<сценарий>.ts` + `declare module` + `model/domain.ts` с `ctx.handle` и политикой, подписки при необходимости + хук + `index.ts`), вывод `routes:map`.

## 9. Критерии приёмки

1. Контрактные тесты проходят для web, webview и mock.
2. Fuzz-тест: 300 прогонов без `token_error` от гонок и без дублей.
3. Сообщение, отправленное во время рестарта, доставлено ровно один раз; страница прошлого epoch не попадает в стор; после `dispose` во время рестарта — тишина.
4. Пачка из 50 сообщений перерисовывает только ленту и новые строки.
5. Steiger и boundaries проходят; намеренно неверный импорт падает; междоменная подписка в `defineEntity` не компилируется.
6. Фича «повторить отправку» — не больше четырёх файлов.
7. В единой ленте Redux DevTools видна цепочка с `cause`: `• transport.session.invalidated` → `▶ recovery/restart` → действия срезов → `■ recovery/restart · done` → `• session.restored` → `▶ outbox/flush`; повторный рестарт во время текущего виден как `■ recovery/restart · deduplicated`.
8. Сборка webview не содержит DPoP, `fetch` и `WebSocket`; вес обеих сборок зафиксирован.
9. Persist, тексты сообщений и токены в логах и ленте DevTools не встречаются (поиск по коду и прогон e2e с перехватом `console`).
10. Тест утечек: 500 циклов создания и удаления движка — все собраны, слушатели и таймеры вернулись к исходному.

Критерий команды (не для агента): middle добавляет сущность `banner` и фичу `delivery-problem-banner` (`ctx.on` на `message.failed`, `session.restored`; `ctx.onCommand` на `message/send done`) по README — замеряем время и вопросы.

## 10. Что агенту не делать

- Не создавать слой «команд» как отдельный уровень над сценариями, `wiring`, центральный реестр сценариев, отдельные файлы маршрутов, классы-сервисы, DI-контейнер, собственную абстракцию над подпиской Zustand.
- Не возвращать результат из `dispatch` и не ждать завершения команды через подписку на `command.done` внутри сценария — последовательность только прямым вызовом функции.
- Не вызывать порты из срезов стора и `setState` из сценариев.
- Не подписываться на шину вне `domain.ts` и вне `setup(ctx)`; не подписывать сервисы (транспорт, платформу, сессию) на шину.
- Не класть в реакции условия, счётчики, таймеры и переменные в замыкании.
- Не реализовывать политику в обёртке с собственным состоянием — только описатели, исполняет канал команд.
- Не пускать команды через шину фактов.
- Не использовать middleware `devtools` Zustand — только свой плагин.
- Не использовать генераторы, RxJS, redux-saga, Effection — это альтернативы для отдельного сравнения, не часть демо.
- Не хранить изменяемое состояние на уровне модуля; не вызывать `setTimeout` мимо `d.timers`.
- Не ходить в сеть в обход `NetworkChannel`; не отправлять кадры WS через очередь.
- Не придумывать поля протокола сверх разд. 6; если чего-то не хватает — оставить `TODO(Дn: …)` и описать в PR.
- Не добавлять зависимости вне разд. 3 без обоснования.
- Не менять форму порта и гарантии из 5.7 и это ТЗ — предлагать правки в PR.

## 11. Допущения

Реальные ответы бэкенда и мобильных команд ещё не получены. Код, зависящий от допущения, помечается `// Д<n>` и изолируется так, чтобы замена касалась одного места.

- **[Д1] Стартовые токены.** SDK сам обменивает `hostToken` из опций хоста на пару токенов через `POST /auth/token` с DPoP-proof; токен привязывается к thumbprint ключа (`cnf.jkt`).
- **[Д2] DPoP при подключении WS.** Access-токен и proof передаются в query-параметрах URL подключения.
- **[Д3] Ключ при рестарте.** Пара ключей живёт весь срок инстанса движка и при рестарте не меняется; новые токены получаются тем же ключом.
- **[Д4] Ошибки токена.** Истёкший токен и неверный nonce дают одинаковый `token_error`; обработка: один refresh → повтор → иначе `session.invalidated`.
- **[Д5] Обновление токена у открытого WS.** Новый access-токен доходит до WS переподключением.
- **[Д6] Файлы в webview.** Не реализуются в демо; в порту `uploadFile` отсутствует, `capabilities.uploadFile = false`.
- **[Д7] Мост.** Контракт публикует мобильная поверхность; он один и согласованный, но текущая версия ещё не получена. В демо: транспорт моста — `BridgeLike { send(json), onMessage(fn) }`, протокол — JSON-RPC 2.0 из 6.4 с формой, совпадающей с портом, опции — `init.getOptions` с таймаутом 5 с; нет ответа — экран ошибки. Когда контракт появится, меняются только `bridge.schema.ts`, таблица соответствия в `BridgeProtocolAdapter` и `fake-host.ts`.
- **[Д8] Политика outbox.** Ack ожидается 15 с, затем `failed`; автоповторов нет, повтор ручной; при рестарте pending переотправляются с теми же `clientMessageId`.
