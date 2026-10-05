# ТЗ: демо-приложение sc-sdk (ходячий скелет)

> Версия 3 от 02.10.2026. Исполнитель — GigaCode (агент), ревью — архитектор и тимлид.
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

1. FSD без страниц и правила границ работают, включая `@x`.
2. Диспетчер + сценарии `(deps, payload)` + реестры типов не дают лишнего шаблонного кода и сохраняют типизацию.
3. Один Zustand-стор на инстанс не вызывает лишних перерисовок.
4. Единая очередь DPoP исключает гонки за nonce.
5. Машина состояний сессии и epoch переживают обрывы и рестарты.
6. Общий `Transport` над двумя адаптерами (web и webview) взаимозаменяем.
7. DevTools и логи отвечают на вопрос «почему не ушло сообщение».

**Входит:** одна ветка; текстовые сообщения; отправка, приём, история с подгрузкой вверх; статусы `pending / sent / failed` и ручной повтор; переподключение и полный рестарт; оба режима (web и webview); лента с разделителями по дням и виртуализацией; `ChatProvider`, хуки, виджет `<Chat />`; плагины logging, telemetry, devtools; фейковый бэкенд в памяти; демо-страница с панелью хаоса.

**Не входит:** файлы и Platform.pickFiles (вторая итерация, но порт `Platform` создаётся); несколько веток в UI; баннер; удалённый конфиг; реальный бэкенд и реальный мост; дизайн и темы; SSR; публикация пакета.

## 2. Архитектурные решения (обязательны)

1. **Диспетчер.** Отдельного слоя «команд» нет. UI и маршруты вызывают `dispatch(type, payload)`; диспетчер находит сценарий в реестре и выполняет его через общую обёртку: политика конкурентности, причинная цепочка `cause`, DevTools, User Timing, перехват ошибок.
2. **Сценарий — обычная функция `(deps, payload) => Promise<R>`.** Без функций высшего порядка, классов и генераторов. Сценарий имеет доступ к стору (только через `getState().<действие среза>`), сессии, транспорту, платформе, `dispatch`, `events`, таймерам, логгеру.
3. **Мутации стора — только именованные действия срезов.** Сценарий не вызывает `setState`; это обеспечено типом: в `Deps` стор виден как `{ getState(): ChatState }`.
4. **Реестры типов через declaration merging.** В `shared/engine` объявлены пустые `ChatState`, `ActionMap`, `DomainEventMap`; сущности и фичи дописывают свои срезы, сценарии и доменные факты через `declare module`. Рантайм-реестр в `app/engine` проверяется через `satisfies`. Так хуки и маршруты на любом слое типизированы без импорта из `app`.
5. **Сценарии по слоям.** Реакция одного домена на факты сервисов — в `entities/<домен>/model` (`message/receive`). Пользовательские действия и процессы через несколько доменов — в `features/<поведение>/model`; у междоменных процессов свой префикс (`recovery/restart`, `lifecycle/start`, `outbox/flush`).
6. **Шина.** `internal` — факты сервисов (`transport.*`, `platform.*`, `session.*`) и доменные факты, которые публикуют сценарии; `public` — стабильная проекция для плагинов.
7. **Маршруты по слоям.** Подписки на шину есть только в маршрутах. `entities/*/model/routes.ts`: факты сервисов → действия своего домена. `features/*/model/routes.ts`: доменные факты → действия любых доменов. В маршрутах нет логики и состояния. Защита от циклов — глубина цепочки `cause`.
8. **Политики конкурентности** объявляются при регистрации сценария: `parallel`, `latest`, `leading` (с ключом), `queue`.
9. **Транспорт в три слоя:** `Transport` (общий для режимов: жизненный цикл, epoch, таймауты, ошибки, capabilities, публикация фактов) → адаптер чужого протокола (web — `BackendProtocolAdapter`, webview — `BridgeProtocolAdapter`) → канал (`NetworkChannel` / `BridgeChannel`). Контрактные тесты гарантий пишутся один раз на `Transport`.
10. **Контракт моста публикует мобильная поверхность** (один, согласованный). Наши схемы моста — копия этого контракта, `BridgeProtocolAdapter` переводит его в наш порт **[Д7]**.
11. **DI без контейнера.** `createEngine(options)` собирает зависимости вручную на каждый инстанс; на уровне модуля нет изменяемого состояния. `ChatProvider` кладёт ссылку на движок в контекст. Движок различает `stop()` (обратимо, для StrictMode) и `dispose()` (окончательно, всё собирается сборщиком мусора).

## 3. Стек и ограничения

- React 18, Zustand 5 (`zustand/vanilla` + контекст), styled-components 6 (только `shared/ui-kit` и `*/ui`), TypeScript 5 `strict`, valibot, Vite, Vitest (+ happy-dom), Playwright (Chromium и WebKit), MSW 2.x (HTTP и WebSocket), `@tanstack/react-virtual`, ESLint 9 + `eslint-plugin-boundaries`, Steiger, size-limit.
- Другие зависимости — только с обоснованием в PR. Запрещены: Redux/RTK, RxJS, MobX, xstate, DI-контейнеры, lodash, moment/dayjs, axios, reselect.
- **Запрещён любой persist**: `localStorage`, `sessionStorage`, IndexedDB, cookies, Cache API.
- **В логах, событиях и телеметрии нет текстов сообщений и токенов**; логгер маскирует поля `text`, `token`, `accessToken`, `refreshToken`, `dpop`, `authorization`.
- Код: именованные экспорты, без `default`; без `any` и `as unknown as` (исключение — одна строка в диспетчере, разд. 5.4); фабрики вместо классов (исключения — `TransportError` и `DispatchError`); время и id — через `Clock` и `Ids` из зависимостей, не `Date.now()` и `crypto.randomUUID()` напрямую в логике.
- Идентификаторы и код — по-английски; комментарии и README — по-русски.

## 4. Структура репозитория

```
sc-sdk-skeleton/
├─ src/
│  ├─ app/
│  │  ├─ engine/
│  │  │  ├─ create-engine.ts       сборка Deps, стора, шины, сессии, транспорта; подключение маршрутов и плагинов
│  │  │  ├─ store.ts               createChatStore: композиция срезов + devtools middleware
│  │  │  ├─ scenarios.ts           рантайм-реестр сценариев с политиками (satisfies ScenarioRegistry)
│  │  │  ├─ dispatcher.ts          createDispatcher: политики, cause, DevTools, User Timing
│  │  │  ├─ routes.ts              список модулей маршрутов из index.ts слайсов + routes:map
│  │  │  ├─ session.ts             машина состояний сессии (без IO)
│  │  │  └─ plugins.ts             запуск плагинов, изоляция ошибок
│  │  ├─ plugins/                  logging/, telemetry/, devtools/
│  │  ├─ providers/                ChatProvider.tsx
│  │  └─ entries/                  web.ts, webview.ts — Composition Root и публичный экспорт
│  ├─ widgets/
│  │  ├─ feed/                     лента: виртуализация, разделители, подгрузка вверх
│  │  ├─ composer/                 поле ввода и кнопка отправки
│  │  └─ chat/                     виджет по умолчанию = статус + feed + composer
│  ├─ features/                    ← каждая: model/<сценарий>.ts (+ declare module), model/routes.ts при наличии, ui/, index.ts
│  │  ├─ lifecycle/                lifecycle/start, lifecycle/stop
│  │  ├─ recovery/                 recovery/restart, recovery/hostRestarted, restore; routes.ts на transport.session.*
│  │  ├─ open-thread/              thread/open
│  │  ├─ load-older/               history/loadOlder
│  │  ├─ send-message/             message/send
│  │  ├─ retry-message/            message/retry
│  │  └─ flush-outbox/             outbox/flush; routes.ts: session.connected → outbox/flush
│  ├─ entities/
│  │  ├─ session/                  model/ (срез статуса, сценарии connectionChanged и resumed, routes.ts), ui/ (плашка)
│  │  ├─ thread/                   model/ (срез веток, активная ветка)
│  │  ├─ message/                  model/ (срез, мутаторы, селекторы, buildFeed, статус-FSM, сценарии receive и ack, routes.ts), ui/, @x/
│  │  └─ composer/                 model/ (черновики по веткам, сценарий setDraft)
│  └─ shared/
│     ├─ engine/                   registry.ts, events.ts, deps.ts, routes.ts (defineEntityRoutes, defineFeatureRoutes),
│     │                            dispatch.ts, context.ts, hooks.ts
│     ├─ api/
│     │  ├─ transport/             port.ts, create-transport.ts, adapter.ts, errors.ts,
│     │  │                         network/ (channel.ts, dpop.ts, queue.ts, backend-protocol-adapter.ts),
│     │  │                         bridge/ (bridge-protocol-adapter.ts), mock/ (mock-adapter.ts)
│     │  ├─ platform/              port.ts, web/, bridge/
│     │  └─ bridge-channel/        запрос-ответ и уведомления поверх BridgeLike
│     ├─ contracts/                transport.schema.ts, bridge.schema.ts (копия контракта поверхности), backend.schema.ts
│     ├─ lib/                      emitter, fsm, backoff, single-flight, timers, memoize-last, brand, clock, ids, logger
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
- `zustand` импортируется только в `app/engine`, `entities/*/model` и `shared/engine/hooks.ts`.
- `fetch`, `XMLHttpRequest`, `WebSocket` — только в `shared/api/transport/network/channel.ts`.
- `shared/api/*` не импортирует `entities`, `features`, `app`.
- Изменяемые переменные верхнего уровня модуля в `src/` запрещены (правило линтера); `setTimeout` и `setInterval` вне `shared/lib/timers.ts` запрещены.

## 5. Ключевые интерфейсы

### 5.1. Реестры типов (`shared/engine/registry.ts`)

```ts
/** Состояние стора. Каждая сущность дописывает свой срез через declare module. */
export interface ChatState {}
/** Действия диспетчера. Каждая фича дописывает свой сценарий через declare module. */
export interface ActionMap {}

export type ActionType = keyof ActionMap;
export type PayloadOf<T extends ActionType> = Parameters<ActionMap[T]>[1];
export type ResultOf<T extends ActionType> = Awaited<ReturnType<ActionMap[T]>>;
export type Dispatch = <T extends ActionType>(
  type: T,
  ...args: PayloadOf<T> extends void | undefined ? [] : [PayloadOf<T>]
) => Promise<ResultOf<T>>;
```

Пример наполнения:

```ts
// entities/message/model/slice.ts
export interface MessagesSlice { messages: MessagesState; messagesActions: MessagesActions }
declare module '@/shared/engine/registry' { interface ChatState extends MessagesSlice {} }

// features/send-message/model/send-message.ts
export async function sendMessage(
  d: Pick<Deps, 'store' | 'transport' | 'ids' | 'clock' | 'events' | 'timers'>,
  p: { threadId: ThreadId; text: string },
): Promise<{ clientMessageId: ClientMessageId }> { /* … */ }
declare module '@/shared/engine/registry' { interface ActionMap { 'message/send': typeof sendMessage } }
```

Правила для сценариев: один конкретный тип payload, без перегрузок и generic; ожидаемые исходы — результатом-объединением `{ ok: true, … } | { ok: false; code }`, исключения — только для багов и `TransportError`.

### 5.2. Зависимости (`shared/engine/deps.ts`)

```ts
export interface Deps {
  store: { getState(): ChatState };   // только чтение и действия срезов, без setState
  session: SessionApi;                 // разд. 5.6
  transport: Transport;                // разд. 5.7
  platform: Platform;
  events: { emit<K extends keyof DomainEventMap>(type: K, e: DomainEventMap[K]): void };   // только доменные факты
  publicEvents: { emit<K extends keyof PublicEventMap>(type: K, e: PublicEventMap[K]): void };
  dispatch: Dispatch;                  // вложенный вызов, попадающий в DevTools и цепочку cause
  signal: AbortSignal;                 // отмена политикой конкурентности или stop/dispose
  timers: Timers;                      // setTimeout/clear, снимаются при stop и dispose
  logger: Logger;
  clock: Clock;                        // now(): number, monotonic(): number
  ids: Ids;                            // clientMessageId(), uploadId()
}
```

Сценарий объявляет только нужное: `d: Pick<Deps, …>`. `signal` и `dispatch` диспетчер передаёт свои для каждого вызова (со своим `cause`). Вложенный сценарий вызывается через `d.dispatch`.

### 5.3. Стор

- `createChatStore(deps)` в `app/engine/store.ts`: `createStore` из `zustand/vanilla` + `devtools` (только dev, `name: 'sc-sdk:store:<instanceId>'`), композиция срезов.
- Срез экспортирует `create<Name>Slice: StateCreator<ChatState, [['zustand/devtools', never]], [], <Name>Slice>`.
- Каждое действие среза синхронное: `set((s) => mutator(s, args), false, { type: 'messages/receive', … })`. Мутаторы — чистые функции рядом со срезом, тестируются таблицами.
- Срезы демо: `session` (статус для UI, причина ошибки), `threads` (список, активная), `messages` (byId, порядок по ветке, статусы, outbox), `history` (`hasNext`, `loading` по ветке), `composer` (черновики по ветке), `ui` (последняя прочитанная позиция — опционально).
- Слияние сообщений — по `id`; собственные — по `clientMessageId` (pending → sent при ack или эхо). Порядок — `createdAt`, при равенстве — `id`.
- Статус сообщения — мини-FSM: `pending → sent | failed`, `failed → pending`; прочие переходы отбрасываются и логируются.

### 5.4. Диспетчер и реестр (`app/engine/dispatcher.ts`, `app/engine/scenarios.ts`)

```ts
// shared/engine/registry.ts
export type Concurrency = 'parallel' | 'latest' | 'leading' | 'queue';
export interface ScenarioEntry<T extends ActionType> {
  run: ActionMap[T];
  concurrency: Concurrency;
  key?: (p: PayloadOf<T>) => string;   // для leading и latest по ключу, например threadId
  devtools?: false;                    // не писать в DevTools (частые действия)
}
export type ScenarioRegistry = { [K in ActionType]: ScenarioEntry<K> };

// app/engine/scenarios.ts
export const scenarios = {
  'lifecycle/start':           { run: start,             concurrency: 'leading' },
  'lifecycle/stop':            { run: stop,              concurrency: 'leading' },
  'recovery/restart':          { run: restart,           concurrency: 'leading' },
  'recovery/hostRestarted':    { run: hostRestarted,     concurrency: 'leading' },
  'session/connectionChanged': { run: connectionChanged, concurrency: 'queue' },
  'session/resumed':           { run: resumed,           concurrency: 'leading' },
  'thread/open':               { run: openThread,        concurrency: 'latest' },
  'history/loadOlder':         { run: loadOlder,         concurrency: 'leading', key: (p) => p.threadId },
  'message/send':              { run: sendMessage,       concurrency: 'parallel' },
  'message/retry':             { run: retryMessage,      concurrency: 'leading', key: (p) => p.clientMessageId },
  'message/receive':           { run: receiveMessage,    concurrency: 'parallel' },
  'message/ack':               { run: ackMessage,        concurrency: 'parallel' },
  'outbox/flush':              { run: flushOutbox,       concurrency: 'queue' },
  'composer/setDraft':         { run: setDraft,          concurrency: 'parallel', devtools: false },
} satisfies ScenarioRegistry;   // пропущенное действие из ActionMap — ошибка компиляции
```

Поведение диспетчера:
- `parallel` — каждый вызов независим.
- `latest` — новый вызов (по ключу, если задан) отменяет предыдущий через его `signal`; предыдущий промис отклоняется с `DispatchError('superseded')`.
- `leading` — пока вызов (по ключу) идёт, новые возвращают промис текущего, не запуская сценарий.
- `queue` — вызовы выполняются строго по одному в порядке поступления.
- `DispatchError` (`shared/engine/registry.ts`) — класс с кодом `'superseded' | 'cause_loop'`; второе исключение из правила «фабрики вместо классов» наряду с `TransportError`.
- Каждый вызов получает `id` и `cause` (id действия или факта, который его запустил; от UI — `ui`). Глубина цепочки больше 5 или повтор типа действия в одной цепочке — ошибка в dev, лог в prod.
- DevTools: `dispatch/<тип>` с payload (маскированным), `cause` и исходом (`done`, `failed`, `superseded`, `deduplicated`). User Timing — `performance.measure` на каждый вызов.
- Ошибка сценария логируется и пробрасывается вызывающему; маршруты промис не ждут, ошибка остаётся в логе.
- Внутри — одно приведение типа при вызове `run`; снаружи `Dispatch` полностью типизирован.

### 5.5. Шина и маршруты

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
// в демо: message.received, message.sent, message.failed (entities/message), session.connected, session.restored (entities/session, features/recovery)

export interface PublicEventMap {                              // под semver, без текстов и токенов
  'session.statusChanged': { status: SessionState };
  'message.sent': { threadId: ThreadId; clientMessageId: ClientMessageId };
  'message.received': { threadId: ThreadId; messageId: MessageId };
  'message.failed': { threadId: ThreadId; clientMessageId: ClientMessageId; code: string };
}
export interface Bus { internal: Emitter<InternalEventMap & DomainEventMap>; public: Emitter<PublicEventMap> }
```

```ts
// shared/engine/routes.ts
type Domain = ActionType extends `${infer D}/${string}` ? D : never;
/** Сущность: только факты сервисов, только действия своего домена. */
export function defineEntityRoutes<D extends Domain>(
  domain: D,
  setup: (on: On<InternalEventMap>, dispatch: DomainDispatch<D>) => void,
): RouteModule;
/** Фича: доменные факты, действия любых доменов. */
export function defineFeatureRoutes(
  name: string,
  setup: (on: On<DomainEventMap>, dispatch: Dispatch) => void,
): RouteModule;
/** Явное исключение для features/recovery: сервисные факты сессии. */
export function defineRecoveryRoutes(
  setup: (on: On<Pick<InternalEventMap, 'transport.session.invalidated' | 'transport.session.restarted'>>, dispatch: DomainDispatch<'recovery'>) => void,
): RouteModule;
```

Маршруты демо:

```ts
// entities/message/model/routes.ts
export const routes = defineEntityRoutes('message', (on, dispatch) => {
  on('transport.message.received', ({ message }) => dispatch('message/receive', { message }));
  on('transport.message.acked', ({ ack }) => dispatch('message/ack', { ack }));
});
// entities/session/model/routes.ts
export const routes = defineEntityRoutes('session', (on, dispatch) => {
  on('transport.connection.changed', ({ state }) => dispatch('session/connectionChanged', { state }));
  on('platform.app.resumed', () => dispatch('session/resumed'));
});
// features/recovery/model/routes.ts
export const routes = defineRecoveryRoutes((on, dispatch) => {
  on('transport.session.invalidated', ({ reason }) => dispatch('recovery/restart', { reason }));
  on('transport.session.restarted', ({ epoch }) => dispatch('recovery/hostRestarted', { epoch }));
});
// features/flush-outbox/model/routes.ts
export const routes = defineFeatureRoutes('flush-outbox', (on, dispatch) => {
  on('session.connected', () => dispatch('outbox/flush'));
});
```

Правила:
- В шине только факты. В `internal` публикуют транспорт, платформа и сессия (сервисные факты) и сценарии через `d.events` (доменные факты); в `public` — только сценарии через `d.publicEvents`.
- Подписываются на шину только модули маршрутов; сервисы и сценарии не подписываются.
- В маршруте нет логики и состояния: подписка, перекладка полей, `dispatch`. Условия, счётчики и решения — в срезах, мутаторах и сценариях; время — в сценариях через `d.timers`.
- Один `routes.ts` на слайс. Больше 10–15 строк — признак, что делить нужно слайс.
- `app/engine/routes.ts` собирает модули из `index.ts` слайсов, подключает их к шине, проставляет `cause` и снимает подписки при `stop` и `dispose`. Скрипт `npm run routes:map` печатает карту «факт → действие».
- Ошибки слушателей изолируются и логируются.

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
export interface ThreadsPort   { loadThreads(): Promise<Thread[]> }
export interface HistoryPort   { loadHistory(threadId: ThreadId, opts?: { fromStart?: boolean }): Promise<HistoryPage> }
export interface MessagingPort { sendMessage(cmd: SendMessageCmd): Promise<Ack> }
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
  | 'not_started' | 'disposed' | 'aborted_by_restart' | 'not_connected'
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
11. У каждой операции есть таймаут → `timeout`.
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

`createTransport` отвечает за гарантии 1–4 и 10–14 из 5.7.5: `not_started` / `disposed`; идемпотентность `start` / `restart` по epoch; таймаут каждой операции; отмена вызовов старого epoch с `aborted_by_restart`; отбрасывание событий с устаревшим epoch; приведение любых ошибок к `TransportError`; `not_supported` по capabilities; публикация событий в `bus.internal` с префиксом `transport.`.

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
```

- `logging` — пишет публичные события через логгер с пространством `sc:public`.
- `telemetry` — считает `message.sent`, `message.failed`, время от `message.sent` до ack; в демо отправляет в `console.table` раз в 10 с через переданный `sink`.
- `devtools` (только dev) — отдельное соединение Redux DevTools `sc-sdk:bus:<instanceId>`, подписано на `internal` и `public` через `onAny`.
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
- Хуки сущностей и фич: `useThread(threadId)` → `{ status, hasNext, loadOlder }`; `useFeed(threadId)` → строки ленты (мемоизированный `buildFeed`); `useMessage(id)` → одно сообщение; `useComposer(threadId)` → `{ draft, setDraft, send }`; `useSessionStatus()`.
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

1. **Старт (web):** `lifecycle/start` → `session.begin('start')` → `transport.start(epoch)` (канал: `/auth/token`, подключение WS, `DPOP_NONCE`) → `loadThreads` → `dispatch('thread/open')` первой ветки → первая страница истории → `session.complete(epoch)`.
2. **Отправка:** `message/send` → pending в сторе (с `clientMessageId`) → `transport.sendMessage` → ack → sent, доменный факт `message.sent`. Нет соединения → остаётся в outbox (pending). Ack не пришёл за 15 с (`d.timers`) → failed, факт `message.failed`. Повтор — `message/retry` с тем же `clientMessageId`.
3. **Доставка outbox:** `transport.connection.changed: connected` → маршрут `entities/session` → `session/connectionChanged` → факт `session.connected` → маршрут `features/flush-outbox` → `outbox/flush` (политика `queue`).
4. **Приём:** `NEW_MESSAGE` → `transport.message.received` → маршрут `entities/message` → `message/receive` → слияние по `id` / `clientMessageId`; новое — факт `message.received`. Дубликаты не создают строк.
5. **Подгрузка вверх:** `history/loadOlder` при `hasNext`; якорение скролла; параллельный вызов для той же ветки отбрасывается политикой `leading` по ключу.
6. **Быстрое переключение ветки** (в тесте сценариев): второй `thread/open` отменяет первый политикой `latest`; страница первого не попадает в стор.
7. **Обрыв WS:** канал переподключается сам → `reconnecting` → `ready`; outbox дошлётся по п. 3; история не перезагружается.
8. **Рестарт (web):** `update_token_error` или повторный `token_error` → `transport.session.invalidated` → маршрут `features/recovery` → `recovery/restart` (политика `leading`: повторный во время рестарта не запускается) → `session.begin('restart')` → статус `restarting` → `transport.restart(epoch)` с backoff (3 попытки, затем `failed`) → восстановление: ветки → история открытой ветки с `fromStart` (слияние, стор не очищается) → outbox с теми же `clientMessageId` → `session.complete(epoch)` → факт `session.restored`. После каждого `await` — `assertEpoch` и проверка `signal`.
9. **Рестарт (webview):** `restartFromHost()` → `transport.session.restarted` → `recovery/hostRestarted` → то же восстановление.
10. **Фон:** `platform.app.resumed` → `session/resumed`: если access-токен истёк или WS закрыт — refresh / переподключение.
11. **StrictMode и жизненный цикл:** `start → stop → start` не создаёт второго соединения и не теряет данные; `dispose` во время рестарта — тишина (ни событий, ни записей в стор, ни сработавших таймеров).

## 8. Этапы

Каждый этап — отдельный PR. В конце этапа должны проходить `npm run lint`, `npm run typecheck`, `npm test`; дополнительно — проверки этапа.

### Этап 0. Каркас
- Vite-проект, TS strict, алиас `@/` → `src/`, ESLint 9 flat config с `eslint-plugin-boundaries` по разд. 4, Steiger, Vitest (happy-dom), Playwright (chromium, webkit), size-limit.
- Скрипты: `dev` (демо), `build:web`, `build:webview`, `typecheck`, `lint`, `test`, `test:contracts`, `test:fuzz`, `e2e`, `size`.
- Проверки: пустые слайсы проходят Steiger; тестовый файл `tests/boundaries/bad-import.ts` с импортом `entities → features` даёт ошибку линтера (тест проверяет это через ESLint API).

### Этап 1. `shared`
- `lib`: emitter (`on`, `onAny`, `emit`, `clear`, изоляция ошибок), fsm (таблица переходов → `can`, `transition`), backoff, single-flight, timers (`set`, `clear`, `clearAll`), memoize-last, brand, clock, ids, logger (уровни, пространства, маскирование).
- `contracts`: valibot-схемы и выведенные типы домена, бэкенда (разд. 6) и моста.
- `engine`: `registry.ts`, `deps.ts`, `events.ts`, `routes.ts`, `dispatch.ts`, `context.ts`, `hooks.ts`.
- `api/transport/errors.ts`: `TransportError`, коды из контракта.
- Проверки: юнит-тесты таблицами для fsm, backoff, single-flight, маскирования логгера; `expectTypeOf` для `Dispatch` (нет второго аргумента у `void`-действия, ошибка на неверный payload).

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
- Сессия, шина, стор и срезы сущностей, сценарии сущностей и фич, `define*Routes`, маршруты слайсов, `scenarios.ts`, `dispatcher.ts` с политиками и `cause`, `routes.ts` со сборкой и `routes:map`, `createEngine` (`start`, `stop`, `dispose`), плагины.
- Проверки (`tests/scenarios/` на фейковом бэкенде, оба режима одним набором): все сценарии разд. 7; мутаторы и `buildFeed` — таблицами; каждый `routes.ts` — на фейковой шине со шпионом на `dispatch`; четыре политики конкурентности — отдельными тестами диспетчера; цепочка `cause` глубже 5 и повтор типа в цепочке дают ошибку; инварианты в dev после каждого действия среза: нет дублей `clientMessageId`, переходы статусов по таблицам.
- Тесты типов (`expectTypeOf` / `@ts-expect-error`): маршрут сущности не может подписаться на доменный факт и вызвать действие чужого домена; сценарий не может вызвать `setState`; реестр без одного действия не компилируется.

### Этап 6. UI
- `shared/ui-kit` (Button, TextArea, Stack, Spinner, тема через CSS-переменные, `StyleSheetManager` с `namespace`), `entities/message/ui` (пузырь со статусом и кнопкой повтора), `entities/session/ui` (плашка), `widgets/feed` (виртуализация, разделители дней, подгрузка вверх с якорем), `widgets/composer`, `widgets/chat`, `ChatProvider`, `entries/web.ts`, `entries/webview.ts`.
- Проверки: компонентный тест — пачка `burst(50)` перерисовывает `Feed` и только новые строки (счётчик рендеров через `React.Profiler`); существующие пузыри не перерисовываются при вводе в composer.

### Этап 7. Демо-страница (`dev/demo`)
- Переключатель режима: web (MSW в браузере) / webview (fake-host).
- Два инстанса чата рядом — проверка изоляции (разные соединения, ключи, сторы).
- Панель хаоса — кнопки на все функции разд. 6.5.
- Панель состояния: статус сессии, epoch, длина очереди DPoP, размер outbox, последние 50 событий шины (без текстов).
- Пример конструктора: своя раскладка из `Feed`, `Composer`, `SessionBanner` и хуков.
- Приложение в `<React.StrictMode>`.

### Этап 8. Итоговые проверки
- `tests/fuzz/`: 300 прогонов случайной последовательности (отправка, подгрузка, переключение ветки, `dropWs`, `updateTokenError`, `delay`, `burst`) с фиксированным сидом, без `invalidateNonce` (он провоцирует ошибку намеренно) — ни одного `token_error` из-за гонки nonce; каждое отправленное сообщение доставлено ровно один раз; в сторе нет данных чужого epoch.
- `tests/memory/`: 500 циклов `createEngine → start → отправка → dispose` в Node с `--expose-gc`; `FinalizationRegistry` подтверждает сбор всех движков; число слушателей на `window` и `document` и активных таймеров возвращается к исходному.
- `e2e/` (Chromium и WebKit): отправка и приём; обрыв WS с доставкой outbox; рестарт с сообщением, отправленным во время рестарта; webview-рестарт от хоста; `dispose` во время рестарта.
- `npm run size` — фиксирует вес `web` и `webview` (порог выставит архитектор после первого замера).
- README: как запустить демо, где что лежит, как добавить фичу (шаблон: `model/<name>.ts` + `declare module` + строка в `scenarios.ts` + `routes.ts` при необходимости + хук + `index.ts`), вывод `routes:map`.

## 9. Критерии приёмки

1. Контрактные тесты проходят для web, webview и mock.
2. Fuzz-тест: 300 прогонов без `token_error` от гонок и без дублей.
3. Сообщение, отправленное во время рестарта, доставлено ровно один раз; страница прошлого epoch не попадает в стор; после `dispose` во время рестарта — тишина.
4. Пачка из 50 сообщений перерисовывает только ленту и новые строки.
5. Steiger и boundaries проходят; намеренно неверный импорт падает; междоменная подписка в маршрутах сущности не компилируется.
6. Фича «повторить отправку» — не больше четырёх файлов.
7. В Redux DevTools видна цепочка с `cause`: `transport.session.invalidated` → `dispatch/recovery/restart` → действия срезов → `transport.message.acked` → `dispatch/message/ack` → `messages/ack`.
8. Сборка webview не содержит DPoP, `fetch` и `WebSocket`; вес обеих сборок зафиксирован.
9. Persist, тексты сообщений и токены в логах не встречаются (поиск по коду и прогон e2e с перехватом `console`).
10. Тест утечек: 500 циклов создания и удаления движка — все собраны, слушатели и таймеры вернулись к исходному.

Критерий команды (не для агента): middle добавляет сущность `banner` и фичу `delivery-problem-banner` (маршруты на `message.failed`, `message.sent`, `session.restored`) по README — замеряем время и вопросы.

## 10. Что агенту не делать

- Не создавать слой «команд», `wiring`, классы-сервисы, DI-контейнер, собственную абстракцию над подпиской Zustand.
- Не вызывать порты из срезов стора и `setState` из сценариев.
- Не подписываться на шину вне модулей маршрутов; не подписывать сервисы (транспорт, платформу, сессию) на шину.
- Не класть в маршруты условия, счётчики, таймеры и переменные в замыкании.
- Не подписываться на действия диспетчера (`after('message/send')`) — только на факты.
- Не использовать генераторы для сценариев; не вводить `race`, `fork`, каналы — только `Promise.race` с `signal` внутри сценария.
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
