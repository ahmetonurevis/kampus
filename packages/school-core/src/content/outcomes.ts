import { z } from 'zod'
import { subjects } from '../data/curriculum.ts'
import { coordinatesArea, type CoordinatorScope } from '../lib/coordinator-duties.ts'
import type { Role } from '../modules/navigation.ts'
import { GRADE_LEVEL_RANGE, OUTCOME_SOURCES, enumKeys, type OutcomeSource } from './taxonomy.ts'

/**
 * Kazanım / öğrenme çıktısı kataloğu (docs/domain/kaynak-platformu.md DOM-KYN-011; ADR 0004 karar
 * 9; IST-030, 031). Kazanım serbest metin girilmez: kaynak etiketi katalogdaki bir koda işaret eder
 * (`outcomeSource` + `outcomeId`, `outcomeId` kataloğun kodudur).
 *
 * - Platform kataloğu (`platform`) öğretim programı kodlarını sürümüyle taşır, kurumdan bağımsızdır;
 *   HTTP'den yazılmaz, platform bakım betiği yazar (ADR 0004 karar 9).
 * - Kurum kataloğu (`institution`) kurumun kendi kodlarıdır; yönetici ve kapsamındaki koordinatör
 *   ekler ve arşivler. Kod kurumda tekildir; arşivlenen kod yeniden kullanılmaz, çünkü eski içerik
 *   aynı koda bağlı kalır.
 * - Arşivlenen kod yeni seçimde reddedilir; sürümde zaten bulunan kod korunur (`outcomeSelectionIssues`).
 *
 * Fonksiyonlar saftır; yükleme ve yazma API servisindedir.
 */

z.config(z.locales.tr())

/** Kod: büyük harf, rakam, nokta, tire ve alt çizgi; harf ya da rakamla başlar. */
export const OUTCOME_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/
export const OUTCOME_CODE_MAX = 40
export const OUTCOME_NAME_MAX = 300

export const learningOutcomeCodeSchema = z
  .string()
  .trim()
  .min(1, 'Kazanım kodunu yazın.')
  .max(OUTCOME_CODE_MAX, `Kod en fazla ${OUTCOME_CODE_MAX} karakter olabilir.`)
  .transform((code) => code.toUpperCase())
  .refine((code) => OUTCOME_CODE_PATTERN.test(code), {
    message: 'Kod yalnız harf, rakam, nokta, tire ve alt çizgi içerebilir (ör. MAT.7.1.2).',
  })

/** Kurum kazanımı ekleme gövdesi (API ve form şeması). */
export const learningOutcomeInputSchema = z.strictObject({
  code: learningOutcomeCodeSchema,
  name: z
    .string()
    .trim()
    .min(1, 'Kazanımın adını yazın.')
    .max(OUTCOME_NAME_MAX, `En fazla ${OUTCOME_NAME_MAX} karakter girebilirsiniz.`),
  // TODO(kazanim-ders-dogrulama): ders kurumun ders kaydıyla doğrulanmıyor (kaynak etiketi gibi).
  subjectId: z.string().trim().min(1, 'Dersi seçin.').max(200),
  gradeLevel: z
    .number()
    .int()
    .min(GRADE_LEVEL_RANGE.min, 'Sınıf düzeyi 5 ile 12 arasında olmalıdır.')
    .max(GRADE_LEVEL_RANGE.max, 'Sınıf düzeyi 5 ile 12 arasında olmalıdır.'),
})
export type LearningOutcomeInput = z.output<typeof learningOutcomeInputSchema>

export const learningOutcomeSourceSchema = z.enum(enumKeys(OUTCOME_SOURCES))

/** Katalog satırı (iki kaynak birleşik). `programVersion` yalnız platform satırında doludur. */
export type LearningOutcome = {
  source: OutcomeSource
  code: string
  name: string
  subjectId: string
  gradeLevel: number
  programVersion: string | null
  archivedAt: string | null
}

// --- Yetki --------------------------------------------------------------------------------

export type OutcomeManager = { role: Role; coordination: CoordinatorScope }

/**
 * Kurum kazanımını yönetici ekler ve arşivler; öğretmen yalnız zümre başkanı/koordinatör olduğu
 * derste (DOM-YTK-027). `subjectId` verilmezse "herhangi bir derste yönetebilir mi" sorusudur
 * (rota düzeyi 403).
 */
export function canManageLearningOutcomes(
  manager: OutcomeManager,
  subjectId?: string | undefined,
): boolean {
  if (manager.role === 'yonetici') return true
  if (manager.role !== 'ogretmen') return false
  if (subjectId === undefined) return manager.coordination.subjectIds.length > 0
  return coordinatesArea(manager.coordination, { subjectId, cefrLevel: null })
}

/** Katalog okuma: içerik personeli (yönetici, öğretmen); öğrenci, veli ve ön büro okumaz. */
export const canReadLearningOutcomes = (role: Role) => role === 'yonetici' || role === 'ogretmen'

// --- Seçim denetimi -----------------------------------------------------------------------

export type OutcomeRef = { outcomeSource: OutcomeSource; outcomeId: string }
export const outcomeKey = (ref: OutcomeRef) => `${ref.outcomeSource}:${ref.outcomeId}`

export type OutcomeSelectionIssue = {
  path: (string | number)[]
  code: 'outcome_not_found' | 'outcome_archived'
  message: string
}

export const OUTCOME_SELECTION_MESSAGES = {
  outcome_not_found: 'Seçilen kazanım katalogda bulunamadı. Listeden bir kazanım seçin.',
  outcome_archived: 'Seçilen kazanım arşivlenmiş. Etkin bir kazanım seçin.',
} as const satisfies Record<OutcomeSelectionIssue['code'], string>

/**
 * Kaynak sürümünün kazanım seçimi (DOM-KYN-011). Yeni seçilen her kod katalogda bulunmalı ve
 * arşivli olmamalı; `kept` (kaynağın sürümlerinde zaten bulunan bağlantılar) aynen korunur:
 * arşivlenen ya da katalog öncesi serbest girilmiş kod eski içerikte silinmez, yeniden seçilemez
 * yalnız. `catalog` yalnız istenen kodların satırlarıdır (anahtar `outcomeKey`).
 */
export function outcomeSelectionIssues(input: {
  outcomes: readonly OutcomeRef[]
  kept: readonly OutcomeRef[]
  catalog: ReadonlyMap<string, { archivedAt: string | null }>
}): OutcomeSelectionIssue[] {
  const kept = new Set(input.kept.map(outcomeKey))
  return input.outcomes.flatMap((outcome, index) => {
    const key = outcomeKey(outcome)
    if (kept.has(key)) return []
    const row = input.catalog.get(key)
    const code =
      row === undefined ? 'outcome_not_found' : row.archivedAt === null ? null : 'outcome_archived'
    return code === null
      ? []
      : [
          {
            path: ['tags', 'outcomes', index, 'outcomeId'],
            code,
            message: OUTCOME_SELECTION_MESSAGES[code],
          },
        ]
  })
}

/** Yeni seçilen (korunmayan) bağlantılar; servis yalnız bunların katalog satırını okur. */
export function newOutcomeRefs(
  outcomes: readonly OutcomeRef[],
  kept: readonly OutcomeRef[],
): OutcomeRef[] {
  const keptKeys = new Set(kept.map(outcomeKey))
  return outcomes.filter((outcome) => !keptKeys.has(outcomeKey(outcome)))
}

// --- Örnek platform kataloğu --------------------------------------------------------------

/**
 * Örnek program sürümü. Kodlar müfredat örnek verisinin (`data/curriculum.ts`) ders ve konu
 * listesinden türetilir; resmî MEB öğretim programı kodları değildir. Gerçek program içe aktarımı
 * OG-132'dedir (`TODO(katalog)`); aynı bakım betiği gerçek sürümü ekler, bu sürümü arşivler.
 */
export const SAMPLE_PROGRAM_VERSION = 'ornek-2025'

/** Ders kodu öneki (örnek katalog). */
const SUBJECT_PREFIXES: Record<string, string> = {
  math: 'MAT',
  turkish: 'TUR',
  science: 'FEN',
  social: 'SOS',
  literature: 'TDE',
  physics: 'FIZ',
  chemistry: 'KIM',
  biology: 'BIY',
  history: 'TAR',
  geography: 'COG',
  english: 'ENG',
  informatics: 'BIL',
  music: 'MUZ',
  art: 'GOR',
  pe: 'BED',
  religion: 'DKA',
}

export type PlatformOutcomeSeed = Omit<LearningOutcome, 'source' | 'archivedAt'> & {
  programVersion: string
  /** Katalogdaki sıra (ders, düzey, konu). */
  position: number
}

/**
 * Örnek platform kataloğu: her ders, sınıf düzeyi ve konu için bir kazanım; kod
 * `<ders öneki>.<düzey>.<konu sırası>.1` (ör. `MAT.7.1.1` Matematik 7, Sayılar ve işlemler).
 * Deterministiktir; sıra kimlik değildir, kod kimliktir.
 */
export function samplePlatformOutcomes(): PlatformOutcomeSeed[] {
  const rows: PlatformOutcomeSeed[] = []
  for (const subject of subjects) {
    const prefix = SUBJECT_PREFIXES[subject.id]
    if (prefix === undefined) continue
    for (let grade = subject.min; grade <= subject.max; grade += 1)
      subject.topics.forEach((topic, index) => {
        rows.push({
          code: `${prefix}.${grade}.${index + 1}.1`,
          name: topic,
          subjectId: subject.id,
          gradeLevel: grade,
          programVersion: SAMPLE_PROGRAM_VERSION,
          position: rows.length + 1,
        })
      })
  }
  return rows
}
