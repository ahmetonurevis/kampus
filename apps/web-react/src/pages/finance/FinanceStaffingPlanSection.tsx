import { useState } from 'react'
import { useJobOffers } from '@kampus/react-shared/use-finance-staff-onboarding.ts'
import {
  useCreateStaffingPosition,
  useSaveStaffingPlan,
  useStaffingPlan,
  useUpdateStaffingPosition,
  type StaffingPlan,
  type StaffingPosition,
} from '@kampus/react-shared/use-finance-staffing-plans.ts'
import { STAFFING_POSITION_HOURS_MAX } from '@kampus/school-core/lib/finance-staffing-plans.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  academicYearLabel,
  balanceText,
  currentAcademicYear,
  fteText,
  planFormBody,
  planFormDefaults,
  positionActions,
  positionStatusLabel,
  yearOptions,
  type StaffingPlanFormValues,
} from './finance-staffing-plan-view.ts'

const num = 'text-right tabular-nums'
const weekText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { month: 'long' })

/**
 * Kadro planı (DOM-FIN-126; ON-188): Finans "Kadro planı" sekmesi, yalnız yönetici. Eğitim yılı
 * başına norm ve branş ihtiyaç saati; ders programı önerisi, kapasite, açık ve önerilen pozisyon
 * (saat ve tam zamanlı eşdeğeri) sunucuda hesaplanır (K-433…K-435). Açık pozisyonlar aynı yerde
 * açılır, ilana çıkar, doldurulur ya da iptal edilir; iş teklifine isteğe bağlı bağlanır.
 */
export function FinanceStaffingPlanSection() {
  const current = currentAcademicYear(dayKey())
  const [year, setYear] = useState(current)
  const [weekOf, setWeekOf] = useState('')
  const plan = useStaffingPlan(year, weekOf === '' ? undefined : weekOf)
  const [editing, setEditing] = useState(false)
  const [opening, setOpening] = useState<{ subjectId: string; hours: number } | null>(null)
  const data = plan.data?.data
  return (
    <section
      aria-labelledby="kadro-plani"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-4 max-[650px]:px-4">
        <h2 id="kadro-plani" className="text-lg font-semibold">
          Kadro planı
        </h2>
        <p className="text-sm text-muted-foreground">
          Branş başına haftalık ders saati ihtiyacı, tam zamanlı öğretmen kapasitesi ve açık.
          İhtiyaç girilmeyen branşta seçilen haftanın ders programı kullanılır; saatlik ücretli
          öğretmen kapasiteye girmez.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <FormField id="kadro-yil" label="Eğitim yılı">
            {(control) => (
              <NativeSelect
                {...control}
                value={String(year)}
                onChange={(event) => setYear(Number(event.target.value))}
              >
                {yearOptions(current).map((option) => (
                  <NativeSelectOption key={option} value={String(option)}>
                    {academicYearLabel(option)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="kadro-hafta"
            label="Program haftası"
            description="Önerinin alındığı hafta; boşsa bu hafta."
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                value={weekOf}
                onChange={(event) => setWeekOf(event.target.value)}
              />
            )}
          </FormField>
          <Button type="button" disabled={data === undefined} onClick={() => setEditing(true)}>
            Planı düzenle
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={data === undefined}
            onClick={() => setOpening({ subjectId: '', hours: 0 })}
          >
            Pozisyon aç
          </Button>
        </div>
      </header>
      <div className="grid gap-6 px-6 pb-6 max-[650px]:px-4">
        {plan.error ? (
          <QueryError error={plan.error} onRetry={() => void plan.refetch()} />
        ) : data === undefined ? (
          <SummaryLoading />
        ) : (
          <PlanView data={data} onOpen={(subjectId, hours) => setOpening({ subjectId, hours })} />
        )}
      </div>
      {editing && data !== undefined ? (
        <PlanForm data={data} onClose={() => setEditing(false)} />
      ) : null}
      {opening !== null && data !== undefined ? (
        <PositionForm data={data} initial={opening} onClose={() => setOpening(null)} />
      ) : null}
    </section>
  )
}

function PlanView({
  data,
  onOpen,
}: {
  data: StaffingPlan
  onOpen: (subjectId: string, hours: number) => void
}) {
  const { totals } = data
  return (
    <>
      <StatGrid
        label="Kadro özeti"
        items={[
          { label: 'Norm', value: `${String(data.normHours)} saat`, note: 'öğretmen başına' },
          { label: 'Haftalık ihtiyaç', value: `${String(totals.requiredHours)} saat` },
          { label: 'Kapasite', value: `${String(totals.capacityHours)} saat` },
          { label: 'Açık', value: `${String(totals.gapHours)} saat` },
          {
            label: 'Önerilen pozisyon',
            value: `${String(totals.suggestedHours)} saat`,
            note: `${fteText(totals.suggestedFte)} tam zamanlı eşdeğeri`,
          },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        Program haftası {weekText(data.week.startDate)} – {weekText(data.week.endDate)}.
        {data.teachersWithoutPayRate > 0
          ? ` Ücret tanımı olmayan ${String(data.teachersWithoutPayRate)} öğretmen tam zamanlı sayıldı.`
          : ''}
      </p>
      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Branş yok: öğretmen kaydı, ders programı ya da plan satırı bulunamadı.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label="Branş kadro hesabı">
            <TableHeader>
              <TableRow>
                <TableHead>Branş</TableHead>
                <TableHead className={num}>İhtiyaç</TableHead>
                <TableHead className={num}>Program</TableHead>
                <TableHead className={num}>Tam zamanlı</TableHead>
                <TableHead className={num}>Saatlik</TableHead>
                <TableHead className={num}>Kapasite</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className={num}>Açık pozisyon</TableHead>
                <TableHead className={num}>Öneri</TableHead>
                <TableHead>
                  <span className="sr-only">İşlem</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.subjectId}>
                  <TableCell className="font-medium">{row.subjectName}</TableCell>
                  <TableCell className={num}>
                    {row.requiredHours}
                    {row.requiredSource === 'schedule' ? (
                      <span className="block text-2xs text-muted-foreground">programdan</span>
                    ) : null}
                  </TableCell>
                  <TableCell className={num}>{row.scheduleHours}</TableCell>
                  <TableCell className={num}>{row.fullTimeTeachers}</TableCell>
                  <TableCell className={num}>{row.hourlyTeachers}</TableCell>
                  <TableCell className={num}>{row.capacityHours}</TableCell>
                  <TableCell>{balanceText(row)}</TableCell>
                  <TableCell className={num}>{row.openPositionHours}</TableCell>
                  <TableCell className={num}>
                    {row.suggestedHours} saat
                    <span className="block text-2xs text-muted-foreground">
                      {fteText(row.suggestedFte)} TZE
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.suggestedHours > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={`${row.subjectName} için pozisyon aç`}
                        onClick={() =>
                          onOpen(
                            row.subjectId,
                            Math.min(row.suggestedHours, STAFFING_POSITION_HOURS_MAX),
                          )
                        }
                      >
                        Pozisyon aç
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Positions positions={data.positions} />
    </>
  )
}

function Positions({ positions }: { positions: readonly StaffingPosition[] }) {
  const update = useUpdateStaffingPosition()
  async function move(position: StaffingPosition, status: StaffingPosition['status']) {
    const outcome = await update.submit({
      id: position.id,
      version: position.version,
      body: { status },
    })
    if (outcome.status === 'success')
      notify.success(`Pozisyon: ${positionStatusLabel(outcome.data.data.status)}.`)
  }
  return (
    <section aria-labelledby="acik-pozisyonlar" className="grid gap-3">
      <h3 id="acik-pozisyonlar" className="text-base font-semibold">
        Açık pozisyonlar
      </h3>
      {positions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu eğitim yılında pozisyon yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label="Açık pozisyonlar">
            <TableHeader>
              <TableRow>
                <TableHead>Branş</TableHead>
                <TableHead className={num}>Saat</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>İş teklifi</TableHead>
                <TableHead>Not</TableHead>
                <TableHead>
                  <span className="sr-only">İşlem</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((position) => (
                <TableRow key={position.id}>
                  <TableCell className="font-medium">{position.subjectName}</TableCell>
                  <TableCell className={num}>{position.hours}</TableCell>
                  <TableCell>
                    <StatusBadge text={positionStatusLabel(position.status)} />
                  </TableCell>
                  <TableCell>{position.jobOfferPosition ?? '—'}</TableCell>
                  <TableCell className="max-w-[260px] truncate">{position.note ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {positionActions(position.status).map((action) => (
                        <Button
                          key={action.status}
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={update.isPending}
                          aria-label={`${position.subjectName} pozisyonu: ${action.label}`}
                          onClick={() => void move(position, action.status)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function PlanForm({ data, onClose }: { data: StaffingPlan; onClose: () => void }) {
  const save = useSaveStaffingPlan()
  const [values, setValues] = useState<StaffingPlanFormValues>(() => planFormDefaults(data))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const busy = save.isPending
  const scheduleOf = new Map(data.rows.map((row) => [row.subjectId, row.scheduleHours]))
  async function submit() {
    const result = planFormBody(values)
    if ('issues' in result) {
      setErrors(Object.fromEntries(result.issues.map((issue) => [issue.field, issue.message])))
      return
    }
    setErrors({})
    const outcome = await save.submit(
      { academicYear: data.academicYear, version: data.version, body: result.body },
      {
        setError: (name, error) =>
          setErrors((all) => ({
            ...all,
            [name === 'normHours' ? 'normHours' : 'root']: error.message,
          })),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Kadro planı kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  }
  const message = (field: string) =>
    errors[field] === undefined ? undefined : { message: errors[field] }
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Kadro planı ${academicYearLabel(data.academicYear)}`}
      description="Norm tam zamanlı öğretmenin haftalık zorunlu ders saatidir. İhtiyaç saati boş bırakılan branşta ders programı önerisi kullanılır."
    >
      <form
        noValidate
        aria-label="Kadro planı"
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <FormField
          id="kadro-norm"
          label="Norm (haftalık ders saati)"
          error={message('normHours')}
          description="1 ile 40 arası."
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              autoComplete="off"
              value={values.normHours}
              disabled={busy}
              onChange={(event) => setValues({ ...values, normHours: event.target.value })}
            />
          )}
        </FormField>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold">Branş ihtiyaç saatleri</legend>
          {data.subjects.map((subject) => (
            <FormField
              key={subject.id}
              id={`kadro-saat-${subject.id}`}
              label={`${subject.name} haftalık ihtiyaç`}
              error={message(`hours.${subject.id}`)}
              description={`Program önerisi ${String(scheduleOf.get(subject.id) ?? 0)} saat.`}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  autoComplete="off"
                  value={values.hours[subject.id] ?? ''}
                  disabled={busy}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      hours: { ...values.hours, [subject.id]: event.target.value },
                    })
                  }
                />
              )}
            </FormField>
          ))}
        </fieldset>
        <RootError message={errors.root} />
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Planı kaydet
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function PositionForm({
  data,
  initial,
  onClose,
}: {
  data: StaffingPlan
  initial: { subjectId: string; hours: number }
  onClose: () => void
}) {
  const create = useCreateStaffingPosition()
  const offers = useJobOffers({ page: 1, pageSize: 100 })
  const [subjectId, setSubjectId] = useState(initial.subjectId)
  const [hours, setHours] = useState(initial.hours > 0 ? String(initial.hours) : '')
  const [note, setNote] = useState('')
  const [jobOfferId, setJobOfferId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const busy = create.isPending
  async function submit() {
    const issues: Record<string, string> = {}
    if (subjectId === '') issues.subjectId = 'Branş seçin.'
    const parsed = /^\d{1,2}$/.test(hours.trim()) ? Number(hours.trim()) : 0
    if (parsed < 1 || parsed > STAFFING_POSITION_HOURS_MAX)
      issues.hours = `Saat 1 ile ${String(STAFFING_POSITION_HOURS_MAX)} arası tam sayı olmalı.`
    setErrors(issues)
    if (Object.keys(issues).length > 0) return
    const outcome = await create.submit(
      {
        academicYear: data.academicYear,
        subjectId,
        hours: parsed,
        note: note.trim() === '' ? null : note.trim(),
        jobOfferId: jobOfferId === '' ? null : jobOfferId,
      },
      {
        setError: (name, error) =>
          setErrors((all) => ({
            ...all,
            [['subjectId', 'hours', 'note', 'jobOfferId'].includes(name) ? name : 'root']:
              error.message,
          })),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Pozisyon açıldı.')
      onClose()
    }
  }
  const message = (field: string) =>
    errors[field] === undefined ? undefined : { message: errors[field] }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Pozisyon aç"
      description={`${academicYearLabel(data.academicYear)} eğitim yılı için açık pozisyon; saat açıktan düşülür.`}
    >
      <form
        noValidate
        aria-label="Pozisyon aç"
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <FormField id="pozisyon-brans" label="Branş" error={message('subjectId')}>
          {(control) => (
            <NativeSelect
              {...control}
              value={subjectId}
              disabled={busy}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              {data.subjects.map((subject) => (
                <NativeSelectOption key={subject.id} value={subject.id}>
                  {subject.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="pozisyon-saat" label="Haftalık ders saati" error={message('hours')}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              autoComplete="off"
              value={hours}
              disabled={busy}
              onChange={(event) => setHours(event.target.value)}
            />
          )}
        </FormField>
        <FormField
          id="pozisyon-teklif"
          label="İş teklifi (isteğe bağlı)"
          error={message('jobOfferId')}
        >
          {(control) => (
            <NativeSelect
              {...control}
              value={jobOfferId}
              disabled={busy}
              onChange={(event) => setJobOfferId(event.target.value)}
            >
              <NativeSelectOption value="">Bağlama</NativeSelectOption>
              {(offers.data?.data ?? []).map((offer) => (
                <NativeSelectOption key={offer.id} value={offer.id}>
                  {offer.position} · {offer.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="pozisyon-not" label="Not (isteğe bağlı)" error={message('note')}>
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              maxLength={500}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </FormField>
        <RootError message={errors.root} />
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Pozisyonu aç
          </Button>
        </div>
      </form>
    </Modal>
  )
}
