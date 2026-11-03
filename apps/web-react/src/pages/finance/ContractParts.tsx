// Sözleşme sürümünün ortak görünümü (IST-092; DOM-FIN-010, -012, -051): durum rozeti, künye ve
// belgedeki Ek 1 ile aynı plan tablosu. Görevli paneli (`ContractPanel`) ve veli onay paneli
// (`ContractApprovalPanel`) aynı parçaları kullanır; ikinci bir görünüm yazılmaz.
import type { UseFormRegisterReturn } from 'react-hook-form'
import {
  CONTRACT_PLAN_ROW_LABELS,
  contractPlanRows,
  contractRevision,
  isAmendment,
  type ContractRecord,
} from '@kampus/react-shared/contract-model.ts'
import {
  CONTRACT_APPROVAL_METHOD_LABELS,
  CONTRACT_STATUS_LABELS,
  SIGNATORY_ROLE_LABELS,
  type ContractStatus,
} from '@kampus/school-core/lib/contract-status.ts'
import { FEE_ITEM_KIND_LABELS, type FeeItemKind } from '@kampus/school-core/lib/fee-tariffs.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import type { BadgeTone } from '@/lib/badge-tone.ts'

type InvoiceRecord = State['invoices'][number]

const STATUS_TONES: Readonly<Record<ContractStatus, BadgeTone>> = {
  awaiting_signatory: 'amber',
  awaiting_approval: 'amber',
  approved: 'green',
  superseded: 'gray',
  cancelled: 'gray',
}

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return <StatusBadge text={CONTRACT_STATUS_LABELS[status]} tone={STATUS_TONES[status]} />
}

/**
 * Onay kutusu: işaretlenmeden form gönderilmez; alan hatası kutuya bağlıdır (`aria-describedby`).
 * Etiket kutuyu saran `label`dır, dokunma alanı bütün satırdır.
 */
export function AcceptCheckbox({
  id,
  label,
  registration,
  error,
  disabled,
}: {
  id: string
  label: string
  registration: UseFormRegisterReturn
  error: string | undefined
  disabled: boolean
}) {
  const errorId = error ? `${id}-hata` : undefined
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="flex min-h-11 items-center gap-2.5 text-sm">
        <input
          id={id}
          type="checkbox"
          className="size-4"
          {...registration}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
        />
        {label}
      </label>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** "Sürüm 2 · Ek protokol" ya da "Sürüm 1". */
export const contractVersionLabel = (contract: ContractRecord) =>
  `Sürüm ${String(contractRevision(contract))}${isAmendment(contract) ? ' · Ek protokol' : ''}`

const dateTime = (value: string) => `${dateLabel(value, { year: 'numeric' })} ${timeLabel(value)}`
const day = (value: string) => dateLabel(value, { year: 'numeric' })

const feeKindLabel = (kind: string) =>
  kind in FEE_ITEM_KIND_LABELS ? FEE_ITEM_KIND_LABELS[kind as FeeItemKind] : kind

/** Künye: sürüm, durum, tarih, tutar, imza yetkilisi ve ödeyici onayının biçimi ile zamanı. */
export function ContractFacts({
  contract,
  status,
  studentName,
}: {
  contract: ContractRecord
  status: ContractStatus
  studentName?: string | undefined
}) {
  const facts: [string, string][] = [
    ...(studentName ? ([['Öğrenci', studentName]] as [string, string][]) : []),
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
    ...(contract.approval
      ? ([['Onaylayan ödeyici', contract.approval.payerName]] as [string, string][])
      : []),
    ...(contract.amendmentReason
      ? ([['Ek protokol gerekçesi', contract.amendmentReason]] as [string, string][])
      : []),
    ...(contract.cancelledAt
      ? ([
          ['İptal tarihi', dateTime(contract.cancelledAt)],
          ['İptal gerekçesi', contract.cancelReason ?? '—'],
        ] as [string, string][])
      : []),
  ]
  return (
    <dl className="detail-facts mb-6 grid gap-0 text-sm">
      {facts.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 border-b py-2.5 last:border-b-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Ödeme planı: onaylı sürümde onay anının kopyası, ek protokol taslağında korunan ve önerilen
 * satırlar ("Korunur", "Yeni plan"), onaysız sözleşmede kendi güncel taksitleri.
 */
export function ContractPlanTable({
  contract,
  invoices,
}: {
  contract: ContractRecord
  invoices: readonly InvoiceRecord[]
}) {
  const rows = contractPlanRows(contract, invoices)
  const showKind = contract.proposedPlan !== undefined
  const caption = contract.approval
    ? 'Onaylanan ödeme planı'
    : showKind
      ? 'Ek protokolün önerdiği ödeme planı'
      : 'Güncel ödeme planı'
  if (rows.length === 0)
    return <p className="mb-6 text-sm text-muted-foreground">Sözleşmeye bağlı taksit yok.</p>
  return (
    <div className="mb-6 overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="mb-2 text-left font-semibold">{caption}</caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              Taksit
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Kalem
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Vade
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Tutar
            </th>
            {showKind ? (
              <th scope="col" className="py-2 font-medium">
                Satır
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b last:border-b-0">
              <td className="py-2 pr-3">{row.installment}.</td>
              <td className="py-2 pr-3">{feeKindLabel(row.feeKind)}</td>
              <td className="py-2 pr-3">{day(row.dueDate)}</td>
              <td className="py-2 pr-3 text-right font-medium">{money(row.amount)}</td>
              {showKind ? <td className="py-2">{CONTRACT_PLAN_ROW_LABELS[row.kind]}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
