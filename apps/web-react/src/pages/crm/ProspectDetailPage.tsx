import { Link, useParams } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { prospectStageLabel } from '@kampus/school-core/lib/prospects.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { ProspectNoteForm } from './ProspectNoteForm.tsx'
import { ProspectPlanPanel } from './ProspectPlanPanel.tsx'
import { ProspectConsentPanel } from './ProspectConsentPanel.tsx'
import { ProspectEditPanel } from './ProspectEditPanel.tsx'
import { ProspectStageForm } from './ProspectStageForm.tsx'
import { ProspectStageRevertForm } from './ProspectStageRevertForm.tsx'
import {
  CONTACT_LABELS,
  dateTimeLabel,
  isOpenStage,
  prospectContactOwner,
  slotLabel,
  stageTone,
} from './prospect-rows.ts'

type Prospect = CoreRecord<'prospects'>

function Section({
  id,
  title,
  description,
  children,
  aside,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="panel rounded-card border bg-surface p-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

/** Kesin kayıt taksit ve sözleşme yazar: `crm` ve `finance` birlikte açık olmalıdır (DOM-YTK-040). */
export const ENROLL_MODULES_CLOSED_MESSAGE =
  'Kesin kayıt için aday (CRM) ve finans modüllerinin açık olması gerekir. Modülleri yönetici Ayarlar sayfasından açar.'

/**
 * Aday detayı (`/onburo/aday/:id`, `/yonetici/aday/:id`; Vue `Crm.vue` aday kartı): iletişim ve
 * aşama kartı, görüşme notu, değişmez iletişim geçmişi, planlanan görüşme ve (dil okulunda) deneme
 * dersi. Kart tek kayıt ucundan okunur; kapsam dışı ya da olmayan aday "Kayıt bulunamadı" görünümüne
 * düşer (API 404). Yazan komutlar kartın okunan sürümünü `If-Match` olarak taşır; araya giren
 * değişiklik 409 ile Türkçe uyarı verir ve kart yenilenir.
 */
export function ProspectDetailPage({ page }: { page: NavPage }) {
  const { prospectId = '' } = useParams()
  const { session } = useAuth()
  const item = useCoreItem('prospects', prospectId)
  useDocumentTitle(item.data?.record.name ?? page.title)
  const role = session?.role ?? 'onburo'
  const listHref = role === 'onburo' ? '/onburo/adaylar' : `/${role}/dashboard`

  if (item.error)
    return (
      <>
        <PageHeading title={page.title} />
        <div className="rounded-card border bg-surface p-8">
          <QueryError error={item.error} onRetry={() => void item.refetch()} />
        </div>
      </>
    )
  if (!item.data) return <SummaryLoading />
  return (
    <Detail
      prospect={item.data.record}
      version={item.data.version}
      listHref={listHref}
      listLabel={role === 'onburo' ? 'Aday listesine dön' : 'Panele dön'}
      canPickTeacher={role === 'yonetici'}
      canEnroll={role === 'onburo' || role === 'yonetici'}
    />
  )
}

function Detail({
  prospect,
  version,
  listHref,
  listLabel,
  canPickTeacher,
  canEnroll,
}: {
  prospect: Prospect
  version: number
  listHref: string
  listLabel: string
  canPickTeacher: boolean
  /** Kesin kayıt formu Kayıt İşlemleri sayfasındadır (tarifeli, adımlı form); ön büro ve yönetici. */
  canEnroll: boolean
}) {
  const { session } = useAuth()
  const role = session?.role ?? 'onburo'
  const type = session?.institution.type ?? 'school'
  // Kesin kayıt taksit ve sözleşme yazar: `crm` ve `finance` birlikte açık olmalıdır (liste ile aynı).
  const enrollModulesOpen = session?.modules.crm === true && session.modules.finance === true
  const contact = CONTACT_LABELS[prospectContactOwner(prospect)]
  const plan = useDetailPanel('planlama')
  const edit = useDetailPanel('duzenle')
  const branches = useCoreAll('branches')
  const branch = branches.data?.find((entry) => entry.record.id === prospect.branchId)?.record.name
  const classes = useCoreAll(
    'classes',
    { filters: { branchId: prospect.branchId } },
    { enabled: type === 'language_school' },
  )
  const groupName = classes.data?.find((entry) => entry.record.id === prospect.trialLesson?.classId)
    ?.record.name
  const open = isOpenStage(prospect.stage)
  const stageLabel = prospectStageLabel(prospect.stage, type)
  const enrolled = prospect.stage === 'Kayıt oldu'

  return (
    <>
      <PageHeading
        title={prospect.name}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link to={listHref}>
                <Icon name="ArrowLeft" size={16} aria-hidden="true" />
                {listLabel}
              </Link>
            </Button>
            <Button variant="secondary" onClick={() => edit.open('bilgi')}>
              <Icon name="Pencil" size={17} aria-hidden="true" />
              Bilgileri düzenle
            </Button>
            <Button variant="secondary" onClick={() => plan.open('gorusme')} disabled={!open}>
              <Icon name="CalendarDays" size={17} aria-hidden="true" />
              Tanışma görüşmesi planla
            </Button>
            {type === 'language_school' ? (
              <Button variant="secondary" onClick={() => plan.open('deneme')} disabled={!open}>
                <Icon name="CalendarCheck2" size={17} aria-hidden="true" />
                Deneme dersi planla
              </Button>
            ) : null}
            {canEnroll ? (
              open && enrollModulesOpen ? (
                <Button asChild>
                  <Link to={`/${role}/kayit-islemleri?aday=${encodeURIComponent(prospect.id)}`}>
                    <Icon name="UserRoundPlus" size={17} aria-hidden="true" />
                    Kesin kayda dönüştür
                  </Link>
                </Button>
              ) : (
                <Button
                  disabled
                  title={enrollModulesOpen ? undefined : ENROLL_MODULES_CLOSED_MESSAGE}
                  aria-describedby={enrollModulesOpen ? undefined : 'kayit-modul-kapali'}
                >
                  <Icon name="UserRoundPlus" size={17} aria-hidden="true" />
                  Kesin kayda dönüştür
                </Button>
              )
            ) : null}
          </>
        }
      />
      {enrollModulesOpen || !canEnroll ? null : (
        <p
          id="kayit-modul-kapali"
          role="alert"
          className="rounded-card border bg-warning-soft p-4 text-sm font-medium"
        >
          {ENROLL_MODULES_CLOSED_MESSAGE}
        </p>
      )}
      <div className="detail-grid grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <aside
          aria-label="Aday bilgileri"
          className="panel profile-card grid gap-5 rounded-card border bg-surface p-6"
        >
          <div className="grid justify-items-center gap-2 text-center">
            <Avatar name={prospect.name} size="large" />
            <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{prospect.name}</h2>
            <StatusBadge text={stageLabel} tone={stageTone(prospect.stage ?? '')} />
          </div>
          <dl className="contact-lines grid gap-2.5 text-sm">
            <div className="flex items-start gap-2.5">
              <Icon name="Phone" size={17} aria-hidden="true" />
              <div>
                <dt className="text-xs text-muted-foreground">{contact.phone}</dt>
                <dd>{prospect.phone}</dd>
              </div>
            </div>
            {prospect.email ? (
              <div className="flex items-start gap-2.5">
                <Icon name="Mail" size={17} aria-hidden="true" />
                <div>
                  <dt className="text-xs text-muted-foreground">{contact.email}</dt>
                  <dd className="[overflow-wrap:anywhere]">{prospect.email}</dd>
                </div>
              </div>
            ) : null}
            <div className="flex items-start gap-2.5">
              <Icon name="Building2" size={17} aria-hidden="true" />
              <div>
                <dt className="sr-only">Kampüs</dt>
                <dd>{branch ?? '—'}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Icon name="BookOpen" size={17} aria-hidden="true" />
              <div>
                <dt className="sr-only">İlgilendiği program</dt>
                <dd>{prospect.interest}</dd>
              </div>
            </div>
            {prospect.minor !== false && prospect.guardianName ? (
              <div className="flex items-start gap-2.5">
                <Icon name="UserRound" size={17} aria-hidden="true" />
                <div>
                  <dt className="text-xs text-muted-foreground">Veli</dt>
                  <dd>{prospect.guardianName}</dd>
                </div>
              </div>
            ) : null}
          </dl>
          <ProspectStageForm
            key={`${prospect.stage}:${version}`}
            prospectId={prospect.id}
            version={version}
            stage={prospect.stage ?? ''}
            type={type}
          />
          {role === 'yonetici' ? (
            <ProspectStageRevertForm
              key={`revert:${prospect.stage}:${version}`}
              prospectId={prospect.id}
              version={version}
              prospect={prospect}
              type={type}
            />
          ) : null}
          <ProspectConsentPanel
            key={`consent:${version}`}
            prospectId={prospect.id}
            version={version}
            prospect={prospect}
          />
          {enrolled ? (
            <p className="text-xs text-muted-foreground">
              Kesin kayıt tamamlandı; öğrenci kaydı Kayıt İşlemleri ve öğrenci listelerinde görünür.
            </p>
          ) : null}
        </aside>
        <div className="grid gap-6">
          <Section
            id="aday-not-baslik"
            title="Görüşme notu ekle"
            description="Notlar eklenir; düzenlenmez ve silinmez."
          >
            <ProspectNoteForm prospectId={prospect.id} version={version} open={open} />
          </Section>
          <Section
            id="aday-gecmis"
            title="İletişim geçmişi"
            aside={<StatusBadge text={`${prospect.notes.length} görüşme`} />}
          >
            <ol className="timeline grid gap-4">
              {prospect.notes.map((note) => (
                <li key={note.id} className="grid gap-1 border-l-2 border-border pl-4">
                  <small className="text-xs text-muted-foreground">
                    {dateLabel(note.date, {
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {note.author ? ` · ${note.author}` : ''}
                  </small>
                  <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {note.text}
                  </p>
                </li>
              ))}
              <li className="grid gap-1 border-l-2 border-border pl-4">
                <small className="text-xs text-muted-foreground">
                  {dateLabel(prospect.createdAt, { year: 'numeric' })}
                </small>
                <p className="text-sm">{prospect.source} üzerinden aday kaydı oluşturuldu.</p>
              </li>
            </ol>
          </Section>
          {prospect.trialAt ? (
            <Section id="aday-gorusme" title="Tanışma görüşmesi planlandı">
              <p className="text-sm">
                {dateTimeLabel(prospect.trialAt)}
                {prospect.meeting
                  ? ` · ${slotLabel(prospect.trialAt, prospect.meeting.duration)} · ${prospect.meeting.room}`
                  : ''}
                {branch ? ` · ${branch}` : ''}
              </p>
            </Section>
          ) : null}
          {prospect.trialLesson ? (
            <Section id="aday-deneme" title="Deneme dersi planlandı">
              <p className="text-sm">
                {dateTimeLabel(prospect.trialLesson.date)} ·{' '}
                {slotLabel(prospect.trialLesson.date, prospect.trialLesson.duration)}
                {groupName ? ` · ${groupName}` : ''}
              </p>
            </Section>
          ) : null}
        </div>
      </div>
      <ProspectEditPanel
        open={edit.selectedId === 'bilgi'}
        prospect={prospect}
        version={version}
        onClose={edit.close}
      />
      <ProspectPlanPanel
        kind={plan.selectedId}
        prospect={prospect}
        version={version}
        canPickTeacher={canPickTeacher}
        onClose={plan.close}
      />
    </>
  )
}
