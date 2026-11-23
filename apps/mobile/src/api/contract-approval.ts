// Veli Sözleşmeler ekranının saf görünüm mantığı (IST-092; docs/domain/finans.md DOM-FIN-010, -012,
// -051). Durum, sürüm ve plan satırları core (`lib/contract-status.ts`) ve web ile ortak
// `@kampus/react-shared/contract-model.ts` kurallarından türer; burada yeniden yazılmaz, yalnız
// telefona çevrilir. Yetki ve kesin karar sunucudadır.
//
// Onay telefonda verilmez: onay ucu taze oturum ister (403 `reauthentication_required`) ve mobil
// uygulama parola doğrulama penceresi sunmaz (docs/muhendislik/guvenlik-kvkk.md §3, "hassas işlemler
// web'dedir"). Veli onay bekleyen sürümü, planını ve PDF'ini telefonda görür; onayı web'den verir.
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import {
  CONTRACT_PLAN_ROW_LABELS,
  contractPlanRows,
  contractRevision,
  isAmendment,
  type ContractRecord,
} from '@kampus/react-shared/contract-model.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  CONTRACT_APPROVAL_METHOD_LABELS,
  CONTRACT_STATUS_LABELS,
  contractStatus,
  SIGNATORY_ROLE_LABELS,
  type ContractStatus,
} from '@kampus/school-core/lib/contract-status.ts'
import { FEE_ITEM_KIND_LABELS } from '@kampus/school-core/lib/fee-tariffs.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import { isModuleOpen, type MobileSession } from './session-state.ts'

type InvoiceRecord = State['invoices'][number]

/** Telefon rozet tonu (`ui/components.tsx` `Tone`; o dosya React Native'e bağlı olduğu için ayrı). */
export type ContractTone = 'primary' | 'green' | 'amber' | 'red'

/** Veli menüsündeki sayfa yolu (`full-navigation.ts`, `veli/sozlesmeler`). */
export const PARENT_CONTRACTS_PATH = 'sozlesmeler'

const CONTRACTS_MODULE =
  navigation.veli.find((page) => page.path === PARENT_CONTRACTS_PATH)?.module ?? 'finance'

/**
 * Ekran açık mı: yalnız veli ve sayfanın modülü (finans) kurumda açıkken. Kapalı modülde ekran
 * "Modül kullanıma kapalı" gösterir; sunucu da 403 `module_disabled` döner.
 */
export function canOpenParentContracts(session: Pick<MobileSession, 'role' | 'modules'>): boolean {
  return session.role === 'veli' && isModuleOpen(session.modules, CONTRACTS_MODULE)
}

const STATUS_TONES: Readonly<Record<ContractStatus, ContractTone>> = {
  awaiting_signatory: 'amber',
  awaiting_approval: 'amber',
  approved: 'green',
  superseded: 'primary',
  cancelled: 'primary',
}

export const contractStatusTone = (status: ContractStatus): ContractTone => STATUS_TONES[status]

/** "Sürüm 2 · Ek protokol" ya da "Sürüm 1" (web `ContractParts.tsx` ile aynı metin). */
export const contractVersionLabel = (
  contract: Pick<ContractRecord, 'revision' | 'amendsContractId'>,
) => `Sürüm ${String(contractRevision(contract))}${isAmendment(contract) ? ' · Ek protokol' : ''}`

const day = (value: string) => dateLabel(value, { year: 'numeric' })
const dateTime = (value: string) => `${day(value)} ${timeLabel(value)}`

/** Veli bu sürümü onaylayabilir mi (görünüm): onay bekliyor ve ödeyici kursiyer değil. */
const awaitsGuardian = (contract: ContractRecord, status: ContractStatus) =>
  status === 'awaiting_approval' && contract.payer !== 'student'

export interface ContractListItem {
  id: string
  /** Okunan kayıt sürümü (`If-Match`); onay web'de verildiği için yalnız tazelikte kullanılır. */
  version: number
  title: string
  subtitle: string
  amount: string
  status: ContractStatus
  statusLabel: string
  tone: ContractTone
  /** Veli onayı bekleyen sürüm; listede üstte durur. */
  awaitingApproval: boolean
  /** Ekran okuyucu adı: başlık, sürüm ve durum. */
  label: string
}

/**
 * Liste satırları: iptal edilen ek protokol hiçbir sonuç doğurmadığı için gösterilmez, eski
 * sürümler durumuyla kalır (DOM-FIN-051, web ile aynı). Veli onayı bekleyen sürümler üstte, kalan
 * sıra sunucunun sırasıdır. Durum öğrencinin bütün sürümlerinden türetilir.
 */
export function contractListItems(rows: readonly CollectionRow<ContractRecord>[]) {
  const all = rows.map((row) => row.record)
  const items = rows
    .filter((row) => row.record.cancelledAt === undefined)
    .map((row): ContractListItem => {
      const contract = row.record
      const status = contractStatus(contract, all)
      const versionLabel = contractVersionLabel(contract)
      return {
        id: row.id,
        version: row.version,
        title: contract.title,
        subtitle: `${day(contract.date)} · ${versionLabel}`,
        amount: money(contract.amount),
        status,
        statusLabel: CONTRACT_STATUS_LABELS[status],
        tone: STATUS_TONES[status],
        awaitingApproval: awaitsGuardian(contract, status),
        label: `${contract.title}, ${versionLabel}, ${CONTRACT_STATUS_LABELS[status]}`,
      }
    })
  // `sort` kararlıdır: onay bekleyenler öne alınır, aralarında ve geri kalanında sıra korunur.
  return items.sort((left, right) => Number(right.awaitingApproval) - Number(left.awaitingApproval))
}

/** Veli onayı bekleyen sürüm sayısı (liste üstündeki bilgi kutusu). */
export const awaitingApprovalCount = (items: readonly ContractListItem[]) =>
  items.filter((item) => item.awaitingApproval).length

/**
 * Künye (web `ContractFacts` ile aynı satırlar): sürüm, durum, tarih, tutar, imza yetkilisi, ödeyici
 * onayının biçimi ile zamanı, ek protokol gerekçesi ve iptal bilgisi.
 */
export function contractFacts(
  contract: ContractRecord,
  status: ContractStatus,
): readonly (readonly [string, string])[] {
  return [
    ['Sürüm', contractVersionLabel(contract)],
    ['Durum', CONTRACT_STATUS_LABELS[status]],
    ['Sözleşme tarihi', day(contract.date)],
    ['Eğitim bedeli', money(contract.amount)],
    [
      'İmza yetkilisi',
      contract.signatory
        ? `${contract.signatory.name} · ${SIGNATORY_ROLE_LABELS[contract.signatory.role]}`
        : 'İşlenmedi',
    ],
    [
      'Ödeyici onayı',
      contract.approval
        ? `${CONTRACT_APPROVAL_METHOD_LABELS[contract.approval.method]} · ${dateTime(contract.approval.approvedAt)}`
        : 'Bekleniyor',
    ],
    ...(contract.approval ? [['Onaylayan ödeyici', contract.approval.payerName] as const] : []),
    ...(contract.amendmentReason
      ? [['Ek protokol gerekçesi', contract.amendmentReason] as const]
      : []),
    ...(contract.cancelledAt
      ? ([
          ['İptal tarihi', dateTime(contract.cancelledAt)],
          ['İptal gerekçesi', contract.cancelReason ?? '—'],
        ] as const)
      : []),
  ]
}

const FEE_LABELS: Readonly<Record<string, string>> = { ...FEE_ITEM_KIND_LABELS }
const feeKindLabel = (kind: string) => FEE_LABELS[kind] ?? kind

export interface ContractPlanItem {
  key: string
  title: string
  subtitle: string
  amount: string
  /** Ek protokol taslağında satırın kaynağı ("Korunur", "Yeni plan"); diğerlerinde yok. */
  kind: string | undefined
}

export interface ContractPlanView {
  caption: string
  rows: ContractPlanItem[]
}

/**
 * Belgedeki Ek 1 ile aynı plan (`contractPlanRows`): onaylı sürümde onay anının kopyası, ek protokol
 * taslağında korunan ve önerilen satırlar, onaysız sözleşmede kendi güncel taksitleri.
 */
export function contractPlanView(
  contract: ContractRecord,
  invoices: readonly InvoiceRecord[],
): ContractPlanView {
  const proposed = contract.proposedPlan !== undefined
  return {
    caption: contract.approval
      ? 'Onaylanan ödeme planı'
      : proposed
        ? 'Ek protokolün önerdiği ödeme planı'
        : 'Güncel ödeme planı',
    rows: contractPlanRows(contract, invoices).map((row) => ({
      key: row.key,
      title: `${String(row.installment)}. taksit · ${feeKindLabel(row.feeKind)}`,
      subtitle: `Vade ${day(row.dueDate)}`,
      amount: money(row.amount),
      kind: proposed ? CONTRACT_PLAN_ROW_LABELS[row.kind] : undefined,
    })),
  }
}

export interface ContractNotice {
  title: string
  text: string
  tone: ContractTone
}

/** Onay bekleyen sürümde web yönlendirmesi; ekran ve test aynı metni kullanır. */
export const APPROVAL_ON_WEB_NOTICE: ContractNotice = {
  title: 'Onay web’den verilir',
  text: 'Sözleşmeyi ve ödeme planını buradan inceleyebilirsiniz. Onay, parolanızı yeniden doğrulayarak Kampüs web uygulamasında Sözleşmeler sayfasından verilir; onayı yalnız ödeyici veli verebilir.',
  tone: 'amber',
}

/**
 * Sürümün durumuna göre bilgi kutusu: onay bekleyende web yönlendirmesi, kurum imzası bekleyende
 * sıradaki adım, yerini ek protokole bırakan ya da iptal edilen sürümde sonucu. Onaylı sürümde künye
 * yeterlidir (`null`).
 */
export function contractNotice(
  contract: ContractRecord,
  status: ContractStatus,
): ContractNotice | null {
  switch (status) {
    case 'awaiting_approval':
      return contract.payer === 'student'
        ? {
            title: 'Kursiyer onayı bekleniyor',
            text: 'Bu sözleşmenin ödeyicisi kursiyerdir; veli hesabından onay verilmez.',
            tone: 'primary',
          }
        : APPROVAL_ON_WEB_NOTICE
    case 'awaiting_signatory':
      return {
        title: 'Kurum imzası bekleniyor',
        text: 'Kurum imza yetkilisini işledikten sonra sözleşme onayınıza açılır.',
        tone: 'primary',
      }
    case 'superseded':
      return {
        title: 'Yerini ek protokole bıraktı',
        text: 'Bu sürüm ve onayı değişmeden saklanır; yürürlükteki plan sonraki sürümdedir.',
        tone: 'primary',
      }
    case 'cancelled':
      return {
        title: 'Ek protokol iptal edildi',
        text: 'İptal edilen ek protokol hiçbir taksiti değiştirmedi.',
        tone: 'primary',
      }
    case 'approved':
      return null
    default:
      return status satisfies never
  }
}
