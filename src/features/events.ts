import type { EventCallable } from 'effector';
import type { ActionMap } from './deps';

/** Входные события канала: по одному на команду из ActionMap, создаются в домене инстанса. */
export type Events = { [K in keyof ActionMap]: EventCallable<ActionMap[K]> };
