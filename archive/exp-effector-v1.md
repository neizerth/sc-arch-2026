# ТЗ: ветка `exp/effector` — состояние и процессы на Effector

> Версия 1 от 05.10.2026. Исполнитель — GigaCode (агент), ревью — архитектор и тимлид.
> База — `main` после выполнения `specs/02-main-alignment.md` (раскладка по доменам и слоям, ядро по `specs/01-demo-skeleton.md` v4, контрольная фича, метрики базы). Это ТЗ описывает только изменения; всё, что не сказано здесь, работает как в базе.
> Порядок работы: агент получает весь файл и номер этапа из раздела 6. Следующий этап — только после прохождения проверок предыдущего.

## 0. Цель ветки

Effector ранее отклонили из-за опасения, что модель живёт в памяти и не очищается: граф юнитов статический, на уровне модуля, а у scope нет явного `dispose`. Ветка проверяет это опасение на практике и заодно — Effector как замену всей склейки ядра:
- стор и срезы Zustand → сторы Effector;
- шина фактов → события Effector;
- канал команд → эффекты и события;
- реакции модулей доменов → `sample`;
- факты жизненного цикла команд → `.done` / `.fail` / `.finally` эффектов;
- инстанс движка → scope (`fork`), граф общий.

Вопросы, на которые отвечает ветка:
1. **Главный:** проходит ли тест утечек — 500 циклов «создать инстанс, поработать, уничтожить», включая два инстанса на странице одновременно, — без роста памяти и без утечки подписок.
2. Становится ли код реакций и процессов короче и понятнее, чем в `main`.
3. Чего стоит переход: вес, плагин сборки, переписанные хуки, порог входа.

**Версия.** effector и effector-react — актуальная стабильная 23.x (на момент написания — 23.4). Если к началу работ вышла новая мажорная версия — использовать её и указать в отчёте.

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

### 5.1. Зависимости и сборка

- `effector`, `effector-react` — 23.x; `patronum` — для `debounce`, `delay`, `combineEvents` в контрольной фиче (если хватает встроенных средств — не добавлять).
- Плагин сборки для `sid` юнитов: `@effector/swc-plugin` или babel-плагин effector через Vite. `sid` нужны для `fork({ values })` и инспектора; без плагина ветка не принимается.
- Zustand удаляется из ядра (остаётся в `package.json`, только если что-то вне ядра его использует — описать в отчёте); nanoevents удаляется.
- Импорт `effector` разрешён в `entities/*/model/`, `features/*/model/`, `shared/engine/`, `app/engine/`; `effector-react` — в хуках (`entities/*/model/hooks.ts`, `features/*/model/hooks.ts`, `shared/engine/hooks.ts`) и в `app/providers/`.

### 5.2. Что переходит на Effector, что остаётся

- **Переходит:** стор и срезы → сторы; мутаторы → `.on` или `sample` с чистыми `fn` (сами мутаторы как чистые функции переиспользуются); шина фактов → события; канал команд → события команд + эффекты сценариев; реакции `domain.ts` → `sample`; факты `command.*` → `.done` / `.fail` эффектов; хуки → `useUnit`.
- **Остаётся без изменений:** порты, адаптеры и каналы транспорта и платформы; машина состояний сессии как сервис; чистые функции (`buildFeed`, мутаторы, маппинги); UI-компоненты (меняются только хуки, их публичная форма — нет); плагины `logging` и `telemetry` (на публичных событиях).

### 5.3. Статический граф и scope на инстанс

Все юниты (`createStore`, `createEvent`, `createEffect`, `sample`, `attach`) создаются **только на верхнем уровне модулей** в `model/` — это и есть граф. Инстанс движка — scope.

```ts
// shared/engine/deps.ts — зависимости инстанса как стор, не сериализуется
export const $deps = createStore<EngineDeps | null>(null, { serialize: 'ignore' });

// app/engine/create-engine.ts
export function createEngine(options: EngineOptions) {
  const sink = createScopedFactsSink();                // факты сервисов → события в scope (5.4); scope подключается ниже
  const deps = createDeps(options, { bus: sink });     // транспорт, платформа, сессия, логгер, часы, id — на инстанс
  const scope = fork({ values: [[$deps, deps]] });
  sink.attach(scope);
  const stopInspect = inspect({ scope, fn: devtoolsSink });   // только dev (5.8)
  return {
    scope,
    start: () => allSettled(lifecycleStart, { scope }),
    stop: () => allSettled(lifecycleStop, { scope }),
    dispose: () => { stopInspect(); sink.dispose(); deps.transport.dispose(); /* scope больше не используется — ссылки отпускаются */ },
  };
}
```

- Создание юнитов внутри `createEngine`, хуков, сценариев и фабрик — запрещено правилом линтера (это и есть «динамическая модель», которая требует ручной очистки через `clearNode`).
- `$deps` не сериализуется и не попадает в DevTools.
- Явного `dispose` у scope нет: освобождение — это отсутствие ссылок на него. Поэтому все места, которые держат scope (подписки транспорта через `scopeBind`, инспектор, React-провайдер, таймеры `patronum`), обязаны отпускать его в `dispose` — это проверяет тест утечек (раздел 6, этап 1).

### 5.4. Факты сервисов → события

```ts
// shared/engine/facts.ts — события фактов на уровне модуля
export const transportMessageReceived = createEvent<{ epoch: number; message: Message }>();
export const transportSessionInvalidated = createEvent<{ epoch: number; reason: InvalidationReason }>();
export const connectionChanged = createEvent<{ epoch: number; state: ConnectionState }>();
export const appResumed = createEvent();
// …все факты InternalEventMap

// app/engine/bind-service-facts.ts — адаптер с интерфейсом Bus.emit для сервисов
export function createScopedFactsSink() {
  let targets: { [K in keyof InternalEventMap]: (p: InternalEventMap[K]) => void } | null = null;
  const bind = (scope: Scope) => ({
    'transport.message.received': scopeBind(transportMessageReceived, { scope }),
    'transport.session.invalidated': scopeBind(transportSessionInvalidated, { scope }),
    'transport.connection.changed': scopeBind(connectionChanged, { scope }),
    'platform.app.resumed': scopeBind(appResumed, { scope }),
    // …все факты InternalEventMap
  }) satisfies { [K in keyof InternalEventMap]: (p: InternalEventMap[K]) => void };
  return {
    attach: (scope: Scope) => { targets = bind(scope); },
    emit: <K extends keyof InternalEventMap>(type: K, payload: InternalEventMap[K]) => { targets?.[type](payload as never); },
    dispose: () => { targets = null; },              // отпустить ссылки на scope
  };
}
```

В базе `createTransport`, платформа и сессия публикуют факты через зависимость `bus.emit`. В ветке им передаётся `createScopedFactsSink(scope)` с тем же методом `emit`; интерфейсы портов не меняются, сервисы по-прежнему не знают о сторах и событиях. `dispose` синка отпускает ссылки на scope.

### 5.5. Команды и сценарии

Команда — событие; сценарий — эффект, связанный с командой и получающий зависимости из `$deps`.

```ts
// features/recovery/model/restart.ts
export const restartRequested = createEvent<{ reason: InvalidationReason }>();      // команда recovery/restart

export const restartFx = attach({
  source: $deps,
  effect: async (deps, p: { reason: InvalidationReason }, signal?: AbortSignal) => { /* тело как в базе, deps вместо d */ },
});

withPolicy(restartRequested, restartFx, { concurrency: 'leading' });   // 5.6

// реакция (бывший domain.ts)
sample({ clock: transportSessionInvalidated, fn: ({ reason }) => ({ reason }), target: restartRequested });
```

- Тело сценария остаётся `async`-функцией с теми же шагами; зависимости приходят из `$deps` через `attach` (`source`).
- Мутации стора из сценария — только через события-действия срезов, вызванные в scope. Внутри эффекта для этого — привязанные к scope функции; рекомендуемый путь — возвращать данные из эффекта и применять их `sample({ clock: fx.doneData, fn: mutator, target: $store })`. Выбранный способ описать в отчёте.
- Вложенный шаг процесса — прямой вызов `async`-функции, как в базе. Вызов другого эффекта изнутри эффекта допустим только для запуска независимой работы.
- `dispatch` для UI и хуков — вызов события команды через `useUnit`; `void`, как в базе.
- Факты `command.started/done/failed` → `restartRequested` (старт), `restartFx.done`, `restartFx.fail`. `ctx.onCommand` из базы заменяется `sample({ clock: sendFx.done, … })`.
- Слои подписок сохраняются по смыслу: в `entities/*/model` — `sample` только от событий фактов сервисов к своим командам; в `features/*/model` — от доменных событий и `.done`/`.fail` чужих эффектов. Проверка — правилом линтера на импорты (сущность не импортирует чужие эффекты и доменные события других слайсов, кроме `@x`) и ревью.

### 5.6. Политики

В Effector нет встроенных `takeLatest` и `takeLeading`, а эффекты не отменяются сами. Нужен помощник `withPolicy(command, fx, { concurrency, key? })` в `shared/engine/policies.ts`:

- состояние слотов (текущий `AbortController`, флаг «идёт») — в сторе внутри scope с `serialize: 'ignore'`, а не в замыкании на уровне модуля (иначе два инстанса разделят блокировку);
- `parallel` — каждый вызов запускает `fx`;
- `latest` — перед запуском прерывается `AbortController` предыдущего вызова слота; `signal` передаётся в эффект (третий аргумент обработчика или поле payload — выбрать и описать) и дальше в транспорт; результат прерванного отбрасывается (`sample` с фильтром по id вызова);
- `leading` — если слот занят, вызов отбрасывается (`sample` с `filter` по стору слота);
- `queue` — вызовы складываются в стор-очередь, следующий запускается по `fx.finally`;
- исходы `superseded` и `deduplicated` сообщаются в ленту DevTools.

Если окажется, что готовая реализация (например, стратегии конкурентности из `@farfetched/core`) закрывает это проще — не подключать в этой ветке, а описать в отчёте как вариант.

### 5.7. Хуки и React

- `app/providers/ChatProvider.tsx` оборачивает дерево в `Provider` из `effector-react` со scope движка.
- Хуки сохраняют имена и форму возвращаемых значений; внутри — `useUnit` по сторам и событиям. Производные данные — производные сторы (`.map`, `combine`) на уровне модуля; `buildFeed` — в `combine` по сторам сообщений и UI.
- Критерий перерисовок базы (пачка из 50 сообщений перерисовывает только ленту и новые строки) обязателен; для строк ленты — точечные производные сторы или `useStoreMap`.

### 5.8. DevTools

Лента DevTools (одна на инстанс, только чтение, маскирование) строится на `inspect({ scope, fn })` из `effector/inspect`:
- обновления сторов → записи «действие среза» с именем юнита и состоянием;
- вызовы событий фактов → `• факт`;
- события команд и `.done`/`.fail` эффектов → `▶` / `■` с исходом;
- `cause` — по цепочке вызовов, которую даёт инспектор, или по id в payload команд (описать в отчёте, что удалось).

Имена юнитов должны быть читаемыми (`messages/receive`, а не `event_12`) — за счёт плагина сборки и явного `name`.

### 5.9. Контрольная фича на Effector

- `connection-banner`: `debounce` из `patronum` (3 с) на событии не-`connected` + отмена при `connected`; или `delay` + фильтр по текущему состоянию — выбрать и описать.
- `delivery-banner`: окно неудач — стор с метками времени `message.failed`; решение — `sample` с чистой `fn`; таймер очистки окна — `delay`.
- Тесты — на `fork` с фейковыми таймерами и `allSettled`.

## 6. Этапы

### Этап 1. Каркас: граф, scope, факты, тест утечек
- Плагин сборки, `$deps`, события фактов, `bind-service-facts.ts` (синк фактов), `createEngine` на `fork`, правило линтера против создания юнитов вне верхнего уровня `model/`.
- Проверки (до переноса остального — это главный вопрос ветки): тест утечек на голом каркасе — 500 циклов `createEngine → привязка фактов → прогон нескольких фактов → dispose`; затем два инстанса одновременно, затем с React-провайдером. Снять кучу после GC и число удерживаемых scope (`FinalizationRegistry`). Если утечка есть — найти держателя, описать и исправить, если это наша ошибка, а не свойство библиотеки. Результат этапа — отдельный раздел отчёта.

### Этап 2. Сторы и хуки
- Перенос срезов в сторы, мутаторов — в `.on`/`sample`; хуки на `useUnit`; провайдер со scope.
- Проверки: компонентные тесты и тест перерисовок базы; e2e без изменений.

### Этап 3. Команды, сценарии, политики, реакции
- События команд, эффекты сценариев через `attach` с `$deps`, `withPolicy`, реакции на `sample`, факты команд через `.done`/`.fail`.
- Проверки: `tests/scenarios`, `tests/fuzz` (300 прогонов), `tests/memory` — зелёные; тесты политик и исходов.

### Этап 4. DevTools и контрольная фича
- Лента на `inspect`, контрольная фича по 5.9.
- Проверки: критерий 7 базы (цепочка рестарта в ленте); тесты раздела 2.

### Этап 5. Метрики и отчёт
- Снять метрики раздела 3 в ветке и в `main`, написать `reports/exp-effector.md`. Первым разделом — ответ на главный вопрос (память): что держит scope, как отпускается, проходит ли тест, с какими оговорками.

## 7. Чего не делать

- Не создавать юниты динамически (внутри функций, на инстанс) и не использовать `clearNode`/`withRegion` как способ управления жизненным циклом инстанса — инстанс это только scope.
- Не вызывать события и эффекты вне scope (без `scopeBind`, `allSettled` или `useUnit`) и не читать `getState` сторов вне тестов.
- Не использовать `.watch` для побочных эффектов — только эффекты.
- Не менять порты, адаптеры, каналы и машину состояний сессии.
- Не подключать `@farfetched/core`, `effector-storage` и другие пакеты экосистемы, кроме перечисленных в 5.1.
- Не делать SSR-сериализацию — она вне цели ветки.

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

- **`exp/effector`:** юниты (`createStore`, `createEvent`, `createEffect`, `sample`, `attach`) — только на верхнем уровне модулей в `model/` (запрет внутри функций — `no-restricted-syntax`); префикс `$` для сторов разрешён в `naming-convention`; запрет `.watch`.

Метрики 8.6 входят в отчёт ветки (раздел 3, пункт 7).
