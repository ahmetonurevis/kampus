// Yönetici ve ön büro sözleşme listesi ve ayrıntısının saf görünüm mantığı (ON-079; IST-092,
// DOM-FIN-010, -012, -051). Durum, sürüm ve işlem seçimi core (`lib/contract-status.ts`,
// `lib/contract-approval.ts`) ve web ile ortak `@kampus/react-shared/contract-model.ts`
// kurallarından gelir; burada yeniden yazılmaz. Yetki ve kesin karar sunucudadır.
//
// Islak imzalı onay telefonda işlenmez: onay ucu taze oturum ister (403 `reauthentication_required`)
// ve mobil uygulama parola doğrulama penceresi sunmaz (docs/muhendislik/guvenlik-kvkk.md §3). İmza
// yetkilisi, ek protokol ve ek protokol iptali taze oturum istemez; bunlar telefonda da yapılır.
import type { ApiError } from '@kampus/api-client/errors.ts'
import type {
  CollectionQuery,
  CollectionRow,
  CollectionSort,
} from '@kampus/react-shared/collections.ts'
import { keepsIdempotencyKey } from '@kampus/react-shared/commands.ts'
import {
  amendmentBody,
  amendmentFormSchema,
  contractActions,
  type AmendmentFormValues,
  type ContractRecord,
} from '@kampus/react-shared/contract-model.ts'
import {
  CONTRACT_MESSAGES,
  type AmendContractBody,
} from '@kampus/react-shared/use-contract-commands.ts'
import {
  cancelAmendmentSchema,
  contractSignatorySchema,
  type CancelAmendmentInput,
  type ContractSignatoryInput,
} from '@kampus/school-core/lib/contract-approval.ts'
import {
  CONTRACT_STATUS_LABELS,
  contractStatus,
  type ContractStatus,
} from '@kampus/school-core/lib/contract-status.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'
import { commandFailure, type FieldErrors } from './command-failure.ts'
import {
  contractFacts,
  contractStatusTone,
  contractVersionLabel,
  type ContractNotice,
  type ContractTone,
} from './contract-approval.ts'
import { API_PAGE_SIZE, type ListState } from './list-state.ts'

const day = (value: string) => dateLabel(value, { year: 'numeric' })

/** En yeni sürüm önce; eşitlikte kimlik (web `ContractsSection`, sayfalar arası kararlı sıra). */
const CONTRACT_SORT: readonly CollectionSort[] = ['-date', 'id']
const MIN_SEARCH = 2

/** Sürüm listesi sorgusu: öğrenci adı araması ve sıra sunucuda. */
export function staffContractQuery(state: ListState, search: string): CollectionQuery {
  const q = search.trim()
  return {
    page: state.index + 1,
    pageSize: API_PAGE_SIZE,
    sort: CONTRACT_SORT,
    ...(q.length >= MIN_SEARCH ? { q } : {}),
  }
}

/** Sayfadaki öğrenciler; bir sürümün yerini alan ek protokol başka sayfada olabilir. */
export const contractStudentIds = (rows: readonly CollectionRow<ContractRecord>[]) =>
  [...new Set(rows.map((row) => row.record.studentId))].sort()

export interface StaffContractItem {
  id: string
  title: string
  subtitle: string
  amount: string
  /** Öğrencinin öteki sürümleri gelene kadar `null`: durum türetilemez, rozet çizilmez. */
  statusLabel: string | null
  tone: ContractTone
  label: string
}

/**
 * Liste satırları (web `ContractsSection`): durum saklanmaz, öğrencinin bütün sürümlerinden türetilir.
 * Görevli iptal edilen ek protokolü de görür; sıra sunucunundur.
 */
export function staffContractItems(
  rows: readonly CollectionRow<ContractRecord>[],
  versions: readonly CollectionRow<ContractRecord>[] | undefined,
): StaffContractItem[] {
  const byStudent = new Map<string, ContractRecord[]>()
  for (const { record } of versions ?? [])
    byStudent.set(record.studentId, [...(byStudent.get(record.studentId) ?? []), record])
  return rows.map(({ id, record, joined }) => {
    const name = joined?.studentName ?? '—'
    const version = contractVersionLabel(record)
    const status = versions
      ? contractStatus(record, byStudent.get(record.studentId) ?? [record])
      : null
    return {
      id,
      title: name,
      subtitle: `${record.title} · ${version} · ${day(record.date)}`,
      amount: money(record.amount),
      statusLabel: status ? CONTRACT_STATUS_LABELS[status] : null,
      tone: status ? contractStatusTone(status) : 'primary',
      label: `${name} ${version} sözleşme ayrıntısını aç`,
    }
  })
}

/** Panelin kaydı listedekinden tazedir; öteki sürümlerle birlikte durumun girdisidir. */
export function contractVersions(
  contract: ContractRecord,
  rows: readonly CollectionRow<ContractRecord>[],
): ContractRecord[] {
  return [contract, ...rows.map((row) => row.record).filter((row) => row.id !== contract.id)]
}

export interface StaffContractActions {
  sign: boolean
  /** Islak imzalı onay görevlinin işidir ama telefonda işlenmez; bilgi kutusu web'e yönlendirir. */
  approveOnWeb: boolean
  amend: boolean
  cancelAmendment: boolean
}

export function staffContractActions(
  contract: ContractRecord,
  all: readonly ContractRecord[],
  role: Role,
): StaffContractActions {
  const actions = contractActions(contract, all, role)
  return {
    sign: actions.sign,
    approveOnWeb: actions.approve,
    amend: actions.amend,
    cancelAmendment: actions.cancelAmendment,
  }
}

/** Künye: veli ekranıyla aynı satırlar, başta öğrenci (web `ContractFacts`). */
export function staffContractFacts(
  contract: ContractRecord,
  status: ContractStatus,
  studentName: string | null | undefined,
): readonly (readonly [string, string])[] {
  return [['Öğrenci', studentName ?? '—'], ...contractFacts(contract, status)]
}

/** Durum notu (web `StatusNote`); onay bekleyende işlemin web'de olduğu söylenir. */
export function staffContractNotice(
  contract: ContractRecord,
  status: ContractStatus,
  canSign: boolean,
): ContractNotice | null {
  switch (status) {
    case 'awaiting_signatory':
      return {
        title: 'Kurum imzası bekleniyor',
        text: canSign
          ? 'Onaydan önce kurumu bağlayan kurucu ya da kurucu temsilcisini işleyin.'
          : 'Onay için önce yöneticinin imza yetkilisini işlemesi gerekir.',
        tone: 'amber',
      }
    case 'awaiting_approval':
      return {
        title: 'Ödeyici onayı bekleniyor',
        text: 'Veli kendi hesabından elektronik onay verebilir. Kâğıt üzerinde imzalandıysa ıslak imzalı onay, parola doğrulaması gerektiği için Kampüs web uygulamasından işlenir.',
        tone: 'amber',
      }
    case 'approved':
      return {
        title: 'Sözleşme onaylı',
        text: 'Onaylanmış sözleşmenin tutarı ve planı değiştirilemez; değişiklik ek protokolle yeni sürüm olarak yapılır.',
        tone: 'green',
      }
    case 'superseded':
      return {
        title: 'Yerini ek protokole bıraktı',
        text: 'Bu sürümün yerini onaylı bir ek protokol aldı; salt okunur geçmiştir.',
        tone: 'primary',
      }
    case 'cancelled':
      return contract.cancelledAt
        ? {
            title: 'Ek protokol iptal edildi',
            text: 'İptal edilen ek protokol hiçbir taksiti değiştirmedi.',
            tone: 'primary',
          }
        : null
    default:
      return status satisfies never
  }
}

export interface ContractVersionLink {
  id: string
  label: string
}

/** Aynı pencerede açılacak öteki sürümler: önceki sürüm ve iptal edilmemiş ek protokoller. */
export function contractVersionLinks(
  contract: ContractRecord,
  all: readonly ContractRecord[],
): ContractVersionLink[] {
  const previous = all.find((row) => row.id === contract.amendsContractId)
  return [
    ...(previous ? [{ id: previous.id, label: 'Önceki sürümü aç' }] : []),
    ...all
      .filter((row) => row.amendsContractId === contract.id && row.cancelledAt === undefined)
      .map((row) => ({ id: row.id, label: `${contractVersionLabel(row)} aç` })),
  ]
}

export type FormErrors = Record<string, string | undefined>

function firstIssues(issues: readonly { path: PropertyKey[]; message: string }[]): FormErrors {
  const errors: FormErrors = {}
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '')
    if (field !== '' && errors[field] === undefined) errors[field] = issue.message
  }
  return errors
}

export type FormCheck<TBody> = { ok: true; body: TBody } | { ok: false; errors: FormErrors }

/** İmza yetkilisi: kurucu ya da kurucu temsilcisi (ÖÖKY m.31/4); core şemasıyla denetlenir. */
export function checkSignatory(values: ContractSignatoryInput): FormCheck<ContractSignatoryInput> {
  const parsed = contractSignatorySchema.safeParse(values)
  return parsed.success
    ? { ok: true, body: parsed.data }
    : { ok: false, errors: firstIssues(parsed.error.issues) }
}

export function checkCancelAmendment(
  values: CancelAmendmentInput,
): FormCheck<CancelAmendmentInput> {
  const parsed = cancelAmendmentSchema.safeParse(values)
  return parsed.success
    ? { ok: true, body: parsed.data }
    : { ok: false, errors: firstIssues(parsed.error.issues) }
}

/** Ek protokol formu web ile aynı şema ve gövdeyle kurulur (`contract-model.ts`). */
export function checkAmendment(values: AmendmentFormValues): FormCheck<AmendContractBody> {
  const parsed = amendmentFormSchema.safeParse(values)
  return parsed.success
    ? { ok: true, body: amendmentBody(parsed.data) }
    : { ok: false, errors: firstIssues(parsed.error.issues) }
}

export interface ContractFailure {
  errors: FormErrors
  message: string | null
  /** Sonuç belirsiz (ağ, 5xx): aynı gövde aynı anahtarla yeniden gönderilir. */
  uncertain: boolean
  /** Çakışma: kayıt eskidi, kanca listeyi tazeledi; form kapanır (web `FormButtons` akışı). */
  conflict: boolean
}

/**
 * Sözleşme komutunun form içi hatası. Formda karşılığı olmayan alan maddesi kaybolmaz, genel mesaj
 * olur. `fields`: formun alanları.
 */
export function contractFailure(
  error: ApiError,
  collected: FieldErrors,
  fields: readonly string[],
): ContractFailure {
  const failure = commandFailure(error, CONTRACT_MESSAGES, collected)
  const errors: FormErrors = {}
  const other: string[] = []
  for (const [name, message] of Object.entries(failure.fields)) {
    if (fields.includes(name)) errors[name] = message
    else other.push(message)
  }
  const uncertain = keepsIdempotencyKey(error)
  return {
    errors,
    message: failure.message ?? other[0] ?? null,
    uncertain,
    conflict: error.status === 409 && !uncertain,
  }
}
