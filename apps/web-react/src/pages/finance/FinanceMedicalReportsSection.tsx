import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useCancelMedicalReport,
  useCreateMedicalReport,
  useMedicalReports,
  useMedicalReportSummary,
  useUpdateMedicalReport,
  type MedicalReport,
  type UpdateMedicalReportBody,
} from '@kampus/react-shared/use-finance-medical-reports.ts'
import {
  MEDICAL_REPORT_ISSUER_LABELS,
  MEDICAL_REPORT_ISSUERS,
  MEDICAL_REPORT_NOTES,
  MEDICAL_REPORT_STATE_LABELS,
  MEDICAL_REPORT_TYPE_LABELS,
  MEDICAL_REPORT_TYPES,
  medicalReportCancelSchema,
} from '@kampus/school-core/lib/finance-medical-reports.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { useOpenFile } from '../learning/SubmissionFiles.tsx'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { roleLabel } from './finance-fixed-asset-assignment-forms.ts'
import {
  byTypeText,
  flagsText,
  issuerText,
  medicalReportBody,
  medicalReportDefaults,
  medicalReportFormField,
  medicalReportFormSchema,
  monthToPeriod,
  reportPeriodText,
  reportTitle,
  type MedicalReportFormValues,
} from './finance-medical-report-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'days']
const STATUS_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'passive', label: 'Pasif (ayrılan)' },
]
const FILTERS = [
  { key: 'status', label: 'Personel durumu', type: 'select' as const, options: STATUS_OPTIONS },
]
const STATE_TONES = {
  scheduled: 'purple',
  ongoing: 'amber',
  ended: 'gray',
  cancelled: 'red',
} as const
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

type Row = {
  id: string
  name: string
  role: string
  days: string
  byType: string
  pending: string
}

/**
 * Sağlık raporları (DOM-FIN-110; ON-185): Finans "Sağlık raporları" sekmesi, yalnız yönetici
 * (K-363). Ay seçilir; tablo personel başına o aya düşen rapor gününü verir (bordro girdisi).
 * Personel panelinde raporlar, yeni rapor (tarih aralığı ve tür; tanı yok), SGK işaretleri,
 * dosyayı açma ve gerekçeli iptal bulunur. Sağlık verisi adrese ve kalıcı depoya yazılmaz.
 */
export function FinanceMedicalReportsSection() {
  const today = dayKey()
  const list = useListState('saglik-raporu', { urlPrefix: 'rapor_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [onlyWithReports, setOnlyWithReports] = useState(false)
  const period = monthToPeriod(month, today)
  const summary = useMedicalReportSummary({
    page: list.state.page,
    pageSize: list.state.pageSize,
    from: period.from,
    to: period.to,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === 'active' || status === 'passive' ? { status } : {}),
    ...(onlyWithReports ? { withReports: 'true' as const } : {}),
  })
  const panel = useDetailPanel('rapor_personel')
  const openPerson = panel.open
  const names = useMemo(
    () => new Map(summary.data?.data.map((item) => [item.membershipId, item]) ?? []),
    [summary.data],
  )
  const rows = useMemo(
    () =>
      summary.data?.data.map((item): Row => ({
        id: item.membershipId,
        name: item.active ? item.name : `${item.name} (pasif)`,
        role: roleLabel(item.role),
        days: `${String(item.totalDays)} gün`,
        byType: byTypeText(item.byType),
        pending:
          item.reportCount === 0
            ? '—'
            : `${String(item.awaitingNoticeCount)} bildirim · ${String(item.awaitingSgkCount)} SGK`,
      })),
    [summary.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: 'Ad' },
      { key: 'role', label: 'Rol' },
      { key: 'days', label: 'Rapor günü' },
      { key: 'byType', label: 'Türe göre' },
      { key: 'pending', label: 'Bekleyen işaret' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} sağlık raporlarını aç`}
            onClick={() => openPerson(row.id)}
          >
            Raporlar
          </Button>
        ),
      },
    ],
    [openPerson],
  )
  const selected = names.get(panel.selectedId)
  return (
    <section
      aria-labelledby="saglik-raporlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="saglik-raporlari" className="text-lg font-semibold">
            Sağlık raporları
          </h2>
          <p className="text-sm text-muted-foreground">
            Sağlık verisi özel niteliklidir: yalnız tarih aralığı ve rapor türü tutulur; her
            görüntüleme, değişiklik ve dosya açılışı denetim kaydına yazılır.
          </p>
        </div>
        <ul aria-label="Bilgi notları" className="grid list-disc gap-1 pl-5 text-sm">
          {MEDICAL_REPORT_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-3">
          <FormField id="rapor-donem" label="Dönem (ay)">
            {(control) => (
              <Input
                {...control}
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            )}
          </FormField>
          <Button
            variant="secondary"
            aria-pressed={onlyWithReports}
            onClick={() => setOnlyWithReports((value) => !value)}
          >
            Yalnız raporu olanlar
          </Button>
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={summary.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Dönemde personel rapor günleri"
        empty="Kurumda personel yok."
        emptyFiltered="Bu seçimle eşleşen personel yok."
        loading={summary.isPending}
        fetching={summary.isFetching && !summary.isPending}
        error={
          summary.error ? (
            <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Personel sağlık raporları"
      >
        {panel.selectedId ? (
          <StaffMedicalReports
            membershipId={panel.selectedId}
            name={selected?.name ?? ''}
            active={selected?.active ?? true}
          />
        ) : null}
      </SidePanel>
    </section>
  )
}

type Dialog = { kind: 'create' } | { kind: 'cancel'; report: MedicalReport } | null

function StaffMedicalReports({
  membershipId,
  name,
  active,
}: {
  membershipId: string
  name: string
  active: boolean
}) {
  const [cancelled, setCancelled] = useState(false)
  const reports = useMedicalReports({
    page: 1,
    pageSize: 100,
    membershipId,
    ...(cancelled ? { state: 'cancelled' as const } : {}),
  })
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => setDialog(null)
  if (reports.error)
    return <QueryError error={reports.error} onRetry={() => void reports.refetch()} />
  const items = reports.data?.data
  if (!items) return <SummaryLoading />
  const title = name || items[0]?.staffName || 'Personel'
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{title}</h3>
        {active ? null : <p className="text-sm text-muted-foreground">Pasif (ayrılan) personel</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDialog({ kind: 'create' })}>Rapor gir</Button>
        <Button
          variant="secondary"
          aria-pressed={cancelled}
          onClick={() => setCancelled((value) => !value)}
        >
          İptal edilenler
        </Button>
      </div>
      <section aria-labelledby="rapor-liste" className="grid gap-2">
        <h4 id="rapor-liste" className="text-sm font-semibold">
          {cancelled ? 'İptal edilen raporlar' : 'Raporlar'}
        </h4>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {cancelled ? 'İptal edilen rapor yok.' : 'Henüz rapor girilmedi.'}
          </p>
        ) : (
          <ul aria-label={cancelled ? 'İptal edilen raporlar' : 'Raporlar'} className="grid gap-2">
            {items.map((report) => (
              <ReportItem
                key={report.id}
                report={report}
                onCancel={() => setDialog({ kind: 'cancel', report })}
              />
            ))}
          </ul>
        )}
      </section>
      <Modal
        open={dialog?.kind === 'create'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Sağlık raporu gir"
        description={`${title} için istirahat raporu. Tanı, hastalık adı ya da ICD kodu girilmez.`}
      >
        {dialog?.kind === 'create' ? (
          <CreateForm membershipId={membershipId} onDone={close} />
        ) : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'cancel'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Sağlık raporunu iptal et"
      >
        {dialog?.kind === 'cancel' ? <CancelForm report={dialog.report} onDone={close} /> : null}
      </Modal>
    </div>
  )
}

/** Rapor satırı: tür, aralık, işaretler (K-365), dosya ve iptal. */
function ReportItem({ report, onCancel }: { report: MedicalReport; onCancel: () => void }) {
  const update = useUpdateMedicalReport()
  const files = useOpenFile()
  const open = report.state !== 'cancelled'
  const busy = update.isPending
  const change = async (body: UpdateMedicalReportBody, done: string) => {
    const outcome = await update.submit(
      { reportId: report.id, version: report.version, body },
      { setError: (_name, issue) => notify.error(issue.message) },
    )
    if (outcome.status === 'success') notify.success(done)
  }
  const issuer = issuerText(report)
  return (
    <li
      aria-label={`${reportTitle(report)}, ${reportPeriodText(report)}`}
      className="grid gap-1 rounded-sm border px-3 py-2 text-sm"
    >
      <span className="flex flex-wrap items-center gap-2 font-medium">
        {reportTitle(report)}
        <StatusBadge
          text={MEDICAL_REPORT_STATE_LABELS[report.state]}
          tone={STATE_TONES[report.state]}
        />
      </span>
      <span>{reportPeriodText(report)}</span>
      {issuer === null ? null : <span className="text-muted-foreground">{issuer}</span>}
      {open ? <span className="text-muted-foreground">{flagsText(report)}</span> : null}
      {report.cancelReason ? (
        <span className="text-muted-foreground [overflow-wrap:anywhere]">
          İptal gerekçesi: {report.cancelReason}
        </span>
      ) : null}
      {open ? (
        <span className="flex flex-wrap gap-2 pt-1">
          {report.employerNotifiedAt === null ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void change({ employerNotified: true }, 'İşverene bildirildi olarak işaretlendi.')
              }
            >
              İşverene bildirildi
            </Button>
          ) : report.sgkApprovedAt === null ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void change({ sgkApproved: true }, 'SGK onayı işaretlendi.')}
              >
                SGK sisteminde onaylandı
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void change({ employerNotified: false }, 'Bildirim işareti geri alındı.')
                }
              >
                Bildirimi geri al
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void change({ sgkApproved: false }, 'SGK onayı işareti geri alındı.')}
            >
              SGK onayını geri al
            </Button>
          )}
          {report.fileId === null ? null : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={files.opening !== ''}
                aria-busy={files.opening !== '' || undefined}
                onClick={() => {
                  if (report.fileId) void files.open(report.fileId)
                }}
              >
                <Icon name="FileText" size={16} aria-hidden="true" />
                Raporu aç
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void change({ fileId: null }, 'Rapor dosyası kaldırıldı.')}
              >
                Dosyayı kaldır
              </Button>
            </>
          )}
          <Button size="sm" variant="secondary" onClick={onCancel}>
            İptal et
          </Button>
        </span>
      ) : null}
    </li>
  )
}

/** Yeni rapor (K-363, K-364): tür, aralık, isteğe bağlı veren kurum türü ve dosya. */
function CreateForm({ membershipId, onDone }: { membershipId: string; onDone: () => void }) {
  const create = useCreateMedicalReport()
  const schema = useMemo(() => medicalReportFormSchema(membershipId), [membershipId])
  const form = useForm<MedicalReportFormValues>({
    resolver: zodResolver(schema),
    defaultValues: medicalReportDefaults(dayKey()),
  })
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const errors = form.formState.errors
  const saving = create.isPending || form.formState.isSubmitting
  const busy = saving || uploading
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(
      medicalReportBody(membershipId, values, files[0]?.id ?? null),
      {
        setError: (name, error) => {
          const field = medicalReportFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`Rapor kaydedildi (${String(outcome.data.data.dayCount)} gün).`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Sağlık raporu"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="rapor-tur" label="Rapor türü" error={errors.reportType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('reportType')}
            className="w-full"
            disabled={saving}
          >
            {MEDICAL_REPORT_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {MEDICAL_REPORT_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="rapor-veren" label="Veren kurum (isteğe bağlı)" error={errors.issuerType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('issuerType')}
            className="w-full"
            disabled={saving}
          >
            <NativeSelectOption value="">Belirtilmedi</NativeSelectOption>
            {MEDICAL_REPORT_ISSUERS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {MEDICAL_REPORT_ISSUER_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="rapor-baslangic" label="Başlangıç" error={errors.startDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('startDate')} disabled={saving} />
        )}
      </FormField>
      <FormField
        id="rapor-bitis"
        label="Bitiş"
        description="Bitiş günü dahildir; gün sayısı takvim günüdür."
        error={errors.endDate}
      >
        {(control) => (
          <Input {...control} type="date" {...form.register('endDate')} disabled={saving} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FileUploadField
          id="rapor-dosya"
          label="Rapor dosyası (isteğe bağlı)"
          purpose="document"
          description="Raporun PDF taraması; en çok 20 MB. Yalnız yöneticiler açar, her açılış kaydedilir."
          listLabel="Rapor dosyası"
          items={files}
          disabled={saving}
          onUploaded={(item) => setFiles([item])}
          onRemoved={() => setFiles([])}
          onBusyChange={setUploading}
          onBlockedChange={setScanBlocked}
        />
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy || scanBlocked} aria-busy={saving || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Gerekçeli iptal (K-364); dosyanın bağı kalkar (K-363). */
function CancelForm({ report, onDone }: { report: MedicalReport; onDone: () => void }) {
  const cancel = useCancelMedicalReport()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(medicalReportCancelSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { reportId: report.id, version: report.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Rapor iptal edildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="İptal gerekçesi"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">
        {reportTitle(report)} · {reportPeriodText(report)}
      </p>
      <FormField
        id="rapor-iptal"
        label="Gerekçe"
        description="Tanı ya da hastalık adı yazmayın."
        error={errors.reason}
      >
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
          İptal et
        </Button>
      </div>
    </form>
  )
}
