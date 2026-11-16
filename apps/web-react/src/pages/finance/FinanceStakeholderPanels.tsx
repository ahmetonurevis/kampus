import { useState, type ReactNode } from 'react'
import {
  useActivateStakeholderAgreement,
  useArchiveStakeholderAgreement,
  useStakeholder,
  useStakeholderAgreement,
  useStakeholderAgreements,
  useUpdateStakeholder,
  type AgreementDetail,
  type StakeholderDetail,
} from '@kampus/react-shared/use-finance-stakeholders.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  AGREEMENT_BENEFIT_LABELS,
  CONTRIBUTION_TYPE_LABELS,
  STAKEHOLDER_TYPE_LABELS,
} from '@kampus/school-core/lib/finance-stakeholders.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify.ts'
import { useOpenFile } from '../learning/SubmissionFiles.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  AgreementFormModal,
  StakeholderFormModal,
  TerminateAgreementForm,
} from './FinanceStakeholderForms.tsx'
import { AGREEMENT_STATUS_VIEW, remainingText } from './finance-stakeholder-forms.ts'

const dayText = (day: string | null) =>
  day === null ? '—' : dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const STAKEHOLDER_AGREEMENTS_PAGE = 100

function Facts({ pairs }: { pairs: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid gap-2 text-sm">
      {pairs.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[minmax(0,11rem)_1fr] gap-2 max-[480px]:grid-cols-1"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="[overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Paydaş ayrıntısı (`?paydas=`; DOM-FIN-102): tam iletişim bilgisi (K-317), düzenleme,
 * pasifleştirme ve paydaşın anlaşmaları; etkin paydaşa yeni anlaşma açılır (K-316).
 */
export function StakeholderDetailView({
  stakeholderId,
  onOpenAgreement,
}: {
  stakeholderId: string
  onOpenAgreement: (id: string) => void
}) {
  const item = useStakeholder(stakeholderId)
  const agreements = useStakeholderAgreements({
    page: 1,
    pageSize: STAKEHOLDER_AGREEMENTS_PAGE,
    stakeholderId,
  })
  const update = useUpdateStakeholder()
  const [editing, setEditing] = useState(false)
  const [opening, setOpening] = useState(false)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const stakeholder = item.data?.data
  if (!stakeholder) return <SummaryLoading />
  const toggle = async () => {
    const outcome = await update.submit({
      stakeholderId: stakeholder.id,
      version: stakeholder.version,
      body: { isActive: !stakeholder.isActive },
    })
    if (outcome.status === 'success')
      notify.success(
        stakeholder.isActive
          ? `${stakeholder.name} pasifleştirildi.`
          : `${stakeholder.name} etkinleştirildi.`,
      )
  }
  return (
    <div className="grid gap-6">
      <section aria-labelledby="paydas-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="paydas-bilgileri" className="text-base font-semibold">
            {stakeholder.name}
          </h3>
          {stakeholder.isActive ? null : <StatusBadge text="Pasif" tone="gray" />}
        </div>
        <StakeholderFacts stakeholder={stakeholder} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Düzenle
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={update.isPending}
            aria-busy={update.isPending || undefined}
            onClick={() => void toggle()}
          >
            {stakeholder.isActive ? 'Pasifleştir' : 'Etkinleştir'}
          </Button>
        </div>
      </section>
      <section aria-labelledby="paydas-anlasma-baslik" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="paydas-anlasma-baslik" className="text-base font-semibold">
            Anlaşmalar
          </h3>
          {stakeholder.isActive ? (
            <Button type="button" size="sm" onClick={() => setOpening(true)}>
              <Icon name="Plus" size={16} aria-hidden="true" />
              Yeni anlaşma
            </Button>
          ) : null}
        </div>
        {agreements.error ? (
          <QueryError error={agreements.error} onRetry={() => void agreements.refetch()} />
        ) : !agreements.data ? (
          <SummaryLoading />
        ) : agreements.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu paydaşla anlaşma yok.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Paydaşın anlaşmaları">
            {agreements.data.data.map((agreement) => (
              <li
                key={agreement.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{agreement.subject}</span>
                  <span className="block text-muted-foreground">
                    {`${dayText(agreement.startDate)} – ${dayText(agreement.endDate)}`}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    text={AGREEMENT_STATUS_VIEW[agreement.status].label}
                    tone={AGREEMENT_STATUS_VIEW[agreement.status].tone}
                  />
                  {agreement.renewalDue ? (
                    <StatusBadge text="Yenileme yaklaşıyor" tone="amber" />
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label={`${agreement.subject} anlaşmasını aç`}
                    onClick={() => onOpenAgreement(agreement.id)}
                  >
                    Aç
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing ? (
        <StakeholderFormModal stakeholder={stakeholder} onClose={() => setEditing(false)} />
      ) : null}
      {opening ? (
        <AgreementFormModal
          stakeholderId={stakeholder.id}
          onClose={() => setOpening(false)}
          onSaved={(id) => {
            setOpening(false)
            onOpenAgreement(id)
          }}
        />
      ) : null}
    </div>
  )
}

function StakeholderFacts({ stakeholder }: { stakeholder: StakeholderDetail }) {
  return (
    <Facts
      pairs={[
        ['Tür', STAKEHOLDER_TYPE_LABELS[stakeholder.type]],
        ['VKN', stakeholder.taxNumber ?? '—'],
        ['İletişim kişisi', stakeholder.contactName ?? '—'],
        ['Telefon', stakeholder.contactPhone ?? '—'],
        ['E-posta', stakeholder.contactEmail ?? '—'],
        ['Etiketler', stakeholder.tags.join(', ') || '—'],
      ]}
    />
  )
}

/**
 * Anlaşma ayrıntısı (`?anlasma=`; DOM-FIN-102): dönem, kalan gün ve yenileme bildirimi günü,
 * katkı, karşılık ve sözleşme dosyası. Taslak düzenlenir, yürürlüğe alınır ya da silinir;
 * yürürlükteki anlaşma düzenlenir ya da feshedilir; feshedilmiş anlaşma salt okunur (K-318).
 */
export function AgreementDetailView({
  agreementId,
  onArchived,
}: {
  agreementId: string
  onArchived: () => void
}) {
  const item = useStakeholderAgreement(agreementId)
  const activate = useActivateStakeholderAgreement()
  const archive = useArchiveStakeholderAgreement()
  const files = useOpenFile()
  const [editing, setEditing] = useState(false)
  const [terminating, setTerminating] = useState(false)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const agreement = item.data?.data
  if (!agreement) return <SummaryLoading />
  const target = { agreementId: agreement.id, version: agreement.version }
  const busy = activate.isPending || archive.isPending
  const runActivate = async () => {
    const outcome = await activate.submit(target)
    if (outcome.status === 'success') notify.success('Anlaşma yürürlüğe alındı.')
  }
  const runArchive = async () => {
    const outcome = await archive.submit(target)
    if (outcome.status === 'success') {
      notify.success('Taslak anlaşma silindi.')
      onArchived()
    }
  }
  return (
    <div className="grid gap-6">
      <section aria-labelledby="anlasma-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="anlasma-bilgileri" className="text-base font-semibold">
            {agreement.subject}
          </h3>
          <StatusBadge
            text={AGREEMENT_STATUS_VIEW[agreement.status].label}
            tone={AGREEMENT_STATUS_VIEW[agreement.status].tone}
          />
          {agreement.renewalDue ? <StatusBadge text="Yenileme yaklaşıyor" tone="amber" /> : null}
        </div>
        <AgreementFacts agreement={agreement} />
        {agreement.contractFile ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={files.opening !== ''}
              aria-busy={files.opening !== '' || undefined}
              onClick={() => {
                if (agreement.contractFile) void files.open(agreement.contractFile.id)
              }}
            >
              <Icon name="FileText" size={16} aria-hidden="true" />
              Sözleşmeyi aç
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {agreement.status !== 'terminated' ? (
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Düzenle
            </Button>
          ) : null}
          {agreement.status === 'draft' ? (
            <>
              <Button
                type="button"
                disabled={busy}
                aria-busy={activate.isPending || undefined}
                onClick={() => void runActivate()}
              >
                Yürürlüğe al
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                aria-busy={archive.isPending || undefined}
                onClick={() => void runArchive()}
              >
                Taslağı sil
              </Button>
            </>
          ) : null}
          {agreement.status === 'active' && !terminating ? (
            <Button type="button" variant="outline" onClick={() => setTerminating(true)}>
              Feshet
            </Button>
          ) : null}
        </div>
        {terminating && agreement.status === 'active' ? (
          <TerminateAgreementForm agreement={agreement} onDone={() => setTerminating(false)} />
        ) : null}
      </section>
      {editing ? (
        <AgreementFormModal
          stakeholderId={agreement.stakeholder.id}
          agreement={agreement}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}

function AgreementFacts({ agreement }: { agreement: AgreementDetail }) {
  const remaining = remainingText(agreement)
  const pairs: [string, ReactNode][] = [
    ['Paydaş', agreement.stakeholder.name],
    ['Dönem', `${dayText(agreement.startDate)} – ${dayText(agreement.endDate)}`],
    [
      'Yenileme bildirimi',
      agreement.noticeDate === null
        ? `${String(agreement.renewalNoticeDays)} gün önce`
        : `${dayText(agreement.noticeDate)} (${String(agreement.renewalNoticeDays)} gün önce)`,
    ],
    ...(remaining ? ([['Kalan', remaining]] as [string, ReactNode][]) : []),
    ['Katkı türü', CONTRIBUTION_TYPE_LABELS[agreement.contributionType]],
    [
      agreement.contributionType === 'cash' ? 'Tutar' : 'Tahmini değer',
      agreement.contributionAmountCents === null ? '—' : money(agreement.contributionAmountCents),
    ],
    ['Katkı açıklaması', agreement.contributionDescription ?? '—'],
    [
      'Karşılık',
      agreement.benefits.map((benefit) => AGREEMENT_BENEFIT_LABELS[benefit]).join(', ') || '—',
    ],
    ['Karşılık ayrıntısı', agreement.benefitNote ?? '—'],
    ['Sözleşme dosyası', agreement.contractFile?.name ?? 'Eklenmedi'],
  ]
  if (agreement.status === 'terminated')
    pairs.push(
      ['Fesih günü', dayText(agreement.terminationDate)],
      ['Fesih gerekçesi', agreement.terminationReason ?? '—'],
    )
  return <Facts pairs={pairs} />
}
