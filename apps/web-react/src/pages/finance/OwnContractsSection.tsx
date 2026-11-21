import { useRef, useState } from 'react'
import {
  isAdultLearnerOnlyError,
  useOwnContracts,
  type OwnContract,
} from '@kampus/react-shared/use-contract-self-service.ts'
import {
  CONTRACT_APPROVAL_METHOD_LABELS,
  CONTRACT_STATUS_LABELS,
} from '@kampus/school-core/lib/contract-status.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useOwnContractPdf } from '@/hooks/use-contract-own-pdf.ts'
import { FinancePdfDialog } from './FinancePdfDialog.tsx'

// Öğrenci Ödemelerim'deki "Sözleşmelerim" bölümü (IST-082; docs/domain/finans.md DOM-FIN-059).
// Velisi olmayan yetişkin kursiyer sözleşme sürümlerini salt okur görür: sürüm, durum, ödeme planı
// özeti ve sözleşme PDF'i. Onay yoktur (ödeyici onayı velinin ve görevlinin ekranındadır). Bölüm
// yalnız kursta istenir; okulda uç yoktur. 18 yaş altı kursiyerde sunucu 403 `adult_learner_only`
// döner ve bölüm hiç çizilmez. Kapsam sunucudadır: öğrenci kimliği oturum bağından gelir.

const HEADING_ID = 'sozlesmelerim'
const day = (value: string) => dateLabel(value, { year: 'numeric' })
const versionLabel = ({ contract }: OwnContract) =>
  `Sürüm ${String(contract.revision ?? 1)}${contract.amendsContractId ? ' · Ek protokol' : ''}`

export function OwnContractsSection() {
  const { session } = useAuth()
  const studentId = session?.links.find((link) => link.kind === 'student')?.recordId ?? ''
  const course = session?.institution?.type !== undefined && session.institution.type !== 'school'
  const contracts = useOwnContracts(studentId, { enabled: course })
  if (!course || studentId === '' || isAdultLearnerOnlyError(contracts.error)) return null
  let body
  if (contracts.error)
    body = <QueryError error={contracts.error} onRetry={() => void contracts.refetch()} />
  else if (!contracts.data)
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        Sözleşmeler yükleniyor…
      </p>
    )
  else {
    // İptal edilen ek protokol hiçbir sonuç doğurmamıştır; veli listesindeki gibi gösterilmez.
    const shown = contracts.data.data.filter((item) => item.status !== 'cancelled')
    body =
      shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Kayıtlı sözleşmeniz bulunmuyor.</p>
      ) : (
        <ul
          aria-label="Sözleşmelerim"
          className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4"
        >
          {shown.map((item) => (
            <OwnContractCard key={item.contract.id} item={item} />
          ))}
        </ul>
      )
  }
  return (
    <section aria-labelledby={HEADING_ID} className="mt-8 grid gap-4">
      <div className="grid gap-1">
        <h2 id={HEADING_ID} className="text-lg font-semibold">
          Sözleşmelerim
        </h2>
        <p className="max-w-[62ch] text-sm text-muted-foreground">
          Taraf olduğunuz eğitim sözleşmeleri ve ek protokoller. Onay ve değişiklik için kurumla
          iletişime geçin.
        </p>
      </div>
      {body}
    </section>
  )
}

function OwnContractCard({ item }: { item: OwnContract }) {
  const { contract, plan } = item
  const version = versionLabel(item)
  return (
    <li className="panel document-card grid content-start gap-2 rounded-card border bg-surface p-6">
      <h3 className="text-lg font-semibold">{contract.title}</h3>
      <p className="text-sm text-muted-foreground">
        {day(contract.date)} · {version} · {CONTRACT_STATUS_LABELS[item.status]}
      </p>
      <dl className="grid gap-1 text-sm" aria-label={`${contract.title} ${version} ödeme planı`}>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Ödeme planı</dt>
          <dd>
            {plan.installmentCount} taksit · {money(plan.totalCents)} · {plan.paidCount} ödendi
          </dd>
        </div>
        {plan.nextDue ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Sıradaki vade</dt>
            <dd>
              {day(plan.nextDue.date)} · {money(plan.nextDue.amountCents)}
            </dd>
          </div>
        ) : null}
      </dl>
      {contract.approval ? (
        <p className="text-sm text-muted-foreground">
          {CONTRACT_APPROVAL_METHOD_LABELS[contract.approval.method]} ·{' '}
          {day(contract.approval.approvedAt)}
        </p>
      ) : null}
      <div>
        <OwnContractPdfButton item={item} label={`${contract.title} ${version}`} />
      </div>
    </li>
  )
}

function OwnContractPdfButton({ item, label }: { item: OwnContract; label: string }) {
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="secondary"
        aria-haspopup="dialog"
        aria-label={`${label} sözleşmeyi görüntüle`}
        onClick={() => {
          setUsed(true)
          setOpen(true)
        }}
      >
        <Icon name="FileText" size={16} />
        Sözleşmeyi görüntüle
      </Button>
      {used ? (
        <OwnContractPreview
          item={item}
          open={open}
          onOpenChange={setOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            button.current?.focus()
          }}
        />
      ) : null}
    </>
  )
}

function OwnContractPreview({
  item,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  item: OwnContract
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: (event: Event) => void
}) {
  const pdf = useOwnContractPdf(item, open)
  return (
    <FinancePdfDialog
      title="Eğitim sözleşmesi"
      pdf={pdf}
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
