import { use, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  CONTRACT_APPROVAL_METHOD_LABELS,
  CONTRACT_STATUS_LABELS,
  contractStatus,
} from '@kampus/school-core/lib/contract-status.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { hasScholarshipContract } from '@kampus/school-core/lib/payments.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreItem } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useMediaQuery } from '@/hooks/use-media-query.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { ContractApprovalPanel } from './ContractApprovalPanel.tsx'
import { contractVersionLabel } from './ContractParts.tsx'
import { FamilyInvoicesView } from './FamilyInvoicesView.tsx'
import { StudentStatementSection } from './StudentStatementSection.tsx'
import { invoiceRow } from './finance-rows.ts'

/** Telefon genişliği (tablodaki kart görünümüyle aynı sınır). Öğrenci ödemeleri burada gösterilmez. */
const PHONE_QUERY = '(max-width: 650px)'
const CONTACT_PATH = '/veli/randevu-mesaj'

/** Seçili çocuk yoksa (bağlı öğrenci bulunmayan veli hesabı) tek boş durum. */
function NoChild({ page }: { page: NavPage }) {
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <EmptyState
        title="Bağlı öğrenci bulunamadı."
        description="Hesabınıza bağlı bir öğrenci olduğunda ödeme bilgileri burada görünür."
      />
    </>
  )
}

/** Seçili çocuğun adı ve sınıfı; adı okunamazsa sayfa yine çalışır (yalnız özet düşer). */
function ChildSummary({ childId }: { childId: string }) {
  const student = useCoreItem('students', childId)
  const schoolClass = useCoreItem('classes', student.data?.record.classId ?? null)
  if (student.error)
    return <QueryError error={student.error} onRetry={() => void student.refetch()} />
  if (!student.data) return null
  return (
    <section
      aria-label="Öğrenci özeti"
      className="panel mb-6 flex flex-wrap items-center gap-4 rounded-card border bg-surface px-6 py-5"
    >
      <Avatar name={student.data.record.name} size="large" />
      <div className="min-w-0">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
          {student.data.record.name}
        </h2>
        <p className="text-sm text-muted-foreground">{schoolClass.data?.record.name ?? ''}</p>
      </div>
    </section>
  )
}

/**
 * Veli Finans & Ödeme Planı (`finans`) ve Dekontlar (`dekontlar`): seçili çocuğun taksitleri.
 * Seçili çocuk kabuktan gelir (`ViewScopeContext`, adreste `?cocuk=`); veli yalnız kendi
 * çocuklarını görür (kapsam sunucuda). Veli çevrim içi ödeme yapamaz, bkz. `FamilyInvoicesView`.
 */
export function ParentFinancePage({ page, receipts }: { page: NavPage; receipts: boolean }) {
  useDocumentTitle(page.title)
  const childId = use(ViewScopeContext)
  if (!childId) return <NoChild page={page} />
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <ChildSummary childId={childId} />
      <FamilyInvoicesView
        audience="parent"
        studentId={childId}
        receiptsOnly={receipts}
        title={receipts ? 'Ödeme dekontları' : 'Taksit listesi'}
      />
      {receipts ? null : <ChildStatement childId={childId} />}
    </>
  )
}

function ChildStatement({ childId }: { childId: string }) {
  return <StudentStatementSection studentId={childId} />
}

/**
 * Veli "Ödeme Yap" (`odeme-yap`): çevrim içi ödeme yoktur (`invoice.pay` yalnız yönetici ve ön
 * büro). Sayfa sıradaki ödenmemiş taksiti ve okulla iletişim yolunu gösterir.
 */
export function ParentPayPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const childId = use(ViewScopeContext)
  if (!childId) return <NoChild page={page} />
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <ChildSummary childId={childId} />
      <NextInstallment childId={childId} />
    </>
  )
}

function NextInstallment({ childId }: { childId: string }) {
  const invoices = useCoreAll('invoices', { filters: { studentId: childId } })
  const today = dayKey()
  const next = invoices.data
    ?.map((item) => invoiceRow(item, today))
    .filter((row) => !row.paidAt)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  let summary: ReactNode
  if (invoices.error)
    summary = <QueryError error={invoices.error} onRetry={() => void invoices.refetch()} />
  else if (!invoices.data)
    summary = (
      <p role="status" className="text-sm text-muted-foreground">
        Ödeme bilgisi yükleniyor…
      </p>
    )
  else if (next)
    summary = (
      <dl className="grid gap-3 text-sm sm:grid-cols-3" aria-label="Sıradaki taksit">
        <div>
          <dt className="text-muted-foreground">Sıradaki taksit</dt>
          <dd className="font-medium">{next.installment}. taksit</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Vade tarihi</dt>
          <dd className="font-medium">{dateLabel(next.dueDate, { year: 'numeric' })}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tutar</dt>
          <dd className="font-medium">
            {money(next.amount)} · {next.status}
          </dd>
        </div>
      </dl>
    )
  else summary = <p className="text-sm">Ödenmemiş taksit bulunmuyor.</p>
  return (
    <section
      aria-labelledby="odeme-bilgisi"
      className="panel grid gap-4 rounded-card border bg-surface px-6 py-5"
    >
      <h2 id="odeme-bilgisi" className="text-lg font-semibold">
        Ödemeler okulda kaydedilir
      </h2>
      <p className="max-w-[62ch] text-sm text-muted-foreground">
        Çevrim içi ödeme bu uygulamadan yapılmaz. Havale, nakit veya kart ödemesi okulun tahsilat
        biriminde kaydedilir; ödeme kaydedilince taksit "Ödendi" olur ve dekontunu buradan
        indirebilirsiniz. Ödeme için okulla iletişime geçin.
      </p>
      {summary}
      {/* Bağlantılar metin satırı kadar (17 px) kalmasın: dokunma hedefi en az 24 px (WCAG 2.5.8). */}
      <div className="flex flex-wrap gap-3 text-sm font-medium">
        <Link
          to={CONTACT_PATH}
          className="inline-flex min-h-(--target-min) items-center gap-1.5 text-primary hover:underline"
        >
          <Icon name="MessagesSquare" size={16} aria-hidden="true" />
          Okulla iletişime geçin
        </Link>
        <Link
          to="/veli/finans"
          className="inline-flex min-h-(--target-min) items-center gap-1.5 text-primary hover:underline"
        >
          <Icon name="ReceiptText" size={16} aria-hidden="true" />
          Ödeme planını görüntüleyin
        </Link>
      </div>
    </section>
  )
}

/**
 * Veli Sözleşmeler (`sozlesmeler`): seçili çocuğun sözleşme sürümleri ve taksit taahhütnamesi
 * PDF'leri. Ödeyici onayı bekleyen sürüm "İncele ve onayla" ile sağ panelde açılır (`?onay=`,
 * IST-092); onaylı sürüm onayın biçimini ve gününü gösterir.
 */
export function ParentContractsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const childId = use(ViewScopeContext)
  if (!childId) return <NoChild page={page} />
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <ChildSummary childId={childId} />
      <ContractsWithApproval childId={childId} />
    </>
  )
}

/**
 * Onay paneli listenin yükleme dalının dışındadır: parola doğrulaması sorguları baştan yükler,
 * panel bu sırada sökülürse bekleyen onay vazgeçilmiş sayılırdı (`useContractApproval`).
 */
function ContractsWithApproval({ childId }: { childId: string }) {
  const approval = useDetailPanel('onay')
  return (
    <>
      <Contracts childId={childId} onApprove={approval.open} />
      <ContractApprovalPanel contractId={approval.selectedId} onClose={approval.close} />
    </>
  )
}

function Contracts({
  childId,
  onApprove,
}: {
  childId: string
  onApprove: (contractId: string) => void
}) {
  const contracts = useCoreAll('contracts', { filters: { studentId: childId } })
  if (contracts.error)
    return <QueryError error={contracts.error} onRetry={() => void contracts.refetch()} />
  if (!contracts.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Sözleşmeler yükleniyor…
      </p>
    )
  const all = contracts.data.map(({ record }) => record)
  // İptal edilen ek protokol hiçbir sonuç doğurmamıştır; eski sürümler durumuyla listede kalır
  // (DOM-FIN-051, IST-092).
  const shown = all.filter((contract) => contract.cancelledAt === undefined)
  return (
    <ul aria-label="Belgeler" className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
      {shown.map((contract) => {
        const status = contractStatus(contract, all)
        return (
          <li
            key={contract.id}
            className="panel document-card grid content-start gap-2 rounded-card border bg-surface p-6"
          >
            <h2 className="text-lg font-semibold">{contract.title}</h2>
            <p className="text-sm text-muted-foreground">
              {dateLabel(contract.date, { year: 'numeric' })} · {contractVersionLabel(contract)} ·{' '}
              {CONTRACT_STATUS_LABELS[status]}
            </p>
            <p className="text-sm">
              Eğitim bedeli: <strong>{money(contract.amount)}</strong>
            </p>
            {contract.approval ? (
              <p className="text-sm text-muted-foreground">
                {CONTRACT_APPROVAL_METHOD_LABELS[contract.approval.method]} ·{' '}
                {dateLabel(contract.approval.approvedAt, { year: 'numeric' })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {status === 'awaiting_approval' ? (
                <Button
                  aria-label={`${contract.title} ${contractVersionLabel(contract)} incele ve onayla`}
                  onClick={() => onApprove(contract.id)}
                >
                  İncele ve onayla
                </Button>
              ) : null}
              <PdfButton
                type="contract"
                recordId={contract.id}
                label="Sözleşmeyi görüntüle"
                size="default"
              />
            </div>
          </li>
        )
      })}
      {hasScholarshipContract(all, childId) ? null : (
        <li className="panel document-card grid content-start gap-2 rounded-card border bg-surface p-6">
          <h2 className="text-lg font-semibold">Taksit taahhütnamesi</h2>
          <p className="text-sm text-muted-foreground">Öğrencinin güncel ödeme planı belgesi.</p>
          <div>
            <PdfButton
              type="payment-plan"
              recordId={childId}
              label="Ödeme belgesini görüntüle"
              size="default"
            />
          </div>
        </li>
      )}
    </ul>
  )
}

/**
 * Öğrenci Ödemelerim (`odemelerim`): kendi taksitleri, salt okunur. Öğrenci ödemeleri telefonda
 * gösterilmez (mobil uygulama sayfayı menüden de çıkarır); dar ekranda veri hiç okunmaz.
 */
export function StudentPaymentsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const phone = useMediaQuery(PHONE_QUERY)
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {phone ? (
        <EmptyState
          icon="Wallet"
          title="Ödemeler telefonda gösterilmez"
          description="Ödeme planınızı bilgisayardan veya tabletten görüntüleyebilirsiniz."
        />
      ) : (
        <>
          <FamilyInvoicesView audience="student" studentId="" title="Ödemelerim" />
          <OwnStatement />
        </>
      )}
    </>
  )
}

/** Öğrencinin kendi ekstresi; öğrenci kimliği oturum bağından gelir. */
function OwnStatement() {
  const { session } = useAuth()
  const studentId = session?.links.find((link) => link.kind === 'student')?.recordId
  if (!studentId) return null
  return <StudentStatementSection studentId={studentId} />
}
