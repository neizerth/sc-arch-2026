# ТЗ: ветка `exp/rxjs` — процессы и шина на RxJS

> Версия 1 от 05.10.2026. Исполнитель — GigaCode (агент), ревью — архитектор и тимлид.
> База — `main` после выполнения `specs/02-main-alignment.md` (раскладка по доменам и слоям, ядро по `specs/01-demo-skeleton.md` v4, контрольная фича, метрики базы). Это ТЗ описывает только изменения; всё, что не сказано здесь, работает как в базе.
> Порядок работы: агент получает весь файл и номер этапа из раздела 6. Следующий этап — только после прохождения проверок предыдущего.

## 0. Цель ветки

Проверить, заменяет ли RxJS самописную склейку ядра с выигрышем:
- шину фактов — `Subject`;
- канал команд и политики — операторы `mergeMap`, `switchMap`, `exhaustMap`, `concatMap`;
- ручную отмену (`d.step`, `assertEpoch`, `d.timers`) в длинных процессах — отпиской;
- логику со временем в реакциях фич — операторами времени;
- переподключение WS — `retry` с задержкой.

Вопрос, на который отвечает ветка: становится ли код процессов короче и надёжнее по отмене настолько, чтобы окупить порог входа, правила работы с потоками и вес.

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

### 5.1. Зависимость

`rxjs` — актуальная стабильная 7.x (если к началу работ вышла стабильная 8.x — использовать её и указать в отчёте). Импорт `rxjs` разрешён только в: `shared/lib/rx/`, `shared/lib/emitter.ts`, `app/engine/commands.ts`, `features/*/model/`, `shared/api/transport/network/channel.ts`. Правило — в `eslint-plugin-boundaries` или `no-restricted-imports`.

### 5.2. Шина на `Subject`

Интерфейс `Bus` из `shared/engine/bus.ts` сохраняется; добавляются два члена для цепочек операторов. Реализация в `shared/lib/emitter.ts` переходит с nanoevents на `Subject`; nanoevents удаляется из зависимостей.

```ts
export interface Bus {
  emit<K extends keyof Facts>(type: K, payload: Facts[K]): void;
  on<K extends keyof Facts>(type: K, fn: (payload: Facts[K], meta: { id: string }) => void): () => void;
  onAny(fn: (fact: AnyFact) => void): () => void;
  facts$: Observable<AnyFact>;
  ofType<K extends keyof Facts>(type: K): Observable<FactOf<K>>;   // filter с сужением типа
  dispose(): void;                                                  // complete() всех Subject
}
```

- Изоляция ошибок подписчиков: в `on` колбэк оборачивается `try/catch` с логированием (не полагаться только на `config.onUnhandledError`).
- `dispose` вызывает `complete()`.

### 5.3. Канал команд на операторах

`app/engine/commands.ts` переписывается; внешний контракт (`dispatch` возвращает `void`, `register` из `ctx.handle`, описатели политик, факты `command.*`, `cause`, хуки DevTools) не меняется.

```ts
const operatorFor = { parallel: mergeMap, latest: switchMap, leading: exhaustMap, queue: concatMap } as const;

export function register(type: ActionType, h: Policied<Scenario>) {
  // дубль — ошибка, как в базе
  const sub = commands$.pipe(
    filter((c) => c.type === type),
    groupBy((c) => h.key?.(c.payload) ?? '*'),
    mergeMap((g$) => g$.pipe(operatorFor[h.concurrency]((c) => run(h, c)))),
    takeUntil(dispose$),
  ).subscribe();
  return () => sub.unsubscribe();
}

const run = (h: Policied<Scenario>, c: Command) => defer(() => {
  const ac = new AbortController();
  inspector.commandStart(c);
  bus.emit('command.started', c);
  return toObservable(h.run(depsFor(c, ac.signal), c.payload)).pipe(
    takeLast(1), defaultIfEmpty(undefined),                       // результат — последнее значение или undefined
    tap((result) => { bus.emit('command.done', { ...c, result }); inspector.commandEnd(c, 'done'); }),
    catchError((e) => { bus.emit('command.failed', { ...c, code: toCode(e) }); inspector.commandEnd(c, 'failed'); return EMPTY; }),
    finalize(() => { if (!ac.signal.aborted) ac.abort(); }),
    tap({ unsubscribe: () => inspector.commandEnd(c, 'superseded') }),
  );
});
```

- `toObservable` нормализует результат сценария: `Observable` — как есть, `Promise` — `from`, значение или `void` — `of`.
- Исход `deduplicated` для `leading`: `exhaustMap` молча отбрасывает вызов — перед `commands$.next` проверять, есть ли текущий вызов по ключу, и сообщать `inspector.commandEnd(c, 'deduplicated')`.
- Ошибка одного вызова не должна завершать поток команды: `catchError` внутри `run`, не снаружи.

### 5.4. Сценарии-потоки

Сценарий может вернуть `Observable`. Переписать на потоки:
- `recovery/restart` и `restore` (повторы `transport.restart` — `retry({ count: 3, delay: backoff })`, шаги — `concat`);
- `recovery/hostRestarted`;
- `message/send` (ожидание ack — `timeout({ first: 15_000 })`);
- `outbox/flush` (`concatMap` по pending);
- `lifecycle/start`.

Остальные сценарии (`message/receive`, `message/ack`, `composer/*`, `session/*`, `thread/open`, `history/loadOlder`, `message/retry`) остаются обычными функциями.

Мост к промисным портам — `shared/lib/rx/call.ts`:

```ts
export const call = <T>(fn: (signal: AbortSignal) => Promise<T>) =>
  new Observable<T>((sub) => {
    const ac = new AbortController();
    fn(ac.signal).then((v) => { sub.next(v); sub.complete(); }, (e) => sub.error(e));
    return () => ac.abort();
  });
```

Пример:

```ts
export const restart = (d: Pick<Deps, 'session' | 'transport' | 'store' | 'events'>, p: { reason: InvalidationReason }) =>
  defer(() => {
    const started = d.session.begin('restart');
    if (!started) return EMPTY;
    const { epoch } = started;
    d.store.getState().sessionActions.setStatus('restarting');
    return concat(
      call((signal) => d.transport.restart({ epoch }, { signal })).pipe(retry({ count: 3, delay: (_, i) => timer(backoffMs(i)) })),
      restore(d, { epoch }),
    ).pipe(
      ignoreElements(),
      tap({ complete: () => { d.session.complete(epoch); d.events.emit('session.restored', { epoch }); } }),
      catchError((e) => { d.session.fail(epoch, toCode(e)); return EMPTY; }),
    );
  });
```

В сценариях-потоках не используются `d.step`, `assertEpoch` и `d.timers`: отмена — отпиской (политикой, `stop`, `dispose`), время — операторами. Epoch в транспорте остаётся без изменений.

### 5.5. Реакции фич на потоках

`FeatureContext` получает метод для реакций с логикой времени. `EntityContext` не меняется.

```ts
interface FeatureContext<F, S> {
  // …handle, on, onCommand — как в базе
  from(build: (facts: FactsApi) => Observable<CallOf<ActionType>>): void;   // FactsApi: ofType, ofCommand(type, phase)
}
```

- Маршрут возвращает поток вызовов `{ type, payload }`, вызывает `dispatch` только движок (с `cause` = id последнего факта, который привёл к вызову).
- В `from` разрешены операторы фильтрации, преобразования и времени (`filter`, `map`, `scan`, `bufferTime`, `debounceTime`, `switchMap` с `timer`). Запрещены эффекты (`tap` с записью куда-либо, вызовы портов, `subscribe`).
- `installModule` подписывает поток с `catchError` внутри (ошибка не убивает маршрут) и `takeUntil(dispose$)`; пары для `routes:map` берутся из объявлений `ofType` / `ofCommand`.

Контрольная фича реализуется через `ctx.from`:

```ts
export const connectionBanner = defineFeature('banner-connection', {}, (ctx) => {
  ctx.from(({ ofType }) =>
    ofType('session.connection.changed').pipe(
      switchMap(({ payload }) =>
        payload.state === 'connected'
          ? of(call('banner/hide', { kind: 'connection' }))
          : timer(3_000).pipe(map(() => call('banner/show', { kind: 'connection' })))),
    ));
});
```

(Если доменного факта `session.connection.changed` в базе нет — добавить его публикацию в сценарий `session/connectionChanged`.)

### 5.6. Канал сети

В `NetworkChannel` переподключение WS и состояние соединения переписываются на потоки внутри модуля; интерфейс канала (5.7.6 базового ТЗ) не меняется. Переподключение — `retry({ delay: (_, i) => timer(backoffWithJitter(i)) })` с потолком 15 с; состояние — `BehaviorSubject<WsState>` наружу через существующий `onState`. Очередь DPoP не трогать.

### 5.7. Правила работы с потоками (в README ветки и в шаблоне сценария)

1. Тело сценария-потока — всегда `defer(() => …)`: побочные эффекты до первого оператора иначе выполнятся при вызове функции, а не при подписке.
2. `catchError` — внутри вложенной цепочки, иначе ошибка завершит внешний поток навсегда.
3. Шаги без передачи значений — `concat`, не `forkJoin` (`forkJoin([])` завершается, ничего не выдав).
4. Побочные эффекты — только в `tap` на своём шаге; вложенный `subscribe` запрещён.
5. Сценарий подписывается ровно один раз — каналом команд.
6. Любая долгоживущая подписка — с `takeUntil(dispose$)`.
7. Линтер: подключить плагин правил RxJS (актуальный форк `eslint-plugin-rxjs`) с правилами против игнорируемых подписок, небезопасного `takeUntil` и вложенных `subscribe`.

## 6. Этапы

### Этап 1. Шина и вспомогательные функции
- `shared/lib/emitter.ts` на `Subject`, `facts$`, `ofType`; `shared/lib/rx/call.ts`, `toObservable`.
- Проверки: тесты шины (изоляция ошибок, `dispose` завершает подписки, порядок доставки); все тесты базы зелёные.

### Этап 2. Канал команд
- Переписать `app/engine/commands.ts` по 5.3.
- Проверки: существующие тесты политик и исходов (`superseded`, `deduplicated`) без изменений; marble-тесты (`TestScheduler`) на четыре политики.

### Этап 3. Сценарии-потоки
- Переписать сценарии из 5.4.
- Проверки: `tests/scenarios`, `tests/fuzz` (300 прогонов), `tests/memory` — зелёные; число ручных проверок отмены в переписанных сценариях — 0.

### Этап 4. Реакции фич и контрольная фича
- `ctx.from` в `defineFeature` и `installModule`; контрольная фича на `ctx.from`.
- Проверки: тесты контрольной фичи из раздела 2 на `TestScheduler`; `routes:map` показывает связи из `ctx.from`.

### Этап 5. Канал сети
- Переподключение и состояние WS на потоках по 5.6.
- Проверки: контрактные тесты транспорта на всех трёх реализациях; тест канала на переподключение с backoff на виртуальном времени.

### Этап 6. Метрики и отчёт
- Снять метрики раздела 3 в ветке и в `main`, написать `reports/exp-rxjs.md`.

## 7. Чего не делать

- Не переписывать на потоки простые реакции и короткие сценарии из 5.4.
- Не делать стор на `BehaviorSubject` и не трогать Zustand, срезы и хуки.
- Не использовать redux-observable и не превращать команды в эпики: политика остаётся на команде, `dispatch` — `void`.
- Не менять очередь DPoP, адаптеры и порты.
- Не экспортировать `Subject` наружу движка; наружу — только `Observable` через `asObservable()`.

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

- **`exp/rxjs`:** плагин правил RxJS (актуальный форк `eslint-plugin-rxjs`): запрет игнорируемых подписок, вложенных `subscribe`, небезопасного `takeUntil`; `max-nested-callbacks` — 4 для файлов с цепочками операторов.

Метрики 8.6 входят в отчёт ветки (раздел 3, пункт 7).
