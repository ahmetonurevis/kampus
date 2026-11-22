import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import {
  useAddTripReportPhoto,
  useCreateTripReport,
  useRemoveTripReportPhoto,
  useTransitionTripReport,
  useTripReport,
  useUpdateTripReport,
  useUpdateTripReportPhoto,
  type TripReport,
  type TripReportOptions,
  type TripReportPhoto,
  type TripReportView,
} from '@kampus/react-shared/use-finance-trip-reports.ts'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  attendanceText,
  distributionRows,
  evaluationText,
  incidentLabel,
  PHOTO_VISIBILITY_VIEW,
  photoBody,
  photoChanges,
  photoDefaults,
  photoFormSchema,
  REPORT_STATUS_VIEW,
  reportChanges,
  reportDefaults,
  reportFormSchema,
  reportMeta,
  returnFormSchema,
  type PhotoFormValues,
  type ReportFormValues,
  type ReturnFormValues,
} from './finance-trip-report-forms.ts'

/**
 * Gezi planının "Gezi raporu" görünümü (DOM-FIN-158; ON-158; K-529…K-531; IST-017). Gezi bitince
 * planın görevlisi öğretmen ya da yönetici gerçekleşme özeti, olay notu (kaza tutanağı bağı) ve
 * kazanım metnini yazar, onaya gönderir; yönetici onaylar ya da gerekçeyle iade eder. Fotoğrafta
 * görünen öğrenciler etiketlenir; rıza rozeti etiketli öğrencinin geçerli fotoğraf rızasını gösterir
 * ve yayım okuma anında hesaplanır: rızası olmayan öğrencinin fotoğrafı iç arşivde kalır.
 * Katılım gezi günü yoklamasındandır; değerlendirme özeti 5'ten az yanıtta gizlidir.
 */
export function FinanceTripReportView({ planId }: { planId: string }) {
  const view = useTripReport(planId)
  if (view.error) return <QueryError error={view.error} onRetry={() => void view.refetch()} />
  const data = view.data?.data
  if (!data) return <SummaryLoading />
  return <TripReportDetails view={data} />
}

function TripReportDetails({ view }: { view: TripReportView }) {
  const report = view.report
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">Gezi raporu</h3>
        <StatusBadge
          text={REPORT_STATUS_VIEW[report?.status ?? 'missing'].label}
          tone={REPORT_STATUS_VIEW[report?.status ?? 'missing'].tone}
        />
      </div>
      <p className="text-sm text-muted-foreground">{attendanceText(view.attendance)}</p>
      {report === null ? <ReportStart view={view} /> : <ReportBody view={view} report={report} />}
      <EvaluationSummary view={view} />
    </div>
  )
}

function ReportStart({ view }: { view: TripReportView }) {
  const create = useCreateTripReport()
  if (!view.tripFinished)
    return (
      <p role="status" className="rounded-card border bg-secondary p-3 text-sm">
        Rapor gezi bittikten sonra yazılır.
      </p>
    )
  if (!view.canCreate)
    return <p className="text-sm text-muted-foreground">Bu gezi için henüz rapor yazılmadı.</p>
  const start = async () => {
    const outcome = await create.submit({ planId: view.plan.id, body: {} })
    if (outcome.status === 'success') notify.success('Rapor taslağı açıldı.')
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        className="min-h-11"
        disabled={create.isPending}
        aria-busy={create.isPending || undefined}
        onClick={() => void start()}
      >
        <Icon name="FileText" size={17} aria-hidden="true" />
        Raporu yazmaya başla
      </Button>
    </div>
  )
}

function ReportBody({ view, report }: { view: TripReportView; report: TripReport }) {
  return (
    <div className="grid gap-5">
      <ul className="grid gap-1 text-sm text-muted-foreground">
        {reportMeta(report).map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
      {report.status === 'returned' && report.returnReason !== null ? (
        <p role="status" className="rounded-card border bg-secondary p-3 text-sm">
          İade gerekçesi: {report.returnReason}
        </p>
      ) : null}
      {report.canEdit && view.options !== null ? (
        <ReportForm view={view} report={report} options={view.options} />
      ) : (
        <ReportText report={report} />
      )}
      {report.canDecide ? <DecisionActions view={view} report={report} /> : null}
      <PhotoSection view={view} report={report} />
    </div>
  )
}

function ReportText({ report }: { report: TripReport }) {
  const rows = [
    ['Gerçekleşme özeti', report.summary],
    ['Olaylar', report.incidentNote],
    ['Kazanımlar ve değerlendirme', report.outcomeNote],
  ] as const
  return (
    <dl className="grid gap-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1">
          <dt className="font-medium">{label}</dt>
          <dd className="whitespace-pre-line text-muted-foreground">{value ?? '—'}</dd>
        </div>
      ))}
      <div className="grid gap-1">
        <dt className="font-medium">Kaza tutanakları</dt>
        <dd className="text-muted-foreground">
          {report.incidents.length === 0
            ? 'Bağlı tutanak yok.'
            : report.incidents.map((incident) => incidentLabel(incident)).join('; ')}
        </dd>
      </div>
    </dl>
  )
}

function ReportForm({
  view,
  report,
  options,
}: {
  view: TripReportView
  report: TripReport
  options: TripReportOptions
}) {
  const update = useUpdateTripReport()
  const transition = useTransitionTripReport()
  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportFormSchema),
    defaultValues: reportDefaults(report),
  })
  const errors = form.formState.errors
  const selected = useWatch({ control: form.control, name: 'incidentIds' })
  const busy = update.isPending || transition.isPending || form.formState.isSubmitting
  const fields = {
    setError: (name: string, error: { type: string; message: string }) =>
      name === 'summary' || name === 'incidentNote' || name === 'outcomeNote'
        ? form.setError(name, error, { shouldFocus: true })
        : form.setError('root.server', error),
  }
  /** Değişiklik varsa kaydeder; sonraki adım için güncel sürümü döner (başarısızsa `null`). */
  const save = async (values: ReportFormValues): Promise<number | null> => {
    const changes = reportChanges(report, values)
    if (changes === null) return report.version
    const outcome = await update.submit(
      { planId: view.plan.id, version: report.version, body: changes },
      fields,
    )
    if (outcome.status !== 'success') return null
    return outcome.data.data.report?.version ?? null
  }
  const onSave = form.handleSubmit(async (values) => {
    if (reportChanges(report, values) === null) {
      notify.success('Değişiklik yok.')
      return
    }
    if ((await save(values)) !== null) notify.success('Rapor kaydedildi.')
  })
  const onSubmit = form.handleSubmit(async (values) => {
    const version = await save(values)
    if (version === null) return
    const outcome = await transition.submit(
      { planId: view.plan.id, version, transition: 'submit' },
      fields,
    )
    if (outcome.status === 'success') notify.success('Rapor onaya gönderildi.')
  })
  const toggle = (id: string, checked: boolean) =>
    form.setValue(
      'incidentIds',
      checked ? [...selected, id] : selected.filter((value) => value !== id),
    )
  return (
    <form
      noValidate
      aria-label="Gezi raporu"
      className="grid gap-3"
      onSubmit={(event) => void onSave(event)}
    >
      <RootError message={errors.root?.server?.message} />
      <FormField id="rapor-ozet" label="Gerçekleşme özeti" error={errors.summary}>
        {(control) => (
          <Textarea {...control} {...form.register('summary')} rows={4} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="rapor-olay"
        label="Olaylar (isteğe bağlı)"
        description="Kaza ve yaralanma ayrıntısı kaza tutanağına yazılır; burada yalnız kısa not."
        error={errors.incidentNote}
      >
        {(control) => (
          <Textarea {...control} {...form.register('incidentNote')} rows={2} disabled={busy} />
        )}
      </FormField>
      {options.incidents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Gezi süresinde yazılmış kaza tutanağı yok.</p>
      ) : (
        <FieldSet className="gap-1">
          <FieldLegend variant="label" className="text-sm font-medium">
            Kaza tutanakları
          </FieldLegend>
          <ul className="grid gap-0 rounded-card border">
            {options.incidents.map((incident) => {
              const id = `rapor-tutanak-${incident.id}`
              return (
                <li key={incident.id}>
                  <label
                    htmlFor={id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      id={id}
                      checked={selected.includes(incident.id)}
                      onCheckedChange={(value) => toggle(incident.id, value === true)}
                      disabled={busy}
                    />
                    {incidentLabel(incident)}
                  </label>
                </li>
              )
            })}
          </ul>
        </FieldSet>
      )}
      <FormField id="rapor-kazanim" label="Kazanımlar ve değerlendirme" error={errors.outcomeNote}>
        {(control) => (
          <Textarea {...control} {...form.register('outcomeNote')} rows={4} disabled={busy} />
        )}
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="outline"
          className="min-h-11"
          disabled={busy}
          aria-busy={update.isPending || undefined}
        >
          Kaydet
        </Button>
        <Button
          type="button"
          className="min-h-11"
          disabled={busy}
          aria-busy={transition.isPending || undefined}
          onClick={(event) => void onSubmit(event)}
        >
          <Icon name="Send" size={17} aria-hidden="true" />
          Onaya gönder
        </Button>
      </div>
    </form>
  )
}

function DecisionActions({ view, report }: { view: TripReportView; report: TripReport }) {
  const transition = useTransitionTripReport()
  const [returning, setReturning] = useState(false)
  const approve = async () => {
    const outcome = await transition.submit({
      planId: view.plan.id,
      version: report.version,
      transition: 'approve',
    })
    if (outcome.status === 'success') notify.success('Rapor onaylandı.')
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        className="min-h-11"
        disabled={transition.isPending}
        aria-busy={transition.isPending || undefined}
        onClick={() => void approve()}
      >
        <Icon name="Check" size={17} aria-hidden="true" />
        Raporu onayla
      </Button>
      <Button variant="outline" className="min-h-11" onClick={() => setReturning(true)}>
        İade et
      </Button>
      <Modal open={returning} onOpenChange={setReturning} title="Raporu iade et">
        {returning ? (
          <ReturnForm view={view} report={report} onDone={() => setReturning(false)} />
        ) : null}
      </Modal>
    </div>
  )
}

function ReturnForm({
  view,
  report,
  onDone,
}: {
  view: TripReportView
  report: TripReport
  onDone: () => void
}) {
  const transition = useTransitionTripReport()
  const form = useForm<ReturnFormValues>({
    resolver: zodResolver(returnFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = transition.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await transition.submit(
      {
        planId: view.plan.id,
        version: report.version,
        transition: 'return',
        reason: returnFormSchema.parse(values).reason,
      },
      {
        setError: (name, error) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Rapor iade edildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Raporu iade et"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <RootError message={errors.root?.server?.message} />
      <FormField id="rapor-iade" label="İade gerekçesi" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
        )}
      </FormField>
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        İade et
      </Button>
    </form>
  )
}

// --- Fotoğraf ------------------------------------------------------------------------------------

function PhotoSection({ view, report }: { view: TripReportView; report: TripReport }) {
  const [adding, setAdding] = useState(false)
  const editable = report.canEdit && view.options !== null
  return (
    <section aria-labelledby="rapor-fotograflar" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="rapor-fotograflar" className="text-sm font-semibold">
          Fotoğraflar
        </h4>
        {editable ? (
          <Button variant="outline" className="min-h-11" onClick={() => setAdding(true)}>
            <Icon name="Upload" size={17} aria-hidden="true" />
            Fotoğraf ekle
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Fotoğraf ailelere yalnız rapor onaylıyken ve etiketli her öğrencinin geçerli fotoğraf
        paylaşım rızası varken açılır; rıza geri çekilirse fotoğraf yayından düşer.
      </p>
      {report.photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz fotoğraf yok.</p>
      ) : (
        <ul aria-label="Rapor fotoğrafları" className="grid gap-4 sm:grid-cols-2">
          {report.photos.map((photo, index) => (
            <li key={photo.id}>
              <PhotoCard view={view} photo={photo} index={index} editable={editable} />
            </li>
          ))}
        </ul>
      )}
      <Modal open={adding} onOpenChange={setAdding} title="Fotoğraf ekle" size="wide">
        {adding && view.options !== null ? (
          <PhotoAddForm view={view} options={view.options} onDone={() => setAdding(false)} />
        ) : null}
      </Modal>
    </section>
  )
}

function PhotoCard({
  view,
  photo,
  index,
  editable,
}: {
  view: TripReportView
  photo: TripReportPhoto
  index: number
  editable: boolean
}) {
  const remove = useRemoveTripReportPhoto()
  const [editing, setEditing] = useState(false)
  const visibility = PHOTO_VISIBILITY_VIEW[photo.visibility]
  const label = photo.caption ?? `Fotoğraf ${String(index + 1)}`
  const onRemove = async () => {
    const outcome = await remove.submit({
      planId: view.plan.id,
      photoId: photo.id,
      version: photo.version,
    })
    if (outcome.status === 'success') notify.success('Fotoğraf kaldırıldı.')
  }
  return (
    <article aria-label={label} className="grid gap-2 rounded-card border p-3">
      {photo.url === null ? (
        <p className="grid aspect-video place-items-center rounded-sm border text-sm text-muted-foreground">
          Önizleme yok
        </p>
      ) : (
        <img
          src={photo.url}
          alt={label}
          loading="lazy"
          className="aspect-video w-full rounded-sm object-cover"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        <StatusBadge text={visibility.label} tone={visibility.tone} />
      </div>
      {photo.noStudentsVisible ? (
        <p className="text-sm text-muted-foreground">Öğrenci görünmüyor.</p>
      ) : (
        <ul aria-label="Etiketli öğrenciler" className="flex flex-wrap gap-1">
          {photo.students.map((student) => (
            <li key={student.studentId}>
              <StatusBadge
                text={`${student.studentName}: ${student.consent ? 'rıza var' : 'rıza yok'}`}
                tone={student.consent ? 'green' : 'amber'}
              />
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => setEditing(true)}>
            Etiketleri düzenle
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={remove.isPending}
            aria-busy={remove.isPending || undefined}
            onClick={() => void onRemove()}
          >
            Kaldır
          </Button>
        </div>
      ) : null}
      <Modal open={editing} onOpenChange={setEditing} title="Etiketleri düzenle" size="wide">
        {editing && view.options !== null ? (
          <PhotoEditForm
            view={view}
            photo={photo}
            options={view.options}
            onDone={() => setEditing(false)}
          />
        ) : null}
      </Modal>
    </article>
  )
}

function PhotoAddForm({
  view,
  options,
  onDone,
}: {
  view: TripReportView
  options: TripReportOptions
  onDone: () => void
}) {
  const add = useAddTripReportPhoto()
  const [items, setItems] = useState<FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const form = useForm<PhotoFormValues>({
    resolver: zodResolver(photoFormSchema),
    defaultValues: photoDefaults(),
  })
  const busy = add.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const fileId = items[0]?.id
    if (fileId === undefined) {
      form.setError('root.server', { type: 'manual', message: 'Önce fotoğrafı yükleyin.' })
      return
    }
    const outcome = await add.submit(
      { planId: view.plan.id, body: { fileId, ...photoBody(values) } },
      { setError: (_name, error) => form.setError('root.server', error) },
    )
    if (outcome.status !== 'success') return
    notify.success('Fotoğraf eklendi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Fotoğraf ekle"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <RootError message={form.formState.errors.root?.server?.message} />
      <FileUploadField
        id="rapor-fotograf-dosyasi"
        label="Fotoğraf"
        purpose="question_image"
        description="JPG, PNG ya da WEBP, en çok 2 MB."
        listLabel="Eklenecek fotoğraf"
        items={items}
        disabled={busy}
        onUploaded={(item) => setItems([item])}
        onRemoved={(id) => setItems((current) => current.filter((file) => file.id !== id))}
        onBusyChange={setUploading}
        onBlockedChange={setBlocked}
      />
      <PhotoFields form={form} options={options} busy={busy} />
      <Button
        type="submit"
        className="min-h-11"
        disabled={busy || uploading || blocked || items.length === 0}
        aria-busy={busy || undefined}
      >
        Fotoğrafı ekle
      </Button>
    </form>
  )
}

function PhotoEditForm({
  view,
  photo,
  options,
  onDone,
}: {
  view: TripReportView
  photo: TripReportPhoto
  options: TripReportOptions
  onDone: () => void
}) {
  const update = useUpdateTripReportPhoto()
  const form = useForm<PhotoFormValues>({
    resolver: zodResolver(photoFormSchema),
    defaultValues: photoDefaults(photo),
  })
  const busy = update.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const changes = photoChanges(photo, values)
    if (changes !== null) {
      const outcome = await update.submit(
        { planId: view.plan.id, photoId: photo.id, version: photo.version, body: changes },
        { setError: (_name, error) => form.setError('root.server', error) },
      )
      if (outcome.status !== 'success') return
      notify.success('Fotoğraf güncellendi.')
    }
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Etiketleri düzenle"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <RootError message={form.formState.errors.root?.server?.message} />
      <PhotoFields form={form} options={options} busy={busy} />
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Kaydet
      </Button>
    </form>
  )
}

/** Açıklama, öğrenci etiketleri (rıza rozetiyle), "öğrenci görünmüyor" ve yayım isteği. */
function PhotoFields({
  form,
  options,
  busy,
}: {
  form: UseFormReturn<PhotoFormValues>
  options: TripReportOptions
  busy: boolean
}) {
  const errors = form.formState.errors
  const selected = useWatch({ control: form.control, name: 'studentIds' })
  const none = useWatch({ control: form.control, name: 'noStudentsVisible' })
  const share = useWatch({ control: form.control, name: 'shareWithFamilies' })
  const toggle = (studentId: string, checked: boolean) =>
    form.setValue(
      'studentIds',
      checked ? [...selected, studentId] : selected.filter((id) => id !== studentId),
      { shouldValidate: form.formState.isSubmitted },
    )
  return (
    <>
      <FormField
        id="rapor-fotograf-aciklama"
        label="Açıklama (isteğe bağlı)"
        error={errors.caption}
      >
        {(control) => <Input {...control} {...form.register('caption')} disabled={busy} />}
      </FormField>
      <label
        htmlFor="rapor-fotograf-ogrencisiz"
        className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
      >
        <Checkbox
          id="rapor-fotograf-ogrencisiz"
          checked={none}
          onCheckedChange={(value) =>
            form.setValue('noStudentsVisible', value === true, {
              shouldValidate: form.formState.isSubmitted,
            })
          }
          disabled={busy}
        />
        Öğrenci görünmüyor (manzara, eser)
      </label>
      {none ? null : (
        <FieldSet className="gap-1">
          <FieldLegend variant="label" className="text-sm font-medium">
            Fotoğrafta görünen öğrenciler
          </FieldLegend>
          {errors.studentIds?.message === undefined ? null : (
            <p role="alert" className="text-sm text-destructive">
              {errors.studentIds.message}
            </p>
          )}
          <ul className="grid max-h-72 gap-0 overflow-y-auto rounded-card border">
            {options.students.map((student) => {
              const id = `rapor-etiket-${student.studentId}`
              return (
                <li key={student.studentId}>
                  <label
                    htmlFor={id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      id={id}
                      checked={selected.includes(student.studentId)}
                      onCheckedChange={(value) => toggle(student.studentId, value === true)}
                      disabled={busy}
                    />
                    <span className="grid">
                      <span>{student.studentName}</span>
                      <span className="text-muted-foreground">
                        {[student.className, student.consent ? 'Rıza var' : 'Rıza yok']
                          .filter((part) => part !== null)
                          .join(' · ')}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {options.studentTotal > options.students.length ? (
            <p className="text-sm text-muted-foreground">
              İlk {String(options.students.length)} katılımcı gösteriliyor.
            </p>
          ) : null}
        </FieldSet>
      )}
      <label
        htmlFor="rapor-fotograf-yayim"
        className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
      >
        <Checkbox
          id="rapor-fotograf-yayim"
          checked={share}
          onCheckedChange={(value) => form.setValue('shareWithFamilies', value === true)}
          disabled={busy}
        />
        Onaydan sonra ailelerle paylaş (rızası olmayan öğrenci varsa iç arşivde kalır)
      </label>
    </>
  )
}

// --- Değerlendirme -------------------------------------------------------------------------------

function EvaluationSummary({ view }: { view: TripReportView }) {
  const summary = view.evaluations
  const rows = distributionRows(summary.distribution)
  return (
    <section aria-labelledby="rapor-degerlendirme" className="grid gap-2">
      <h4 id="rapor-degerlendirme" className="text-sm font-semibold">
        Katılımcı değerlendirmesi
      </h4>
      <p className="text-sm text-muted-foreground">{evaluationText(summary)}</p>
      {rows.length === 0 ? null : (
        <ul aria-label="Puan dağılımı" className="grid gap-1 text-sm">
          {rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      )}
      {summary.comments === null || summary.comments.length === 0 ? null : (
        <ul aria-label="Yorumlar (adsız)" className="grid gap-2 text-sm">
          {summary.comments.map((comment, index) => (
            <li key={`${String(index)}-${comment}`} className="rounded-card border p-3">
              {comment}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
