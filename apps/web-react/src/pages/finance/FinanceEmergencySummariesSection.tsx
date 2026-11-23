import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import {
  useApproveEmergencySummary,
  useArchiveEmergencySummary,
  useCreateEmergencySummary,
  useEmergencyClasses,
  useEmergencySummaries,
  useEmergencySummary,
  useLoadEmergencyClassCards,
  useRevealEmergencyContact,
  useUpdateEmergencySummary,
  type EmergencyCard,
  type EmergencyClassCards,
  type EmergencySummaryDetail,
  type EmergencySummaryRow,
} from '@kampus/react-shared/use-finance-emergency-summaries.ts'
import {
  EMERGENCY_CARD_DEFAULT_REASON,
  EMERGENCY_SUMMARY_STATE_LABELS,
  EMERGENCY_SUMMARY_STATES,
} from '@kampus/school-core/lib/finance-emergency-summaries.ts'
import type { HealthAccessReason } from '@kampus/school-core/lib/finance-health-access.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import {
  alertText,
  contactText,
  medicationTodayText,
} from '@/lib/finance-emergency-summary-text.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { occurredText } from './finance-incident-forms.ts'
import {
  actionFormSchema,
  summaryFormField,
  summaryFormSchema,
  summaryStateBadge,
  type ActionFormValues,
  type SummaryFormValues,
} from './finance-emergency-summary-forms.ts'
import { HealthAccessGate, useRememberHealthReason } from './FinanceHealthAccessReasonDialog.tsx'
import { FinanceStudentSearch } from './FinanceStudentSearch.tsx'

const NO_SORT: readonly string[] = []
const STATE_FILTERS = [
  {
    key: 'state',
    label: 'Durum',
    type: 'select' as const,
    options: EMERGENCY_SUMMARY_STATES.map((value) => ({
      value,
      label: EMERGENCY_SUMMARY_STATE_LABELS[value],
    })),
  },
]
const summaryScope = (summaryId: string) => `emergency-summary:${summaryId}`
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * Acil durum özetleri (DOM-FIN-155; ON-165; K-520…K-522): Finans "Acil durum özetleri" sekmesi.
 * Yönetici özeti yazar, onaylar ve arşivler; yönetici ve ön büro sınıf kartlarını açar ve sınıf
 * PDF'ini indirir. Kart yalnız onaylı metni, uyarı türünü (tanısız), bugünkü ilacı ve maskeli acil
 * iletişimi gösterir; tam telefon tek tıkla açılır. Her açılış sunucuda denetime düşer. Öğretmenin
 * kendi sınıfı ekranı platform tarafındadır; uçlar hazırdır.
 */
export function FinanceEmergencySummariesSection({ isManager }: { isManager: boolean }) {
  return (
    <section
      aria-labelledby="acil-durum"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-1 px-6 pt-6 pb-2">
        <h2 id="acil-durum" className="text-lg font-semibold">
          Acil durum özetleri
        </h2>
        <p className="text-sm text-muted-foreground">
          Öğretmenin ve nöbetteki personelin acil anda göreceği kısa özet. Tanı yazılmaz; her açılış
          kayda geçer.
        </p>
      </header>
      <div className="grid gap-8 px-6 pb-6">
        <ClassCards />
        {isManager ? <Summaries /> : null}
      </div>
    </section>
  )
}

// --- Sınıf kartları ------------------------------------------------------------------------------

function ClassCards() {
  const { session } = useAuth()
  const learner = useEnrollmentLearner()
  const classes = useEmergencyClasses()
  const load = useLoadEmergencyClassCards()
  const [classId, setClassId] = useState('')
  const [list, setList] = useState<EmergencyClassCards | null>(null)
  const [printing, setPrinting] = useState(false)
  const options = classes.data?.data ?? []
  const busy = load.isPending || printing

  async function show() {
    const outcome = await load.submit({ classId, purpose: 'view' })
    if (outcome.status === 'success') setList(outcome.data.data)
  }

  async function print() {
    setPrinting(true)
    try {
      const outcome = await load.submit({ classId, purpose: 'print' })
      if (outcome.status !== 'success') return
      const data = outcome.data.data
      const [{ renderPdf }, template] = await Promise.all([
        import('@/lib/pdf/render.ts'),
        import('@/lib/pdf/templates/finance-emergency-summaries.ts'),
      ])
      const { blob } = await renderPdf((measurer) =>
        template.emergencySummariesDocument(measurer, data, {
          institution: session?.institution.name ?? 'Kampüs',
          generatedAt: new Date(),
          learnerTitle: learner.title,
        }),
      )
      saveBlob(blob, template.emergencySummariesFilename(data))
      notify.success('Sınıfın acil durum özetleri PDF olarak indirildi.')
    } catch (error) {
      console.error('[kampus]', 'pdf', error)
      notify.error('Acil durum özetleri PDF’i hazırlanamadı. Lütfen tekrar deneyin.')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <section aria-labelledby="acil-durum-sinif" className="grid gap-3">
      <h3 id="acil-durum-sinif" className="text-base font-semibold">
        Sınıf kartları
      </h3>
      {classes.error ? (
        <QueryError error={classes.error} onRetry={() => void classes.refetch()} />
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-2">
          <Label htmlFor="acil-durum-sinif-secimi">Sınıf</Label>
          <NativeSelect
            id="acil-durum-sinif-secimi"
            value={classId}
            disabled={busy}
            onChange={(event) => {
              setClassId(event.target.value)
              setList(null)
            }}
          >
            <NativeSelectOption value="">Sınıf seçin</NativeSelectOption>
            {options.map((item) => (
              <NativeSelectOption key={item.classId} value={item.classId}>
                {`${item.className} (${String(item.summaryCount)} özet)`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button
          className="min-h-11"
          disabled={classId === '' || busy}
          aria-busy={load.isPending || undefined}
          onClick={() => void show()}
        >
          Kartları göster
        </Button>
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={classId === '' || busy}
          aria-busy={printing || undefined}
          onClick={() => void print()}
        >
          <Icon name="Printer" size={17} aria-hidden="true" />
          Sınıf PDF’i
        </Button>
      </div>
      {list === null ? null : list.cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu sınıfta onaylanmış acil durum özeti yok.</p>
      ) : (
        <ul aria-label={`${list.className} acil durum kartları`} className="grid gap-3">
          {list.cards.map((card) => (
            <CardItem key={card.summaryId} card={card} />
          ))}
        </ul>
      )}
    </section>
  )
}

function CardItem({ card }: { card: EmergencyCard }) {
  const reveal = useRevealEmergencyContact()
  // Tam telefon yalnız bu bileşenin belleğinde kalır (önbellek, adres ve depo yok).
  const [phones, setPhones] = useState<ReadonlyMap<number, string>>(() => new Map())
  async function open(position: number) {
    const outcome = await reveal.submit({ studentId: card.studentId, position })
    if (outcome.status === 'success')
      setPhones((current) => new Map(current).set(position, outcome.data.data.phone))
  }
  return (
    <li className="grid gap-2 border-b pb-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{card.studentName}</span>
        {card.className === null ? null : (
          <span className="text-muted-foreground">{card.className}</span>
        )}
        {card.needsReview ? <StatusBadge text="Gözden geçiriliyor" tone="amber" /> : null}
      </div>
      <p className="whitespace-pre-wrap">{card.actionText}</p>
      <p className="text-muted-foreground">{`${alertText(card)} · ${medicationTodayText(card)}`}</p>
      {card.contacts.length === 0 ? (
        <p className="text-muted-foreground">Acil iletişim kişisi yok.</p>
      ) : (
        <ul aria-label={`${card.studentName} acil iletişim`} className="grid gap-1">
          {card.contacts.map((contact) => {
            const phone = phones.get(contact.position)
            return (
              <li key={contact.position} className="flex flex-wrap items-center gap-2">
                <span>{contactText(contact, phone)}</span>
                {contact.hasPhone && phone === undefined ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11"
                    disabled={reveal.isPending}
                    aria-label={`${card.studentName} için ${contact.name ?? 'veli'} telefonunu göster`}
                    onClick={() => void open(contact.position)}
                  >
                    Telefonu göster
                  </Button>
                ) : null}
                {phone === undefined ? null : (
                  <a className="underline" href={`tel:${phone.replace(/\s/g, '')}`}>
                    Ara
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

// --- Yönetim -------------------------------------------------------------------------------------

type SummaryTableRow = { id: string; row: EmergencySummaryRow; student: string; group: string }

function Summaries() {
  const panel = useDetailPanel('acil')
  const rememberReason = useRememberHealthReason()
  const [creating, setCreating] = useState(false)
  const list = useListState('acil-durum-ozetleri', { urlPrefix: 'acil_' })
  const state = EMERGENCY_SUMMARY_STATES.find((value) => value === text(list.state.filters.state))
  const q = list.state.query.trim()
  const summaries = useEmergencySummaries({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(state === undefined ? {} : { state }),
    ...(q === '' ? {} : { q }),
  })
  const rows = useMemo(
    () =>
      summaries.data?.data.map((item): SummaryTableRow => ({
        id: item.id,
        row: item,
        student: item.studentName ?? '—',
        group: item.className ?? '—',
      })),
    [summaries.data],
  )
  const columns = useMemo<DataColumn<SummaryTableRow>[]>(
    () => [
      { key: 'student', label: 'Öğrenci' },
      { key: 'group', label: 'Sınıf' },
      {
        key: 'state',
        label: 'Durum',
        cell: (row) => {
          const badge = summaryStateBadge(row.row)
          return <StatusBadge text={badge.text} tone={badge.tone} />
        },
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.student} acil durum özetini aç`}
            onClick={() => panel.open(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [panel],
  )
  return (
    <section aria-labelledby="acil-durum-yonetim" className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="acil-durum-yonetim" className="text-base font-semibold">
          Özetler
        </h3>
        <Button className="min-h-11" onClick={() => setCreating(true)}>
          Yeni özet
        </Button>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={summaries.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={STATE_FILTERS}
        mobileColumns={['student', 'state']}
        caption="Acil durum özetleri"
        empty="Henüz acil durum özeti yok."
        emptyFiltered="Bu süzgece uyan özet yok."
        loading={summaries.isPending}
        fetching={summaries.isFetching && !summaries.isPending}
        error={
          summaries.error ? (
            <QueryError error={summaries.error} onRetry={() => void summaries.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Acil durum özeti"
      >
        {panel.selectedId ? (
          <HealthAccessGate
            key={panel.selectedId}
            scope={summaryScope(panel.selectedId)}
            subject="Acil durum özeti"
            askOnOpen
          >
            {(reason) => (
              <SummaryPanel summaryId={panel.selectedId} reason={reason} onArchived={panel.close} />
            )}
          </HealthAccessGate>
        ) : null}
      </SidePanel>
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni acil durum özeti"
        description="Özet onaylanana kadar öğretmenlere görünmez. Tanı ya da ilaç adı yazmayın; acil anda ne yapılacağını yazın."
      >
        {creating ? (
          <CreateForm
            onDone={(id) => {
              setCreating(false)
              if (!id) return
              // Özeti yazan kişinin amacı bellidir: ayrıntı açılınca gerekçe yeniden sorulmaz.
              rememberReason(summaryScope(id), EMERGENCY_CARD_DEFAULT_REASON)
              panel.open(id)
            }}
          />
        ) : null}
      </Modal>
    </section>
  )
}

function CreateForm({ onDone }: { onDone: (id?: string) => void }) {
  const create = useCreateEmergencySummary()
  const form = useForm<SummaryFormValues>({
    resolver: zodResolver(summaryFormSchema),
    defaultValues: { studentId: '', actionText: '' },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(
      { studentId: values.studentId, actionText: values.actionText },
      {
        setError: (name, error) => {
          const field = summaryFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Acil durum özeti kaydedildi; onaylanınca görünür.')
    onDone(outcome.data.data.id)
  })
  return (
    <form
      noValidate
      aria-label="Yeni acil durum özeti"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <Controller
        control={form.control}
        name="studentId"
        render={({ field }) => (
          <FinanceStudentSearch
            label="Öğrenci"
            value={field.value}
            onChange={field.onChange}
            error={errors.studentId?.message}
            disabled={busy}
          />
        )}
      />
      <FormField
        id="acil-eylem-yeni"
        label="Acil eylem"
        error={errors.actionText}
        description="Örnek: Arı sokmasında adrenalin kalem çantada; 112 ara."
      >
        {(control) => (
          <Textarea {...control} {...form.register('actionText')} rows={3} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <Button
        type="submit"
        className="min-h-11 justify-self-start"
        disabled={busy}
        aria-busy={busy || undefined}
      >
        Özeti kaydet
      </Button>
    </form>
  )
}

function SummaryPanel({
  summaryId,
  reason,
  onArchived,
}: {
  summaryId: string
  reason: HealthAccessReason
  onArchived: () => void
}) {
  const summary = useEmergencySummary(summaryId, reason)
  if (summary.error)
    return <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
  const detail = summary.data?.data
  if (!detail) return <SummaryLoading />
  return <SummaryDetails key={detail.version} detail={detail} onArchived={onArchived} />
}

function SummaryDetails({
  detail,
  onArchived,
}: {
  detail: EmergencySummaryDetail
  onArchived: () => void
}) {
  const update = useUpdateEmergencySummary()
  const approve = useApproveEmergencySummary()
  const archive = useArchiveEmergencySummary()
  const badge = summaryStateBadge(detail)
  const form = useForm<ActionFormValues>({
    resolver: zodResolver(actionFormSchema),
    defaultValues: { actionText: detail.draftText ?? detail.publishedText ?? '' },
  })
  const errors = form.formState.errors
  const busy = update.isPending || approve.isPending || archive.isPending
  const canApprove = detail.draftText !== null || detail.needsReview
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await update.submit(
      { summaryId: detail.id, version: detail.version, actionText: values.actionText },
      {
        setError: (name, error) => {
          if (name === 'actionText') form.setError('actionText', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success('Değişiklik kaydedildi; onay bekliyor.')
  })
  const facts: [string, string][] = [
    ['Öğrenci', detail.studentName ?? '—'],
    ['Sınıf', detail.className ?? '—'],
    ['Yayındaki metin', detail.publishedText ?? 'Henüz onaylanmadı'],
    ['Onay bekleyen metin', detail.draftText ?? '—'],
    ['Uyarı', alertText(detail)],
    ['İlaç', medicationTodayText(detail)],
    [
      'Acil iletişim',
      detail.contacts.length === 0 ? '—' : detail.contacts.map((c) => contactText(c)).join('; '),
    ],
    ['Profildeki acil talimat', detail.profileInstructions ?? '—'],
    [
      'Son onay',
      detail.approvedAt === null
        ? '—'
        : `${occurredText(detail.approvedAt)}${detail.approvedByName ? ` · ${detail.approvedByName}` : ''}`,
    ],
  ]
  return (
    <div className="grid gap-4">
      <StatusBadge text={badge.text} tone={badge.tone} />
      {detail.needsReview ? (
        <p className="text-sm">
          Sağlık bilgisi onaydan sonra değişti. Metni gözden geçirip düzeltin ya da olduğu gibi
          yeniden onaylayın.
        </p>
      ) : null}
      <dl className="grid gap-2 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
      </dl>
      <form
        noValidate
        aria-label="Acil eylemi düzelt"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="acil-eylem-duzelt" label="Acil eylem" error={errors.actionText}>
          {(control) => (
            <Textarea {...control} {...form.register('actionText')} rows={3} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="secondary"
            className="min-h-11"
            disabled={busy}
            aria-busy={update.isPending || undefined}
          >
            Değişikliği kaydet
          </Button>
          {canApprove ? (
            <Button
              type="button"
              className="min-h-11"
              disabled={busy}
              aria-busy={approve.isPending || undefined}
              onClick={() =>
                void approve
                  .submit({ summaryId: detail.id, version: detail.version })
                  .then((outcome) => {
                    if (outcome.status === 'success') notify.success('Özet onaylandı ve yayında.')
                  })
              }
            >
              {detail.draftText === null ? 'Gözden geçirildi, onayla' : 'Onayla ve yayınla'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={busy}
            aria-busy={archive.isPending || undefined}
            onClick={() =>
              void archive
                .submit({ summaryId: detail.id, version: detail.version })
                .then((outcome) => {
                  if (outcome.status !== 'success') return
                  notify.success('Özet arşivlendi.')
                  onArchived()
                })
            }
          >
            Arşivle
          </Button>
        </div>
      </form>
    </div>
  )
}
