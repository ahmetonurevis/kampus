import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import { enumKeys } from '../content/taxonomy.ts'
import {
  assertSubmissionOpen,
  attemptEndsAt,
  attemptState,
  type AttemptRow,
  type AttemptTiming,
  type Deadline,
  type ExtraTimeGrant,
} from './scoring.ts'

/**
 * Bireysel ek süre (docs/domain/beceri-gelisimi.md DOM-BEC-043; OG-248). Öğretmen özel gereksinimi
 * olan kursiyere süreli görevde ek süre tanımlar; ek süre kayıt geçmişinde gerekçesiyle görünür.
 *
 * - Düzey: atama × kursiyer. Ek süre bir kursiyerin bir atamadaki bütün denemelerine uygulanır;
 *   başka atamaya ve başka kursiyere geçmez.
 * - Kayıtlar (`task_extra_times`) değişmez ve yalnız eklenir: verme, değiştirme ve kaldırma
 *   (`minutes: 0`) yeni kayıttır, geçmiş böylece kendiliğinden tutulur. Güncel ek süre son
 *   kayıttır; sürüm son kaydın sıra numarasıdır (kayıt yoksa 0).
 * - Denemenin ek süresi ve bitiş anı saklanmaz; kayıt geçmişinden hesaplanır
 *   (`scoring.ts` `attemptExtraMinutes`): süren deneme yeni ek süreyle uzar, biten deneme yeniden
 *   açılmaz.
 * - Gerekçe serbest metin değil, seçilmiş kategoridir (KVKK): sağlık ve engel bilgisi (özel
 *   nitelikli veri) kayda girmesin diye not alanı yoktur. Kategori kursiyere ve veliye dönmez;
 *   kursiyer yalnız ek dakikayı ve denemesinin bitiş anını görür.
 * - Fonksiyonlar saftır, `now` alır; kimlik, okuma ve yazma servistedir.
 */

z.config(z.locales.tr())

type Instant = Date | string
const toIso = (value: Instant) => new Date(value).toISOString()

/**
 * Ek süre gerekçesi (kategori). `accommodation` özel gereksinim uyarlamasıdır; gereksinimin
 * kendisi (tanı, rapor) yazılmaz.
 */
export const EXTRA_TIME_REASONS = {
  accommodation: { label: 'Bireysel uyarlama' },
  technical_issue: { label: 'Teknik sorun' },
  other: { label: 'Diğer' },
} as const
export type ExtraTimeReason = keyof typeof EXTRA_TIME_REASONS

/** Ek sürenin sınırı (dakika): 1–300 ve görevin kendi süresini aşmaz (`planExtraTime`). */
export const EXTRA_TIME_LIMITS = { min: 1, max: 300 } as const

/** Ek süre verme ve değiştirme gövdesi (API ve form). */
export const extraTimeSchema = z.object({
  minutes: z
    .number({ error: 'Ek süreyi dakika olarak girin.' })
    .int('Ek süre tam dakika olmalıdır.')
    .min(EXTRA_TIME_LIMITS.min, 'Ek süre en az 1 dakika olmalıdır.')
    .max(EXTRA_TIME_LIMITS.max, 'Ek süre en fazla 300 dakika olabilir.'),
  // kvkk: Ç (özel gereksinim kategorisi; ayrıntı kayda girmez, loglanmaz)
  reason: z.enum(enumKeys(EXTRA_TIME_REASONS), { error: 'Ek süre gerekçesini seçin.' }),
})
export type ExtraTimeInput = z.input<typeof extraTimeSchema>
export type ExtraTime = z.output<typeof extraTimeSchema>

/** Ek süreyi veren roller; öğretmen yalnız kendi atamasında (`canManageExtraTime`). */
export const EXTRA_TIME_ROLES = ['yonetici', 'ogretmen'] as const

/** `task_extra_times` satırı: kursiyerin bir atamadaki ek süre değişikliği. */
export type ExtraTimeRow = ExtraTimeGrant & {
  /** Atama × kursiyer içinde 1'den artan sıra; ek sürenin sürümüdür. */
  sequence: number
  /** Kaldırmada (`minutes: 0`) `null`. */
  reason: ExtraTimeReason | null
  grantedByUserId: string
}

/** Kayıtlar sıra numarasıyla (yeniden eskiye değil, eskiden yeniye). */
function ordered(rows: readonly ExtraTimeRow[]): ExtraTimeRow[] {
  return [...rows].sort((a, b) => a.sequence - b.sequence)
}

/** Ek sürenin sürümü: son kaydın sıra numarası, kayıt yoksa 0. */
export function extraTimeVersion(rows: readonly ExtraTimeRow[]): number {
  return ordered(rows).at(-1)?.sequence ?? 0
}

/** Güncel ek süre: son kayıt; kayıt yoksa ya da son kayıt kaldırmaysa `null`. */
export function currentExtraTime(rows: readonly ExtraTimeRow[]): ExtraTimeRow | null {
  const last = ordered(rows).at(-1)
  return last === undefined || last.minutes === 0 ? null : last
}

/** Kursiyerin deneme süre bağlamı: atamanın süresi ve kursiyerin ek süre geçmişi. */
export function learnerTiming(
  base: Pick<AttemptTiming, 'timeLimitMinutes' | 'deadline'>,
  rows: readonly ExtraTimeRow[],
): AttemptTiming {
  return {
    timeLimitMinutes: base.timeLimitMinutes,
    deadline: base.deadline,
    extraMinutes: currentExtraTime(rows)?.minutes ?? 0,
    extraTime: ordered(rows).map(({ minutes, grantedAt }) => ({ minutes, grantedAt })),
  }
}

/**
 * Ek süreyi kim yönetir (DOM-BEC-043, DOM-YTK-028): yönetici her atamada, öğretmen yalnız kendi
 * atamasında. Atamayı kapsamındaki sınıf yüzünden gören öğretmen ek süreyi okur, değiştirmez.
 */
// TODO(beceri-ek-sure-yetki): Domain "öğretmen tanımlar" diyor, hangi öğretmen olduğunu
// söylemiyor; atama ayarlarını değiştirenle (atayan ve yönetici) aynı dar küme seçildi.
export function canManageExtraTime(
  actor: { role: string; userId: string },
  assignment: { assignedByUserId: string },
): boolean {
  if (actor.role === 'yonetici') return true
  return actor.role === 'ogretmen' && assignment.assignedByUserId === actor.userId
}

export type ExtraTimeChange =
  | { kind: 'grant'; input: unknown }
  | { kind: 'change'; input: unknown; expectedVersion: number }
  | { kind: 'remove'; expectedVersion: number }

export type ExtraTimePlanInput = {
  actor: { role: string; userId: string }
  /** Kurumun modülleri; `learning` kapalıysa ret. */
  modules: Readonly<Record<string, boolean>>
  assignment: {
    assignedByUserId: string
    timeLimitMinutes: number | null
    deadline: Deadline
    archivedAt: string | null
  }
  /** Kursiyer atamanın hedeflediği (ve aktörün kapsamındaki) kişi mi; servis çözer. */
  learnerTargeted: boolean
  /** Kursiyerin bu atamadaki ek süre kayıtları. */
  rows: readonly ExtraTimeRow[]
  /** Kursiyerin bu atamadaki denemeleri. */
  attempts: readonly AttemptRow[]
  change: ExtraTimeChange
  now: Instant
}

/** Yazılacak yeni ek süre kaydı (`grantedByUserId` aktördür). */
export type ExtraTimePlan = Omit<ExtraTimeRow, 'grantedByUserId'>

const forbidden = () =>
  new DomainError('extra_time_forbidden', 'Bu görevde ek süre tanımlama yetkiniz bulunmuyor.', {
    kind: 'forbidden',
  })
const rule = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { path })

/**
 * Ek süre verme, değiştirme ve kaldırma (DOM-BEC-043). Sıra: modül ve rol (403) → atama ve
 * kursiyer kapsamı (404) → atayan ya da yönetici (403) → gövde (Zod) → sürüm (409) → kayıt
 * durumu (verilmiş ek süreye ikinci verme 409 `extra_time_exists`, olmayanı değiştirme ya da
 * kaldırma 404 `extra_time_not_found`) → kural (422): yalnız süreli görevde, teslim penceresi
 * açıkken, görevin süresini aşmadan; süren denemeyi şimdiden önce bitirecek kısaltma ya da
 * kaldırma reddedilir (deneme geçmişte bitmiş sayılır, kaydedilmiş cevaplar geride kalırdı).
 * Hata hiçbir şey yazmaz; dönen tek kayıt eklenir.
 */
// TODO(beceri-ek-sure-sinir): Domain üst sınır vermiyor; en dar yorumla görevin süresi kadar
// (çift süre) ve en çok 300 dakika seçildi.
export function planExtraTime(input: ExtraTimePlanInput): ExtraTimePlan {
  const { actor, assignment, change } = input
  if (input.modules.learning !== true) {
    throw new DomainError('module_disabled', 'Bu modül kullanıma kapalı.', { kind: 'forbidden' })
  }
  if (!(EXTRA_TIME_ROLES as readonly string[]).includes(actor.role)) throw forbidden()
  if (assignment.archivedAt !== null || !input.learnerTargeted) {
    throw new DomainError('not_found', 'Kayıt bulunamadı.', { kind: 'not_found' })
  }
  if (!canManageExtraTime(actor, assignment)) throw forbidden()
  const data = change.kind === 'remove' ? null : extraTimeSchema.parse(change.input)
  const version = extraTimeVersion(input.rows)
  if (change.kind !== 'grant' && change.expectedVersion !== version) {
    throw new DomainError('version_conflict', 'Ek süre başka biri tarafından değiştirildi.', {
      kind: 'conflict',
    })
  }
  const current = currentExtraTime(input.rows)
  if (change.kind === 'grant' && current !== null) {
    throw new DomainError(
      'extra_time_exists',
      'Bu kursiyerin ek süresi zaten var; değiştirmeyi kullanın.',
      { kind: 'conflict' },
    )
  }
  if (change.kind !== 'grant' && current === null) {
    throw new DomainError('extra_time_not_found', 'Bu kursiyerin ek süresi yok.', {
      kind: 'not_found',
    })
  }
  const limit = assignment.timeLimitMinutes
  if (limit === null) {
    throw rule('extra_time_untimed', 'Ek süre yalnız süreli görevde tanımlanır.', ['minutes'])
  }
  assertSubmissionOpen(assignment.deadline, input.now)
  const minutes = data?.minutes ?? 0
  if (minutes > limit) {
    throw rule('extra_time_too_long', `Ek süre görevin süresini (${limit} dakika) aşamaz.`, [
      'minutes',
    ])
  }
  const now = toIso(input.now)
  const timing = learnerTiming(assignment, input.rows)
  const next: AttemptTiming = { ...timing, extraTime: undefined, extraMinutes: minutes }
  for (const attempt of input.attempts) {
    if (attemptState(attempt, timing, now).status !== 'in_progress') continue
    const endsAt = attemptEndsAt(attempt.startedAt, next)
    if (endsAt !== null && Date.parse(endsAt) <= Date.parse(now)) {
      throw rule(
        'extra_time_below_elapsed',
        'Kursiyerin süren denemesinde geçen süre bu ek süreyi aştı; daha uzun bir süre girin.',
        ['minutes'],
      )
    }
  }
  return {
    sequence: version + 1,
    minutes,
    reason: data?.reason ?? null,
    grantedAt: now,
  }
}
