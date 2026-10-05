# Контракт транспорта sc-sdk

> Черновик от 02.10.2026 (ред. 3). Источник правды для порта `shared/contracts/transport.ts` и общей реализации `createTransport(adapter)`. Под ней — адаптеры чужих протоколов: `BackendProtocolAdapter` поверх `NetworkChannel` (web, протокол публикует бэкенд) и `BridgeProtocolAdapter` поверх `BridgeChannel` (webview, контракт моста публикует мобильная поверхность). Связанный документ — FINDINGS.md, раздел 5.
> Форму задают типы, поведение — гарантии из раздела 6. Гарантии проверяет общий набор контрактных тестов для всех реализаций, включая Mock.

## 1. Доменные типы

```ts
export type ThreadId = Brand<string, 'ThreadId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ClientMessageId = Brand<string, 'ClientMessageId'>;
export type FileId = Brand<string, 'FileId'>;
export type UploadId = Brand<string, 'UploadId'>;

export interface Message {
  id: MessageId;
  clientMessageId?: ClientMessageId;   // есть у собственных сообщений
  threadId: ThreadId;
  author: Author;
  text?: string;
  files?: FileAttachment[];
  createdAt: string;                   // серверное время, ISO
}

export interface Thread { id: ThreadId; title?: string; createdAt: string /* …уточнить по ответам бэкенда */ }

export interface HistoryPage { threadId: ThreadId; messages: Message[]; hasNext: boolean }   // от новых к старым

export interface SendMessageCmd { threadId: ThreadId; clientMessageId: ClientMessageId; text?: string; fileIds?: FileId[] }
export interface Ack { clientMessageId: ClientMessageId; message: Message }

export type FileRef =
  | { kind: 'blob'; blob: Blob; name: string; mime: string }                        // web
  | { kind: 'host'; hostFileId: string; name: string; mime: string; size: number };  // webview: файл выбран хостом

export interface UploadedFile { fileId: FileId; name: string; mime: string; size: number }

export interface Ctx { epoch: number }
```

Состав `Message`, `Thread` и вложений уточняется по реальным ответам бэкенда (golden fixtures).

## 2. Операции

```ts
export interface TransportLifecycle {
  start(ctx: Ctx): Promise<void>;
  restart(ctx: Ctx): Promise<void>;          // идемпотентен для одного epoch
  dispose(): void;
}
export interface ThreadsPort   { loadThreads(): Promise<Thread[]> }
export interface HistoryPort   { loadHistory(threadId: ThreadId, opts?: { fromStart?: boolean }): Promise<HistoryPage> }
export interface MessagingPort { sendMessage(cmd: SendMessageCmd): Promise<Ack> }
export interface FilesPort {
  uploadFile(file: FileRef, threadId: ThreadId, opts: { uploadId: UploadId; signal?: AbortSignal }): Promise<UploadedFile>;
}
export interface TransportEvents {
  on<K extends keyof TransportEventMap>(type: K, fn: (e: TransportEventMap[K]) => void): () => void;
}

export interface TransportCapabilities {
  uploadFile: boolean;
  requestRestart: boolean;       // webview: может ли SDK попросить хост перезапустить сессию
  maxFileSizeBytes?: number;
}

export type Transport = TransportLifecycle & ThreadsPort & HistoryPort & MessagingPort & FilesPort & TransportEvents & {
  readonly capabilities: TransportCapabilities;
};
```

Сценарии объявляют нужные части порта в `Pick<Deps, …>`. События транспорта `createTransport` публикует во внутреннюю шину с префиксом `transport.`; подписываются на них только маршруты (`entities/*/model/routes.ts`, `features/recovery`). Сессия (FSM без IO) транспорт не видит.

## 3. События

```ts
export interface TransportEventMap {
  'message.received':     { epoch: number; message: Message };
  'message.acked':        { epoch: number; ack: Ack };
  'thread.created':       { epoch: number; thread: Thread };
  'file.uploadProgress':  { epoch: number; uploadId: UploadId; loaded: number; total: number };
  'file.uploadConfirmed': { epoch: number; fileId: FileId; payload: UploadConfirmation };
  'connection.changed':   { epoch: number; state: 'connected' | 'reconnecting' | 'disconnected' };
  'session.invalidated':  { epoch: number; reason: 'update_token_error' | 'token_error' | 'auth_required' };   // web: «перезапусти меня»
  'session.restarted':    { epoch: number };                                                                  // webview: хост уже перезапустил
}
```

Именование: `домен.сущность` + прошедшее время для фактов.

## 4. Ошибки

```ts
export type TransportErrorCode =
  | 'not_started' | 'disposed' | 'aborted_by_restart'
  | 'timeout' | 'network' | 'rate_limited'
  | 'unauthorized' | 'not_supported' | 'invalid_response' | 'server';

export class TransportError extends Error {
  constructor(readonly code: TransportErrorCode, readonly retryable: boolean, readonly cause?: unknown) { super(code); }
}
```

## 5. Epoch

Номер поколения сессии: целое число, растёт при каждом `start` и `restart`, владелец — сессия.
- Канал помечает им всё входящее: HTTP-запрос помнит поколение, в котором встал в очередь; каждый WS-сокет создаётся с текущим поколением; в webview epoch передаётся хосту и возвращается в уведомлениях.
- Ответы и кадры старого поколения отбрасываются; вызов, начатый в старом поколении, отклоняется с `aborted_by_restart`.
- Адаптеры переносят epoch из канала в события; `createTransport` отбрасывает события и отклоняет вызовы старого epoch. Сценарии проверяют epoch после каждого ожидания.
- В стор epoch не попадает. Persist запрещён, номер живёт в памяти и начинается с нуля для каждого инстанса.
- Отмена (`AbortController`) останавливает то, что ещё можно остановить; epoch отбрасывает то, что остановить не успели.

## 6. Поведенческие гарантии

Жизненный цикл:
1. До завершения `start` доменные операции отклоняются с `not_started`, после `dispose` — с `disposed`.
2. `start` и `restart` идемпотентны: повторный вызов с тем же epoch возвращает тот же промис.
3. После `dispose` событий нет, подписки очищены.
4. После завершения `restart` события старого epoch не приходят.

Сообщения:
5. `sendMessage` идемпотентен по `clientMessageId`. Ack и эхо собственного сообщения в `message.received` несут тот же `clientMessageId`.
6. `message.received` может прийти повторно с тем же `id`. Дедупликация — на стороне потребителя.
7. Порядок между событиями и результатами вызовов не гарантируется. Упорядочивание — по `createdAt` и `id` у потребителя.

История:
8. `loadHistory` выдаёт страницы от новых к старым, пагинация независима для каждой ветки.
9. `fromStart: true` сбрасывает позицию ветки. После `hasNext: false` следующий вызов возвращает пустую страницу с `hasNext: false`.

Файлы:
10. `uploadId` задаёт вызывающий; прогресс приходит событиями `file.uploadProgress` с этим `uploadId`.
11. `signal` отменяет загрузку: задача снимается с очереди или прерывается, вызов отклоняется.
12. Файл больше `capabilities.maxFileSizeBytes` отклоняется до начала загрузки.

Ошибки и время:
13. Любой сбой — `TransportError` с кодом и `retryable`; сырых исключений наружу нет.
14. У каждой операции есть таймаут → `timeout`.
15. Операции, которых нет в `capabilities`, потребители не вызывают; если вызвали — `not_supported`.

Данные:
16. Всё внешнее проверено схемами и переведено в доменные типы. Неизвестное событие логируется и отбрасывается; неверный ответ на вызов — `invalid_response`.
17. Время только серверное, ISO.

Параллельность и границы:
18. Методы можно вызывать параллельно; транспорт сам выстраивает их так, как требует протокол (очередь DPoP в web).
19. Транспорт не читает и не пишет стор. Данные приложения получает параметрами фабрики или аргументами методов.

## 7. Отображение на мост (допущение до получения контракта поверхности)

Контракт моста публикует мобильная поверхность; он один и согласованный. Ниже — форма, которую эмулирует фейковый хост в скелете. Реальный контракт переводится в порт `BridgeProtocolAdapter`; гарантии раздела 6 от его формы не зависят.


- Вызов: `{ jsonrpc: '2.0', id, method: 'transport.<операция>', params }` → `result` или `error`.
- Методы: `transport.start`, `transport.restart`, `transport.loadThreads`, `transport.loadHistory`, `transport.sendMessage`, `transport.uploadFile`, `transport.cancelUpload`, `transport.capabilities`, `init.getOptions`.
- Один `BridgeChannel` на инстанс общий для Transport и Platform: методы `platform.pickFiles`, `platform.openLink`, `platform.openFile`, `platform.capabilities` и уведомление `platform.event` (`app.resumed`, `app.paused`, `network.changed`).
- Схемы контракта моста — `shared/contracts/bridge.schema.ts`, копия опубликованного контракта. Перевод операций, уведомлений и ошибок — таблица соответствия в `BridgeProtocolAdapter`. Consumer-driven набор (что SDK использует из контракта + сценарии на фикстурах) передаётся издателю.
- События хоста: уведомление `{ jsonrpc: '2.0', method: 'transport.event', params: { type, epoch, data } }` с `type` из `TransportEventMap`.
- Ошибки: коды JSON-RPC, в `error.data.code` — значение из `TransportErrorCode`.
- Таймаут на каждый запрос задаёт SDK; нет ответа — `timeout`.
- Нет ответа на `transport.capabilities` — минимальный набор возможностей.

## 8. Контрактные тесты (на `createTransport` с BackendProtocolAdapter, BridgeProtocolAdapter и MockAdapter)

- ack приходит с тем же `clientMessageId`; повторная отправка с тем же id не создаёт второе сообщение;
- после `dispose` нет событий, вызовы отклоняются с `disposed`;
- `restart` с тем же epoch выполняется один раз; события старого epoch не приходят после рестарта;
- вызовы, прерванные рестартом, отклоняются с `aborted_by_restart`;
- `fromStart` сбрасывает пагинацию; после `hasNext: false` — пустая страница;
- прогресс загрузки приходит с переданным `uploadId`; `signal` отменяет загрузку;
- неизвестное событие не роняет транспорт; неверный ответ даёт `invalid_response`;
- операция без поддержки даёт `not_supported`.

Автор реализации пишет только харнесс, имитирующий удалённую сторону: адаптеры фейкового бэкенда из скелета (msw-http и ws для `NetworkChannel`, fake-host для `BridgeChannel`).

## 9. Открытые вопросы

- Как файл попадает к хосту в webview: ссылка на выбранный файл или байты через мост (FINDINGS, вопрос 14).
- Может ли SDK просить хост о рестарте — `capabilities.requestRestart` (вопрос 15).
- Состав `Message`, `Thread`, вложений и статусов — по ответам бэкенда (вопросы 5, 9, 12).
- Текущая версия согласованного контракта моста и его формат (FINDINGS, вопрос 44); издатель — мобильная поверхность.
