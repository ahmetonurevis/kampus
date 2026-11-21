import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { CEFR_LEVELS, GRADE_LEVEL_RANGE, enumKeys, type CefrLevel } from '../content/taxonomy.ts'

/**
 * Sınıf düzeyi → hedef CEFR seviyesi eşlemesi, `cefrTargets` (docs/domain/beceri-gelisimi.md
 * DOM-BEC-063; ADR 0004 karar 10, 11). Platform varsayılan eşleme vermez; İngilizce zümresi eğitim
 * yılı başında düzey başına hedefi girer ve eşleme o yıl için kilitlenir. Eşleme yoksa düzey
 * raporu "hedef tanımlı değil" gösterir; beceri görevleri yine yayımlanabilir.
 *
 * Kurum başına yılda bir satırdır; ADR 0004 karar 10'a göre `records`'ta core koleksiyonu olur.
 */
// TODO(cefr-targets-state): State koleksiyonu kaydı (örnek veri, `COLLECTION_MODULES` modül
// eşlemesi, `lib/scope.ts` kapsamı, API koleksiyon listesi ve yetki eylemi) bu dalda eklenmedi:
// CEFR için modül anahtarı yok ve kayıt API'ye dokunur. Şema ve kilit kuralı buradadır; kayıt F5b'de.

z.config(z.locales.tr())

type Instant = Date | string
const toIso = (value: Instant) => new Date(value).toISOString()

/** Hedef yoksa ekrandaki ifade (DOM-BEC-063). */
export const TARGET_UNDEFINED_LABEL = 'Hedef tanımlı değil'

const gradeCount = GRADE_LEVEL_RANGE.max - GRADE_LEVEL_RANGE.min + 1

/** Eşleme gövdesi: eğitim yılı (başladığı takvim yılı) ve düzey başına tek hedef. */
export const cefrTargetsInputSchema = z.object({
  academicYear: z.number().int().min(2000).max(2100),
  targets: z
    .array(
      z.object({
        gradeLevel: z
          .number()
          .int()
          .min(GRADE_LEVEL_RANGE.min, 'Sınıf düzeyi 5–12 arasında olmalıdır.')
          .max(GRADE_LEVEL_RANGE.max, 'Sınıf düzeyi 5–12 arasında olmalıdır.'),
        level: z.enum(enumKeys(CEFR_LEVELS), { error: 'Bir CEFR seviyesi seçin.' }),
      }),
    )
    .min(1, 'En az bir sınıf düzeyi için hedef girin.')
    .max(gradeCount)
    .refine((list) => new Set(list.map((t) => t.gradeLevel)).size === list.length, {
      error: 'Her sınıf düzeyine bir hedef girilir.',
    }),
})
export type CefrTargetsInput = z.input<typeof cefrTargetsInputSchema>

/** `cefrTargets` kaydı. Kayıtla birlikte kilitlenir; kilit anı ve kilitleyen saklanır. */
export type CefrTargetsRecord = z.output<typeof cefrTargetsInputSchema> & {
  id: string
  lockedAt: string
  // kvkk: K
  lockedByUserId: string
}
export type CefrTargetsDraft = Omit<CefrTargetsRecord, 'id'>

function assertSchool(institutionType: InstitutionType): void {
  if (institutionType !== 'school') {
    throw new DomainError(
      'module_unavailable_for_type',
      'Sınıf düzeyi hedefi yalnız okulda tanımlanır.',
      { kind: 'not_found' },
    )
  }
}

/**
 * Eşlemeyi kaydeder ve kilitler (DOM-BEC-063). Yalnız içinde bulunulan eğitim yılı için girilir;
 * o yılın eşlemesi bir kez kaydedilir ve değişmez (güncelleme işlemi yoktur). Geçmiş veya gelecek
 * yıl reddedilir.
 */
// TODO(cefr-hedef-yili): "Eğitim yılı başında" için bir tarih penceresi domain'de yok; en
// muhafazakâr yorumla yalnız güncel eğitim yılına bir kez girilir, ilk kayıt kilittir.
export function planCefrTargets(input: {
  institutionType: InstitutionType
  /** Kurumun güncel eğitim yılı (State `academicYear`). */
  currentAcademicYear: number
  existing: readonly Pick<CefrTargetsRecord, 'academicYear'>[]
  // kvkk: K
  userId: string
  input: unknown
  now: Instant
}): CefrTargetsDraft {
  assertSchool(input.institutionType)
  const data = cefrTargetsInputSchema.parse(input.input)
  if (data.academicYear !== input.currentAcademicYear) {
    throw new DomainError(
      'cefr_targets_year_invalid',
      'Hedefler yalnız içinde bulunulan eğitim yılı için girilir.',
      { path: ['academicYear'] },
    )
  }
  if (input.existing.some((record) => record.academicYear === data.academicYear)) {
    throw new DomainError(
      'cefr_targets_locked',
      'Bu eğitim yılının hedefleri kilitli; yıl içinde değiştirilemez.',
      { kind: 'conflict', path: ['academicYear'] },
    )
  }
  const targets = [...data.targets].sort((a, b) => a.gradeLevel - b.gradeLevel)
  return {
    academicYear: data.academicYear,
    targets,
    lockedAt: toIso(input.now),
    lockedByUserId: input.userId,
  }
}

/** Düzeyin o yılki hedefi; eşleme veya düzey yoksa "hedef tanımlı değil" (DOM-BEC-063). */
export function cefrTargetFor(
  records: readonly Pick<CefrTargetsRecord, 'academicYear' | 'targets'>[],
  academicYear: number,
  gradeLevel: number,
): { status: 'defined'; level: CefrLevel } | { status: 'undefined'; label: string } {
  const level = records
    .find((record) => record.academicYear === academicYear)
    ?.targets.find((target) => target.gradeLevel === gradeLevel)?.level
  return level === undefined
    ? { status: 'undefined', label: TARGET_UNDEFINED_LABEL }
    : { status: 'defined', level }
}
