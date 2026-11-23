// Öğretmenin deneme dersi sonucu ekranının saf hesapları: satır, sonuç rozeti, yazılabilirlik ve
// form. Kural core'dadır (`recordTrialResult`, DOM-DIL-031, DOM-YTK-080); burada yalnız ekranın
// neyi göstereceği ve sunucuya gereksiz istek atılmaması için aynı koşullar türetilir. Karar yine
// sunucudadır (yapılmamış ders 409 `trial_not_held`, iptal 409 `trial_lesson_cancelled`).
import { z } from 'zod'
import type { RecordTrialResultBody } from '@kampus/react-shared/use-prospect-commands.ts'
import {
  prospectStageLabel,
  recordTrialResultSchema,
  TRIAL_FIT_LABELS,
  type ProspectTrialLesson,
  type TrialFit,
} from '@kampus/school-core/lib/prospects.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { FilterField } from '@/lib/list-query.ts'
import type { CoreRow } from '@/hooks/use-core-collection.ts'
import { isOpenStage, slotLabel, stageTone } from './prospect-rows.ts'

/** Deneme dersi günü aralığı; sunucuda `dateField=trialLesson.date` ile süzülür. */
export const TRIAL_DATE_FILTER: FilterField = {
  key: 'trialDate',
  label: 'Deneme dersi tarihi',
  type: 'date',
}

/** Sonuç rozeti: uygun yeşil, kur önerisi mor; sonucu olmayan ders durumuna göre. */
export const TRIAL_FIT_TONES = {
  suitable: 'green',
  lower_level: 'purple',
  upper_level: 'purple',
} as const satisfies Record<TrialFit, BadgeTone>

/**
 * Sonucun yazılamama nedeni (yoksa `null`): kapalı aday (`prospect_closed`), henüz başlamamış ders
 * (`trial_not_held`; core dersin başlangıcı geçmişse yapılmış sayar) ve iptal edilmiş ders
 * (`trial_lesson_cancelled`). Ders programı okunamazsa iptal bilinmez; karar sunucudadır.
 */
export function trialResultBlock(
  prospect: { stage?: string | undefined; trialLesson?: ProspectTrialLesson | undefined },
  now: number,
  lessonCancelled = false,
): string | null {
  const trial = prospect.trialLesson
  if (!trial) return 'Bu adayın deneme dersi yok.'
  if (!isOpenStage(prospect.stage))
    return prospect.stage === 'Kayıt oldu'
      ? 'Aday kesin kayıt oldu; deneme sonucu artık değiştirilemez.'
      : 'Aday vazgeçti; deneme sonucu yazılamaz.'
  if (lessonCancelled) return 'Deneme dersi iptal edildi; sonuç yazılamaz.'
  if (Date.parse(trial.date) > now)
    return 'Deneme dersi henüz yapılmadı; sonucu ders başladıktan sonra yazabilirsiniz.'
  return null
}

/** "14 Eki 2026 Çarşamba · 13:00 – 13:45" (Europe/Istanbul). */
export const trialLessonLabel = (trial: Pick<ProspectTrialLesson, 'date' | 'duration'>) =>
  `${dateLabel(trial.date, { weekday: 'long', year: 'numeric' })} · ${slotLabel(trial.date, trial.duration)}`

export type TrialResultRow = {
  id: string
  name: string
  /** 18 yaş altı mı; kaydında bayrak olmayan eski aday 18 yaş altı sayılır (DOM-KAY-009). */
  minor: boolean
  group: string
  trialDate: string
  trialLabel: string
  interest: string
  stage: string
  stageLabel: string
  stageTone: BadgeTone
  /** Sonuç yazılmışsa karar; rozet metni ve tonu `resultLabel`/`resultTone`. */
  fit: TrialFit | null
  resultLabel: string
  resultTone: BadgeTone
  /** Sonuç yazılabilir mi (iptal bilgisi listede yoktur; panel ayrıca bakar). */
  writable: boolean
}

/** Sonuç rozeti: yazılmışsa karar; yoksa ders bekleniyor, sonuç bekliyor ya da yazılmadı. */
function resultBadge(
  trial: ProspectTrialLesson,
  open: boolean,
  now: number,
): { label: string; tone: BadgeTone } {
  if (trial.result)
    return { label: TRIAL_FIT_LABELS[trial.result.fit], tone: TRIAL_FIT_TONES[trial.result.fit] }
  if (!open) return { label: 'Sonuç yazılmadı', tone: 'gray' }
  if (Date.parse(trial.date) > now) return { label: 'Ders bekleniyor', tone: 'gray' }
  return { label: 'Sonuç bekliyor', tone: 'amber' }
}

/**
 * Tablo satırı; deneme dersi olmayan kayıt (öğretmene dönmemesi gerekir) `null` olur ve
 * listelenmez. Grup adı öğretmenin okuyabildiği gruplardan, yoksa "—".
 */
export function trialResultRow(
  item: CoreRow<'prospects'>,
  type: InstitutionType,
  groups: ReadonlyMap<string, string>,
  now: number,
): TrialResultRow | null {
  const { record } = item
  const trial = record.trialLesson
  if (!trial) return null
  const stage = record.stage ?? ''
  const open = isOpenStage(record.stage)
  const badge = resultBadge(trial, open, now)
  return {
    id: record.id,
    name: record.name,
    minor: record.minor !== false,
    group: groups.get(trial.classId) ?? '—',
    trialDate: trial.date,
    trialLabel: trialLessonLabel(trial),
    interest: record.interest,
    stage,
    stageLabel: prospectStageLabel(record.stage, type),
    stageTone: stageTone(stage),
    fit: trial.result?.fit ?? null,
    resultLabel: badge.label,
    resultTone: badge.tone,
    writable: trialResultBlock(record, now) === null,
  }
}

// --- Form -------------------------------------------------------------------------------

/** Karar seçilmemişse (`''`) core şemasının Türkçe iletisi döner; not core şemasıyla aynı sınırda. */
export const trialResultFormSchema = z.object({
  fit: z.string().pipe(recordTrialResultSchema.shape.fit),
  note: z.string().pipe(recordTrialResultSchema.shape.note.unwrap()),
})
export type TrialResultFormValues = z.input<typeof trialResultFormSchema>

/** Var olan sonuç yeniden yazılırken form önceki kararla açılır (öğretmen kararını düzeltir). */
export function trialResultDefaults(trial: ProspectTrialLesson | undefined): TrialResultFormValues {
  return { fit: trial?.result?.fit ?? '', note: trial?.result?.note ?? '' }
}

/** Boş not gönderilmez; sunucu notu `null` yapar (önceki not silinir). */
export function trialResultBody(
  values: z.output<typeof trialResultFormSchema>,
): RecordTrialResultBody {
  return values.note === '' ? { fit: values.fit } : { fit: values.fit, note: values.note }
}
