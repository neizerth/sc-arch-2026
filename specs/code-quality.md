# Требования к качеству кода sc-sdk

> Версия 1 от 05.10.2026. Действует для `main` (`specs/01-demo-skeleton.md`, `specs/02-main-alignment.md`) и для веток `specs/branches/*`.
> Этот текст встроен в `specs/02-main-alignment.md` (раздел 7) и в ТЗ веток `specs/branches/*` (раздел 8), чтобы каждое ТЗ было самодостаточным. При изменении требований — обновлять все копии.
> Принцип: правило, которое можно проверить машиной, проверяется машиной (ESLint, `tsc`, скрипты в CI); остальное — чеклистом ревью. Пороги — блокирующие для CI, если не сказано иное.

## 1. Цель

Код должен читаться middle-разработчиком без автора: один файл — одна роль, одна функция — один уровень абстракции, типы выражают намерение и не обходятся приведениями. Сложность допускается только в нескольких местах ядра (`shared/engine`, канал команд, каналы транспорта), и там она покрыта тестами и комментариями.

## 2. Приведения типов и небезопасные конструкции

**Норма — ноль приведений в прикладном коде.** Вместо приведений — сужение типов (type guards, `in`, дискриминированные объединения), разбор схемами valibot на границах, `satisfies`, явные аннотации.

Разрешено:
- `as const`;
- `satisfies`;
- приведения в списке разрешённых файлов (белый список ниже) — каждое с комментарием «почему без него нельзя»;
- приведения в тестах (`*.test.ts`, `tests/`).

Белый список (в базе):
- `app/engine/commands.ts` — один вызов `run` с типом, восстановленным из реестра;
- `shared/lib/brand.ts` — конструкторы брендированных типов после проверки;
- `shared/engine/domain.ts` — передача контекста модулю (`setup(ctx)`), если без него не выражается связь generic-параметров.

Запрещено везде, кроме тестов:
- `any` (явный и неявный), `as unknown as`, `!` (non-null assertion);
- `@ts-ignore`, `@ts-nocheck`; `@ts-expect-error` — только в тестах типов, с описанием;
- `Function`, `Object`, `{}` как тип; `object` без уточнения;
- небезопасные операции с `any` из внешних библиотек (`no-unsafe-*`) — оборачивать в типизированные адаптеры.

Настройки `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`.

## 3. SOLID в нашей архитектуре

Принципы переведены в проверяемые правила. Абстрактное «следовать SOLID» на ревью не принимается — только ссылки на пункты ниже.

**S — одна причина для изменения.**
- Один файл — одна роль: срез, сценарий, `domain.ts`, адаптер, канал, компонент, хук. Файл `model/<сценарий>.ts` экспортирует один сценарий и его `declare module`.
- Сценарий — один процесс; если в нём больше одного «и потом» на разных доменах, это процесс в `features` с прямыми вызовами шагов, каждый шаг — отдельная функция.
- Реакция — одна строка без логики (подписка → `dispatch`).
- Компонент — отображение; данные и действия — из хуков.
- Пороги длины и сложности (раздел 5) — машинная проверка этого принципа.

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

## 4. Удобочитаемость

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

## 5. ESLint

Flat config, один для `main` и веток; ветки только добавляют исключения из раздела 8.

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

## 6. Метрики и пороги CI

Команда `npm run quality` запускает всё ниже и пишет сводку в `reports/quality.json`; в PR выводится diff сводки с `main`.

1. **Линтер:** 0 ошибок, 0 предупреждений.
2. **Типы:** `tsc --noEmit` без ошибок; `type-coverage --strict` — не ниже 99 %.
3. **Приведения:** скрипт `scripts/count-casts.ts` (TypeScript Compiler API) считает `as` (кроме `as const`), `<T>x`, `!`, `any`, `@ts-expect-error` вне тестов. Порог: 0 вне белого списка; в белом списке — не больше числа, указанного в разделе 2. Отчёт — по файлам.
4. **Сложность:** цикломатическая ≤ 8 и когнитивная ≤ 10 на функцию (правила ESLint); дополнительно в сводке — максимум и 95-й перцентиль по проекту.
5. **Размер:** функция ≤ 40 строк, файл ≤ 250 (UI ≤ 150), параметров ≤ 2; в сводке — максимум и 95-й перцентиль.
6. **Дублирование:** `jscpd` — не более 3 % (минимум 10 строк / 50 токенов на фрагмент).
7. **Циклы зависимостей:** 0 (`import-x/no-cycle`; дополнительно `madge --circular` в CI).
8. **Мёртвый код:** `knip` — 0 неиспользуемых файлов, экспортов и зависимостей.
9. **Покрытие тестами** (Vitest, v8): `shared/lib` и мутаторы — ≥ 90 % строк и ветвей; сценарии и `domain.ts` — ≥ 85 %; проект — ≥ 80 %.
10. **Отключения правил:** каждое `eslint-disable` — с причиной; общее число в `src/` — не больше 5, список — в сводке.
11. **Публичный API:** отчёт api-extractor без незапланированных изменений.

## 7. Чеклист ревью (то, что машина не проверит)

- Имя функции, файла, команды и факта понятно без чтения тела.
- Функция работает на одном уровне абстракции: шаги процесса — вызовы функций с говорящими именами, а не перемешанные детали.
- Нет «умных» конструкций там, где хватает простых (generic-магия, цепочки `reduce`, неочевидные операторы).
- Ошибки обрабатываются там, где есть что с ними делать; ожидаемые исходы — результатом, а не исключением.
- Новая связь между доменами видна в `routes:map` и лежит в `features`.
- Тест описывает поведение («повторный рестарт во время текущего отбрасывается»), а не реализацию.

Командный критерий (не для агента): middle, не писавший код, за 15 минут чтения объясняет поток рестарта и добавляет реакцию в новую фичу по README — замеряется на `main` и в каждой ветке.

## 8. Исключения веток

Ветки используют тот же конфиг; допустимы только исключения ниже, каждое — в `eslint.config.ts` ветки с комментарием.

- **`exp/rxjs`:** плагин правил RxJS (актуальный форк `eslint-plugin-rxjs`): запрет игнорируемых подписок, вложенных `subscribe`, небезопасного `takeUntil`; `max-nested-callbacks` — 4 для файлов с цепочками операторов.
- **`exp/effect`:** генераторы `Effect.gen` разрешены; классы — только для объявления сервисов и ошибок с тегами (`Context.Service`, `Data.TaggedError`); `explicit-module-boundary-types` для сценариев — тип `Effect<A, E, R>` обязателен.
- **`exp/effector`:** юниты (`createStore`, `createEvent`, `createEffect`, `sample`, `attach`) — только на верхнем уровне модулей в `model/` (запрет внутри функций — `no-restricted-syntax`); префикс `$` для сторов разрешён в `naming-convention`; запрет `.watch`.

Метрики раздела 6 входят в отчёт каждой ветки (раздел 3 ТЗ ветки, пункт 7 «Типизация» расширяется до всех метрик раздела 6).
