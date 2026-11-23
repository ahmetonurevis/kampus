import { z } from 'zod'
import {
  LEARNER_KINDS,
  PLACEMENT_ANSWER_SECTIONS,
  PLACEMENT_MODES,
  PLACEMENT_RUBRIC_SECTIONS,
  PLACEMENT_SECTIONS,
  placementDecisionInputSchema,
  placementSessionInputSchema,
  type LearnerKind,
  type PlacementSection,
} from '@kampus/school-core/cefr/placement.ts'
import { CEFR_LEVELS, SKILLS, enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { rubricScoreInputSchema } from '@kampus/school-core/skills/rubric.ts'
import type {
  PlacementFormItem,
  PlacementSession,
  PlacementSessionRow,
} from '@kampus/react-shared/cefr.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { bandNeedsComment } from '../tasks/task-model.ts'
import { PLACEMENT_VALIDITY } from './cefr-profile-model.ts'

/**
 * Seviye tespiti ekranının sunumu (OG-078; IST-058; DOM-DIL-010…012). Bölüm puanı, öneri ve
 * geçerlilik sunucuda hesaplanır; burada yalnız etiket, satır ve eylemin açık olup olmadığı
 * vardır. Eylem koşulları core kurallarının (`planPlacementSectionEntry`, `planPlacementDecision`)
 * aynasıdır; son söz sunucunundur, ret Türkçe toast olur.
 */

const DATE_OPTIONS = { day: 'numeric', month: 'long', year: 'numeric' } as const

export const LEARNER_KIND_OPTIONS = enumKeys(LEARNER_KINDS).map((kind) => ({
  value: kind,
  label: LEARNER_KINDS[kind].label,
}))
export const MODE_OPTIONS = enumKeys(PLACEMENT_MODES).map((mode) => ({
  value: mode,
  label: PLACEMENT_MODES[mode].label,
}))
export const LEVEL_OPTIONS = enumKeys(CEFR_LEVELS)
export const SECTION_KEYS = enumKeys(PLACEMENT_SECTIONS)

export const isLearnerKind = (value: string | null): value is LearnerKind =>
  value !== null && Object.hasOwn(LEARNER_KINDS, value)
/**
 * Adaylar CRM modülündedir (`prospects` koleksiyonu); modül kapalıysa aday türü seçilemez ve
 * adreste `?tur=prospect` olsa bile öğrenciye dönülür.
 */
export const learnerKindOptions = (crmOpen: boolean) =>
  crmOpen
    ? LEARNER_KIND_OPTIONS
    : LEARNER_KIND_OPTIONS.filter((option) => option.value !== 'prospect')
export const resolveLearnerKind = (value: string | null, crmOpen: boolean): LearnerKind =>
  isLearnerKind(value) && (crmOpen || value !== 'prospect') ? value : 'student'
export const isPlacementSection = (value: string): value is PlacementSection =>
  Object.hasOwn(PLACEMENT_SECTIONS, value)

/** Otomatik (cevap girilen) ve rubrikle puanlanan bölümler: giriş gövdesi türe göre ayrılır. */
export type AnswerSection = (typeof PLACEMENT_ANSWER_SECTIONS)[number]
export type RubricSection = (typeof PLACEMENT_RUBRIC_SECTIONS)[number]
export const isAnswerSection = (section: PlacementSection): section is AnswerSection =>
  PLACEMENT_ANSWER_SECTIONS.some((item) => item === section)
export const isRubricSection = (section: PlacementSection): section is RubricSection =>
  PLACEMENT_RUBRIC_SECTIONS.some((item) => item === section)

export const sectionLabel = (section: PlacementSection) => SKILLS[section].label

// --- Kişi seçici -------------------------------------------------------------------------

export interface LearnerOption {
  id: string
  label: string
}

/** Kişi seçicisinin seçenekleri: ada göre Türkçe sıralı, aramaya (ad öneki değil, içinde) göre. */
export function learnerOptions(
  records: readonly { id: string; name?: string | null }[],
  query: string,
): LearnerOption[] {
  const needle = query.trim().toLocaleLowerCase('tr')
  return records
    .map((record) => ({ id: record.id, label: record.name?.trim() || record.id }))
    .filter((option) => needle === '' || option.label.toLocaleLowerCase('tr').includes(needle))
    .sort((left, right) => left.label.localeCompare(right.label, 'tr'))
}

// --- Liste --------------------------------------------------------------------------------

export type PlacementListRow = {
  id: string
  started: string
  mode: string
  status: string
  tone: BadgeTone
  completed: string
  until: string
}

/** Liste satırı: başlangıç, yer, durum ve geçerlilik sonu (DOM-DIL-011, DOM-DIL-012). */
export function placementListRow(row: PlacementSessionRow): PlacementListRow {
  const validity = PLACEMENT_VALIDITY[row.validity.status]
  return {
    id: row.id,
    started: dateLabel(row.startedAt, DATE_OPTIONS),
    mode: PLACEMENT_MODES[row.mode].label,
    status: validity.label,
    tone: validity.tone,
    completed: row.completedAt ? dateLabel(row.completedAt, DATE_OPTIONS) : '',
    until: row.validity.validUntil ? dateLabel(row.validity.validUntil, DATE_OPTIONS) : '',
  }
}

// --- Ayrıntı ------------------------------------------------------------------------------

/** Önerilen CEFR seviyesi (DOM-DIL-010): öneri karar değildir; eksik bölümler metinle söylenir. */
export function suggestedLevel(session: Pick<PlacementSession, 'suggestion'>): {
  level: string
  note: string
} {
  const { overall } = session.suggestion
  if (overall.status === 'suggested')
    return { level: overall.level, note: 'Bölüm sonuçlarına göre öneri; karar değildir.' }
  const missing = overall.missingSkills.map((skill) => SKILLS[skill].label)
  return {
    level: 'Öneri yok',
    note: missing.length
      ? `Öneri için eksik bölüm: ${missing.join(', ')}`
      : 'Öneri için yeterli sonuç yok.',
  }
}

/** Geçerlilik özeti (DOM-DIL-012): süren tespitte sonuç yoktur; bitmişte son gün söylenir. */
export function validityText(session: Pick<PlacementSession, 'validity'>): string {
  const { validity } = session
  if (validity.status === 'in_progress') return 'Tespit sürüyor'
  const until = validity.validUntil ? dateLabel(validity.validUntil, DATE_OPTIONS) : ''
  return validity.status === 'valid' ? `${until} tarihine kadar geçerli` : `Süresi doldu (${until})`
}

const SECTION_STATUS = {
  missing: 'Formda yok',
  pending: 'Girilmedi',
  scored: 'Puanlandı',
} as const

export interface SectionRow {
  section: PlacementSection
  label: string
  scoring: string
  status: string
  result: string
  targetLevel: string
  canScore: boolean
}

/**
 * Bölüm girişi açık mı (core `planPlacementSectionEntry`): karar verilmemiş, bölüm girilmemiş ve
 * formda var; otomatik bölüm yalnız süren oturumda, rubrikli bölüm bittikten sonra da girilir.
 */
export function canScoreSection(
  session: Pick<PlacementSession, 'sections' | 'decisions' | 'completedAt'>,
  section: PlacementSection,
): boolean {
  const row = session.sections.find((item) => item.section === section)
  if (row === undefined || row.status !== 'pending' || session.decisions.length > 0) return false
  return row.scoring === 'rubric' || session.completedAt === null
}

/**
 * Bitirmeden önce girilmemiş otomatik bölümlerin adları: formda olup henüz girilmeyenler. Bitmiş
 * oturumda otomatik bölüm girilemediğinden bitirme onayı bunları söyler (DOM-DIL-010).
 */
export function unenteredAutoSections(session: Pick<PlacementSession, 'sections'>): string[] {
  return session.sections
    .filter((row) => row.scoring === 'auto' && row.status === 'pending')
    .map((row) => row.label)
}

/** Beş bölüm sabit sırayla: puanlama türü, durum, yüzde ve hedef seviye. */
export function sectionRows(
  session: Pick<PlacementSession, 'sections' | 'decisions' | 'completedAt'>,
): SectionRow[] {
  return session.sections.map((row) => ({
    section: row.section,
    label: row.label,
    scoring: row.scoring === 'auto' ? 'Otomatik' : 'Rubrikle',
    status: SECTION_STATUS[row.status],
    result: row.percent === null ? '—' : `%${row.percent}`,
    targetLevel: row.targetLevel ?? '—',
    canScore: canScoreSection(session, row.section),
  }))
}

/** Beceri önerileri: puanlanmamış becerinin önerisi çıkmaz. */
export function skillSuggestionRows(session: Pick<PlacementSession, 'suggestion'>) {
  return session.suggestion.skills.map((row) => ({
    key: row.skill,
    label: row.label,
    value: row.status === 'suggested' && row.level ? row.level : 'Sonuç yetersiz',
  }))
}

/**
 * Yerleştirme kararı neden verilemez (core `planPlacementDecision`); verilebiliyorsa `null`.
 * Sıra sunucununkiyle aynıdır.
 */
export function decisionBlockedReason(
  session: Pick<PlacementSession, 'validity' | 'sections' | 'decisions'>,
): string | null {
  if (session.decisions.length > 0) return 'Bu tespit için yerleştirme kararı verildi.'
  if (session.validity.status === 'in_progress') return 'Karar için önce seviye tespitini bitirin.'
  if (session.validity.preliminary)
    return 'Uzaktan yapılan ön tespitle yerleştirme kararı verilmez.'
  if (session.validity.status === 'expired')
    return 'Tespit sonucunun 90 günlük geçerliliği doldu; yeni tespit gerekir.'
  const unscored = session.sections.filter(
    (row) => PLACEMENT_SECTIONS[row.section].scoring === 'rubric' && row.status !== 'scored',
  )
  if (unscored.length)
    return `Karar için ${unscored.map((row) => row.label.toLocaleLowerCase('tr')).join(' ve ')} bölümü puanlanmalı.`
  return null
}

export function decisionRows(session: Pick<PlacementSession, 'decisions'>) {
  return session.decisions.map((decision) => ({
    key: decision.id,
    label: decision.skill === null ? 'Genel seviye' : SKILLS[decision.skill].label,
    value: decision.level,
    rationale: decision.rationale,
    decidedAt: dateLabel(decision.decidedAt, DATE_OPTIONS),
  }))
}

/** Yerleştirilen genel seviye; karar yoksa `null`. */
export const placedLevel = (session: Pick<PlacementSession, 'decisions'>) =>
  session.decisions.find((decision) => decision.skill === null)?.level ?? null

// --- Formlar ------------------------------------------------------------------------------

/** Oturum açma formu: core gövde şeması (`placementSessionInputSchema`); form tek alanda seçilir. */
export const openFormSchema = placementSessionInputSchema
  .omit({ formId: true, formVersionId: true })
  .extend({ form: z.string().min(1, 'Bir tespit formu seçin.') })
export type OpenFormValues = z.input<typeof openFormSchema>

const FORM_SEPARATOR = ':'
export const formOptionValue = (resourceId: string, versionId: string) =>
  `${resourceId}${FORM_SEPARATOR}${versionId}`

/** Seçilen form değeri gövdedeki `formId` ve `formVersionId`'ye ayrılır. */
export function openBody(values: z.output<typeof openFormSchema>) {
  const [formId = '', formVersionId = ''] = values.form.split(FORM_SEPARATOR)
  return {
    learnerKind: values.learnerKind,
    learnerId: values.learnerId,
    formId,
    formVersionId,
    mode: values.mode,
  }
}

/** Cevap girişi: kaç soru cevaplandı (boş bırakılan soru yanlış sayılır). */
export function answeredCount(
  items: readonly Pick<PlacementFormItem, 'questionVersionId'>[],
  answers: Readonly<Record<string, unknown>>,
): number {
  return items.filter((item) => answers[item.questionVersionId] !== undefined).length
}

/**
 * Rubrikli bölüm formu (yazma, konuşma): rubrik, görevin hedef seviyesi ve kriter bantları.
 * Alan sınırları core `rubricScoreInputSchema`'dan; bant seçilmemiş (`null`) olabilir, hedefin
 * altındaki banda yorum gerekir (DOM-BEC-020).
 */
const criterionCore = rubricScoreInputSchema.shape.criteria.element.shape
export const rubricSectionSchema = z
  .object({
    rubricVersionId: z.string().min(1, 'Bir rubrik seçin.'),
    targetLevel: z
      .string()
      .pipe(z.enum(LEVEL_OPTIONS, { error: 'Görevin hedef seviyesini seçin.' })),
    criteria: z.array(
      z.object({
        criterionId: z.string(),
        band: criterionCore.band.nullable(),
        comment: criterionCore.comment.removeDefault().unwrap(),
      }),
    ),
  })
  .superRefine((value, context) => {
    value.criteria.forEach((criterion, index) => {
      if (criterion.band === null) {
        context.addIssue({
          code: 'custom',
          path: ['criteria', index, 'band'],
          message: 'Bu kritere bant verin.',
        })
      } else if (bandNeedsComment(criterion.band) && criterion.comment.trim() === '') {
        context.addIssue({
          code: 'custom',
          path: ['criteria', index, 'comment'],
          message: 'Hedefin altındaki banda kısa bir yorum yazın.',
        })
      }
    })
  })
export type RubricSectionValues = z.input<typeof rubricSectionSchema>

export function rubricSectionBody(
  section: 'writing' | 'speaking',
  version: number,
  values: z.output<typeof rubricSectionSchema>,
) {
  return {
    version,
    section,
    rubricVersionId: values.rubricVersionId,
    targetLevel: values.targetLevel,
    criteria: values.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      band: criterion.band ?? 0,
      comment: criterion.comment.trim() === '' ? null : criterion.comment.trim(),
    })),
  }
}

/**
 * Yerleştirme kararı formu (DOM-DIL-010): genel seviye ve gerekçe zorunlu, beceri seviyeleri
 * isteğe bağlı (boş seçim gönderilmez). Alanlar core `placementDecisionInputSchema`'dan.
 */
const decisionCore = placementDecisionInputSchema.shape
export const decisionFormSchema = z.object({
  level: z.string().pipe(decisionCore.level),
  skillLevels: z.record(z.enum(SECTION_KEYS), z.union([z.literal(''), z.enum(LEVEL_OPTIONS)])),
  rationale: decisionCore.rationale,
})
export type DecisionFormValues = z.input<typeof decisionFormSchema>

export function decisionBody(values: z.output<typeof decisionFormSchema>, version: number) {
  return {
    version,
    level: values.level,
    skillLevels: SECTION_KEYS.flatMap((skill) => {
      const level = values.skillLevels[skill]
      return level ? [{ skill, level }] : []
    }),
    rationale: values.rationale,
  }
}

/** Karar formunun başlangıcı: genel seviye öneriden, beceri seviyeleri beceri önerilerinden. */
export function decisionDefaults(
  session: Pick<PlacementSession, 'suggestion'>,
): DecisionFormValues {
  const { overall, skills } = session.suggestion
  const levelOf = (
    skill: PlacementSection,
  ): DecisionFormValues['skillLevels'][PlacementSection] => {
    const row = skills.find((item) => item.skill === skill)
    return row?.status === 'suggested' && row.level ? row.level : ''
  }
  const skillLevels: DecisionFormValues['skillLevels'] = {
    language_use: levelOf('language_use'),
    reading: levelOf('reading'),
    listening: levelOf('listening'),
    writing: levelOf('writing'),
    speaking: levelOf('speaking'),
  }
  return {
    level: overall.status === 'suggested' ? overall.level : '',
    skillLevels,
    rationale: '',
  }
}
