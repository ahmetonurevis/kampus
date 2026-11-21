import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { contractStatus, isContractInForce } from './contract-status.ts'
import { daySchema } from './domain.ts'
import { learnerWords } from './enrollment-learner.ts'
import { DomainError } from './errors.ts'
import { FREE_QUOTA_BASIS_POINTS, freeQuotaCount } from './fee-tariffs.ts'
import {
  invoicesOf,
  planRefundPayment,
  type PayRefundOutput,
  type RefundPaymentContext,
} from './withdrawals.ts'

/**
 * Ücretsiz okutma (docs/domain/finans.md DOM-FIN-026; IST-105). Kurum eğitim yılı için bir dönem
 * açar; kontenjan öğrenci sayısından `freeQuotaCount` ile hesaplanır, yönetici kesinleştirir (K-268).
 * Aday gerekçesi ve teslim edilen belgeler sabit listedendir, belgenin kendisi ve serbest metin
 * saklanmaz (K-269). Değerlendirme kurulu toplantı günü, üyeleri ve kararlarıyla kaydedilir; kabul
 * edilen öğrencinin o yılki açık öğrenim taksitleri kapanır, alınmış öğrenim ücreti iade kaydı olur
 * (K-270). MEBBİS'e otomatik gönderim yoktur, işlendiği gün elle işaretlenir (IST-143, K-271).
 * Hukuki varsayımlar **doğrulanmalı** (H-33).
 */

export const FREE_TUITION_REASONS = [
  'financial_need',
  'martyr_veteran_relative',
  'duty_disabled_parent',
  'protection_order',
  'parent_loss',
  'other',
] as const
export type FreeTuitionReason = (typeof FREE_TUITION_REASONS)[number]

export const FREE_TUITION_REASON_LABELS: Readonly<Record<FreeTuitionReason, string>> = {
  financial_need: 'Maddi durum yetersizliği',
  martyr_veteran_relative: 'Şehit ya da gazi yakını',
  duty_disabled_parent: 'Harp ya da vazife malulü çocuğu',
  protection_order: 'Koruma ya da bakım kararı',
  parent_loss: 'Anne ya da babasını kaybetmiş',
  other: 'Diğer (kurul değerlendirir)',
}

export const FREE_TUITION_DOCUMENTS = [
  'application_form',
  'income_statement',
  'household_statement',
  'status_document',
  'report_card',
] as const
export type FreeTuitionDocument = (typeof FREE_TUITION_DOCUMENTS)[number]

export const FREE_TUITION_DOCUMENT_LABELS: Readonly<Record<FreeTuitionDocument, string>> = {
  application_form: 'Başvuru formu',
  income_statement: 'Gelir belgesi',
  household_statement: 'Aile durum belgesi',
  status_document: 'Durum belgesi (şehit, gazi, malul ya da koruma kararı)',
  report_card: 'Karne ya da başarı belgesi',
}

export const FREE_TUITION_DECISIONS = ['accepted', 'reserve', 'rejected'] as const
export type FreeTuitionDecision = (typeof FREE_TUITION_DECISIONS)[number]
export const FREE_TUITION_STATUSES = ['pending', ...FREE_TUITION_DECISIONS] as const
export type FreeTuitionStatus = (typeof FREE_TUITION_STATUSES)[number]

export const FREE_TUITION_STATUS_LABELS: Readonly<Record<FreeTuitionStatus, string>> = {
  pending: 'Değerlendirilmedi',
  accepted: 'Kabul',
  reserve: 'Yedek',
  rejected: 'Ret',
}

/** Kurul en az başkan ve iki üyeden oluşur, en çok dokuz kişidir (K-269). */
export const FREE_TUITION_BOARD_MIN_MEMBERS = 3
export const FREE_TUITION_BOARD_MAX_MEMBERS = 9
/** Alınan ücret öğretim başladıktan sonra iki ay içinde iade edilir (DOM-FIN-026). */
export const FREE_TUITION_REFUND_MONTHS = 2

const text = (message: string, max: number) =>
  z
    .string(message)
    .trim()
    .min(2, message)
    .max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)

const documentsSchema = z
  .array(z.enum(FREE_TUITION_DOCUMENTS, 'Belge türü geçersiz.'))
  .max(FREE_TUITION_DOCUMENTS.length)
  .refine((items) => new Set(items).size === items.length, 'Bir belge iki kez işaretlenemez.')

export const createFreeTuitionRoundSchema = z.strictObject({
  academicYear: z.number('Eğitim yılını seçin.').int().min(2000).max(2100),
  /** Okulda öğretimin başladığı gün; iade süresi buradan sayılır (DOM-FIN-026). */
  teachingStartDate: daySchema,
})
export type CreateFreeTuitionRoundInput = z.input<typeof createFreeTuitionRoundSchema>

export const confirmFreeTuitionQuotaSchema = z.strictObject({
  confirmedQuota: z.number('Kontenjanı girin.').int('Tam sayı girin.').min(0).max(100_000),
})
export type ConfirmFreeTuitionQuotaInput = z.input<typeof confirmFreeTuitionQuotaSchema>

export const createFreeTuitionApplicationSchema = z.strictObject({
  studentId: z.string('Öğrenciyi seçin.').trim().min(1, 'Öğrenciyi seçin.').max(64),
  // kvkk: Ç
  reason: z.enum(FREE_TUITION_REASONS, 'Gerekçeyi seçin.'),
  documents: documentsSchema.default([]),
})
export type CreateFreeTuitionApplicationInput = z.input<typeof createFreeTuitionApplicationSchema>

export const updateFreeTuitionDocumentsSchema = z.strictObject({ documents: documentsSchema })
export type UpdateFreeTuitionDocumentsInput = z.input<typeof updateFreeTuitionDocumentsSchema>

export const freeTuitionBoardMemberSchema = z.strictObject({
  // kvkk: K
  name: text('Üyenin adını yazın.', 120),
  title: text('Üyenin görevini yazın.', 80),
})

export const recordFreeTuitionBoardSchema = z.strictObject({
  meetingDate: daySchema,
  members: z
    .array(freeTuitionBoardMemberSchema)
    .min(
      FREE_TUITION_BOARD_MIN_MEMBERS,
      `Kurul en az ${String(FREE_TUITION_BOARD_MIN_MEMBERS)} kişidir.`,
    )
    .max(
      FREE_TUITION_BOARD_MAX_MEMBERS,
      `Kurul en çok ${String(FREE_TUITION_BOARD_MAX_MEMBERS)} kişidir.`,
    ),
  decisions: z
    .array(
      z.strictObject({
        applicationId: z.uuid('Aday kimliği geçersiz.'),
        decision: z.enum(FREE_TUITION_DECISIONS, 'Kararı seçin.'),
      }),
    )
    .min(1, 'En az bir aday için karar verin.')
    .max(500)
    .refine(
      (items) => new Set(items.map((item) => item.applicationId)).size === items.length,
      'Bir aday için tek karar verilir.',
    ),
})
export type RecordFreeTuitionBoardInput = z.input<typeof recordFreeTuitionBoardSchema>
export type RecordFreeTuitionBoardOutput = z.output<typeof recordFreeTuitionBoardSchema>

export const freeTuitionMebbisSchema = z.strictObject({ recordedDate: daySchema })
export type FreeTuitionMebbisInput = z.input<typeof freeTuitionMebbisSchema>

/** Ücretsiz okutulacak en az öğrenci sayısı (DOM-FIN-026); oran profil parametresidir. */
export const freeTuitionMinimumQuota = (
  studentCount: number,
  basisPoints = FREE_QUOTA_BASIS_POINTS,
) => freeQuotaCount(studentCount, basisPoints)

function requirePastOrToday(day: string, today: string, path: readonly string[]) {
  if (day > today)
    throw new DomainError('free_tuition_date_future', 'Gelecek bir tarih girilemez.', {
      path: [...path],
    })
}

/** Kurumda eğitim yılı başına bir dönem açılır (K-268). */
export function planFreeTuitionRound(input: unknown, existingYears: readonly number[]) {
  const data = createFreeTuitionRoundSchema.parse(input)
  if (existingYears.includes(data.academicYear))
    throw new DomainError(
      'free_tuition_round_exists',
      'Bu eğitim yılı için ücretsiz okutma dönemi zaten açık.',
      { kind: 'conflict', path: ['academicYear'] },
    )
  return data
}

/**
 * Kontenjanı kesinleştirir (K-268): hesaplanan sayının (`freeQuotaCount`, öğrenci sayısının %3'ü)
 * altına inemez, kabul edilmiş aday sayısının altına da inemez. Kesinleşen sayı yeniden
 * değiştirilebilir; o anki öğrenci sayısı ve hesaplanan sayı kayda kopyalanır.
 */
export function planFreeTuitionQuota(
  input: unknown,
  context: { studentCount: number; acceptedCount: number; basisPoints?: number },
) {
  const data = confirmFreeTuitionQuotaSchema.parse(input)
  const computedQuota = freeTuitionMinimumQuota(context.studentCount, context.basisPoints)
  if (data.confirmedQuota < computedQuota)
    throw new DomainError(
      'free_tuition_quota_below_minimum',
      `Kontenjan hesaplanan en az sayının (${String(computedQuota)}) altına inemez.`,
      { path: ['confirmedQuota'] },
    )
  if (data.confirmedQuota < context.acceptedCount)
    throw new DomainError(
      'free_tuition_quota_below_accepted',
      `Kontenjan kabul edilmiş aday sayısının (${String(context.acceptedCount)}) altına inemez.`,
      { path: ['confirmedQuota'] },
    )
  return { ...data, studentCount: context.studentCount, computedQuota }
}

/**
 * Aday kaydı (K-269): öğrenci kurumda etkin olmalı, dönemde bir kez aday olur. O yıl bursu olan
 * öğrenci aday olamaz; burslu oranı ücretsiz okutma oranının dışındadır (ÖÖKY md. 62/4).
 */
export function planFreeTuitionApplication(
  state: Pick<State, 'students'>,
  input: unknown,
  context: {
    applicantStudentIds: ReadonlySet<string>
    scholarshipStudentIds: ReadonlySet<string>
    institutionType?: InstitutionType
  },
) {
  const data = createFreeTuitionApplicationSchema.parse(input)
  const learner = learnerWords(context.institutionType)
  const student = state.students.find((item) => item.id === data.studentId)
  if (!student || !student.isActive)
    throw new DomainError('student_not_found', `${learner.title} bulunamadı.`, {
      kind: 'not_found',
      path: ['studentId'],
    })
  if (context.applicantStudentIds.has(data.studentId))
    throw new DomainError(
      'free_tuition_application_exists',
      `Bu ${learner.genitive} bu dönemde başvurusu var.`,
      { kind: 'conflict', path: ['studentId'] },
    )
  if (context.scholarshipStudentIds.has(data.studentId))
    throw new DomainError(
      'free_tuition_scholarship_conflict',
      `${learner.titleDative} bu eğitim yılında burs atanmış; burslu ücretsiz okutma adayı olamaz.`,
      { path: ['studentId'] },
    )
  return data
}

/** Belge işaretleri karar verilene kadar (değerlendirilmemiş ya da yedek) değişir. */
export function planFreeTuitionDocuments(
  application: { status: FreeTuitionStatus },
  input: unknown,
) {
  const data = updateFreeTuitionDocumentsSchema.parse(input)
  requireOpenApplication(application.status, ['documents'])
  return data
}

function requireOpenApplication(status: FreeTuitionStatus, path: readonly string[]) {
  if (status === 'accepted' || status === 'rejected')
    throw new DomainError('free_tuition_application_decided', 'Bu aday için karar verilmiş.', {
      kind: 'conflict',
      path: [...path],
    })
}

export interface FreeTuitionRoundView {
  confirmedQuota: number | null
}

/**
 * Kurul kararı (K-270): kontenjan kesinleşmiş olmalı; toplantı günü gelecekte olamaz; her karar
 * dönemin değerlendirilmemiş ya da yedek adayına verilir; kabul sayısı kesin kontenjanı aşamaz.
 * Yedek ve değerlendirilmemiş aday sonraki toplantıda yeniden karara girer; kabul ve ret kesindir.
 */
export function planFreeTuitionBoard(
  round: FreeTuitionRoundView,
  input: unknown,
  context: {
    today: string
    applications: ReadonlyMap<string, { status: FreeTuitionStatus; studentId: string }>
    acceptedCount: number
  },
): RecordFreeTuitionBoardOutput {
  const data = recordFreeTuitionBoardSchema.parse(input)
  if (round.confirmedQuota === null)
    throw new DomainError(
      'free_tuition_quota_not_confirmed',
      'Kurul kararından önce kontenjanı kesinleştirin.',
    )
  requirePastOrToday(data.meetingDate, context.today, ['meetingDate'])
  for (const [index, item] of data.decisions.entries()) {
    const application = context.applications.get(item.applicationId)
    if (!application)
      throw new DomainError('free_tuition_application_not_found', 'Aday bulunamadı.', {
        kind: 'not_found',
        path: ['decisions', String(index), 'applicationId'],
      })
    requireOpenApplication(application.status, ['decisions', String(index), 'decision'])
  }
  const accepted = data.decisions.filter((item) => item.decision === 'accepted').length
  if (context.acceptedCount + accepted > round.confirmedQuota)
    throw new DomainError(
      'free_tuition_quota_exceeded',
      `Kabul sayısı kontenjanı (${String(round.confirmedQuota)}) aşıyor; fazlasını yedek seçin.`,
      { path: ['decisions'] },
    )
  return data
}

type Invoice = State['invoices'][number]

export interface FreeTuitionWaiver {
  /** Ücretsiz okutmanın kapsadığı yürürlükteki sözleşmeler; ek protokol bunlarda kapanır. */
  contractIds: string[]
  /** İadenin ödeyicisini veren en yeni sözleşme. */
  contractId: string
  /** Kapanan (listeden çıkan, arşivlenen) öğrenim taksitleri. */
  cancelledInvoiceIds: string[]
  /** Tahsilatı iade edilen taksitler; bunlara dağıtılmış tahsilat artık iptal edilemez. */
  refundedInvoiceIds: string[]
  /** Kapanan taksitlerin tahsil edilmemiş kısmı (vazgeçilen alacak). */
  waivedCents: number
  /** Öğrenim taksitlerine o ana kadar alınmış tutar; iade kaydı olur. */
  refundCents: number
}

const isTuition = (invoice: Invoice) => !invoice.feeKind || invoice.feeKind === 'tuition'

/**
 * Kabul edilen öğrencinin o yılki öğrenim ücretini sıfırlar (K-270, DOM-FIN-026): öğrencinin o
 * eğitim yılına ait yürürlükteki sözleşmelerinde bütünüyle ödenmemiş öğrenim taksitleri kapanır
 * (ayrılıştaki gibi listeden çıkar), öğrenim taksitlerine alınmış her tutar iade edilir. Ek hizmet
 * (yemek, servis) ücretsiz okutmaya girmez, taksiti kalır. Onay bekleyen ek protokol varken karar
 * yazılmaz; onaylanırsa kapanan taksitleri geri açardı. Sözleşme yoksa ücretsiz okutma uygulanamaz.
 * State'i değiştirir; denetimler yazımdan öncedir.
 */
export function applyFreeTuitionWaiver(
  state: State,
  studentId: string,
  academicYear: number,
  context: { allocated: ReadonlyMap<string, number>; institutionType?: InstitutionType },
): FreeTuitionWaiver {
  const learner = learnerWords(context.institutionType)
  const own = state.contracts.filter(
    (item) => item.studentId === studentId && item.academicYear === academicYear,
  )
  if (
    own.some(
      (item) =>
        item.amendsContractId !== undefined &&
        ['awaiting_signatory', 'awaiting_approval'].includes(contractStatus(item, state.contracts)),
    )
  )
    throw new DomainError(
      'free_tuition_amendment_pending',
      `${learner.titleGenitive} onay bekleyen ek protokolü var; önce onaylayın ya da iptal edin.`,
      { kind: 'conflict' },
    )
  const contracts = own
    .filter((item) => isContractInForce(item, state.contracts))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const latest = contracts.at(-1)
  if (!latest)
    throw new DomainError(
      'free_tuition_contract_missing',
      `${learner.titleGenitive} bu eğitim yılına ait sözleşmesi yok; ücretsiz okutma uygulanamaz.`,
    )

  const paidOf = (invoice: Invoice) =>
    invoice.paidAt ? invoice.amount : (context.allocated.get(invoice.id) ?? 0)
  const tuition = [...new Set(contracts.flatMap((contract) => invoicesOf(state, contract)))].filter(
    isTuition,
  )
  const cancelled = tuition.filter((invoice) => !invoice.paidAt)
  const refunded = tuition.filter((invoice) => paidOf(invoice) > 0)
  const cancelledIds = new Set(cancelled.map((invoice) => invoice.id))
  state.invoices = state.invoices.filter((invoice) => !cancelledIds.has(invoice.id))
  for (const contract of contracts)
    if (contract.invoiceIds)
      contract.invoiceIds = contract.invoiceIds.filter((id) => !cancelledIds.has(id))

  return {
    contractIds: contracts.map((contract) => contract.id),
    contractId: latest.id,
    cancelledInvoiceIds: cancelled.map((invoice) => invoice.id),
    refundedInvoiceIds: refunded.map((invoice) => invoice.id),
    waivedCents: cancelled.reduce((sum, invoice) => sum + invoice.amount - paidOf(invoice), 0),
    refundCents: refunded.reduce((sum, invoice) => sum + paidOf(invoice), 0),
  }
}

export interface FreeTuitionAwardPlan extends FreeTuitionWaiver {
  applicationId: string
  studentId: string
  refundDueDate: string
}

/**
 * Kurul kararını uygular (K-270): kararı denetler, her kabul edilen öğrencinin o yılki öğrenim
 * ücretini sıfırlar (`applyFreeTuitionWaiver`) ve iade son gününü hesaplar. Kabul anında bursu
 * olan öğrenci reddedilir (aday olduktan sonra burs atanmış olabilir). Hata, kararın satırını
 * gösterir; bir satır reddedilirse hiçbir kayıt değişmez.
 */
export function applyFreeTuitionBoard(
  state: State,
  round: FreeTuitionRoundView & { academicYear: number; teachingStartDate: string },
  input: unknown,
  context: Parameters<typeof planFreeTuitionBoard>[2] & {
    allocated: ReadonlyMap<string, number>
    scholarshipStudentIds: ReadonlySet<string>
    institutionType?: InstitutionType
  },
): RecordFreeTuitionBoardOutput & { awards: FreeTuitionAwardPlan[] } {
  const data = planFreeTuitionBoard(round, input, context)
  const learner = learnerWords(context.institutionType)
  const awards: FreeTuitionAwardPlan[] = []
  for (const [index, item] of data.decisions.entries()) {
    const application = context.applications.get(item.applicationId)
    if (item.decision !== 'accepted' || !application) continue
    const path = ['decisions', String(index), 'decision']
    if (context.scholarshipStudentIds.has(application.studentId))
      throw new DomainError(
        'free_tuition_scholarship_conflict',
        `${learner.titleDative} bu eğitim yılında burs atanmış; burslu ücretsiz okutma alamaz.`,
        { path },
      )
    let waiver: FreeTuitionWaiver
    try {
      waiver = applyFreeTuitionWaiver(state, application.studentId, round.academicYear, context)
    } catch (error) {
      if (error instanceof DomainError)
        throw new DomainError(error.code, error.message, { kind: error.kind, path, cause: error })
      throw error
    }
    awards.push({
      ...waiver,
      applicationId: item.applicationId,
      studentId: application.studentId,
      refundDueDate: freeTuitionRefundDueDate(round.teachingStartDate, data.meetingDate),
    })
  }
  return { ...data, awards }
}

/** Ay ekler; ayda o gün yoksa ayın son günü (`refundDueDate` ile aynı kırpma). */
function addMonths(day: string, months: number): string {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7)) - 1 + months
  const date = Number(day.slice(8, 10))
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(date, lastDay))).toISOString().slice(0, 10)
}

/**
 * İadenin son günü (DOM-FIN-026, K-270): öğretim başladıktan sonra iki ay. Kurul bu süreden sonra
 * karar verirse süre geçmiştir; son gün kabul günüdür, iade hemen gecikmiş görünür.
 */
export function freeTuitionRefundDueDate(teachingStartDate: string, acceptedDate: string): string {
  const due = addMonths(teachingStartDate, FREE_TUITION_REFUND_MONTHS)
  return due < acceptedDate ? acceptedDate : due
}

export type FreeTuitionRefundStatus = 'none' | 'pending' | 'paid'

export const freeTuitionRefundStatus = (award: {
  refundCents: number
  refundPaidDate: string | null
}): FreeTuitionRefundStatus =>
  award.refundPaidDate !== null ? 'paid' : award.refundCents === 0 ? 'none' : 'pending'

/**
 * Ücretsiz okutma iadesinin ödemesi (K-270): ayrılış iadesiyle aynı kurallar (`planRefundPayment`,
 * DOM-FIN-041): hesap sahibi sözleşmedeki ödeyici, kurumun bildirilmiş hesabı, kapalı güne yazılmaz.
 * Ödeme günü kabul gününden önce olamaz.
 */
export function planFreeTuitionRefund(
  award: {
    refundCents: number
    refundPaidDate: string | null
    acceptedDate: string
    payerName: string
  },
  input: unknown,
  context: RefundPaymentContext,
): PayRefundOutput {
  if (award.refundCents === 0)
    throw new DomainError('free_tuition_refund_not_due', 'Bu hakta iade edilecek tutar yok.', {
      kind: 'conflict',
    })
  const paidDate: unknown =
    typeof input === 'object' && input !== null ? Reflect.get(input, 'paidDate') : undefined
  if (
    award.refundPaidDate === null &&
    typeof paidDate === 'string' &&
    paidDate < award.acceptedDate
  )
    throw new DomainError(
      'free_tuition_refund_before_award',
      'İade ödeme tarihi kurul kararından önce olamaz.',
      { path: ['paidDate'] },
    )
  return planRefundPayment(
    {
      refundCents: award.refundCents,
      refundPaidDate: award.refundPaidDate,
      payerName: award.payerName,
      withdrawalDate: award.acceptedDate,
    },
    input,
    context,
  )
}

/** Hakkın MEBBİS'e işlendiği gün bir kez kaydedilir; gönderim elle yapılır (IST-143, K-271). */
export function planFreeTuitionMebbis(
  award: { mebbisRecordedDate: string | null; acceptedDate: string },
  input: unknown,
  today: string,
) {
  const data = freeTuitionMebbisSchema.parse(input)
  requirePastOrToday(data.recordedDate, today, ['recordedDate'])
  if (data.recordedDate < award.acceptedDate)
    throw new DomainError(
      'free_tuition_mebbis_before_award',
      'MEBBİS günü kurul kararından önce olamaz.',
      { path: ['recordedDate'] },
    )
  if (award.mebbisRecordedDate !== null)
    throw new DomainError('free_tuition_mebbis_recorded', "MEBBİS'e işlendiği zaten kayıtlı.", {
      kind: 'conflict',
    })
  return data
}

/**
 * Ücretsiz okutmanın kapsadığı sözleşmeye ek protokol açılmaz (K-270): kalan neti yeni plana
 * dağıtarak kapanan taksitleri geri getirirdi.
 */
export function assertContractNotFreeTuition(
  contractId: string,
  freeTuitionContractIds: ReadonlySet<string>,
) {
  if (freeTuitionContractIds.has(contractId))
    throw new DomainError(
      'contract_free_tuition',
      'Bu sözleşmenin yılında ücretsiz okutma hakkı var; ek protokol açılamaz.',
    )
}

/** Kurul kararlarının özeti: kabul, yedek, ret sayıları (tutanak ve ekran). */
export function freeTuitionDecisionCounts(
  decisions: readonly { decision: FreeTuitionDecision }[],
): Record<FreeTuitionDecision, number> {
  const counts: Record<FreeTuitionDecision, number> = { accepted: 0, reserve: 0, rejected: 0 }
  for (const item of decisions) counts[item.decision] += 1
  return counts
}

/** Bir öğrencinin o yıldaki sözleşmesi ücretsiz okutmada mı; yalnız hak listesinden bakılır. */
export const freeTuitionContractSet = (awards: readonly { contractIds: readonly string[] }[]) =>
  new Set(awards.flatMap((award) => award.contractIds))
