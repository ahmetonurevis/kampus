import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { isContractInForce } from './contract-status.ts'
import { daySchema, requiredText, type MakeId } from './domain.ts'
import { learnerWords } from './enrollment-learner.ts'
import { DomainError } from './errors.ts'
import type { ACTIVITY_FEE_KIND } from './fee-tariffs.ts'
import { packageUsedHoursRecorded, packageWithdrawalHours } from './finance-package-hours.ts'
import type { PackageHourKind, PackageHourSource } from './finance-packages.ts'
import { dayKey, money } from './format.ts'

/**
 * Ayrılış ve iade (docs/domain/finans.md DOM-FIN-040, -041; kayit-ve-crm.md DOM-KAY-024; IST-110;
 * ADR 0006 karar 10). Bütün yürürlükteki sözleşmeler hesaba girer (K-06). Öğretim takvimi kaynağı
 * olmadığı için öğrenim sözleşmesinde görülen ve toplam birim (ders günü veya ders saati) yönetici
 * tarafından girilir; paket satışında kullanılan saat kayıttan gelir (DOM-DIL-051), yoklama bağı
 * gelene kadar personel elle yazar ve paketli ayrılışın iade tutarı yönetici onayından geçer (K-21).
 * Yuvarlama ödeyici lehinedir: kesinti aşağı yuvarlanır. Oranlar ve hesap tabanı mevzuat metninde
 * açık değildir, **doğrulanmalı** (DOM-FIN-040).
 */

/** Kesinti oranı; on binde birlik, %10 (ÖÖKY md. 56/3). Hesap dökümüne kopyalanır. */
export const REFUND_DEDUCTION_BASIS_POINTS = 1_000
const BASIS = 10_000
const DAY_TIME = 'T09:00:00.000Z'
/**
 * Etkinlik taksitinin türü (`ACTIVITY_FEE_KIND`); değer içe aktarılmaz, `fee-tariffs.ts` →
 * `payments.ts` → bu dosya döngüsü oluşur. Tip denetimi iki değeri eş tutar.
 */
const ACTIVITY_KIND: typeof ACTIVITY_FEE_KIND = 'activity'

export const WITHDRAWAL_REASONS = [
  'transfer',
  'relocation',
  'documented',
  'financial',
  'dissatisfaction',
  'other',
] as const
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number]

const quoteFields = {
  withdrawalDate: daySchema,
  termStartDate: daySchema,
  attendedUnits: z.number().int().min(0).max(100_000),
  totalUnits: z.number().int().min(1).max(100_000),
  /** Sınavla öğrenci alan resmî okulun 9. sınıfına kayıt belgelendi (ÖÖKY md. 56/3-a). */
  publicSchoolExemption: z.boolean().default(false),
}
export const withdrawalQuoteSchema = z.strictObject(quoteFields)
export type WithdrawalQuoteInput = z.input<typeof withdrawalQuoteSchema>

/**
 * Hesaba giren sözleşmelerin ödeyicileri farklıysa iadeyi kimin alacağı yöneticinin kararıdır
 * (K-12, DOM-FIN-040). Geçerli ödeyici hesaba bağlıdır: denetim `withdrawStudent`'tadır (422).
 */
export const payerDecisionSchema = z.strictObject({
  payer: z
    .string('İadeyi alacak ödeyiciyi seçin.')
    .trim()
    .min(1, 'İadeyi alacak ödeyiciyi seçin.')
    .max(200),
  // kvkk: K — yalnız ayrılış kaydında saklanır, loglanmaz; denetime alan adı düşer.
  reason: z
    .string('Karar gerekçesini yazın.')
    .trim()
    .min(2, 'Karar gerekçesini yazın.')
    .max(500, 'En fazla 500 karakter girebilirsiniz.'),
})
export type PayerDecisionInput = z.input<typeof payerDecisionSchema>

export const withdrawStudentSchema = z.strictObject({
  ...quoteFields,
  reason: z.enum(WITHDRAWAL_REASONS, 'Ayrılış nedenini seçin.'),
  targetSchool: requiredText.max(200).nullable().default(null),
  payerDecision: payerDecisionSchema.nullable().default(null),
  /**
   * Yöneticinin önizlemede gördüğü iade tutarı (K-21); paket satışı hesaba giriyorsa zorunludur.
   * Tutar arada değiştiyse ayrılış yazılmaz: denetim `withdrawStudent`'tadır.
   */
  approvedRefundCents: z
    .number('İade tutarı geçersiz.')
    .int('İade tutarı geçersiz.')
    .min(0, 'İade tutarı geçersiz.')
    .nullable()
    .default(null),
})
export type WithdrawStudentInput = z.input<typeof withdrawStudentSchema>

export const WITHDRAWAL_REASON_LABELS: Readonly<Record<WithdrawalReason, string>> = {
  transfer: 'Nakil',
  relocation: 'Taşınma',
  documented: 'Belgeli neden',
  financial: 'Ekonomik',
  dissatisfaction: 'Memnuniyetsizlik',
  other: 'Diğer',
}

/** Ayrılış formu (web): öğrenci seçilir, hedef okul boş metin olabilir. */
export const withdrawalFormSchema = z.object({
  studentId: requiredText,
  withdrawalDate: daySchema,
  termStartDate: daySchema,
  attendedUnits: z.number('Görülen birimi girin.').int().min(0).max(100_000),
  totalUnits: z.number('Toplam birimi girin.').int().min(1).max(100_000),
  publicSchoolExemption: z.boolean(),
  reason: z.enum(WITHDRAWAL_REASONS, 'Ayrılış nedenini seçin.'),
  targetSchool: z.string().trim().max(200),
})
export type WithdrawalFormValues = z.output<typeof withdrawalFormSchema>

/** TR IBAN: 26 karakter, ISO 13616 mod 97 denetimi. */
export function isValidTurkishIban(value: string): boolean {
  if (!/^TR\d{24}$/.test(value)) return false
  const rearranged = value.slice(4) + value.slice(0, 4)
  const digits = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55))
  let remainder = 0
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  return remainder === 1
}

export const payRefundSchema = z.strictObject({
  paidDate: daySchema,
  // kvkk: Ç
  iban: z
    .string()
    .transform((value) => value.replace(/\s/g, '').toUpperCase())
    .refine(isValidTurkishIban, 'Geçerli bir IBAN girin.'),
  // kvkk: K
  accountHolder: requiredText.max(120),
  /** İadenin çıktığı kurum hesabı (DOM-FIN-032, M-13): kurumun arşivlenmemiş bildirilmiş hesabı. */
  bankAccountId: z.uuid('İadenin ödendiği kurum banka hesabını seçin.'),
})
export type PayRefundInput = z.input<typeof payRefundSchema>
export type PayRefundOutput = z.output<typeof payRefundSchema>

export interface WithdrawalExtraLine {
  invoiceId: string
  kind: string
  amountCents: number
  paidCents: number
  usedCents: number
}

export type WithdrawalPayer = 'guardian' | 'student'

export const WITHDRAWAL_PAYER_LABELS: Readonly<Record<WithdrawalPayer, string>> = {
  guardian: 'Veli',
  student: 'Öğrenci veya kursiyer',
}

/** Sözleşmenin ödeyicisi (DOM-KAY-012); yalnız önizlemede döner, ad kayda girmez. */
export interface WithdrawalContractPayer {
  contractId: string
  payer: WithdrawalPayer
  // kvkk: K
  payerName: string
}

/** Bir sözleşmenin dökümü; toplam döküm bu satırların toplamıdır. */
export interface WithdrawalContractLine {
  contractId: string
  title: string
  /** Ödeyicinin türü; ad yazılmaz, iade yanıtının idempotency kaydına hesap sahibi girmesin. */
  payer: WithdrawalPayer
  /** Paket satışı; öğrenim sözleşmesinde yoktur. */
  packageSaleId?: string
  /** Pakette kullanılan ve satın alınan saat; öğrenim sözleşmesinde girilen birim. */
  attendedUnits: number
  totalUnits: number
  /** Ayrılışla iade edilmiş yazılacak kalan saat (DOM-DIL-051); yalnız pakette. */
  returnedHours?: number
  /** Pakette kullanılan saat hiç girilmedi: hesap sıfır saate dayanır, fazla çıkabilir (K-21). */
  usedHoursMissing?: boolean
  scholarshipExempt: boolean
  /**
   * Ayrılış gününde yürürlükte olan burs kesmesi ya da iptali (K-350, ON-342): burslu istisnası
   * uygulanmaz, kalkan burs payı tabana eklenir. Eski kayıtta ve bursu sürende yoktur.
   */
  scholarshipEnd?: {
    kind: WithdrawalScholarshipEndKind
    effectiveDate: string
    reinstatedCents: number
  }
  baseCents: number
  deductionCents: number
  usageCents: number
  entitledCents: number
  paidCents: number
  extraBalanceCents: number
  /** Artıysa bu sözleşmeden iade, eksiyse borç; dağıtılmamış tahsilat hariçtir. */
  balanceCents: number
}

export type WithdrawalScholarshipEndKind = 'terminate' | 'revoke'

/**
 * Sözleşmenin burs kesme ya da iptal kaydı (`scholarship_terminations`, DOM-FIN-025, ON-283).
 * Ayrılış hesabı bundan tabanı ve burslu istisnasını, geri isteme alacağının satırını çıkarır
 * (K-350, K-351).
 */
export interface WithdrawalScholarshipEnd {
  awardId: string
  contractId: string
  kind: WithdrawalScholarshipEndKind
  /** Kesme günü (o gün burslu sayılır) ya da iptal günü. */
  effectiveDate: string
  /** İleriye kalkan burs payı: sözleşmeye bağlı yeni öğrenim taksitlerinin toplamı. */
  reinstatedCents: number
  principalCents: number
  interestCents: number
  /** Sözleşme dışı geri isteme alacağı taksitleri (anapara, faiz); ayrılış iptal etmez (K-266). */
  clawbackInvoiceIds: readonly string[]
}

/**
 * Geri istenen burs alacağı (K-351): dökümde ayrı satırdır; iade ve borç bakiyesine, tabana girmez,
 * ayrılış alacağı iptal etmez. `openCents` ayrılış anında ödenmemiş kısımdır.
 */
export interface WithdrawalClawbackLine {
  awardId: string
  contractId: string
  effectiveDate: string
  principalCents: number
  interestCents: number
  openCents: number
}

/** Etkinlik katılımının ayrılıştaki sonucu (K-348): iptal edildi ya da borcu kaldı. */
export type WithdrawalActivityOutcome = 'cancelled' | 'held'

/**
 * Gezi ve etkinlik katılımının ayrılış satırı (DOM-FIN-098, K-348, K-349). `cancelled`: etkinlik
 * ayrılış gününden sonradır, katılım ayrılış gününe göre etkinliğin kuralıyla iptal edilir.
 * `held`: etkinlik gerçekleşmiştir (ya da önceki iptalin kesinti taksiti açıktır), ödenmemiş kısım
 * borç olarak kalır. Tutarlar iade ve borç bakiyesine girmez; iade katılım kaydından ödenir.
 */
export interface WithdrawalActivityLine {
  participantId: string
  activityId: string
  name: string
  activityDate: string
  outcome: WithdrawalActivityOutcome
  /** Satırın taksiti: katılım taksiti ya da önceki iptalin kesinti taksiti. */
  invoiceId: string
  amountCents: number
  paidCents: number
  /** İptalde katılımcıda kalan kesinti; `held` satırında sıfır. */
  retainedCents: number
  /** İptalde iade edilecek tutar (katılım kaydında ödenir, K-303). */
  refundCents: number
  /** Ayrılıştan sonra açık kalan etkinlik borcu. */
  openCents: number
  /** İptalde kesinti farkı için açılan taksit; yalnız ayrılış kaydında. */
  debtInvoiceId?: string
}

/** Hesap dökümü: iade kaydında aynen saklanır, sonradan değişmez (DOM-FIN-041). */
export interface WithdrawalBreakdown {
  institutionType: InstitutionType
  withdrawalDate: string
  termStartDate: string
  started: boolean
  attendedUnits: number
  totalUnits: number
  publicSchoolExemption: boolean
  /** Burslu ayrılışı: öğrenim için ödenenden fazlası istenmez (DOM-FIN-025). Eski kayıtta yoktur. */
  scholarshipExempt?: boolean
  deductionBasisPoints: number
  baseCents: number
  deductionCents: number
  usageCents: number
  entitledCents: number
  paidCents: number
  creditCents: number
  extras: WithdrawalExtraLine[]
  refundCents: number
  debtCents: number
  /**
   * Ayrılışta kalan borç için açılan taksit. Yalnız ayrılış kaydında bulunur (önizlemede yok); eski
   * kayıtta yoktur. Bu taksite alınan tahsilat ayrılış hesabının dışındadır ve iptal edilebilir
   * (DOM-FIN-041, `reversePayment`).
   */
  debtInvoiceId?: string
  /**
   * Hesaba giren sözleşmeler, eskiden yeniye (K-06). Üstteki tutarlar bunların toplamıdır. Eski
   * kayıtta yoktur. Kayıt `contract_id`'si yalnız son sözleşmeyi tutar; öteki kimlikler buradadır.
   */
  contracts?: WithdrawalContractLine[]
  /**
   * Yöneticinin iade kararı (K-12): yalnız ödeyiciler farklı ve iade varken bulunur. Gerekçe komut
   * yanıtına girmez (`services/withdrawals.ts`), yalnız yöneticinin kayıt okumalarında döner (K-13).
   */
  payerDecision?: {
    payer: WithdrawalPayer
    // kvkk: K
    reason?: string
  }
  /** Paketli ayrılışta yöneticinin onayladığı iade tutarı (K-21); öteki kayıtta yoktur. */
  refundApprovedCents?: number
  /** Geri istenen burs alacağı (K-351); yalnız varsa, eski kayıtta yoktur. */
  scholarshipClawbacks?: WithdrawalClawbackLine[]
  /** Gezi ve etkinlik katılımları (K-348, K-349); yalnız varsa, eski kayıtta yoktur. */
  activities?: WithdrawalActivityLine[]
}

/** Hesaba giren paket satışı ve saat hareketleri (`lesson_package_sales`, DOM-DIL-051). */
export interface WithdrawalPackageSale {
  id: string
  contractId: string
  purchasedHours: number
  entries: readonly {
    kind: PackageHourKind
    hours: number
    occurredDate: string
    /** `manual` satırı girildiği güne kadarki toplamdır; ayrılış gününe göre elenmez (K-21, K-43). */
    sourceType?: PackageHourSource
  }[]
}

export interface WithdrawalContext {
  institutionType: InstitutionType
  /** Taksit → iptal edilmemiş tahsilatlardan dağıtılmış tutar. */
  allocated: ReadonlyMap<string, number>
  /** Taksitlere dağıtılmamış tahsilat tutarı (iade alacağı, DOM-FIN-030). */
  creditCents: number
  /** Öğrencinin paket satışları; dil okulu dışında boştur. */
  packageSales?: readonly WithdrawalPackageSale[]
  /**
   * Ücretsiz okutmanın kapsadığı sözleşmeler (DOM-FIN-026, K-270): öğrenim ücreti istenmez ve
   * alınmış öğrenim ücreti hakkın kendi iade kaydıyla döndüğü için ayrılışta yeniden iade edilmez.
   */
  freeTuitionContractIds?: ReadonlySet<string>
  /** Öğrencinin burs kesme ve iptal kayıtları (K-350, K-351); eskiden yeniye. */
  scholarshipEnds?: readonly WithdrawalScholarshipEnd[]
  now: string
}

type Contract = State['contracts'][number]
type Invoice = State['invoices'][number]

function plannedRenewalContractIds(state: State, studentId: string): Set<string> {
  return new Set(
    state.renewals
      .filter((item) => item.studentId === studentId && item.status === 'Planlandı')
      .flatMap((item) => (item.contractId ? [item.contractId] : [])),
  )
}

/** Sözleşmenin kendi taksitleri (DOM-FIN-012); alanı olmayan eski kayıtta öğrencinin taksitleri. */
export function invoicesOf(state: State, contract: Contract): Invoice[] {
  return state.invoices.filter((invoice) =>
    contract.invoiceIds
      ? contract.invoiceIds.includes(invoice.id)
      : invoice.studentId === contract.studentId,
  )
}

const paidOf = (invoice: Invoice, allocated: ReadonlyMap<string, number>) =>
  invoice.paidAt ? invoice.amount : (allocated.get(invoice.id) ?? 0)

interface AccountContract {
  contract: Contract
  invoices: Invoice[]
  sale: WithdrawalPackageSale | undefined
}

/** Satış ilk sürüme bağlıdır; ek protokol zinciri satışın sözleşmesine kadar geri okunur. */
function saleFinder(state: State, sales: readonly WithdrawalPackageSale[]) {
  const saleByContract = new Map(sales.map((sale) => [sale.contractId, sale]))
  const contractById = new Map(state.contracts.map((item) => [item.id, item]))
  return (contract: Contract) => {
    const seen = new Set<string>()
    let current: Contract | undefined = contract
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      const sale = saleByContract.get(current.id)
      if (sale) return sale
      current = current.amendsContractId ? contractById.get(current.amendsContractId) : undefined
    }
    return undefined
  }
}

/**
 * Hesaba giren sözleşmeler (K-06, DOM-FIN-040), eskiden yeniye; son eleman ayrılış kaydının
 * sözleşmesidir. Onaylanmamış ek protokol ve yerini ek protokole bırakan sürüm girmez (DOM-FIN-012),
 * planlanmış yenileme ayrı iptal yoluyla işlenir. Yeni yıla geçilince geçen yılın öğrenim sözleşmesi
 * yürürlükte görünür ama hizmeti bitmiştir: görülen birim bu yıla aittir, o sözleşmeye uygulanırsa
 * alınmış hizmet iade edilir. Paket satışının saati yıl geçse de yanmadığı için her zaman girer
 * (DOM-DIL-051).
 */
function withdrawalAccount(
  state: State,
  studentId: string,
  sales: readonly WithdrawalPackageSale[],
  institutionType: InstitutionType,
  standalone: ReadonlySet<string>,
): AccountContract[] {
  const planned = plannedRenewalContractIds(state, studentId)
  const saleOf = saleFinder(state, sales)
  const inForce = state.contracts.filter(
    (item) =>
      item.studentId === studentId &&
      !planned.has(item.id) &&
      isContractInForce(item, state.contracts),
  )
  const latestYear = Math.max(
    ...inForce.filter((item) => !saleOf(item)).map((item) => item.academicYear ?? 0),
  )
  const contracts = inForce
    .filter((item) => saleOf(item) !== undefined || (item.academicYear ?? 0) === latestYear)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  if (contracts.length === 0) throw contractMissing(institutionType)

  // Taksit bir kez sayılır. Listesi olmayan eski sözleşme yalnız hiçbir sözleşmenin listesinde
  // bulunmayan taksitleri alır; aynı taksit iki sözleşmede görünürse yeni sözleşmede kalır.
  // Sözleşmesiz etkinlik taksiti ve burs geri isteme alacağı hiçbir sözleşmeye girmez (K-349, K-351).
  const listed = new Set(
    state.contracts
      .filter((item) => item.studentId === studentId)
      .flatMap((item) => item.invoiceIds ?? []),
  )
  const counted = new Set<string>()
  const newestFirst = [...contracts].reverse().map((contract) => {
    const own = contract.invoiceIds
      ? invoicesOf(state, contract)
      : state.invoices.filter(
          (item) =>
            item.studentId === studentId &&
            !listed.has(item.id) &&
            item.feeKind !== ACTIVITY_KIND &&
            !standalone.has(item.id),
        )
    const invoices = own.filter((item) => !counted.has(item.id))
    for (const item of invoices) counted.add(item.id)
    return { contract, invoices, sale: saleOf(contract) }
  })
  return newestFirst.reverse()
}

/**
 * Ayrılış gününde yürürlükte olan burs sonu (K-350). İptal geriye etkilidir, günden bağımsız girer;
 * iptal varsa önceki kesmenin kaldırdığı pay da girer. Kesme yalnız kesme günü ayrılış gününden
 * önceyse girer: kesme günü burslu sayılır, pay o günden sonraki vadelerde kalkar (DOM-FIN-025).
 */
export function scholarshipEndAtWithdrawal(
  ends: readonly Pick<WithdrawalScholarshipEnd, 'kind' | 'effectiveDate' | 'reinstatedCents'>[],
  withdrawalDate: string,
): WithdrawalContractLine['scholarshipEnd'] {
  const revoked = ends.find((item) => item.kind === 'revoke')
  const inEffect = revoked ? ends : ends.filter((item) => item.effectiveDate < withdrawalDate)
  const decisive = revoked ?? inEffect.at(-1)
  if (decisive === undefined) return undefined
  return {
    kind: decisive.kind,
    effectiveDate: decisive.effectiveDate,
    reinstatedCents: inEffect.reduce((sum, item) => sum + item.reinstatedCents, 0),
  }
}

/** Bir sözleşmenin hesabı: öğrenimde girilen birim, pakette kayıtlı saat (DOM-FIN-040, DOM-DIL-051). */
function quoteContract(
  { contract, invoices, sale }: AccountContract,
  data: z.output<typeof withdrawalQuoteSchema>,
  started: boolean,
  allocated: ReadonlyMap<string, number>,
  freeTuition = false,
  ends: readonly WithdrawalScholarshipEnd[] = [],
): { line: WithdrawalContractLine; extras: WithdrawalExtraLine[] } {
  // Ücrete yazılan ve iade edilen saat aynı hareket kümesinden çıkar (DOM-DIL-051, K-43): ayrılıştan
  // sonraki ders ücrete girmez, iade edilir; elle girilen toplam girişin günüyle elenmez (K-21).
  const saleHours = sale
    ? packageWithdrawalHours(sale.purchasedHours, sale.entries, data.withdrawalDate)
    : undefined
  const attendedUnits = saleHours?.usedHours ?? data.attendedUnits
  const totalUnits = sale?.purchasedHours ?? data.totalUnits
  const isTuition = (invoice: Invoice) => !invoice.feeKind || invoice.feeKind === 'tuition'
  const share = (amount: number) => Math.floor((amount * attendedUnits) / totalUnits)

  // Ücretsiz okutmada burs olmaz (K-269); kesilen ya da iptal edilen bursun kalkan payı sözleşmeye
  // bağlı yeni öğrenim taksitidir, taban ona göre büyür; kesmeden önce uygulanan burs girmez (K-350).
  const scholarshipEnd = freeTuition
    ? undefined
    : scholarshipEndAtWithdrawal(ends, data.withdrawalDate)
  const baseCents = (contract.netCents ?? contract.amount) + (scholarshipEnd?.reinstatedCents ?? 0)
  const deductionCents = data.publicSchoolExemption
    ? 0
    : Math.floor((baseCents * REFUND_DEDUCTION_BASIS_POINTS) / BASIS)
  // Paket saati gerçekleşmiş kayıttır: dönem başlangıcı girdisinden bağımsız kullanılmış sayılır.
  // İndirimli pakette de taban net ücrettir, saat payı net üzerinden işler (H-13, **doğrulanmalı**).
  const usageCents = sale || started ? share(baseCents) : 0
  // Ücretsiz okutmada öğrenim tahsilatı hakkın iadesindedir; burada ne ödenen ne hak edilen vardır.
  const paidCents = freeTuition
    ? 0
    : invoices.filter(isTuition).reduce((sum, invoice) => sum + paidOf(invoice, allocated), 0)
  const scholarshipExempt = contract.scholarship !== undefined && scholarshipEnd === undefined
  const computedCents = Math.min(baseCents, deductionCents + usageCents)
  // Burs öğrenim ücretini kapsar: ek hizmetin kullanılan payı bursludan da istenir.
  const entitledCents = freeTuition
    ? 0
    : scholarshipExempt
      ? Math.min(computedCents, paidCents)
      : computedCents
  const extras = invoices
    .filter((invoice) => !isTuition(invoice))
    .map((invoice): WithdrawalExtraLine => ({
      invoiceId: invoice.id,
      kind: invoice.feeKind ?? '',
      amountCents: invoice.amount,
      paidCents: paidOf(invoice, allocated),
      usedCents: share(invoice.amount),
    }))
  const extraBalanceCents = extras.reduce((sum, line) => sum + line.paidCents - line.usedCents, 0)
  return {
    extras,
    line: {
      contractId: contract.id,
      title: contract.title,
      payer: contract.payer === 'student' ? 'student' : 'guardian',
      ...(sale
        ? {
            packageSaleId: sale.id,
            returnedHours: saleHours?.returnedHours ?? 0,
            ...(packageUsedHoursRecorded(sale.entries) ? {} : { usedHoursMissing: true }),
          }
        : {}),
      attendedUnits,
      totalUnits,
      scholarshipExempt,
      ...(scholarshipEnd ? { scholarshipEnd } : {}),
      baseCents,
      deductionCents,
      usageCents,
      entitledCents,
      paidCents,
      extraBalanceCents,
      balanceCents: paidCents - entitledCents + extraBalanceCents,
    },
  }
}

function assertUnits(data: z.output<typeof withdrawalQuoteSchema>, today: string): boolean {
  if (data.withdrawalDate > today)
    throw new DomainError('withdrawal_date_in_future', 'Ayrılış tarihi ileri bir gün olamaz.', {
      path: ['withdrawalDate'],
    })
  if (data.attendedUnits > data.totalUnits)
    throw new DomainError('attended_exceeds_total', 'Görülen birim toplamı aşamaz.', {
      path: ['attendedUnits'],
    })
  const started = data.withdrawalDate >= data.termStartDate
  if (!started && data.attendedUnits > 0)
    throw new DomainError('attended_before_term', 'Dönem başlamadan görülen birim girilemez.', {
      path: ['attendedUnits'],
    })
  return started
}

/**
 * Sunucu iletileri kurum türünün sözünü kullanır (DOM-KAY-012, ADR 0008 karar 1): okulda "öğrenci",
 * dil okulu ve kursta "kursiyer"; tür bilinmiyorsa okul metni. Kod (`code`) türden bağımsızdır.
 */
function contractMissing(type?: InstitutionType) {
  return new DomainError(
    'withdrawal_contract_missing',
    `${learnerWords(type).titleGenitive} sözleşmesi bulunamadı.`,
  )
}

function studentOf(state: State, studentId: string, type: InstitutionType) {
  const student = state.students.find((item) => item.id === studentId)
  if (!student)
    throw new DomainError('student_not_found', `${learnerWords(type).title} bulunamadı.`, {
      kind: 'not_found',
    })
  return student
}

/**
 * İade hesabı (DOM-FIN-040, K-06): her sözleşme kendi tabanı ve kullanımıyla hesaplanır, toplam döküm
 * satırların toplamıdır. Taban sözleşmenin net ücretidir. Kesinti `taban × %10`, kullanım
 * `taban × görülen / toplam`; hak edilen tabanı aşamaz. Ek hizmetler ayrı hesaplanır: kullanılmayan
 * süre iade edilir. Saf işlemdir, State değişmez.
 */
export function quoteWithdrawal(
  state: State,
  studentId: string,
  input: unknown,
  context: WithdrawalContext,
): {
  contractId: string
  breakdown: WithdrawalBreakdown
  /** Hesaba giren sözleşmelerin ödeyicileri farklı mı (K-12). */
  payersDiffer: boolean
  payers: WithdrawalContractPayer[]
} {
  const data = withdrawalQuoteSchema.parse(input)
  studentOf(state, studentId, context.institutionType)
  const started = assertUnits(data, dayKey(context.now))
  if (data.publicSchoolExemption && (started || context.institutionType !== 'school'))
    throw new DomainError(
      'exemption_not_applicable',
      'Kesintisiz iade yalnız okulda, öğretim yılı başlamadan uygulanır.',
      { path: ['publicSchoolExemption'] },
    )
  const ends = context.scholarshipEnds ?? []
  const account = withdrawalAccount(
    state,
    studentId,
    context.packageSales ?? [],
    context.institutionType,
    clawbackInvoiceIds(ends),
  )
  const latest = account.at(-1)
  if (!latest) throw contractMissing(context.institutionType)
  const quotes = account.map((item) =>
    quoteContract(
      item,
      data,
      started,
      context.allocated,
      context.freeTuitionContractIds?.has(item.contract.id) ?? false,
      ends.filter((end) => end.contractId === item.contract.id),
    ),
  )
  const clawbacks = clawbackLines(state, ends, context.allocated)
  const lines = quotes.map((quote) => quote.line)
  const total = (pick: (line: WithdrawalContractLine) => number) =>
    lines.reduce((sum, line) => sum + pick(line), 0)
  // Sözleşmeler, ek hizmet ve dağıtılmamış tahsilat tek bakiyede netleşir: iade ve borç birlikte
  // oluşmaz (DOM-FIN-040: ödenen hak edilenden azsa iade sıfırdır).
  const balance = total((line) => line.balanceCents) + context.creditCents
  const payers = lines.map((line): WithdrawalContractPayer => ({
    contractId: line.contractId,
    payer: line.payer,
    payerName: payerNameOf(state, line.contractId, context.institutionType),
  }))
  return {
    contractId: latest.contract.id,
    payersDiffer: new Set(payers.map((item) => normalizedName(item.payerName))).size > 1,
    payers,
    breakdown: {
      institutionType: context.institutionType,
      withdrawalDate: data.withdrawalDate,
      termStartDate: data.termStartDate,
      started,
      attendedUnits: data.attendedUnits,
      totalUnits: data.totalUnits,
      publicSchoolExemption: data.publicSchoolExemption,
      scholarshipExempt: lines.some((line) => line.scholarshipExempt),
      deductionBasisPoints: REFUND_DEDUCTION_BASIS_POINTS,
      baseCents: total((line) => line.baseCents),
      deductionCents: total((line) => line.deductionCents),
      usageCents: total((line) => line.usageCents),
      entitledCents: total((line) => line.entitledCents),
      paidCents: total((line) => line.paidCents),
      creditCents: context.creditCents,
      extras: quotes.flatMap((quote) => quote.extras),
      refundCents: Math.max(balance, 0),
      debtCents: Math.max(-balance, 0),
      contracts: lines,
      ...(clawbacks.length > 0 ? { scholarshipClawbacks: clawbacks } : {}),
    },
  }
}

const clawbackInvoiceIds = (ends: readonly WithdrawalScholarshipEnd[]) =>
  new Set(ends.flatMap((end) => end.clawbackInvoiceIds))

/**
 * Geri isteme alacağının satırları (K-351): anapara, faiz ve ayrılış anında ödenmemiş kısım.
 * Bakiyeye girmez; ayrılış bu taksitleri iptal etmez (K-266).
 */
function clawbackLines(
  state: State,
  ends: readonly WithdrawalScholarshipEnd[],
  allocated: ReadonlyMap<string, number>,
): WithdrawalClawbackLine[] {
  const invoiceById = new Map(state.invoices.map((invoice) => [invoice.id, invoice]))
  return ends
    .filter((end) => end.principalCents + end.interestCents > 0)
    .map((end) => ({
      awardId: end.awardId,
      contractId: end.contractId,
      effectiveDate: end.effectiveDate,
      principalCents: end.principalCents,
      interestCents: end.interestCents,
      openCents: end.clawbackInvoiceIds.reduce((sum, id) => {
        const invoice = invoiceById.get(id)
        return invoice === undefined
          ? sum
          : sum + Math.max(invoice.amount - paidOf(invoice, allocated), 0)
      }, 0),
    }))
}

/**
 * Sözleşme sözleşme gösterilecek satırlar: birden çok sözleşmede ve pakette toplam satırı kullanımı
 * anlatamaz (pakette saat kayıttan gelir). Tek öğrenim sözleşmesinde ve eski kayıtta boştur, döküm
 * toplam satırlarıyla okunur.
 */
export function contractLinesToShow<T extends { packageSaleId?: string | undefined }>(
  lines: readonly T[] | undefined,
): readonly T[] {
  if (!lines) return []
  return lines.length > 1 || lines.some((line) => line.packageSaleId !== undefined) ? lines : []
}

/** Paket satışı hesaba giriyorsa iade tutarı yönetici onayından geçer (K-21). */
export function refundApprovalRequired(breakdown: Pick<WithdrawalBreakdown, 'contracts'>): boolean {
  return breakdown.contracts?.some((line) => line.packageSaleId !== undefined) ?? false
}

/**
 * Yöneticinin onayı gördüğü tutara bağlıdır (K-21): önizlemeden sonra saat girildiyse ya da tahsilat
 * geldiyse tutar değişir, eski tutarla ayrılış yazılmaz.
 */
function requireRefundApproval(refundCents: number, approvedCents: number | null): number {
  if (approvedCents === null)
    throw new DomainError(
      'withdrawal_refund_approval_required',
      'Paket içeren ayrılışta iade tutarını görüp onaylayın.',
      { path: ['approvedRefundCents'] },
    )
  if (approvedCents !== refundCents)
    throw new DomainError(
      'withdrawal_refund_changed',
      'İade tutarı önizlemeden sonra değişti. Hesabı yeniden görüp onaylayın.',
      { kind: 'conflict' },
    )
  return approvedCents
}

/** Seçilebilir iade ödeyicileri (K-12): her biri bir kez; adı bulunamayan ödeyici seçilemez. */
export function refundPayerOptions(
  payers: readonly WithdrawalContractPayer[],
): WithdrawalContractPayer[] {
  const seen = new Set<WithdrawalPayer>()
  return payers.filter((item) => {
    if (seen.has(item.payer) || normalizedName(item.payerName) === '') return false
    seen.add(item.payer)
    return true
  })
}

/**
 * Ayrılanın gittiği yerin etiketi (DOM-KAY-012): okulda "Gittiği okul", dil okulu ve kursta
 * "Gittiği kurum". Tür bilinmiyorsa okul sayılır.
 */
export function withdrawalTargetLabel(type?: InstitutionType): string {
  return type === undefined || type === 'school' ? 'Gittiği okul' : 'Gittiği kurum'
}

/**
 * İade dökümünde ödenen ana ücretin etiketi (DOM-KAY-012, IST-110): okulda "Ödenen öğrenim
 * ücreti", dil okulu ve kursta "Ödenen kurs ücreti". Tür bilinmiyorsa okul sayılır.
 */
export function paidTuitionLabel(type?: InstitutionType): string {
  return type === undefined || type === 'school' ? 'Ödenen öğrenim ücreti' : 'Ödenen kurs ücreti'
}

/**
 * Bir sözleşmenin ekran ve belge satırları; ikisi aynı dökümü aynı sözlerle gösterir (IST-110).
 * Ödenen ücret satırı kurum türünü izler (`paidTuitionLabel`); tür verilmezse okul metnidir.
 */
export function contractLineRows(
  line: WithdrawalContractLine,
  deductionBasisPoints: number,
  payerName?: string,
  institutionType?: InstitutionType,
): readonly (readonly [string, string])[] {
  const usage = `${String(line.attendedUnits)} / ${String(line.totalUnits)}`
  return [
    ['Ödeyici', payerName ?? WITHDRAWAL_PAYER_LABELS[line.payer]],
    ['Hesap tabanı (net ücret)', money(line.baseCents)],
    [`Kesinti (%${String(deductionBasisPoints / 100)})`, money(line.deductionCents)],
    [
      line.packageSaleId === undefined
        ? `Kullanım (${usage})`
        : `Kullanım (${usage} ders saati, kayıttan)`,
      money(line.usageCents),
    ],
    ...(line.usedHoursMissing
      ? ([['Kullanılan saat', 'Girilmedi; hesap sıfır saate göre']] as const)
      : []),
    ['Hak edilen', money(line.entitledCents)],
    ...(line.scholarshipExempt
      ? ([['Burslu istisnası', 'Ödenenden fazlası istenmez']] as const)
      : []),
    [paidTuitionLabel(institutionType), money(line.paidCents)],
    ...(line.extraBalanceCents === 0
      ? []
      : ([['Ek hizmet bakiyesi', money(line.extraBalanceCents)]] as const)),
    ...(line.returnedHours
      ? ([['İade edilen kalan saat', `${String(line.returnedHours)} ders saati`]] as const)
      : []),
    line.balanceCents >= 0
      ? ['Bu sözleşmeden iade', money(line.balanceCents)]
      : ['Bu sözleşmeden borç', money(-line.balanceCents)],
  ]
}

/** Ayrılıştan bir ay sonrası; o gün yoksa ayın son günü (DOM-FIN-040). */
export function refundDueDate(withdrawalDate: string): string {
  const year = Number(withdrawalDate.slice(0, 4))
  const month = Number(withdrawalDate.slice(5, 7))
  const day = Number(withdrawalDate.slice(8, 10))
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10)
}

/**
 * Ayrılışı uygular (DOM-FIN-041, DOM-KAY-024): öğrenci pasifleşir, hesaba giren bütün sözleşmelerin
 * açık taksitleri iptal edilir (listeden çıkan kayıt arşivlenir), borç kalırsa tek taksit açılır,
 * ileri tarihli etüt, servis ve kulüp kayıtları sonlanır, planlanmış yenileme iptal edilir. Kalan
 * paket saatinin iade hareketini servis yazar (`returnedHours`). Paket satışı hesaba giriyorsa iade
 * tutarı yönetici onayından geçer (K-21); komutu yalnız yönetici çalıştırır (`student.withdraw`), ön
 * büro hesabı görür ama ayrılışı tamamlayamaz. Bütün denetimler yazımdan öncedir.
 */
export function withdrawStudent(
  state: State,
  studentId: string,
  input: unknown,
  makeId: MakeId,
  context: WithdrawalContext,
) {
  const data = withdrawStudentSchema.parse(input)
  const learner = learnerWords(context.institutionType)
  const student = studentOf(state, studentId, context.institutionType)
  if (!student.isActive)
    throw new DomainError(
      'student_already_withdrawn',
      `Bu ${learner.genitive} kaydı zaten pasif.`,
      {
        kind: 'conflict',
      },
    )
  const { contractId, breakdown, payersDiffer, payers } = quoteWithdrawal(
    state,
    studentId,
    {
      withdrawalDate: data.withdrawalDate,
      termStartDate: data.termStartDate,
      attendedUnits: data.attendedUnits,
      totalUnits: data.totalUnits,
      publicSchoolExemption: data.publicSchoolExemption,
    },
    context,
  )
  const payerDecision =
    payersDiffer && breakdown.refundCents > 0
      ? requirePayerDecision(payers, data.payerDecision)
      : null
  const refundApprovedCents = refundApprovalRequired(breakdown)
    ? requireRefundApproval(breakdown.refundCents, data.approvedRefundCents)
    : null
  const standalone = clawbackInvoiceIds(context.scholarshipEnds ?? [])
  const account = withdrawalAccount(
    state,
    studentId,
    context.packageSales ?? [],
    context.institutionType,
    standalone,
  )

  const planned = state.renewals.filter(
    (item) => item.studentId === studentId && item.status === 'Planlandı',
  )
  const renewalContracts = state.contracts.filter((item) =>
    planned.some((renewal) => renewal.contractId === item.id),
  )
  // Listesi olmayan eski yenileme sözleşmesi öğrencinin bütün taksitlerini görür; etkinlik ve geri
  // isteme taksiti yenilemeye ait değildir (K-349, K-351).
  const renewalInvoices = renewalContracts
    .flatMap((item) => invoicesOf(state, item))
    .filter((invoice) => invoice.feeKind !== ACTIVITY_KIND && !standalone.has(invoice.id))
  if (renewalInvoices.some((invoice) => paidOf(invoice, context.allocated) > 0))
    throw new DomainError(
      'withdrawal_renewal_paid',
      'Planlanmış yenilemenin tahsilatı var; önce tahsilatı iptal edin.',
      { kind: 'conflict' },
    )

  const paidIn = (invoices: readonly Invoice[]) => invoices.filter((invoice) => invoice.paidAt)
  const kept = paidIn(account.find((item) => item.contract.id === contractId)?.invoices ?? [])
  const cancelled = new Set(
    [...account.flatMap((item) => item.invoices), ...renewalInvoices]
      .filter((invoice) => !invoice.paidAt)
      .map((invoice) => invoice.id),
  )
  state.invoices = state.invoices.filter((invoice) => !cancelled.has(invoice.id))

  const debt =
    breakdown.debtCents === 0
      ? null
      : {
          id: makeId('inv'),
          studentId,
          installment: kept.reduce((highest, item) => Math.max(highest, item.installment), 0) + 1,
          amount: breakdown.debtCents,
          dueDate: `${data.withdrawalDate}${DAY_TIME}`,
          paidAt: null,
          method: null,
          reminderAt: null,
          feeKind: 'tuition',
          contractId,
        }
  if (debt) state.invoices.push(debt)
  // Borç tek bakiyeden doğar, tek taksittir; ayrılış kaydının sözleşmesine yazılır.
  for (const { contract, invoices } of account)
    contract.invoiceIds = [
      ...paidIn(invoices).map((invoice) => invoice.id),
      ...(debt && contract.id === contractId ? [debt.id] : []),
    ]

  for (const renewal of planned) renewal.status = 'İptal'
  student.isActive = false

  const now = context.now
  state.transportAssignments = state.transportAssignments.filter(
    (item) => item.studentId !== studentId,
  )
  state.clubMemberships = state.clubMemberships.filter((item) => item.studentId !== studentId)
  for (const session of state.tutorSessions) {
    if (
      session.status !== 'Planlandı' ||
      Date.parse(session.date) <= Date.parse(now) ||
      !session.studentIds.includes(studentId)
    )
      continue
    session.studentIds = session.studentIds.filter((id) => id !== studentId)
    if (session.studentIds.length === 0)
      Object.assign(session, {
        status: 'İptal',
        cancelReason: `${learner.title} ayrıldı`,
        cancelledAt: now,
        updatedAt: now,
      })
  }
  return {
    studentId,
    contractId,
    reason: data.reason,
    targetSchool: data.targetSchool,
    withdrawalDate: data.withdrawalDate,
    refundDueDate: refundDueDate(data.withdrawalDate),
    breakdown: {
      ...breakdown,
      ...(debt ? { debtInvoiceId: debt.id } : {}),
      ...(payerDecision ? { payerDecision } : {}),
      ...(refundApprovedCents === null ? {} : { refundApprovedCents }),
    },
  }
}

/** Ödeyiciler farklı ve iade varken yöneticinin açık kararı (K-12); hesabı değiştirmez. */
function requirePayerDecision(
  payers: readonly WithdrawalContractPayer[],
  decision: z.output<typeof payerDecisionSchema> | null,
): NonNullable<WithdrawalBreakdown['payerDecision']> {
  if (decision === null)
    throw new DomainError(
      'withdrawal_payer_decision_required',
      'Sözleşmelerin ödeyicileri farklı. İadeyi alacak ödeyiciyi seçip gerekçeyi yazın.',
      { path: ['payerDecision'] },
    )
  const chosen = refundPayerOptions(payers).find((item) => item.payer === decision.payer)
  if (!chosen)
    throw new DomainError(
      'withdrawal_payer_invalid',
      'İadeyi yalnız bu sözleşmelerin ödeyicilerinden biri alabilir.',
      { path: ['payerDecision', 'payer'] },
    )
  return { payer: chosen.payer, reason: decision.reason }
}

const normalizedName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('tr')

export interface RefundPaymentContext {
  today: string
  /** Kurumun arşivlenmemiş bildirilmiş banka hesapları (`DOM-FIN-032`). */
  bankAccountIds: readonly string[]
  /** Ödeme günü kapatılmış mı (`DOM-FIN-036`). */
  dayClosed: boolean
}

/**
 * İade ödemesi (DOM-FIN-041): hesap sahibi ödeyici olmalıdır; ödenen iade değiştirilemez. İade
 * ayrılıştan doğar, ödeme günü ayrılış gününden önce olamaz. İade kurumun bildirilmiş banka
 * hesabından çıkar ve o günün gün sonuna "iade ödemesi" olarak girer; kapatılmış güne yazılmaz
 * (M-13, DOM-FIN-036). Saf denetimdir, yazımı servis yapar.
 */
export function planRefundPayment(
  withdrawal: {
    refundCents: number
    refundPaidDate: string | null
    payerName: string
    withdrawalDate: string
  },
  input: unknown,
  context: RefundPaymentContext,
): PayRefundOutput {
  const data = payRefundSchema.parse(input)
  if (withdrawal.refundCents === 0)
    throw new DomainError('refund_not_due', 'Bu ayrılışta iade tutarı yok.', { kind: 'conflict' })
  if (withdrawal.refundPaidDate !== null)
    throw new DomainError('refund_already_paid', 'Bu iade zaten ödenmiş.', { kind: 'conflict' })
  if (data.paidDate > context.today)
    throw new DomainError('refund_date_in_future', 'Ödeme tarihi ileri bir gün olamaz.', {
      path: ['paidDate'],
    })
  if (data.paidDate < withdrawal.withdrawalDate)
    throw new DomainError(
      'refund_date_before_withdrawal',
      'İade ödeme tarihi ayrılış tarihinden önce olamaz.',
      { path: ['paidDate'] },
    )
  if (normalizedName(data.accountHolder) !== normalizedName(withdrawal.payerName))
    throw new DomainError(
      'refund_holder_mismatch',
      'Hesap sahibi sözleşmedeki ödeyici olmalıdır.',
      { path: ['accountHolder'] },
    )
  if (!context.bankAccountIds.includes(data.bankAccountId))
    throw new DomainError(
      'refund_bank_account_invalid',
      context.bankAccountIds.length === 0
        ? 'Kurumun bildirilmiş banka hesabı yok; önce Ayarlar’dan hesap ekleyin.'
        : 'Banka hesabı bulunamadı; kurumun tanımlı hesaplarından birini seçin.',
      { path: ['bankAccountId'] },
    )
  if (context.dayClosed)
    throw new DomainError(
      'finance_day_closed',
      'Bu günün kasası kapatılmış; bu güne iade ödemesi girilemez. Yöneticinin günü yeniden açması gerekir.',
      { path: ['paidDate'] },
    )
  return data
}

/**
 * Sözleşmedeki ödeyicinin adı: veli veya 18 yaş üstü kursiyer (DOM-KAY-012). Tür yalnız bulunamama
 * iletisinin sözüdür; verilmezse okul metni.
 */
export function payerNameOf(state: State, contractId: string, type?: InstitutionType): string {
  const contract = state.contracts.find((item) => item.id === contractId)
  const student = state.students.find((item) => item.id === contract?.studentId)
  if (!contract || !student) throw contractMissing(type)
  if (contract.payer === 'student') return student.name
  return state.parents.find((parent) => parent.id === student.parentId)?.name ?? ''
}

/** İadeyi alacak kişi: kararla seçilen ödeyici (K-12), karar yoksa kaydın sözleşmesinin ödeyicisi. */
export function refundPayerName(
  state: State,
  withdrawal: {
    contractId: string
    breakdown: Pick<WithdrawalBreakdown, 'contracts' | 'payerDecision'>
  },
  type?: InstitutionType,
): string {
  const { contracts, payerDecision } = withdrawal.breakdown
  const chosen = payerDecision && contracts?.find((line) => line.payer === payerDecision.payer)
  return payerNameOf(state, chosen?.contractId ?? withdrawal.contractId, type)
}
