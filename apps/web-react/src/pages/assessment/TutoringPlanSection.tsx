import { useId, useMemo, useState } from 'react'
import { planChanges, type PlanChanges } from '@kampus/react-shared/assessment-feedback.ts'
import {
  NOTHING_TO_CREATE_CODE,
  TUTORING_PLAN_STALE_CODE,
  useConfirmTutoringPlan,
  usePreviewTutoringPlan,
  type TutoringPlanPreview,
} from '@kampus/react-shared/use-assessment-commands.ts'
import { automationExams } from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session as CoreSession } from '@kampus/school-core/lib/domain.ts'
import type { Session } from '@/auth/auth-port.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
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
import { useSourcesState } from '../workflows/use-workflow-state.ts'
import { collectionSources } from '../workflows/workflow-state.ts'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import {
  checkPlanForm,
  defaultPlanValues,
  planFailure,
  planView,
  TUTORING_PLAN_SOURCES,
  type PlanFailure,
  type PlanFormValues,
  type PlanView,
} from './tutoring-model.ts'

type Props = { session: Session; actor: CoreSession }

/** Önizleme: istenen plan ve sunucunun hesapladığı plan (onayda `expectedPlan` aynen gider). */
type Checked = {
  request: Extract<ReturnType<typeof checkPlanForm>, { ok: true }>['request']
  data: TutoringPlanPreview
}

const FIELD_NAMES = [
  'examId',
  'threshold',
  'fromDate',
  'toDate',
  'duration',
  'maxGroupSize',
] as const

/**
 * Otomatik etüt planlama (Vue "Etüt planını önizle"): plan sunucuda hesaplanır. "Etüt planını
 * önizle" `POST /assessment/plan/preview` çağırır ve hiçbir şey yazmaz; "Onayla ve etütleri
 * oluştur" `POST /assessment/plan` ile önizlemedeki `expectedPlan`'ı aynen gönderir. Sunucu
 * planı güncel veriyle yeniden hesaplar; fark varsa 409 `tutoring_plan_stale` döner, ekran
 * eklenen/kalkan/değişen etütleri gösterir ve yeniden önizleme ister. Tarayıcı yalnız deneme
 * listesini ve öğrenci/öğretmen/ders adlarını okur.
 */
export function TutoringPlanSection({ session, actor }: Props) {
  const sources = useMemo(
    () => collectionSources(TUTORING_PLAN_SOURCES, session.role),
    [session.role],
  )
  const data = useSourcesState(sources, session)
  const exams = automationExams(data.state, actor)
  const [values, setValues] = useState<PlanFormValues>(() =>
    defaultPlanValues(new Date().toISOString()),
  )
  const [checked, setChecked] = useState<Checked | null>(null)
  const [failure, setFailure] = useState<PlanFailure | null>(null)
  const [stale, setStale] = useState<PlanChanges | null>(null)
  const [created, setCreated] = useState<number | null>(null)
  const [nothing, setNothing] = useState<string | null>(null)
  const previewer = usePreviewTutoringPlan()
  const confirmer = useConfirmTutoringPlan()
  const prefix = useId()
  const examId = values.examId || exams[0]?.id || ''
  const view = useMemo(() => (checked ? planView(checked.data, data.state) : null), [checked, data])

  function clearResults() {
    setChecked(null)
    setFailure(null)
    setStale(null)
    setCreated(null)
    setNothing(null)
  }

  function change(field: keyof PlanFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    clearResults()
  }

  async function runPreview(request: Checked['request'], current: PlanFormValues) {
    clearResults()
    const outcome = await previewer.preview(request)
    if (outcome.status === 'success') {
      setChecked({ request, data: outcome.data })
      return
    }
    setFailure(planFailure(outcome.error, current))
  }

  function submitPreview() {
    const form = { ...values, examId }
    const check = checkPlanForm(form)
    if (!check.ok) {
      clearResults()
      setFailure(check.failure)
      return
    }
    void runPreview(check.request, form)
  }

  async function confirm() {
    if (!checked) return
    setCreated(null)
    setNothing(null)
    const outcome = await confirmer.submit({
      ...checked.request,
      expectedPlan: checked.data.expectedPlan,
    })
    if (outcome.status === 'success') {
      const count = outcome.data.data.changes.inserted
      notify.success(`${count} etüt oluşturuldu.`)
      setCreated(count)
      setChecked(null)
      return
    }
    if (outcome.status !== 'failed') return
    if (outcome.error.code === TUTORING_PLAN_STALE_CODE) {
      setStale(planChanges(outcome.error))
      setChecked(null)
    } else if (outcome.error.code === NOTHING_TO_CREATE_CODE) {
      setNothing(
        'Planlanacak yeni etüt kalmadı. Etütler zaten oluşturulmuş olabilir; etüt listesini kontrol edin.',
      )
      setChecked(null)
    }
  }

  const busy = previewer.isPending || confirmer.isPending
  const fieldError = (field: keyof PlanFormValues) => {
    const message = failure?.fields[field]
    return message ? { message } : undefined
  }

  return (
    <AssessmentPanel
      id="etut-planlama"
      title="Etüt planla"
      description="Eksik kazanımlara göre uygun öğretmen, saat ve derslikle etüt önerisi hazırlayın."
    >
      {data.error ? <QueryError error={data.error} onRetry={data.retry} /> : null}
      <form
        className="grid max-w-3xl gap-4"
        aria-label="Etüt plan bilgileri"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submitPreview()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id={`${prefix}-deneme`} label="Deneme" error={fieldError('examId')}>
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={examId}
                onChange={(event) => change('examId', event.target.value)}
              >
                {exams.map((exam) => (
                  <NativeSelectOption key={exam.id} value={exam.id}>
                    {exam.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id={`${prefix}-esik`}
            label="Başarı eşiği (%)"
            error={fieldError('threshold')}
            description="Eşiğin altındaki kazanımlar için etüt planlanır."
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                value={values.threshold}
                onChange={(event) => change('threshold', event.target.value)}
              />
            )}
          </FormField>
          <FormField
            id={`${prefix}-baslangic`}
            label="Başlangıç tarihi"
            error={fieldError('fromDate')}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                value={values.fromDate}
                onChange={(event) => change('fromDate', event.target.value)}
              />
            )}
          </FormField>
          <FormField id={`${prefix}-bitis`} label="Bitiş tarihi" error={fieldError('toDate')}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={values.toDate}
                onChange={(event) => change('toDate', event.target.value)}
              />
            )}
          </FormField>
          <FormField
            id={`${prefix}-sure`}
            label="Etüt süresi (dakika)"
            error={fieldError('duration')}
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                value={values.duration}
                onChange={(event) => change('duration', event.target.value)}
              />
            )}
          </FormField>
          <FormField
            id={`${prefix}-grup`}
            label="En fazla grup büyüklüğü"
            error={fieldError('maxGroupSize')}
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                value={values.maxGroupSize}
                onChange={(event) => change('maxGroupSize', event.target.value)}
              />
            )}
          </FormField>
        </div>
        <div>
          <Button
            type="submit"
            disabled={!exams.length || data.pending || busy}
            aria-busy={previewer.isPending || undefined}
          >
            Etüt planını önizle
          </Button>
        </div>
        {!data.pending && !exams.length ? (
          <p className="text-sm text-muted-foreground">
            Planlanacak deneme yok. Önce Deneme Sınavları ekranında bir deneme oluşturup optik
            değerlendirmeyi yapın.
          </p>
        ) : null}
      </form>

      {created !== null ? (
        <p role="status" className="mt-6 text-sm text-success">
          {created} etüt oluşturuldu. Aşağıdaki etüt listesinde görünür.
        </p>
      ) : null}
      {nothing ? (
        <p role="status" className="mt-6 text-sm text-muted-foreground">
          {nothing}
        </p>
      ) : null}
      {stale ? (
        <StalePlan
          changes={stale}
          busy={busy}
          onReload={() => {
            const check = checkPlanForm({ ...values, examId })
            if (check.ok) void runPreview(check.request, { ...values, examId })
          }}
        />
      ) : null}
      {failure && !FIELD_NAMES.some((name) => failure.fields[name]) ? (
        <p role="alert" className="mt-6 text-sm text-danger">
          {failure.message}
        </p>
      ) : null}
      {view ? (
        <PlanResult view={view} pending={confirmer.isPending} onConfirm={() => void confirm()} />
      ) : null}
    </AssessmentPanel>
  )
}

function ChangeList({ title, items }: { title: string; items: readonly string[] }) {
  if (!items.length) return null
  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="mt-1 grid list-disc gap-1 pl-5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function StalePlan({
  changes,
  busy,
  onReload,
}: {
  changes: PlanChanges
  busy: boolean
  onReload: () => void
}) {
  return (
    <div
      role="alert"
      className="mt-6 grid gap-3 rounded-md border border-warning bg-warning-soft p-4"
    >
      <div>
        <h3 className="text-base font-semibold">Plan değişmiş</h3>
        <p className="mt-1 text-sm">
          Önizlemeden sonra veriler değişti; hiçbir etüt oluşturulmadı. Planı yeniden önizleyip
          farkı kontrol ederek tekrar onaylayın.
        </p>
      </div>
      <ChangeList title="Eklenen etütler" items={changes.added} />
      <ChangeList title="Kalkan etütler" items={changes.removed} />
      <ChangeList title="Değişen etütler" items={changes.changed} />
      <ChangeList title="Diğer farklar" items={changes.other} />
      <div>
        <Button type="button" variant="secondary" disabled={busy} onClick={onReload}>
          Planı yeniden önizle
        </Button>
      </div>
    </div>
  )
}

function PlanResult({
  view,
  pending,
  onConfirm,
}: {
  view: PlanView
  pending: boolean
  onConfirm: () => void
}) {
  const { summary } = view
  return (
    <div className="mt-6 grid gap-4">
      <h3 className="text-base font-semibold">Etüt planı önizlemesi</h3>
      <p role="status" className="text-sm text-muted-foreground">
        {summary.sessions} etüt, {summary.students} öğrenci
        {summary.unresolvedStudents ? ` · ${summary.unresolvedStudents} öğrenci yerleşemedi` : ''}
        {summary.covered ? ` · ${summary.covered} öğrenci/kazanım zaten etütte` : ''} ·{' '}
        {summary.evaluatedStudents} öğrenci değerlendirildi.
      </p>
      {view.sessions.length ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kazanım</TableHead>
                <TableHead>Tarih</TableHead>
                <TableHead>Öğretmen</TableHead>
                <TableHead>Derslik</TableHead>
                <TableHead>Öğrenciler</TableHead>
                <TableHead>Kapasite</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.sessions.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.title}</TableCell>
                  <TableCell>{row.when}</TableCell>
                  <TableCell>{row.teacher}</TableCell>
                  <TableCell>{row.room}</TableCell>
                  <TableCell>{row.students}</TableCell>
                  <TableCell>
                    {row.capacity}
                    {row.full ? ' (dolu)' : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Bu plan için önerilen etüt yok.</p>
      )}
      {view.unresolved.length ? (
        <section aria-label="Yerleşemeyen gruplar" className="grid gap-2">
          <h4 className="text-sm font-semibold">Yerleşemeyen gruplar</h4>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kazanım</TableHead>
                  <TableHead>Öğrenciler</TableHead>
                  <TableHead>Neden</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.unresolved.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.title}</TableCell>
                    <TableCell>{row.students}</TableCell>
                    <TableCell>{row.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
      {view.covered.length ? (
        <section aria-label="Zaten etütte olan kazanımlar" className="grid gap-2">
          <h4 className="text-sm font-semibold">Zaten etütte olan kazanımlar</h4>
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {view.covered.map((row) => (
              <li key={row.key}>
                {row.topic}: {row.students}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div>
        <Button
          type="button"
          disabled={pending || summary.sessions === 0}
          aria-busy={pending || undefined}
          onClick={onConfirm}
        >
          Onayla ve etütleri oluştur
        </Button>
      </div>
    </div>
  )
}
