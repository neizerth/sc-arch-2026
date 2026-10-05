# T0. База (общая для всех веток) — ветка `main`, коммит 1

Прочитай `tasks/RULES.md` и `src/shared/contract.ts`. Контракт и конфиги уже есть. Сделай:

## 1. `src/shared/backend.ts` — `createFakeBackend(): Backend` (≤ 80 строк)

- Внутри массив из 120 сообщений-сидов (`id: 'm1'..'m120'`, `author: 'other'`, `createdAt` растёт, `text: 'Сообщение N'`).
- `loadHistory(beforeId?)`: от новых к старым, 30 штук, `hasMore`. Задержка `latency` (по умолчанию 100 мс) через `setTimeout`.
- `connect()`: эмитит `{type:'connection', state:'connected'}` через `latency`.
- `send(clientId, text)`: если не connected — `Promise.reject(new Error('offline'))`. Иначе после `latency` создаёт сообщение (идемпотентно по `clientId`: повтор возвращает то же), эмитит эхо `{type:'message', message}` и резолвит то же сообщение.
- `chaos.dropConnection(downMs = 5000)`: эмитит `reconnecting`, через `downMs` — `connected`.
- `chaos.burst(n)`: n входящих `other`-сообщений подряд.
- `chaos.setLatency(ms)`.
- Без классов, замыкание на фабрике, без модульного состояния.

## 2. `src/shared/ui/` — только отображение, получает `ChatModel` пропсом

- `ChatView.tsx` (`{ model: ChatModel }`): баннер «Нет соединения» если `showConnectionBanner`; плашка статуса соединения; кнопка «Загрузить ещё» (если `hasOlder`, disabled при `loadingOlder`); список сообщений (простой `map`, без виртуализации); у `pending` пометка «отправляется…», у `failed` — «не доставлено» и кнопка «Повторить»; форма: input + «Отправить».
- `ChaosPanel.tsx` (`{ backend: Backend }`): кнопки «Обрыв 5 с», «Burst 20», «Latency 1500».
- `App.tsx` (`{ chat: Chat; backend: Backend }`): `const model = chat.useChat();` + `<ChaosPanel/>` + `<ChatView/>`.
- Стили — инлайн-объекты, минимум. Никаких UI-библиотек.

## 3. `src/main.tsx`

```tsx
const backend = createFakeBackend();
const chat = createChat(backend);   // из './model/create-chat'
chat.start();
createRoot(...).render(<StrictMode><App chat={chat} backend={backend} /></StrictMode>);
```

## 4. `src/shared/chat.contract.ts` — `describeChat(createChat: CreateChat)` (vitest + `@testing-library/react` `renderHook`, `vi.useFakeTimers`)

Четыре теста, backend берётся `createFakeBackend()`:
1. После `start` и прокрутки таймеров в ленте 30 сообщений, `hasOlder === true`; `send('hi')` → сразу `pending`, после таймеров `sent`, ровно одно сообщение с текстом `hi`.
2. `dropConnection(5000)`; `send('offline')` остаётся `pending`; после 5 с и таймеров — `sent`, без дубля.
3. `dropConnection(5000)`: через 2 с `showConnectionBanner === false`, через 3,1 с `true`, после reconnect `false`.
4. `loadOlder()` даёт 60 сообщений; два вызова подряд — всё равно 60.

## 5. Заглушка модели, чтобы проект собирался

`src/model/create-chat.ts` экспортирует `createChat: CreateChat`, который бросает `new Error('not implemented')`. Это заменит T1.

## Готово, когда

`npm install`, `npm run typecheck` зелёный (тесты пока не запускать), `npx vite build` собирается. Коммит `feat: base` в ветку `main`.
