import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import type { z } from 'zod'
import { useEnrollProspect } from '@kampus/react-shared/use-prospect-commands.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { prospectStageLabel } from '@kampus/school-core/lib/prospects.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  useCoreAll,
  useCoreCounts,
  useCoreItem,
  type CoreRecord,
} from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import { studentCountsByClass } from '../management/management-rows.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  classOptions,
  ENROLL_LIMITS,
  enrollBody,
  enrollDefaults,
  enrollFieldOfCode,
  enrollFieldOfPath,
  enrollFormSchema,
  installmentPreview,
  parseLira,
  liraToCents,
  type EnrollField,
  type EnrollFormValues,
} from './enroll-forms.ts'
import { isOpenStage } from './prospect-rows.ts'

type Prospect = CoreRecord<'prospects'>

/** Kesin kayıt `crm` ve `finance` modüllerini ister (taksit ve sözleşme yazar, DOM-YTK-040). */
export const ENROLL_MODULES_CLOSED_MESSAGE =
  'Kesin kayıt için aday (CRM) ve finans modüllerinin açık olması gerekir. Modülleri yönetici Ayarlar sayfasından açar.'

/**
 * Kesin kayıt paneli (`?kayit=<adayId>`): Kayıt İşlemleri listesinden ve aday detayından aynı form
 * açılır (DOM-KAY-001, DOM-KAY-011, DOM-KAY-035). Aday kartı panel açılırken okunur; yazma bu
 * kartın sürümüyle (`If-Match`) gider, araya giren değişiklik 409 verir ve kart tazelenir.
 */
export function EnrollPanel({ prospectId, onClose }: { prospectId: string; onClose: () => void }) {
  return (
    <SidePanel
      open={prospectId !== ''}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Kesin kayıt"
      description="Öğrenci kaydı, sözleşme ve taksit planı tek işlemde oluşturulur."
    >
      {prospectId ? <PanelBody prospectId={prospectId} onClose={onClose} /> : null}
    </SidePanel>
  )
}

function PanelBody({ prospectId, onClose }: { prospectId: string; onClose: () => void }) {
  const item = useCoreItem('prospects', prospectId)
  const [created, setCreated] = useState<{ studentId: string; name: string } | null>(null)
  if (created) return <Success student={created} onClose={onClose} />
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  return (
    <EnrollForm
      prospect={item.data.record}
      version={item.data.version}
      onClose={onClose}
      onCreated={(studentId) => setCreated({ studentId, name: item.data.record.name })}
    />
  )
}

function Success({
  student,
  onClose,
}: {
  student: { studentId: string; name: string }
  onClose: () => void
}) {
  const { session } = useAuth()
  const role = session?.role ?? 'onburo'
  // Yönetici ve ön büro için ortak bir öğrenci sayfası yoktur: yönetici öğrenci özetini
  // (Risk Listesi çekmecesi), ön büro ödeme planını (Tahsilat Takibi) açar.
  // TODO(web-student-page): öğrenci profil sayfası React'e taşınınca doğrudan oraya bağlanır.
  const link =
    role === 'yonetici'
      ? {
          to: `/yonetici/risk-listesi?ogrenci=${encodeURIComponent(student.studentId)}`,
          label: 'Öğrenci özetini aç',
        }
      : { to: '/onburo/tahsilat-takip', label: 'Ödeme planını aç' }
  return (
    <div role="status" className="grid justify-items-start gap-4">
      <span className="grid size-12 place-items-center rounded-full bg-success-soft text-success">
        <Icon name="CircleCheck" size={26} aria-hidden="true" />
      </span>
      <h3 className="text-lg font-semibold">{student.name} öğrenci olarak kaydedildi</h3>
      <p className="text-sm text-muted-foreground">
        Öğrenci kaydı, sözleşmesi ve taksitleri ilgili ekranlara yansıdı; aday “Kayıt oldu”
        aşamasına geçti.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to={link.to}>
            <Icon name="ArrowRight" size={16} aria-hidden="true" />
            {link.label}
          </Link>
        </Button>
        <Button variant="outline" onClick={onClose}>
          Kapat
        </Button>
      </div>
    </div>
  )
}

function EnrollForm({
  prospect,
  version,
  onClose,
  onCreated,
}: {
  prospect: Prospect
  version: number
  onClose: () => void
  onCreated: (studentId: string) => void
}) {
  const { session } = useAuth()
  const type = session?.institution.type ?? 'school'
  const modulesOpen = session?.modules.crm === true && session.modules.finance === true
  const enroll = useEnrollProspect()
  const classes = useCoreAll('classes')
  const branches = useCoreAll('branches')
  const counts = useCoreCounts('students', { groupBy: 'classId', filters: { isActive: 'true' } })
  const [allCampuses, setAllCampuses] = useState(false)
  const form = useForm<EnrollFormValues, unknown, z.output<typeof enrollFormSchema>>({
    resolver: zodResolver(enrollFormSchema),
    defaultValues: enrollDefaults(),
  })
  const errors = form.formState.errors
  const busy = enroll.isPending || form.formState.isSubmitting
  const open = isOpenStage(prospect.stage)

  const branchNames = useMemo(
    () => new Map((branches.data ?? []).map((row) => [row.record.id, row.record.name])),
    [branches.data],
  )
  const occupancy = useMemo(
    () => (counts.data ? studentCountsByClass(counts.data) : new Map<string, number>()),
    [counts.data],
  )
  const options = useMemo(
    () =>
      classOptions(
        (classes.data ?? []).map((row) => row.record),
        occupancy,
        branchNames,
        prospect.branchId,
        allCampuses,
      ),
    [classes.data, occupancy, branchNames, prospect.branchId, allCampuses],
  )

  const [total, count] = useWatch({ control: form.control, name: ['total', 'count'] })
  const preview = useMemo(() => {
    const lira = parseLira(total)
    const installments = Number(count)
    return lira.ok && installments >= 1 && installments <= ENROLL_LIMITS.maxInstallments
      ? installmentPreview(liraToCents(lira.lira), installments)
      : null
  }, [total, count])

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await enroll.submit(
      { prospectId: prospect.id, version, body: enrollBody(values) },
      {
        setError: (name, error) => {
          const field: EnrollField | undefined = enrollFieldOfPath(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
        fieldFor: (error) => enrollFieldOfCode(error.code),
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Kesin kayıt, sözleşme ve taksit planı oluşturuldu.')
    onCreated(outcome.data.data.entity?.id ?? '')
  })

  if (classes.error)
    return <QueryError error={classes.error} onRetry={() => void classes.refetch()} />
  if (branches.error)
    return <QueryError error={branches.error} onRetry={() => void branches.refetch()} />
  if (counts.error) return <QueryError error={counts.error} onRetry={() => void counts.refetch()} />
  if (!classes.data || !branches.data || !counts.data) return <SummaryLoading />

  const stageLabel = prospectStageLabel(prospect.stage, type)
  const campus = branchNames.get(prospect.branchId) ?? '—'

  return (
    <form
      noValidate
      aria-label="Kesin kayıt"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <dl className="grid gap-1 rounded-card border bg-muted p-4 text-sm">
        <dt className="sr-only">Aday</dt>
        <dd className="font-semibold [overflow-wrap:anywhere]">{prospect.name}</dd>
        <dt className="sr-only">Kampüs ve program</dt>
        <dd className="text-muted-foreground">
          {campus} · {prospect.interest}
        </dd>
        <dt className="sr-only">Aşama</dt>
        <dd className="text-muted-foreground">Aşama: {stageLabel}</dd>
      </dl>
      {!open ? (
        <p role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
          {prospect.stage === 'Kayıt oldu'
            ? 'Bu adayın kesin kaydı zaten tamamlanmış.'
            : 'Yalnız açık aşamadaki aday kayda alınır; vazgeçen adayı önce “İletişime geçildi” aşamasıyla yeniden açın.'}
        </p>
      ) : null}
      {!modulesOpen ? (
        <p role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
          {ENROLL_MODULES_CLOSED_MESSAGE}
        </p>
      ) : null}
      <FormField id="kayit-sinif" label="Sınıf" error={errors.classId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('classId')}
            className="w-full"
            disabled={busy || !open}
          >
            <NativeSelectOption value="">
              {options.length === 0 ? 'Bu kampüste sınıf yok' : 'Sınıf seçin'}
            </NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="flex items-center gap-2.5">
        <Checkbox
          id="kayit-tum-kampusler"
          checked={allCampuses}
          onCheckedChange={(value) => setAllCampuses(value === true)}
          disabled={busy || !open}
        />
        <Label htmlFor="kayit-tum-kampusler" className="font-normal">
          Tüm kampüslerin sınıflarını göster
        </Label>
      </div>
      <FormField
        id="kayit-tutar"
        label="Toplam eğitim bedeli (₺)"
        description="Tam lira yazın (100 – 1.000.000 ₺); kuruş girilemez."
        error={errors.total}
      >
        {(control) => (
          <Input
            {...control}
            {...form.register('total')}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            disabled={busy || !open}
          />
        )}
      </FormField>
      <FormField id="kayit-taksit" label="Taksit sayısı" error={errors.count}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('count')}
            className="w-full"
            disabled={busy || !open}
          >
            {Array.from({ length: ENROLL_LIMITS.maxInstallments }, (_, index) => (
              <NativeSelectOption key={index} value={String(index + 1)}>
                {index === 0 ? 'Peşin (1 taksit)' : `${index + 1} taksit`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="kayit-ilk-vade"
        label="İlk vade"
        description="Sonraki taksitler her ay aynı günde vadelenir."
        error={errors.startDate}
      >
        {(control) => (
          <Input
            {...control}
            {...form.register('startDate')}
            type="date"
            disabled={busy || !open}
          />
        )}
      </FormField>
      {preview ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {preview.count === 1
            ? `Tek ödeme: ${money(preview.total)}`
            : `${preview.count} taksit · ilk taksit ${money(preview.first)}, son taksit ${money(preview.last)} · toplam ${money(preview.total)}`}
        </p>
      ) : null}
      <RootError message={errors.root?.server?.message} />
      <FormActions
        busy={busy}
        disabled={!open || !modulesOpen}
        onCancel={onClose}
        submitLabel="Kesin kaydı tamamla"
      />
    </form>
  )
}
