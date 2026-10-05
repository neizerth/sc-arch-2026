import { Data } from 'effect';

/** Нет соединения: сообщение остаётся pending, его дошлёт outbox. */
export class Offline extends Data.TaggedError('Offline')<{}> {}
/** Нет ack за 10 с. */
export class AckTimeout extends Data.TaggedError('AckTimeout')<{}> {}
/** Результат пришёл уже в другом поколении сессии — отбрасываем. */
export class StaleEpoch extends Data.TaggedError('StaleEpoch')<{}> {}
/** Любой другой отказ транспорта при отправке. */
export class SendFailed extends Data.TaggedError('SendFailed')<{ readonly cause: unknown }> {}
/** Не удалось загрузить страницу истории. */
export class HistoryFailed extends Data.TaggedError('HistoryFailed')<{ readonly cause: unknown }> {}
