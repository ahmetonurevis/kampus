import { z } from 'zod'

import { OPEN_PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import { SEASON_FOLLOW_UP_REASONS } from '@kampus/school-core/lib/prospect-season-watch.ts'

import { dataResponse } from './common.schemas.ts'

// Kayıt sezonu nöbeti yanıtı (`GET /api/v1/prospects/season-watch`; DOM-KAY-037). Satır aday
// kimliği, adı, aşaması ve kampüsünü taşır; telefon, e-posta, veli, not, ilgi ve kaynak yok (K-179).

const count = z.number().int().min(0)
const day = z.string().describe('Europe/Istanbul günü (`YYYY-MM-DD`)')

const prospectFields = {
  prospectId: z.string(),
  name: z.string().describe('Aday adı'),
  stage: z.enum(OPEN_PROSPECT_STAGES).describe('Açık aşama'),
  branchName: z.string().nullable().describe('Kampüs adı; kampüs kaydı yoksa `null`'),
}

const meetingRow = z
  .object({
    ...prospectFields,
    date: z.string().describe('Görüşmenin başlangıç anı (ISO 8601 UTC)'),
    duration: z.number().int().describe('Dakika; süresi saklanmamış eski görüşmede 30'),
    room: z.string().nullable(),
    teacherName: z.string().nullable().describe('Görevli öğretmen; yoksa `null`'),
    held: z.boolean().describe('Bitişi geçmiş mi'),
  })
  .meta({ id: 'SeasonWatchMeeting' })

const trialRow = z
  .object({
    ...prospectFields,
    date: z.string().describe('Dersin güncel başlangıç anı (ISO 8601 UTC)'),
    duration: z.number().int(),
    groupName: z.string().nullable(),
    held: z.boolean(),
    resultRecorded: z.boolean().describe('Öğretmen deneme sonucunu yazdı mı (DOM-DIL-031)'),
  })
  .meta({ id: 'SeasonWatchTrial' })

const followUpRow = z
  .object({
    ...prospectFields,
    reason: z
      .enum(SEASON_FOLLOW_UP_REASONS)
      .describe(
        '`first_contact` ilk temas bekliyor, `meeting_outcome` görüşme sonucu bekleniyor, `trial_outcome` deneme sonrası takip (dil okulu), `stale` temas kesildi',
      ),
    sinceDate: day.describe('Nedenin dayandığı gün (açılış, görüşme, deneme ya da son işlem)'),
    days: count.describe('Dayanak günden bugüne geçen gün'),
    trialResultRecorded: z
      .boolean()
      .nullable()
      .describe('Yalnız `trial_outcome`: öğretmen sonucu yazdı mı; diğerlerinde `null`'),
  })
  .meta({ id: 'SeasonWatchFollowUp' })

const section = <T extends z.ZodType>(row: T) =>
  z.object({
    total: count.describe('Bölümdeki bütün satırlar'),
    rows: z.array(row).describe('En çok 50 satır'),
  })

export const seasonWatchResponseSchema = dataResponse(
  z
    .object({
      window: z.object({
        from: day.describe('Bugün'),
        to: day.describe('Pencerenin son günü (dahil)'),
        days: count,
      }),
      trialsEnabled: z.boolean().describe('Deneme dersi bölümü var mı (yalnız dil okulu)'),
      summary: z.object({
        meetingsToday: count,
        meetingsInWindow: count,
        trialsToday: count,
        trialsInWindow: count,
        followUps: count,
        followUpsByReason: z.object(
          Object.fromEntries(SEASON_FOLLOW_UP_REASONS.map((reason) => [reason, count])) as Record<
            (typeof SEASON_FOLLOW_UP_REASONS)[number],
            typeof count
          >,
        ),
        newToday: count.describe('Bugün açılan açık aday'),
      }),
      meetings: section(meetingRow),
      trials: section(trialRow),
      followUps: section(followUpRow),
    })
    .meta({ id: 'ProspectSeasonWatch' }),
)
