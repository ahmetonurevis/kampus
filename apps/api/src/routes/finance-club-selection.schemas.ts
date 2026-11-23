import { z } from 'zod'

import {
  CLUB_SELECTION_ENTRY_ROLES,
  CLUB_SELECTION_PHASES,
} from '@kampus/school-core/lib/finance-club-selection.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Kulüp tercih dönemi, tercih, kura ve dağıtım şemaları (DOM-FIN-150; ON-169; K-505…K-507). */

const phase = z
  .enum(CLUB_SELECTION_PHASES)
  .describe(
    '`upcoming` açılmadı, `open` tercihe açık, `closed` kapandı, `drawn` kura çekildi, `confirmed` onaylandı',
  )

export const clubSelectionPeriodRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  academicYear: z.number().int().describe('Eğitim yılının başlangıç yılı'),
  term: z.number().int().nullable().describe('Eğitim dönemi (1, 2); `null` bütün yıl'),
  openDate: z.string().describe('Açılış günü (YYYY-MM-DD, dahil)'),
  closeDate: z.string().describe('Kapanış günü (YYYY-MM-DD, dahil)'),
  maxChoices: z.number().int(),
  seatsPerStudent: z.number().int().describe('Öğrenci başına atanacak kulüp'),
  gradeLevels: z.array(z.number().int()).describe('Hedef sınıf düzeyleri; boşsa herkes'),
  phase,
  clubCount: z.number().int(),
  preferenceCount: z.number().int().describe('Etkin tercih sayısı'),
  drawnAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const clubCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  teacherName: z.string().nullable(),
  capacity: z.number().int(),
  memberCount: z.number().int().describe('Güncel etkin üye sayısı'),
  freeSeats: z.number().int().describe('Boş yer (kontenjan − üye)'),
  meetingDay: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
})

export const clubSelectionPeriodDetailSchema = clubSelectionPeriodRowSchema.extend({
  seed: z.string().nullable().describe('Kura tohumu; kura çekilince dolar, sonuç bununla üretilir'),
  clubs: z.array(clubCardSchema).describe('Döneme katılan arşivlenmemiş kulüpler'),
  eligibleStudentCount: z
    .number()
    .int()
    .describe('Hedef düzeydeki etkin öğrenci sayısı (tercih durumu için)'),
  preferences: z
    .array(
      z.object({
        studentId: z.string(),
        // kvkk: K (öğrenci)
        studentName: z.string(),
        choices: z.array(z.string()).describe('Sıralı kulüp kimlikleri'),
        enteredByRole: z.enum(CLUB_SELECTION_ENTRY_ROLES),
        enteredAt: z.string(),
        eligible: z
          .boolean()
          .describe('Kaydı etkin ve hedef düzeyde; değilse tercih dağıtıma girmez'),
      }),
    )
    .describe('Etkin tercihler, öğrenci adına göre'),
  result: z
    .object({
      clubs: z.array(
        z.object({
          clubId: z.string(),
          clubName: z.string(),
          freeSeats: z.number().int(),
          assigned: z.array(
            z.object({ studentId: z.string(), studentName: z.string(), rank: z.number().int() }),
          ),
          waitlist: z.array(
            z.object({
              studentId: z.string(),
              studentName: z.string(),
              rank: z.number().int(),
              position: z.number().int(),
              status: z
                .enum(['waiting', 'joined', 'inactive'])
                .describe(
                  '`waiting` bekliyor, `joined` sonradan üye oldu, `inactive` kaydı etkin değil',
                ),
            }),
          ),
          suggestedStudentId: z
            .string()
            .nullable()
            .describe('Boş yer varsa önerilen ilk bekleyen yedek; otomatik eklenmez'),
          suggestedStudentName: z.string().nullable(),
        }),
      ),
      assignedCount: z.number().int(),
      waitlistedStudentCount: z.number().int(),
    })
    .nullable()
    .describe('Onaylanan dağıtım; onaydan önce `null`'),
})

export const clubSelectionPreviewSchema = z.object({
  periodId: z.string(),
  seed: z.string(),
  digest: z.string().describe('Onayda geri gönderilecek önizleme özeti'),
  clubs: z.array(
    z.object({
      clubId: z.string(),
      clubName: z.string(),
      capacity: z.number().int(),
      members: z.number().int(),
      seatsBefore: z.number().int(),
      assigned: z.number().int(),
      seatsAfter: z.number().int(),
      waitlisted: z.number().int(),
    }),
  ),
  assignments: z.array(
    z.object({
      studentId: z.string(),
      studentName: z.string(),
      clubId: z.string(),
      clubName: z.string(),
      rank: z.number().int(),
      round: z.number().int(),
    }),
  ),
  waitlist: z.array(
    z.object({
      clubId: z.string(),
      clubName: z.string(),
      studentId: z.string(),
      studentName: z.string(),
      rank: z.number().int(),
      position: z.number().int(),
    }),
  ),
  students: z
    .array(
      z.object({
        studentId: z.string(),
        studentName: z.string(),
        lotteryPosition: z.number().int(),
        wanted: z.number().int(),
        assigned: z.number().int(),
      }),
    )
    .describe('Kura sırası'),
})

export const clubSelectionPreferenceResultSchema = z.object({
  periodId: z.string(),
  studentId: z.string(),
  choices: z.array(z.string()),
  enteredAt: z.string().nullable().describe('Geri çekildiyse `null`'),
})

export const myClubSelectionSchema = z.object({
  periodId: z.string(),
  name: z.string(),
  academicYear: z.number().int(),
  term: z.number().int().nullable(),
  openDate: z.string(),
  closeDate: z.string(),
  phase,
  maxChoices: z.number().int(),
  seatsPerStudent: z.number().int(),
  clubs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      teacherName: z.string().nullable(),
      meetingDay: z.number().int(),
      startTime: z.string(),
      endTime: z.string(),
    }),
  ),
  students: z.array(
    z.object({
      studentId: z.string(),
      studentName: z.string(),
      choices: z.array(z.string()),
      enteredAt: z.string().nullable(),
      assignedClubIds: z.array(z.string()).describe('Onaylı dağıtımda atandığı kulüpler'),
      waitlist: z
        .array(z.object({ clubId: z.string(), position: z.number().int() }))
        .describe('Onaylı dağıtımda yedek sırası'),
    }),
  ),
})

export const clubSelectionPeriodResponse = dataResponse(clubSelectionPeriodDetailSchema)
export const clubSelectionPeriodListResponse = z.object({
  data: z.array(clubSelectionPeriodRowSchema),
  meta: pageMetaSchema,
})
export const clubSelectionPreviewResponse = dataResponse(clubSelectionPreviewSchema)
export const clubSelectionPreferenceResponse = dataResponse(clubSelectionPreferenceResultSchema)
export const clubSelectionArchivedResponse = dataResponse(z.object({ id: z.string() }))
export const myClubSelectionsResponse = dataResponse(z.array(myClubSelectionSchema))

export const clubSelectionListQuery = z.strictObject({ ...pageQuerySchema.shape })
export const clubSelectionParams = z.object({ periodId: z.uuid('Tercih dönemi geçersiz.') })
