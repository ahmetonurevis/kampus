import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  useChangeProfessionalDevelopmentStatus,
  useCreateProfessionalDevelopmentEnrollment,
  useCreateProfessionalDevelopmentProgram,
  useProfessionalDevelopmentEnrollments,
  useProfessionalDevelopmentPrograms,
  useUpdateProfessionalDevelopmentEnrollment,
  useUpdateProfessionalDevelopmentProgram,
  type ProfessionalDevelopmentEnrollment,
  type ProfessionalDevelopmentProgram,
} from '@kampus/react-shared/use-finance-professional-development.ts'
import {
  audienceLabel,
  hoursLabel,
  PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGIN_LABELS,
  PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGINS,
  PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUS_LABELS,
  PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES,
  PROFESSIONAL_DEVELOPMENT_KIND_LABELS,
  PROFESSIONAL_DEVELOPMENT_KINDS,
  PROFESSIONAL_DEVELOPMENT_STATUS_LABELS,
  PROFESSIONAL_DEVELOPMENT_STATUSES,
  type ProfessionalDevelopmentEnrollmentOrigin,
  type ProfessionalDevelopmentEnrollmentStatus,
  type ProfessionalDevelopmentKind,
  type ProfessionalDevelopmentStatus,
} from '@kampus/school-core/lib/finance-professional-development.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { staffOptionText } from './finance-staff-certificate-forms.ts'
import {
  capacityText,
  emptyProgramForm,
  parseDecimal,
  programBody,
  programDatesText,
  programFormField,
  programFormFrom,
  programFormSchema,
  type ProgramFormValues,
} from './finance-professional-development-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'status']
const FILTERS = [
  {
    key: 'kind',
    label: 'Tür',
    type: 'select' as const,
    options: PROFESSIONAL_DEVELOPMENT_KINDS.map((value) => ({
      value,
      label: PROFESSIONAL_DEVELOPMENT_KIND_LABELS[value],
    })),
  },
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: PROFESSIONAL_DEVELOPMENT_STATUSES.map((value) => ({
      value,
      label: PROFESSIONAL_DEVELOPMENT_STATUS_LABELS[value],
    })),
  },
]
const STATUS_TONES = { draft: 'amber', published: 'green', archived: 'gray' } as const
const ENROLLMENT_TONES = { assigned: 'purple', attended: 'green', not_completed: 'red' } as const
const STAFF_PAGE = { page: 1, pageSize: 100 } as const
const ENROLLMENT_PAGE = { page: 1, pageSize: 100 } as const

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isKind = (value: string | null): value is ProfessionalDevelopmentKind =>
  (PROFESSIONAL_DEVELOPMENT_KINDS as readonly (string | null)[]).includes(value)
const isStatus = (value: string | null): value is ProfessionalDevelopmentStatus =>
  (PROFESSIONAL_DEVELOPMENT_STATUSES as readonly (string | null)[]).includes(value)
const day = (value: string) => dateLabel(value, { year: 'numeric' })

type Row = {
  id: string
  name: string
  kind: string
  provider: string
  dates: string
  duration: string
  audience: string
  fee: string
  capacity: string
  program: ProfessionalDevelopmentProgram
}

/**
 * Mesleki gelişim kataloğu (DOM-FIN-125; ON-214): Finans "Mesleki gelişim" sekmesi. Yönetici
 * eğitim ekler, düzeltir, yayına alır, arşivler ve personel atar; ön büro yayındaki ve arşivdeki
 * eğitimleri ve katılımcılarını yalnız okur (K-430). Katılımcı penceresinde "katıldı" işareti ve
 * saat girilir (K-432); sertifika ayrı iştir.
 */
export function FinanceProfessionalDevelopmentSection({ canManage }: { canManage: boolean }) {
  const list = useListState('mesleki-gelisim', { urlPrefix: 'mg_' })
  const search = useDebouncedValue(list.state.query).trim()
  const kind = text(list.state.filters.kind)
  const status = text(list.state.filters.status)
  const programs = useProfessionalDevelopmentPrograms({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isKind(kind) ? { kind } : {}),
    ...(isStatus(status) ? { status } : {}),
  })
  const changeStatus = useChangeProfessionalDevelopmentStatus()
  const [editing, setEditing] = useState<ProfessionalDevelopmentProgram | 'new' | null>(null)
  const [roster, setRoster] = useState<ProfessionalDevelopmentProgram | null>(null)

  const rows = useMemo(
    () =>
      programs.data?.data.map((item): Row => ({
        id: item.id,
        name: item.name,
        kind: PROFESSIONAL_DEVELOPMENT_KIND_LABELS[item.kind],
        provider: item.provider,
        dates: programDatesText(item, day),
        duration: hoursLabel(item.durationHours),
        audience: audienceLabel(item),
        fee: item.feeCents === null ? '—' : money(item.feeCents),
        capacity: capacityText(item),
        program: item,
      })),
    [programs.data],
  )

  const columns = useMemo<DataColumn<Row>[]>(() => {
    const move = async (
      program: ProfessionalDevelopmentProgram,
      next: 'published' | 'archived',
    ) => {
      const outcome = await changeStatus.submit({
        programId: program.id,
        version: program.version,
        status: next,
      })
      if (outcome.status === 'success')
        notify.success(
          next === 'published' ? `${program.name} yayına alındı.` : `${program.name} arşivlendi.`,
        )
    }
    return [
      { key: 'name', label: 'Eğitim' },
      { key: 'kind', label: 'Tür' },
      { key: 'provider', label: 'Sağlayıcı' },
      { key: 'dates', label: 'Tarih' },
      { key: 'duration', label: 'Süre' },
      { key: 'audience', label: 'Hedef kitle' },
      { key: 'fee', label: 'Ücret' },
      { key: 'capacity', label: 'Katılımcı' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={PROFESSIONAL_DEVELOPMENT_STATUS_LABELS[row.program.status]}
            tone={STATUS_TONES[row.program.status]}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={`${row.name} katılımcıları`}
              onClick={() => setRoster(row.program)}
            >
              Katılımcılar
            </Button>
            {canManage && row.program.status !== 'archived' ? (
              <Button
                size="sm"
                variant="outline"
                aria-label={`${row.name} eğitimini düzelt`}
                onClick={() => setEditing(row.program)}
              >
                Düzelt
              </Button>
            ) : null}
            {canManage && row.program.status === 'draft' ? (
              <Button
                size="sm"
                aria-label={`${row.name} eğitimini yayına al`}
                disabled={changeStatus.isPending}
                onClick={() => void move(row.program, 'published')}
              >
                Yayına al
              </Button>
            ) : null}
            {canManage && row.program.status !== 'archived' ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${row.name} eğitimini arşivle`}
                disabled={changeStatus.isPending}
                onClick={() => void move(row.program, 'archived')}
              >
                Arşivle
              </Button>
            ) : null}
          </span>
        ),
      },
    ]
  }, [canManage, changeStatus])

  return (
    <section
      aria-labelledby="mesleki-gelisim"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="mesleki-gelisim" className="text-lg font-semibold">
            Mesleki gelişim
          </h2>
          <p className="text-sm text-muted-foreground">
            Personele açılan kurs, seminer, konferans, kurum içi ve çevrim içi eğitimler. Yeni
            eğitim taslak açılır; yayına alınan eğitime personel atanır, katılım saati işaretlenir.
          </p>
        </div>
        {canManage ? <Button onClick={() => setEditing('new')}>Yeni eğitim</Button> : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={programs.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Mesleki gelişim kataloğu"
        empty={canManage ? 'Katalogda henüz eğitim yok.' : 'Yayında eğitim yok.'}
        emptyFiltered="Bu seçimle eşleşen eğitim yok."
        loading={programs.isPending}
        fetching={programs.isFetching && !programs.isPending}
        error={
          programs.error ? (
            <QueryError error={programs.error} onRetry={() => void programs.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title={editing === 'new' ? 'Yeni eğitim' : 'Eğitimi düzelt'}
        description="Süre yarım saat adımlıdır. Sürekli açık eğitimde tarih girilmez; yer ya da çevrim içi bağlantıdan biri gerekir."
        size="wide"
      >
        {editing !== null ? (
          <ProgramForm
            program={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Modal>
      <Modal
        open={roster !== null}
        onOpenChange={(open) => (open ? undefined : setRoster(null))}
        title={roster === null ? 'Katılımcılar' : `${roster.name} katılımcıları`}
        size="wide"
      >
        {roster !== null ? <Roster program={roster} canManage={canManage} /> : null}
      </Modal>
    </section>
  )
}

function ProgramForm({
  program,
  onDone,
}: {
  program: ProfessionalDevelopmentProgram | null
  onDone: () => void
}) {
  const create = useCreateProfessionalDevelopmentProgram()
  const update = useUpdateProfessionalDevelopmentProgram()
  const form = useForm<ProgramFormValues>({
    resolver: zodResolver(programFormSchema),
    defaultValues: program === null ? emptyProgramForm() : programFormFrom(program),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const ongoing = useWatch({ control: form.control, name: 'ongoing' })
  const roles = useWatch({ control: form.control, name: 'audienceRoles' })
  const onSubmit = form.handleSubmit(async (values) => {
    const setError = (name: string, error: { message: string }) => {
      const field = programFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    }
    const body = programBody(values)
    const outcome =
      program === null
        ? await create.submit(body, { setError })
        : await update.submit(
            { programId: program.id, version: program.version, body },
            { setError },
          )
    if (outcome.status === 'success') {
      notify.success(
        program === null ? `${values.name} taslak olarak eklendi.` : `${values.name} güncellendi.`,
      )
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Eğitim"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="mg-ad" label="Eğitim adı" error={errors.name}>
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('name')} disabled={busy} />
        )}
      </FormField>
      <FormField id="mg-tur" label="Tür" error={errors.kind}>
        {(control) => (
          <NativeSelect {...control} {...form.register('kind')} className="w-full" disabled={busy}>
            {PROFESSIONAL_DEVELOPMENT_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {PROFESSIONAL_DEVELOPMENT_KIND_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="mg-saglayici" label="Sağlayıcı" error={errors.provider}>
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('provider')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="mg-sure"
        label="Süre (saat)"
        description="Yarım saat adımlı; örneğin 1,5."
        error={errors.durationHours}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="decimal"
            autoComplete="off"
            {...form.register('durationHours')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="flex min-h-11 items-center gap-2 sm:col-span-2">
        <Checkbox
          id="mg-surekli"
          checked={ongoing}
          disabled={busy}
          onCheckedChange={(checked) =>
            form.setValue('ongoing', checked === true, { shouldDirty: true })
          }
        />
        <Label htmlFor="mg-surekli">Sürekli açık (tarih aralığı yok)</Label>
      </div>
      {ongoing ? null : (
        <>
          <FormField id="mg-baslangic" label="Başlangıç günü" error={errors.startDate}>
            {(control) => (
              <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
            )}
          </FormField>
          <FormField id="mg-bitis" label="Bitiş günü" error={errors.endDate}>
            {(control) => (
              <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
            )}
          </FormField>
        </>
      )}
      <FormField id="mg-yer" label="Yer (isteğe bağlı)" error={errors.location}>
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('location')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="mg-baglanti"
        label="Çevrim içi bağlantı (isteğe bağlı)"
        description="https:// ile başlar."
        error={errors.onlineUrl}
      >
        {(control) => (
          <Input
            {...control}
            type="url"
            autoComplete="off"
            {...form.register('onlineUrl')}
            disabled={busy}
          />
        )}
      </FormField>
      <fieldset className="grid gap-1 sm:col-span-2">
        <legend className="text-sm font-medium">Hedef rol (boşsa tüm personel)</legend>
        <div className="flex flex-wrap gap-4">
          {STAFF_ROLES.map((role) => (
            <div key={role} className="flex min-h-11 items-center gap-2">
              <Checkbox
                id={`mg-rol-${role}`}
                checked={roles.includes(role)}
                disabled={busy}
                onCheckedChange={(checked) =>
                  form.setValue(
                    'audienceRoles',
                    checked === true ? [...roles, role] : roles.filter((item) => item !== role),
                    { shouldDirty: true },
                  )
                }
              />
              <Label htmlFor={`mg-rol-${role}`}>{STAFF_ROLE_LABELS[role]}</Label>
            </div>
          ))}
        </div>
      </fieldset>
      <FormField
        id="mg-brans"
        label="Hedef branşlar (isteğe bağlı)"
        description="Virgülle ayırın; örneğin İngilizce, Matematik."
        error={errors.audienceBranches}
      >
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            {...form.register('audienceBranches')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="mg-ucret" label="Kişi başı ücret, TL (isteğe bağlı)" error={errors.feeTl}>
        {(control) => (
          <Input
            {...control}
            inputMode="decimal"
            autoComplete="off"
            {...form.register('feeTl')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="mg-kontenjan"
        label="Kontenjan (isteğe bağlı)"
        description="Boşsa sınırsız."
        error={errors.capacity}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('capacity')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {program === null ? 'Taslak olarak ekle' : 'Kaydet'}
        </Button>
      </div>
    </form>
  )
}

/** Katılımcılar: liste herkese; atama ve katılım işareti yalnız yöneticiye, arşivde kapalı. */
function Roster({
  program,
  canManage,
}: {
  program: ProfessionalDevelopmentProgram
  canManage: boolean
}) {
  const enrollments = useProfessionalDevelopmentEnrollments(program.id, ENROLLMENT_PAGE)
  const writable = canManage && program.status !== 'archived'
  const items = enrollments.data?.data ?? []
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {PROFESSIONAL_DEVELOPMENT_KIND_LABELS[program.kind]} · {hoursLabel(program.durationHours)} ·{' '}
        {capacityText(program)}
      </p>
      {writable && program.status === 'published' ? <EnrollForm program={program} /> : null}
      {canManage && program.status === 'draft' ? (
        <p className="text-sm">Personel atamak için eğitimi önce yayına alın.</p>
      ) : null}
      {enrollments.error ? (
        <QueryError error={enrollments.error} onRetry={() => void enrollments.refetch()} />
      ) : null}
      {enrollments.isPending ? (
        <p className="text-sm text-muted-foreground">Katılımcılar yükleniyor…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz atanan personel yok.</p>
      ) : (
        <ul aria-label="Katılımcılar" className="grid gap-2">
          {items.map((item) => (
            <li key={item.id} className="grid gap-2 rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{item.staffName}</span>{' '}
                  <span className="text-sm text-muted-foreground">
                    · {PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGIN_LABELS[item.origin]}
                    {item.attendedHours === null ? '' : ` · ${hoursLabel(item.attendedHours)}`}
                  </span>
                </span>
                <StatusBadge
                  text={PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUS_LABELS[item.status]}
                  tone={ENROLLMENT_TONES[item.status]}
                />
              </div>
              {writable ? <AttendanceForm program={program} enrollment={item} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EnrollForm({ program }: { program: ProfessionalDevelopmentProgram }) {
  const enroll = useCreateProfessionalDevelopmentEnrollment()
  const staff = useCertificateStaff(STAFF_PAGE)
  const [membershipId, setMembershipId] = useState('')
  const [origin, setOrigin] = useState<ProfessionalDevelopmentEnrollmentOrigin>('assignment')
  const [error, setError] = useState<string | undefined>(undefined)
  const options = (staff.data?.data ?? []).filter((row) => row.active)
  const busy = enroll.isPending
  const submit = async () => {
    setError(undefined)
    if (membershipId === '') {
      setError('Personel seçin.')
      return
    }
    const outcome = await enroll.submit(
      { programId: program.id, body: { membershipId, origin } },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.staffName} eğitime atandı.`)
      setMembershipId('')
    }
  }
  return (
    <form
      noValidate
      aria-label="Personel ata"
      className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FormField id="mg-personel" label="Personel" error={error ? { message: error } : undefined}>
        {(control) => (
          <NativeSelect
            {...control}
            value={membershipId}
            onChange={(event) => setMembershipId(event.target.value)}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">
              {staff.isPending ? 'Personel yükleniyor…' : 'Personel seçin'}
            </NativeSelectOption>
            {options.map((row) => (
              <NativeSelectOption key={row.membershipId} value={row.membershipId}>
                {staffOptionText(row)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="mg-kaynak" label="Kaynak">
        {(control) => (
          <NativeSelect
            {...control}
            value={origin}
            onChange={(event) =>
              setOrigin(event.target.value === 'request' ? 'request' : 'assignment')
            }
            className="w-full"
            disabled={busy}
          >
            {PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGINS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGIN_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        Ata
      </Button>
      {staff.error ? (
        <div className="sm:col-span-3">
          <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
        </div>
      ) : null}
    </form>
  )
}

function AttendanceForm({
  program,
  enrollment,
}: {
  program: ProfessionalDevelopmentProgram
  enrollment: ProfessionalDevelopmentEnrollment
}) {
  const update = useUpdateProfessionalDevelopmentEnrollment()
  const [status, setStatus] = useState<ProfessionalDevelopmentEnrollmentStatus>(enrollment.status)
  const [hours, setHours] = useState(
    enrollment.attendedHours === null
      ? String(program.durationHours).replace('.', ',')
      : String(enrollment.attendedHours).replace('.', ','),
  )
  const [error, setError] = useState<string | undefined>(undefined)
  const busy = update.isPending
  const prefix = `mg-katilim-${enrollment.id}`
  const submit = async () => {
    setError(undefined)
    const attendedHours = status === 'attended' ? parseDecimal(hours) : null
    if (status === 'attended' && (attendedHours === null || Number.isNaN(attendedHours))) {
      setError('Katılım saatini girin.')
      return
    }
    const outcome = await update.submit(
      {
        programId: program.id,
        enrollmentId: enrollment.id,
        version: enrollment.version,
        body: { status, attendedHours },
      },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success')
      notify.success(`${enrollment.staffName} için katılım kaydedildi.`)
  }
  return (
    <form
      noValidate
      aria-label={`${enrollment.staffName} katılımı`}
      className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FormField id={`${prefix}-durum`} label="Durum">
        {(control) => (
          <NativeSelect
            {...control}
            value={status}
            onChange={(event) => {
              const next = PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES.find(
                (value) => value === event.target.value,
              )
              if (next) setStatus(next)
            }}
            className="w-full"
            disabled={busy}
          >
            {PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUS_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {status === 'attended' ? (
        <FormField
          id={`${prefix}-saat`}
          label="Katılım saati"
          error={error ? { message: error } : undefined}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              autoComplete="off"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              disabled={busy}
            />
          )}
        </FormField>
      ) : (
        <p role={error ? 'alert' : undefined} className="text-sm text-destructive">
          {error ?? ''}
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={busy}
        aria-busy={busy || undefined}
      >
        Kaydet
      </Button>
    </form>
  )
}
