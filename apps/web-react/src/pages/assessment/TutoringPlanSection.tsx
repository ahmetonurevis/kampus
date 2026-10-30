import { useId, useMemo, useState } from 'react'
import { isApiError } from '@kampus/api-client/errors.ts'
import {
  TUTORING_PLAN_STALE_CODE,
  useCreateTutorSessions,
} from '@kampus/react-shared/use-tutoring-commands.ts'
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
  defaultPlanValues,
  planDifference,
  planRequest,
  previewPlan,
  sendsExpectedPlan,
  TUTORING_PLAN_SOURCES,
  type PlanFormValues,
  type PlanPreview,
  type PlanSummary,
} from './tutoring-model.ts'

type Props = { session: Session; actor: CoreSession }

/** Önizleme isteği: form değerleri ve önizlemenin hesaplandığı an (plan bu ana göre kurulur). */
type Checked = { values: PlanFormValues; now: string }
/** Sunucu planı farklı bulduğunda onaydan önceki plan (fark gösterimi için). */
type Stale = { signature: string; summary: PlanSummary }

const FIELD_NAMES = [
  'examId',
  'threshold',
  'fromDate',
  'toDate',
  'duration',
  'maxGroupSize',
] as const

/**
 * Otomatik etüt planlama (Vue "Etüt planını önizle"): önizleme core `planTutoring` ile
 * istemcide çalışır ve sunucuya yazmaz; "Onayla ve etütleri oluştur" planı `expectedPlan` ile
 * gönderir, sunucu planı güncel veriyle yeniden hesaplar. Plan farklıysa (409) veriler
 * tazelenir, yeni plan ve fark gösterilir, onay yeniden istenir.
 *
 * Bölüm açılınca mount olur: plan koleksiyonları (ders programı dahil) yalnız o zaman okunur.
 * TODO(perf): yöneticide ~1440 ders kaydı, uygunluk saatleri ve tüm optik analizler bütünüyle
 * okunur (sayfa sayfa istek); sunucu plan önizleme ucu (`TODO(api-tutoring-preview)`) gelince
 * istemci okuması kalkar.
 * TODO(api-tutoring-slot): öğretmen uygunluk saati ekleme/kaldırma (`slot`, `slot-remove`)
 * uçları API'de yok; uygunluk saatleri seed/yönetici verisinden gelir, ekranda eklenemez.
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
  const [stale, setStale] = useState<Stale | null>(null)
  const [created, setCreated] = useState<number | null>(null)
  const create = useCreateTutorSessions()
  const prefix = useId()
  const examId = values.examId || exams[0]?.id || ''

  // Önizleme saf işlemdir; koleksiyonlar tazelenince (ör. sunucu planı farklı bulunca) aynı
  // girdiyle güncel veriden yeniden hesaplanır.
  const preview = useMemo<PlanPreview | null>(
    () => (checked ? previewPlan(data.state, actor, { ...checked.values }, checked.now) : null),
    [checked, data.state, actor],
  )

  function change(field: keyof PlanFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setChecked(null)
    setStale(null)
    setCreated(null)
  }

  async function confirm() {
    if (!checked || !preview?.ok) return
    setCreated(null)
    const outcome = await create.submit(
      planRequest({ ...checked.values }, sendsExpectedPlan(session) ? preview.signature : null),
    )
    if (outcome.status === 'success') {
      const count = outcome.data.data.changes.inserted
      notify.success(`${count} etüt oluşturuldu.`)
      setCreated(count)
      setStale(null)
      setChecked(null)
    } else if (outcome.status === 'failed' && isApiError(outcome.error)) {
      if (outcome.error.code === TUTORING_PLAN_STALE_CODE)
        setStale({ signature: preview.signature, summary: preview.summary })
    }
  }

  const difference =
    stale && preview?.ok && preview.signature !== stale.signature
      ? planDifference(stale.summary, preview.summary)
      : null

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
        onSubmit={(event) => {
          event.preventDefault()
          setStale(null)
          setCreated(null)
          setChecked({ values: { ...values, examId }, now: new Date().toISOString() })
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id={`${prefix}-deneme`} label="Deneme" error={fieldError(preview, 'examId')}>
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
            error={fieldError(preview, 'threshold')}
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
            error={fieldError(preview, 'fromDate')}
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
          <FormField
            id={`${prefix}-bitis`}
            label="Bitiş tarihi"
            error={fieldError(preview, 'toDate')}
          >
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
            error={fieldError(preview, 'duration')}
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
            error={fieldError(preview, 'maxGroupSize')}
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
          <Button type="submit" disabled={!exams.length || data.pending}>
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
      {stale && preview?.ok ? (
        <div role="alert" className="mt-6 rounded-md border border-warning bg-warning-soft p-4">
          <h3 className="text-base font-semibold">Plan değişmiş</h3>
          <p className="mt-1 text-sm">
            {difference ??
              'Sunucu planı farklı hesapladı. Güncel veriler yüklendi; planı kontrol edip yeniden onaylayın.'}
          </p>
        </div>
      ) : null}
      {preview && !preview.ok && !FIELD_NAMES.some((name) => preview.fields[name]) ? (
        <p role="alert" className="mt-6 text-sm text-danger">
          {preview.message}
        </p>
      ) : null}
      {preview?.ok ? (
        <PlanResult preview={preview} pending={create.isPending} onConfirm={() => void confirm()} />
      ) : null}
    </AssessmentPanel>
  )
}

function fieldError(preview: PlanPreview | null, field: keyof PlanFormValues) {
  const message = preview && !preview.ok ? preview.fields[field] : undefined
  return message ? { message } : undefined
}

function PlanResult({
  preview,
  pending,
  onConfirm,
}: {
  preview: Extract<PlanPreview, { ok: true }>
  pending: boolean
  onConfirm: () => void
}) {
  const { summary } = preview
  return (
    <div className="mt-6 grid gap-4">
      <h3 className="text-base font-semibold">Etüt planı önizlemesi</h3>
      <p role="status" className="text-sm text-muted-foreground">
        {summary.sessions} etüt, {summary.students} öğrenci
        {summary.unresolvedStudents ? ` · ${summary.unresolvedStudents} öğrenci yerleşemedi` : ''}
        {summary.covered ? ` · ${summary.covered} öğrenci/kazanım zaten etütte` : ''} ·{' '}
        {summary.evaluatedStudents} öğrenci değerlendirildi.
      </p>
      {preview.warnings.length ? (
        <section aria-label="Plan uyarıları" className="rounded-md border border-warning p-4">
          <h4 className="text-sm font-semibold">Uyarılar</h4>
          <ul className="mt-1 grid gap-1 text-sm">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {preview.sessions.length ? (
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
              {preview.sessions.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.title}</TableCell>
                  <TableCell>{row.when}</TableCell>
                  <TableCell>{row.teacher}</TableCell>
                  <TableCell>{row.room}</TableCell>
                  <TableCell>{row.students}</TableCell>
                  <TableCell>{row.capacity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <div>
        <Button
          type="button"
          disabled={pending || summary.sessions === 0}
          aria-busy={pending}
          onClick={onConfirm}
        >
          Onayla ve etütleri oluştur
        </Button>
      </div>
    </div>
  )
}
