import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { daySchema } from './domain.ts'
import { learnerWords } from './enrollment-learner.ts'
import { DomainError } from './errors.ts'

/**
 * Burs programı (docs/domain/finans.md DOM-FIN-025; IST-105). Burs indirim değildir, %50 tavanına
 * girmez (DOM-FIN-021) ve yalnız tanımlı programdan atanır. Bildirilmemiş program kullanılamaz.
 * Burs sınavı, kesilme ve geri isteme henüz yoktur (ON-136, ON-283).
 */

const BASIS = 10_000
const text = (message: string, max: number) =>
  z
    .string(message)
    .trim()
    .min(2, message)
    .max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)

export const createScholarshipProgramSchema = z
  .strictObject({
    academicYear: z.number('Eğitim yılını seçin.').int().min(2000).max(2100),
    name: text('Program adını yazın.', 120),
    conditions: text('Burs şartlarını yazın.', 2000),
    terminationConditions: text('Kesilme koşullarını yazın.', 2000),
    durationNote: text('Burs süresini yazın.', 200),
    /** Oran, on binde birlik (%25 → 2500); `amountCents` ile birlikte verilmez. */
    percentBasisPoints: z.number().int().min(1).max(BASIS).optional(),
    amountCents: z.number().int().min(1).max(100_000_000_00).optional(),
    capacity: z.number('Burslu sayısını girin.').int().min(1).max(100_000),
  })
  .refine((data) => (data.percentBasisPoints === undefined) !== (data.amountCents === undefined), {
    message: 'Burs miktarını oran ya da tutar olarak girin.',
    path: ['percentBasisPoints'],
  })
export type CreateScholarshipProgramInput = z.input<typeof createScholarshipProgramSchema>

export const notifyScholarshipProgramSchema = z.strictObject({ notifiedDate: daySchema })
export const scholarshipMebbisSchema = z.strictObject({ recordedDate: daySchema })

export interface ScholarshipProgram {
  id: string
  academicYear: number
  percentBasisPoints: number | null
  amountCents: number | null
  capacity: number
  notifiedDate: string | null
}

/** Aynı yılda aynı adla ikinci program açılmaz. */
export function planProgramCreate(input: unknown, namesOfYear: readonly string[]) {
  const data = createScholarshipProgramSchema.parse(input)
  const key = data.name.toLocaleLowerCase('tr')
  if (namesOfYear.some((name) => name.toLocaleLowerCase('tr') === key))
    throw new DomainError('scholarship_program_exists', 'Bu yılda bu adla bir burs programı var.', {
      kind: 'conflict',
      path: ['name'],
    })
  return data
}

function requirePastOrToday(day: string, today: string, path: string) {
  if (day > today)
    throw new DomainError('scholarship_date_future', 'Gelecek bir tarih girilemez.', {
      path: [path],
    })
}

/** İl millî eğitim müdürlüğüne bildirim günü bir kez işlenir (DOM-FIN-025). */
export function planProgramNotify(
  program: Pick<ScholarshipProgram, 'notifiedDate'>,
  input: unknown,
  today: string,
) {
  const data = notifyScholarshipProgramSchema.parse(input)
  requirePastOrToday(data.notifiedDate, today, 'notifiedDate')
  if (program.notifiedDate !== null)
    throw new DomainError('scholarship_already_notified', 'Bildirim tarihi zaten işlenmiş.', {
      kind: 'conflict',
    })
  return data
}

export function planAwardMebbis(
  award: { mebbisRecordedDate: string | null },
  input: unknown,
  today: string,
) {
  const data = scholarshipMebbisSchema.parse(input)
  requirePastOrToday(data.recordedDate, today, 'recordedDate')
  if (award.mebbisRecordedDate !== null)
    throw new DomainError('scholarship_mebbis_recorded', "MEBBİS'e işlendiği zaten kayıtlı.", {
      kind: 'conflict',
    })
  return data
}

/**
 * Atamada burs tutarı: oran ilan ücreti üzerinden aşağı yuvarlanır, zincirlenmez; indirimlerden
 * sonra kalan neti aşamaz. Net sıfırsa burs da sıfırdır, atama reddedilir.
 */
export function scholarshipAmount(
  program: Pick<ScholarshipProgram, 'percentBasisPoints' | 'amountCents'>,
  grossCents: number,
  netCents: number,
): number {
  const raw =
    program.amountCents ?? Math.floor((grossCents * (program.percentBasisPoints ?? 0)) / BASIS)
  return Math.min(raw, netCents)
}

/**
 * Kesin kayıtta ve yenilemede burs atama kuralları (DOM-FIN-025, DOM-FIN-052): burs onayı
 * yöneticidedir, program bu eğitim yılının olmalı, bildirilmiş olmalı, öğrencinin o yıl başka bursu
 * olmamalı ve burslu sayısı dolmamış olmalıdır. `studentAwarded` öğrencinin bu eğitim yılında
 * arşivlenmemiş ataması olup olmadığıdır; servis kurum kilidi altında yükler, veritabanındaki
 * `scholarship_awards_student_year_key` yalnız yarışta tetiklenir. `institutionType` yalnız iletinin
 * sözüdür (DOM-KAY-012): dil okulu ve kursta "kursiyer", verilmezse okul metni; kod değişmez.
 */
export function requireAwardableProgram(
  program: ScholarshipProgram | null,
  context: {
    academicYear: number
    awardedCount: number
    canApprove: boolean
    studentAwarded: boolean
    institutionType?: InstitutionType
  },
): ScholarshipProgram {
  const path = ['scholarshipProgramId']
  if (!context.canApprove)
    throw new DomainError('scholarship_approval_required', 'Bursu yalnız yönetici atar.', { path })
  if (program === null || program.academicYear !== context.academicYear)
    throw new DomainError('scholarship_program_not_found', 'Burs programı bulunamadı.', {
      kind: 'not_found',
      path,
    })
  if (program.notifiedDate === null)
    throw new DomainError(
      'scholarship_program_not_notified',
      'İl millî eğitim müdürlüğüne bildirilmemiş burs programı kullanılamaz.',
      { path },
    )
  if (context.studentAwarded)
    throw new DomainError(
      'scholarship_already_awarded',
      `${learnerWords(context.institutionType).titleDative} bu eğitim yılında zaten burs atanmış.`,
      { kind: 'conflict', path },
    )
  if (context.awardedCount >= program.capacity)
    throw new DomainError('scholarship_capacity_full', 'Burs programının kontenjanı dolu.', {
      kind: 'conflict',
      path,
    })
  return program
}

/**
 * Ayrılışla iptal edilen burslu yenilemelerin eğitim yılları (K-117): o yılların bursu yürürlüğe
 * girmez, servis atamayı arşivler ve fondan karşılanan payı bırakır. Öğrenci yılda en çok bir burs
 * aldığından yıl atamayı belirler; bursu olmayan yenileme ve süren yılın bursu dokunulmaz.
 * `withdrawStudent` sonrasındaki State'le çağrılır.
 */
export function cancelledRenewalScholarshipYears(
  state: Pick<State, 'renewals'>,
  studentId: string,
): number[] {
  return [
    ...new Set(
      state.renewals.flatMap((item) =>
        item.studentId === studentId && item.status === 'İptal' && item.pricing?.scholarship
          ? [item.year]
          : [],
      ),
    ),
  ]
}
