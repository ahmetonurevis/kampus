import type { ContractTarget } from '@kampus/react-shared/use-contract-commands.ts'
import {
  CONTRACT_APPROVAL_METHOD_LABELS,
  contractStatus,
} from '@kampus/school-core/lib/contract-status.ts'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreItem } from '@/hooks/use-core-collection.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  AcceptCheckbox,
  ContractFacts,
  ContractPlanTable,
  ContractStatusBadge,
  contractVersionLabel,
} from './ContractParts.tsx'
import { useContractApproval, type ContractApproval } from './use-contract-approval.ts'

/**
 * Veli sözleşme onayı (`/veli/sozlesmeler?onay=`; IST-092, DOM-FIN-010, -051): onay bekleyen
 * sürümün künyesi, belgedeki plan ve PDF'i; veli kutuyu işaretleyip kendi hesabıyla elektronik
 * onay verir. Yalnız ödeyici veli onaylayabilir (sunucu 403 `contract_payer_only`). Onay taze
 * oturum ister: parola penceresi açılır, doğrulanınca onay bir kez tekrarlanır.
 */
export function ContractApprovalPanel({
  contractId,
  onClose,
}: {
  contractId: string
  onClose: () => void
}) {
  return (
    <SidePanel
      open={contractId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sözleşme onayı"
    >
      {contractId ? (
        <ApprovalDetail key={contractId} contractId={contractId} onDone={onClose} />
      ) : null}
    </SidePanel>
  )
}

function ApprovalDetail({ contractId, onDone }: { contractId: string; onDone: () => void }) {
  const item = useCoreItem('contracts', contractId)
  const studentId = item.data?.record.studentId ?? ''
  const versions = useCoreAll(
    'contracts',
    { filters: { studentId } },
    { enabled: studentId !== '' },
  )
  const invoices = useCoreAll('invoices', { filters: { studentId } }, { enabled: studentId !== '' })
  const approval = useContractApproval({ successMessage: 'Sözleşme onaylandı.', onSuccess: onDone })

  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (versions.error)
    return <QueryError error={versions.error} onRetry={() => void versions.refetch()} />
  if (!item.data || !versions.data)
    return (
      <>
        <SummaryLoading />
        {approval.reauthModal}
      </>
    )

  const contract = item.data.record
  const all = [
    contract,
    ...versions.data.map((row) => row.record).filter((row) => row.id !== contract.id),
  ]
  const status = contractStatus(contract, all)
  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{contract.title}</h3>
          <p className="text-sm text-muted-foreground">{contractVersionLabel(contract)}</p>
        </div>
        <ContractStatusBadge status={status} />
      </div>
      <ContractFacts contract={contract} status={status} />
      {invoices.error ? (
        <QueryError error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : invoices.data ? (
        <ContractPlanTable contract={contract} invoices={invoices.data.map((row) => row.record)} />
      ) : (
        <p role="status" className="mb-6 text-sm text-muted-foreground">
          Ödeme planı yükleniyor…
        </p>
      )}
      <div className="mb-6">
        <PdfButton
          type="contract"
          recordId={contract.id}
          label="Sözleşmeyi görüntüle"
          variant="outline"
          size="default"
        />
      </div>
      {status === 'awaiting_approval' ? (
        <ApprovalForm
          approval={approval}
          target={{ contractId: contract.id, version: item.data.version }}
          onCancel={onDone}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Bu sözleşme sürümü onay beklemiyor.</p>
      )}
      {approval.reauthModal}
    </>
  )
}

function ApprovalForm({
  approval,
  target,
  onCancel,
}: {
  approval: ContractApproval
  target: ContractTarget
  onCancel: () => void
}) {
  const { form, busy } = approval
  const errors = form.formState.errors
  const onSubmit = approval.submitFor(target)
  return (
    <>
      <form
        noValidate
        aria-label="Sözleşme onayı"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4 border-t pt-5"
      >
        <p className="text-sm">
          Onay biçimi: <strong>{CONTRACT_APPROVAL_METHOD_LABELS.electronic}</strong>. Onayınız
          zamanıyla saklanır; onaydan sonra tutar ve ödeme planı değiştirilemez. Onayı yalnız
          ödeyici veli verebilir.
        </p>
        <AcceptCheckbox
          id="sozlesme-veli-onay"
          label="Sözleşmeyi ve ödeme planını okudum, ödeyici olarak onaylıyorum"
          registration={form.register('accepted')}
          error={errors.accepted?.message}
          disabled={busy}
        />
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Sözleşmeyi onayla
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            Vazgeç
          </Button>
        </div>
      </form>
    </>
  )
}
