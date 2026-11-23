import { dayKey } from './format.ts'

/** Reşit olma yaşı: bu yaşın altı velilidir (DOM-KAY-003, DOM-KAY-009, DOM-DIL-091). */
export const ADULT_AGE = 18

/** Gerçek takvim günü mü (`YYYY-MM-DD`; 2008-02-30 değildir). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value
}

/**
 * `birthDate` (`YYYY-MM-DD`) doğumlu kişinin `now` anındaki tam yaşı; gün Europe/Istanbul'a göredir.
 * 29 Şubat doğumlu artık olmayan yılda 1 Mart'ta yaş alır. Kesin kayıt (`lib/domain.ts`) ve CEFR
 * devamsızlık bildirimi (`cefr/progression.ts`) aynı hesabı kullanır.
 */
export function ageOn(birthDate: string, now: string | number | Date = new Date()): number {
  const today = dayKey(now)
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4))
  return today.slice(5) < birthDate.slice(5) ? years - 1 : years
}

/** `now` anında 18 yaş altında mı (`ADULT_AGE`). */
export const isUnderAdultAge = (birthDate: string, now: string | number | Date = new Date()) =>
  ageOn(birthDate, now) < ADULT_AGE
