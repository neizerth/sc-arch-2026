import { sample } from 'effector';
import type { Domain, Event, Unit } from 'effector';

/**
 * delay из effector 23 не экспортируется (он в patronum, зависимость добавлять нельзя) —
 * тот же приём на эффекте: payload пересылается через timeout мс. Принадлежит домену,
 * поэтому после clearNode(domain) результат никуда не доходит.
 */
export function delay<T>(domain: Domain, source: Unit<T>, timeout: number): Event<T> {
  const timerFx = domain.createEffect((payload: T) => new Promise<T>((resolve) => setTimeout(() => resolve(payload), timeout)));
  sample({ clock: source, target: timerFx });
  return timerFx.doneData;
}
