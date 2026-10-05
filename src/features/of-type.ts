import type { Observable, OperatorFunction } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type { ActionMap, ActionType } from './deps';

/** Команда канала actions$: объединение по типу, payload связан с type через ActionMap. */
export type Action = { [T in ActionType]: { type: T; payload: ActionMap[T] } }[ActionType];
export type Actions = Observable<Action>;

/** Фильтр команд по типу и выделение payload. */
export const ofType = <T extends ActionType>(type: T): OperatorFunction<Action, ActionMap[T]> =>
  (source) =>
    source.pipe(
      filter((a): a is Action & { type: T; payload: ActionMap[T] } => a.type === type),
      map((a) => a.payload),
    );
