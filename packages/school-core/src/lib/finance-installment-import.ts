import type { State } from '../data/seed.ts'
import { contractStatus } from './contract-status.ts'
import { csvTable, foldHeader, type CsvColumn } from './delimited-input.ts'
import type { MakeId } from './domain.ts'
import {
  normalizeImportIdentity,
  parseImportDay,
  type ImportIssue,
  type ImportNotice,
  type ImportRowStatus,
} from './enrollment-import-cells.ts'
import { PAYMENT_METHODS, type PaymentMethod } from './payments.ts'
import { maskNationalId } from './scope.ts'

/**
 * Pilot verisi aktarımı: taksitler (IST-007, ON-061; docs/domain/finans.md DOM-FIN-001, -011, -012,
 * ADR 0010). Okul canlıya geçerken açık ve ödenmiş taksitlerini dosyadan yükler: bütün satırlar
 * doğrulanmadan hiçbir kayıt yazılmaz, sorunlar dosyadaki satır numarasıyla döner.
 *
 * Öğrenci kimlik numarasıyla bulunur (`student_identities`); ad verilirse eşleşmelidir, kimlik
 * yanlış yazılınca borç başka çocuğa yazılmasın. Tutar yalnız tamsayı kuruştur: sütun adı birimi
 * söyler, TL yazan dosya sütun adında reddedilir (100 katı hata olmasın). Vade günün 09:00Z anı,
 * `paidAt` ve `method` birlikte (core ve `invoices` tablosu biçimi).
 *
 * Sözleşmeye bağlama ADR 0010 cevap 3'tedir: öğrencinin tek sözleşmesi varsa taksit ona bağlanır,
 * birden çok ya da hiç sözleşmesi yoksa bağ boş kalır. Ek koşullar: sözleşmenin yılı farklıysa bağ
 * kurulmaz (DOM-FIN-012: sözleşme yalnız kendi taksitlerini çözümler); onaylı sözleşmenin planı
 * değişmez (DOM-FIN-010), plana yeni taksit eklenemez; plan toplamı sözleşmeyi aşamaz (DOM-FIN-011).
 *
 * Mükerrer: aynı öğrenci, eğitim yılı ve taksit numarası kayıtlıysa ve tutar, vade ve ödeme durumu
 * aynıysa satır atlanır (ikinci yükleme mükerrer kayıt açmaz); bir farkı varsa satır hatalıdır,
 * sessizce değiştirilmez. Tahsilat satırı (`payments`) yazılmaz: geçmiş ödeme kasayı ve dönem
 * tahsilatını değiştirmesin; ödendi bilgisi `paid_at` önbelleğindedir (ADR 0010 karar 5). Kısmi
 * ödeme yoktur: satır ya açık ya tamamen ödenmiştir.
 */

export const INSTALLMENT_IMPORT_MAX_ROWS = 5000
/** Bir taksitin üst sınırı (100 milyon TL): kuruş yerine yanlış sütun gelirse satır hatalı olur. */
export const INSTALLMENT_IMPORT_MAX_CENTS = 10_000_000_000

export const INSTALLMENT_IMPORT_COLUMNS = {
  identityNumber: {
    aliases: ['kimlik no', 'kimlik numarası', 't.c. kimlik no', 'tc kimlik no', 'tc no'],
    required: true,
  },
  studentName: { aliases: ['öğrenci adı', 'öğrenci', 'ad soyad'], required: false },
  installment: { aliases: ['taksit no', 'taksit'], required: true },
  amountCents: { aliases: ['tutar kuruş', 'tutar (kuruş)', 'kuruş'], required: true },
  dueDate: { aliases: ['vade', 'vade tarihi'], required: true },
  paidDate: { aliases: ['ödeme tarihi', 'ödendiği tarih'], required: false },
  method: { aliases: ['ödeme yöntemi', 'yöntem'], required: false },
  academicYear: { aliases: ['eğitim yılı', 'yıl'], required: false },
} as const satisfies Record<string, CsvColumn>

export type InstallmentImportField = keyof typeof INSTALLMENT_IMPORT_COLUMNS

/** İndirilebilir örnek dosya: açık ve ödenmiş taksit; kimlik örnektir, tutar kuruştur. */
export const INSTALLMENT_IMPORT_SAMPLE = [
  'kimlik no;öğrenci adı;taksit no;tutar kuruş;vade;ödeme tarihi;ödeme yöntemi;eğitim yılı',
  '10000000146;Ece Demir;1;1250000;15.09.2026;14.09.2026;Banka havalesi;2026',
  '10000000146;Ece Demir;2;1250000;15.10.2026;;;2026',
].join('\n')

export interface InstallmentImportRow {
  line: number
  identityNumber: string
  studentName: string
  installment: string
  amountCents: string
  dueDate: string
  paidDate: string
  method: string
  academicYear: string
  extraCells: boolean
}

/** Metni satırlara ayırır; dosya düzeyindeki sorun `DomainError` (satır sınırı dahil). */
export function parseInstallmentImport(raw: string): InstallmentImportRow[] {
  return csvTable(raw, INSTALLMENT_IMPORT_COLUMNS, INSTALLMENT_IMPORT_MAX_ROWS).map((row) => ({
    line: row.line,
    ...row.values,
    extraCells: row.extraCells,
  }))
}

export const INSTALLMENT_IMPORT_MESSAGES = {
  installment_import_invalid:
    'Dosyada düzeltilmesi gereken satırlar var. Hiçbir taksit aktarılmadı.',
  extra_cells: 'Satırda başlıktan fazla dolu hücre var.',
  student_not_found: 'Bu kimlik numarasıyla kurumda öğrenci bulunamadı.',
  student_inactive: 'Bu öğrenci ayrılmış; ayrılan öğrencinin taksiti aktarılmaz.',
  student_name_mismatch: 'Öğrenci adı kimlik numarasındaki kayıtla uyuşmuyor.',
  installment_invalid: 'Taksit numarası 1 ya da daha büyük bir tam sayı olmalı.',
  amount_invalid: 'Tutarı kuruş olarak tam sayı girin (12.500,00 ₺ için 1250000).',
  due_date_invalid: 'Vadeyi GG.AA.YYYY ya da YYYY-AA-GG biçiminde girin.',
  paid_date_invalid: 'Ödeme tarihini GG.AA.YYYY ya da YYYY-AA-GG biçiminde girin.',
  paid_date_future: 'Ödeme tarihi bugünden sonra olamaz.',
  payment_method_invalid: `Ödeme yöntemi ${PAYMENT_METHODS.join(', ')} olmalı.`,
  payment_fields_incomplete: 'Ödeme tarihi ve ödeme yöntemi birlikte girilir.',
  academic_year_invalid: 'Eğitim yılını 2026 ya da 2026-2027 biçiminde girin.',
  installment_conflict:
    'Bu öğrencinin bu yıl ve taksit numarasında farklı tutarlı ya da vadeli kaydı var.',
  installment_paid_mismatch:
    'Bu taksit kayıtlı ve ödeme durumu farklı. Ödemeyi Finans ekranından işleyin.',
  contract_approved:
    'Öğrencinin onaylı sözleşmesi var; onaylı plana taksit eklenemez. Değişiklik ek protokolle yapılır.',
  contract_total_exceeded: 'Taksitlerin toplamı öğrencinin sözleşme tutarını aşıyor.',
  already_imported: 'Bu taksit kayıtlı; satır atlanır, mükerrer kayıt açılmaz.',
  no_contract: 'Öğrencinin bu taksite bağlanacak tek sözleşmesi yok; taksit sözleşmesiz yazılır.',
} as const

/** Planın gördüğü kurum durumu; API kurum kilidi altında (önizlemede tek görüntüde) okur. */
export interface InstallmentImportContext {
  /** Bugün, Europe/Istanbul günü. */
  today: string
  /** Sütunu boş satırın eğitim yılı: kurumun etkin yılı. */
  academicYear: number
  /** Satırlardaki kimlik numaralarının arşivlenmemiş satırları: numara → öğrenci. */
  identityHolders: ReadonlyMap<string, string>
}

export type InstallmentImportState = Pick<State, 'students' | 'invoices' | 'contracts'>

export interface PlannedInstallment {
  line: number
  studentId: string
  installment: number
  amount: number
  dueDate: string
  paidAt: string | null
  method: PaymentMethod | null
  academicYear: number
  contractId: string | null
}

/** Önizleme satırı: kimlik maskeli; ad kayıttan gelir, dosyadaki yazım gösterilmez. */
export interface InstallmentImportPreviewRow {
  line: number
  status: ImportRowStatus
  studentName: string | null
  identityMasked: string
  installment: number | null
  amountCents: number | null
  dueDate: string | null
  paidDate: string | null
  method: PaymentMethod | null
  academicYear: number | null
  contractLinked: boolean
  issues: ImportIssue[]
  notices: ImportNotice[]
}

export interface InstallmentImportPlan {
  rows: InstallmentImportPreviewRow[]
  /** Hata varsa boştur: çağıran hiçbir şey yazmaz. */
  installments: PlannedInstallment[]
  issues: ImportIssue[]
  /** Yazılacak taksitlerin toplamı ve ödenmişlerin toplamı (kuruş); onay öncesi sağlama için. */
  totalCents: number
  paidCents: number
}

const METHODS = new Map<string, PaymentMethod>(
  PAYMENT_METHODS.map((method) => [foldHeader(method), method]),
)

const nineOClock = (day: string) => `${day}T09:00:00.000Z`

function parseAcademicYear(cell: string, fallback: number): number | null {
  const value = cell.trim()
  if (value === '') return fallback
  const match = /^(\d{4})(?:[-/]\d{2,4})?$/.exec(value)
  return match ? Number(match[1]) : null
}

function parsePositiveInt(cell: string): number | null {
  const value = cell.trim()
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

type Invoice = InstallmentImportState['invoices'][number]
type Contract = InstallmentImportState['contracts'][number]

/** Sözleşmenin planındaki taksitler: `contractId` ya da `invoiceIds` (eski kayıtlarda yok). */
function contractInvoices(contract: Contract, invoices: readonly Invoice[]): Invoice[] {
  const listed = new Set(contract.invoiceIds ?? [])
  return invoices.filter((invoice) => invoice.contractId === contract.id || listed.has(invoice.id))
}

/**
 * Satırları doğrular, yazılacak taksitleri çıkarır (IST-007; DOM-FIN-001, -010, -011, -012). Bir
 * satırın birden çok sorunu ayrı maddedir; sorun iletileri hücre değeri taşımaz.
 */
export function planInstallmentImport(
  state: InstallmentImportState,
  rows: readonly InstallmentImportRow[],
  context: InstallmentImportContext,
): InstallmentImportPlan {
  const studentsById = new Map(state.students.map((student) => [student.id, student]))
  const invoicesByStudent = new Map<string, Invoice[]>()
  for (const invoice of state.invoices)
    invoicesByStudent.set(invoice.studentId, [
      ...(invoicesByStudent.get(invoice.studentId) ?? []),
      invoice,
    ])
  const contractsByStudent = new Map<string, Contract[]>()
  for (const contract of state.contracts)
    if (contractStatus(contract, state.contracts) !== 'cancelled')
      contractsByStudent.set(contract.studentId, [
        ...(contractsByStudent.get(contract.studentId) ?? []),
        contract,
      ])
  const firstLineByKey = new Map<string, number>()
  /** Plandaki sözleşme bağları: taksit numarası tekilliği ve toplam tutar dosyayla birlikte. */
  const contractLoad = new Map<string, { cents: number; installments: Set<number> }>()
  const preview: InstallmentImportPreviewRow[] = []
  const planned: PlannedInstallment[] = []
  const allIssues: ImportIssue[] = []
  let totalCents = 0
  let paidCents = 0

  for (const row of rows) {
    const issues: ImportIssue[] = []
    const notices: ImportNotice[] = []
    const add = (
      field: InstallmentImportField | null,
      code: keyof typeof INSTALLMENT_IMPORT_MESSAGES,
    ) => issues.push({ line: row.line, field, code, message: INSTALLMENT_IMPORT_MESSAGES[code] })

    if (row.extraCells) add(null, 'extra_cells')
    const number = normalizeImportIdentity(row.identityNumber)
    const holderId = context.identityHolders.get(number)
    const student = holderId === undefined ? undefined : studentsById.get(holderId)
    if (student === undefined) add('identityNumber', 'student_not_found')
    else {
      if (!student.isActive) add('identityNumber', 'student_inactive')
      if (row.studentName.trim() && foldHeader(row.studentName) !== foldHeader(student.name))
        add('studentName', 'student_name_mismatch')
    }

    const installment = parsePositiveInt(row.installment)
    if (installment === null) add('installment', 'installment_invalid')
    const amount = parsePositiveInt(row.amountCents)
    const validAmount = amount !== null && amount <= INSTALLMENT_IMPORT_MAX_CENTS
    if (!validAmount) add('amountCents', 'amount_invalid')
    const dueDay = parseImportDay(row.dueDate)
    if (dueDay === null) add('dueDate', 'due_date_invalid')
    const academicYear = parseAcademicYear(row.academicYear, context.academicYear)
    if (academicYear === null) add('academicYear', 'academic_year_invalid')

    const paidCell = row.paidDate.trim()
    const methodCell = row.method.trim()
    let paidDay: string | null = null
    let method: PaymentMethod | null = null
    if (paidCell !== '' && methodCell === '') add('method', 'payment_fields_incomplete')
    if (paidCell === '' && methodCell !== '') add('paidDate', 'payment_fields_incomplete')
    if (paidCell !== '') {
      paidDay = parseImportDay(paidCell)
      if (paidDay === null) add('paidDate', 'paid_date_invalid')
      else if (paidDay > context.today) add('paidDate', 'paid_date_future')
    }
    if (methodCell !== '') {
      method = METHODS.get(foldHeader(methodCell)) ?? null
      if (method === null) add('method', 'payment_method_invalid')
    }

    let skip = false
    let contractId: string | null = null
    if (student !== undefined && installment !== null && academicYear !== null) {
      const key = `${student.id}|${academicYear}|${installment}`
      const firstLine = firstLineByKey.get(key)
      if (firstLine !== undefined)
        issues.push({
          line: row.line,
          field: 'installment',
          code: 'duplicate_installment',
          message: `Bu öğrencinin bu taksiti dosyanın ${firstLine}. satırında da var.`,
        })
      else firstLineByKey.set(key, row.line)

      const own = invoicesByStudent.get(student.id) ?? []
      // Eski kayıtta yıl yoktur (ADR 0010); numarası tutan yılsız taksit aynı taksit sayılır.
      const existing = own.find(
        (invoice) =>
          invoice.installment === installment &&
          (invoice.academicYear === undefined || invoice.academicYear === academicYear),
      )
      if (existing !== undefined) {
        const sameTerms =
          validAmount &&
          existing.amount === amount &&
          dueDay !== null &&
          existing.dueDate.slice(0, 10) === dueDay
        if (!sameTerms) add('installment', 'installment_conflict')
        else if (Boolean(existing.paidAt) !== (paidCell !== ''))
          add('paidDate', 'installment_paid_mismatch')
        else skip = true
      } else if (issues.length === 0 && amount !== null) {
        const [contract, other] = contractsByStudent.get(student.id) ?? []
        const linkable =
          contract !== undefined &&
          other === undefined &&
          (contract.academicYear === undefined || contract.academicYear === academicYear)
        if (!linkable || contract === undefined)
          notices.push({ code: 'no_contract', message: INSTALLMENT_IMPORT_MESSAGES.no_contract })
        else if (contract.approval !== undefined) add('installment', 'contract_approved')
        else {
          const load = contractLoad.get(contract.id) ?? {
            cents: contractInvoices(contract, state.invoices).reduce(
              (sum, invoice) => sum + invoice.amount,
              0,
            ),
            installments: new Set(
              contractInvoices(contract, state.invoices).map((invoice) => invoice.installment),
            ),
          }
          if (load.installments.has(installment)) add('installment', 'installment_conflict')
          else if (load.cents + amount > contract.amount)
            add('amountCents', 'contract_total_exceeded')
          else {
            load.cents += amount
            load.installments.add(installment)
            contractLoad.set(contract.id, load)
            contractId = contract.id
          }
        }
      }
    }
    if (skip)
      notices.push({
        code: 'already_imported',
        message: INSTALLMENT_IMPORT_MESSAGES.already_imported,
      })

    allIssues.push(...issues)
    if (
      issues.length === 0 &&
      !skip &&
      student !== undefined &&
      installment !== null &&
      amount !== null &&
      dueDay !== null &&
      academicYear !== null
    ) {
      planned.push({
        line: row.line,
        studentId: student.id,
        installment,
        amount,
        dueDate: nineOClock(dueDay),
        paidAt: paidDay === null ? null : nineOClock(paidDay),
        method,
        academicYear,
        contractId,
      })
      totalCents += amount
      if (paidDay !== null) paidCents += amount
    }
    preview.push({
      line: row.line,
      status: issues.length > 0 ? 'invalid' : skip ? 'skipped' : 'ready',
      studentName: student?.name ?? null,
      identityMasked: number === '' ? '' : maskNationalId(number),
      installment,
      amountCents: amount,
      dueDate: dueDay,
      paidDate: paidDay,
      method,
      academicYear,
      contractLinked: contractId !== null,
      issues,
      notices,
    })
  }
  const failed = allIssues.length > 0
  return {
    rows: preview,
    installments: failed ? [] : planned,
    issues: allIssues,
    totalCents: failed ? 0 : totalCents,
    paidCents: failed ? 0 : paidCents,
  }
}

/**
 * Planı State'e uygular: taksit core biçimiyle açılır, bağlı sözleşmenin `invoiceIds`'ine eklenir
 * (eski sözleşmede liste yoktur, belge öğrencinin bütün taksitlerine düşer; liste açılmaz ki eski
 * taksitler belgeden düşmesin, ADR 0010). Dönen sayı sözleşmeye bağlanan taksitlerdir.
 */
export function applyInstallmentImport(
  state: Pick<State, 'invoices' | 'contracts'>,
  planned: readonly PlannedInstallment[],
  makeId: MakeId,
): { created: number; linked: number } {
  const contracts = new Map(state.contracts.map((contract) => [contract.id, contract]))
  let linked = 0
  for (const item of planned) {
    const id = makeId('inv')
    state.invoices.push({
      id,
      studentId: item.studentId,
      installment: item.installment,
      amount: item.amount,
      dueDate: item.dueDate,
      paidAt: item.paidAt,
      method: item.method,
      reminderAt: null,
      feeKind: 'tuition',
      academicYear: item.academicYear,
      ...(item.contractId === null ? {} : { contractId: item.contractId }),
    })
    if (item.contractId !== null) {
      linked += 1
      contracts.get(item.contractId)?.invoiceIds?.push(id)
    }
  }
  return { created: planned.length, linked }
}
