// Aday/CRM ekranlarının web ile mobilde ortak saf hesapları (DOM-KAY-003, -005, -030…034): iletişim
// sahibi, aşama hedefleri, aşama gövdesi ve Tanışma Görüşmeleri olayları. Kural core'dadır
// (`lib/prospects.ts`); burada yalnız ekranın hangi seçeneği göstereceği ve hangi gövdeyi göndereceği
// türetilir. Karar yine sunucudadır.
import type { State } from '@kampus/school-core/data/seed.ts'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  nextProspectStages,
  OPEN_PROSPECT_STAGES,
  PROSPECT_LOST_REASON_LABELS,
  PROSPECT_LOST_REASONS,
  PROSPECT_STAGES,
  prospectStageLabel,
  type ProspectStage,
} from '@kampus/school-core/lib/prospects.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

import type { ChangeProspectStageBody } from './use-prospect-commands.ts'

export type ProspectRecord = State['prospects'][number]

/** Vazgeçme nedeninin etiketi (DOM-KAY-005); tanınmayan eski kayıt olduğu gibi gösterilir. */
export function lostReasonLabel(reason: string): string {
  const known = PROSPECT_LOST_REASONS.find((item) => item === reason)
  return known ? PROSPECT_LOST_REASON_LABELS[known] : reason
}

/**
 * Adayın telefon ve e-postası kimin (DOM-KAY-003): 18 yaş altı adayda velinindir, yetişkinde adayın
 * kendisinindir. Kaydında `minor` olmayan eski aday 18 yaş altı sayılır (DOM-KAY-009).
 */
export type ContactOwner = 'guardian' | 'self'
export const prospectContactOwner = (prospect: { minor?: boolean | undefined }): ContactOwner =>
  prospect.minor === false ? 'self' : 'guardian'

/** İletişim alanı etiketleri: sahibi velise "Veli telefonu", adayın kendisiyse "Telefon". */
export const CONTACT_LABELS = {
  guardian: { phone: 'Veli telefonu', email: 'Veli e-postası' },
  self: { phone: 'Telefon', email: 'E-posta' },
} as const satisfies Record<ContactOwner, { phone: string; email: string }>

/** "Pazartesi 20 Ekim 2026 13:00" (Europe/Istanbul). */
export const dateTimeLabel = (value: string) =>
  dateLabel(value, { weekday: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** "13:00 – 13:45" (Europe/Istanbul). */
export const slotLabel = (startsAt: string, minutes: number) =>
  `${timeLabel(startsAt)} – ${timeLabel(new Date(Date.parse(startsAt) + minutes * 60_000))}`

/**
 * Ayrıntıda seçilebilen aşamalar (DOM-KAY-030): yalnız geçerli hedefler. `Görüşme planlandı`
 * planlamayla, `Kayıt oldu` kesin kayıtla girildiği için sunulmaz.
 */
export function stageTargets(stage: string | undefined): ProspectStage[] {
  return nextProspectStages(stage).filter(
    (target) => target !== 'Görüşme planlandı' && target !== 'Kayıt oldu',
  )
}

/** Aday açık aşamada mı (not, görüşme ve deneme dersi yalnız açık adaya, DOM-KAY-032). */
export const isOpenStage = (stage: string | undefined) =>
  (OPEN_PROSPECT_STAGES as readonly (string | undefined)[]).includes(stage)

/** Aşama formunun değerleri (web `stageFormSchema` girdisi, mobil yerel durum). */
export type StageInput = {
  stage: string
  lostReason?: string | undefined
  lostToInstitution?: string | undefined
  siblingOfId?: string | undefined
}

const optional = (value: string | undefined) => value?.trim() || undefined

/**
 * Aşama gövdesi; vazgeçmede neden zorunludur (DOM-KAY-005). Aşama ya da neden yoksa
 * `{ field, message }` döner ve istek atılmaz. Kardeş yalnız vazgeçen aday yeniden açılırken gider.
 */
export function stageBody(
  values: StageInput,
  options: { reopening: boolean },
):
  | { ok: true; body: ChangeProspectStageBody }
  | { ok: false; field: 'stage' | 'lostReason'; message: string } {
  const stage = PROSPECT_STAGES.find((item) => item === values.stage)
  if (!stage) return { ok: false, field: 'stage', message: 'Aşamayı seçin.' }
  if (stage === 'Vazgeçti') {
    const reason = PROSPECT_LOST_REASONS.find((item) => item === values.lostReason)
    const institution = optional(values.lostToInstitution)
    return reason
      ? {
          ok: true,
          body: {
            stage,
            lostReason: reason,
            ...(institution ? { lostToInstitution: institution } : {}),
          },
        }
      : { ok: false, field: 'lostReason', message: 'Vazgeçme nedenini seçin.' }
  }
  const sibling = optional(values.siblingOfId)
  return {
    ok: true,
    body: { stage, ...(options.reopening && sibling ? { siblingOfId: sibling } : {}) },
  }
}

// --- Tanışma Görüşmeleri ------------------------------------------------------------------

export type MeetingKind = 'meeting' | 'trial'
export const MEETING_KIND_LABELS = {
  meeting: 'Tanışma görüşmesi',
  trial: 'Deneme dersi',
} as const satisfies Record<MeetingKind, string>

export type MeetingEvent = {
  id: string
  prospectId: string
  name: string
  kind: MeetingKind
  kindLabel: string
  startsAt: string
  /** Europe/Istanbul günü (`YYYY-MM-DD`); tarih süzgeci bunu karşılaştırır. */
  day: string
  whenLabel: string
  timeRange: string
  branch: string
  place: string
  stage: string
  stageLabel: string
  upcoming: boolean
}

/**
 * Adaylardan planlanmış görüşme ve deneme dersleri. Görüşme `trialAt` (görüşme anı) ve `meeting`
 * alanından, deneme dersi `trialLesson`'dan gelir (DOM-KAY-033, -034). Kapalı (`Kayıt oldu`,
 * `Vazgeçti`) adayın olayı listelenmez. Yaklaşanlar önce ve yakından uzağa, geçmişler sonra ve
 * yeniden eskiye sıralanır.
 */
export function meetingEvents(
  prospects: readonly ProspectRecord[],
  type: InstitutionType,
  context: {
    now: number
    branches: ReadonlyMap<string, string>
    classes: ReadonlyMap<string, string>
  },
): MeetingEvent[] {
  const events: MeetingEvent[] = []
  for (const prospect of prospects) {
    if (!isOpenStage(prospect.stage)) continue
    const base = {
      prospectId: prospect.id,
      name: prospect.name,
      branch: context.branches.get(prospect.branchId) ?? '—',
      stage: prospect.stage ?? '',
      stageLabel: prospectStageLabel(prospect.stage, type),
    }
    const add = (kind: MeetingKind, startsAt: string, minutes: number, place: string) =>
      events.push({
        ...base,
        id: `${prospect.id}:${kind}`,
        kind,
        kindLabel: MEETING_KIND_LABELS[kind],
        startsAt,
        day: dayKey(startsAt),
        whenLabel: dateLabel(startsAt, { weekday: 'long', year: 'numeric' }),
        timeRange: slotLabel(startsAt, minutes),
        place,
        upcoming: Date.parse(startsAt) >= context.now,
      })
    if (prospect.trialAt)
      add(
        'meeting',
        prospect.trialAt,
        prospect.meeting?.duration ?? 30,
        prospect.meeting?.room ?? '—',
      )
    const trial = prospect.trialLesson
    if (trial) add('trial', trial.date, trial.duration, context.classes.get(trial.classId) ?? '—')
  }
  return events.sort((a, b) => {
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1
    const order = Date.parse(a.startsAt) - Date.parse(b.startsAt)
    return a.upcoming ? order : -order
  })
}
