import { useMemo, useState } from 'react'
import {
  useArchiveTeacherFeedbackSurvey,
  useCloseTeacherFeedbackSurvey,
  usePublishTeacherFeedbackSurvey,
  useTeacherFeedbackResults,
  useTeacherFeedbackSurvey,
  useTeacherFeedbackSurveys,
  useTeacherFeedbackTrend,
  type TeacherFeedbackDetail,
  type TeacherFeedbackResultsView,
  type TeacherFeedbackRow,
} from '@kampus/react-shared/use-finance-teacher-feedback.ts'
import {
  TEACHER_FEEDBACK_PHASE_LABELS,
  TEACHER_FEEDBACK_PHASES,
  TEACHER_FEEDBACK_QUESTION_KIND_LABELS,
  type TeacherFeedbackPhase,
} from '@kampus/school-core/lib/finance-teacher-feedback.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { TeacherFeedbackForm } from './FinanceTeacherFeedbackForm.tsx'
import {
  TeacherFeedbackResultBody,
  TeacherFeedbackTrendTable,
} from './FinanceTeacherFeedbackResult.tsx'
import {
  TEACHER_FEEDBACK_PHASE_TONES,
  teacherFeedbackAudienceText,
  teacherFeedbackAverageText,
  teacherFeedbackParticipationText,
} from './finance-teacher-feedback-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['title', 'phase']
const FILTERS = [
  {
    key: 'phase',
    label: 'Aşama',
    type: 'select' as const,
    options: TEACHER_FEEDBACK_PHASES.map((value) => ({
      value,
      label: TEACHER_FEEDBACK_PHASE_LABELS[value],
    })),
  },
]
const isPhase = (value: unknown): value is TeacherFeedbackPhase =>
  (TEACHER_FEEDBACK_PHASES as readonly unknown[]).includes(value)
const day = (value: string) => dateLabel(`${value}T09:00:00.000Z`, { year: 'numeric' })
const range = (survey: { openDate: string; closeDate: string }) =>
  `${day(survey.openDate)} – ${day(survey.closeDate)}`

/**
 * Öğretmen geri bildirimi (DOM-FIN-159; ON-213; IST-069): Finans "Öğretmen geri bildirimi"
 * sekmesi, yalnız yönetici. Dönemlik anket taslağı açılır, düzeltilir, yayımlanır ve kapatılır;
 * sonuç öğretmen başına, anket kapanınca ve anonimlik eşiği geçildiyse gösterilir, öğretmenin
 * dönemler arası eğilimi açılır (K-532). Öğrenci ve velinin yanıt ekranı ve öğretmenin kendi
 * ekranı rol kabuğundadır (yanıt ve "sonuçlarım" uçları hazır).
 */
export function FinanceTeacherFeedbackSection() {
  const list = useListState('ogretmen-geri-bildirimi', { urlPrefix: 'og_' })
  const search = useDebouncedValue(list.state.query).trim()
  const phase = list.state.filters.phase
  const surveys = useTeacherFeedbackSurveys({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isPhase(phase) ? { phase } : {}),
  })
  const [creating, setCreating] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  const rows = useMemo(
    () =>
      surveys.data?.data.map((survey) => ({
        id: survey.id,
        title: survey.title,
        term: survey.term,
        dates: range(survey),
        audience: teacherFeedbackAudienceText(survey),
        participation: teacherFeedbackParticipationText(survey),
        survey,
      })),
    [surveys.data],
  )
  type Row = NonNullable<typeof rows>[number]
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'title', label: 'Anket' },
      { key: 'term', label: 'Dönem' },
      { key: 'dates', label: 'Açık olduğu günler' },
      {
        key: 'phase',
        label: 'Aşama',
        cell: (row) => <PhaseBadge survey={row.survey} />,
      },
      { key: 'audience', label: 'Hedef kitle' },
      { key: 'participation', label: 'Katılım' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="outline"
            aria-label={`${row.title} anketini aç`}
            onClick={() => setOpened(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [],
  )
  return (
    <section
      aria-labelledby="ogretmen-geri-bildirimi"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="ogretmen-geri-bildirimi" className="text-lg font-semibold">
            Öğretmen geri bildirimi
          </h2>
          <p className="text-sm text-muted-foreground">
            Öğrenci ve velilerin öğretmenleri değerlendirdiği dönemlik anketler. Yanıtlar adla
            saklanmaz; sonuç öğretmen başına, anket kapanınca ve en az eşik kadar yanıtla
            gösterilir. Eşik altında yorumlar hiç gösterilmez.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Yeni geri bildirim anketi</Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={surveys.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Öğretmen geri bildirim anketleri"
        empty="Henüz öğretmen geri bildirim anketi yok."
        emptyFiltered="Bu seçimle eşleşen anket yok."
        loading={surveys.isPending}
        fetching={surveys.isFetching && !surveys.isPending}
        error={
          surveys.error ? (
            <QueryError error={surveys.error} onRetry={() => void surveys.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni öğretmen geri bildirim anketi"
        description="Taslak olarak açılır; yayımlanana kadar düzeltilebilir."
        size="wide"
      >
        {creating ? (
          <TeacherFeedbackForm
            onDone={(id) => {
              setCreating(false)
              setOpened(id)
            }}
          />
        ) : null}
      </Modal>
      <Modal
        open={opened !== null}
        onOpenChange={(open) => (open ? undefined : setOpened(null))}
        title="Öğretmen geri bildirim anketi"
        size="wide"
      >
        {opened === null ? null : <SurveyPanel surveyId={opened} onClose={() => setOpened(null)} />}
      </Modal>
    </section>
  )
}

function PhaseBadge({ survey }: { survey: Pick<TeacherFeedbackRow, 'phase'> }) {
  return (
    <StatusBadge
      text={TEACHER_FEEDBACK_PHASE_LABELS[survey.phase]}
      tone={TEACHER_FEEDBACK_PHASE_TONES[survey.phase]}
    />
  )
}

function SurveyPanel({ surveyId, onClose }: { surveyId: string; onClose: () => void }) {
  const detail = useTeacherFeedbackSurvey(surveyId)
  const [editing, setEditing] = useState(false)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (detail.data === undefined) return <p className="text-sm">Anket yükleniyor…</p>
  const survey = detail.data.data
  return (
    <div className="grid gap-4">
      <SurveySummary survey={survey} />
      {survey.status === 'draft' ? (
        editing ? (
          <TeacherFeedbackForm
            key={survey.version}
            survey={survey}
            onDone={() => setEditing(false)}
          />
        ) : (
          <DraftActions survey={survey} onEdit={() => setEditing(true)} onClose={onClose} />
        )
      ) : (
        <>
          {survey.phase === 'closed' ? null : <CloseAction survey={survey} />}
          <SurveyResults surveyId={survey.id} />
        </>
      )}
    </div>
  )
}

function SurveySummary({ survey }: { survey: TeacherFeedbackDetail }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="font-medium">Başlık</dt>
        <dd>{survey.title}</dd>
      </div>
      <div>
        <dt className="font-medium">Dönem</dt>
        <dd>{survey.term}</dd>
      </div>
      <div>
        <dt className="font-medium">Aşama</dt>
        <dd>
          <PhaseBadge survey={survey} />
        </dd>
      </div>
      <div>
        <dt className="font-medium">Açık olduğu günler</dt>
        <dd>{range(survey)}</dd>
      </div>
      <div>
        <dt className="font-medium">Hedef kitle</dt>
        <dd>{teacherFeedbackAudienceText(survey)}</dd>
      </div>
      <div>
        <dt className="font-medium">Anonimlik eşiği</dt>
        <dd>Öğretmen başına en az {String(survey.anonymityThreshold)} yanıt</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="font-medium">Katılım</dt>
        <dd>{teacherFeedbackParticipationText(survey)}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="font-medium">Sorular</dt>
        <dd>
          <ol className="grid list-decimal gap-1 ps-5">
            {survey.questions.map((question, index) => (
              <li key={`${String(index)}-${question.text}`}>
                {question.text} · {TEACHER_FEEDBACK_QUESTION_KIND_LABELS[question.kind]}
                {question.required ? '' : ' · isteğe bağlı'}
              </li>
            ))}
          </ol>
        </dd>
      </div>
    </dl>
  )
}

function DraftActions({
  survey,
  onEdit,
  onClose,
}: {
  survey: TeacherFeedbackDetail
  onEdit: () => void
  onClose: () => void
}) {
  const publish = usePublishTeacherFeedbackSurvey()
  const archive = useArchiveTeacherFeedbackSurvey()
  const busy = publish.isPending || archive.isPending
  const input = { surveyId: survey.id, version: survey.version }
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={onEdit}>
        Taslağı düzenle
      </Button>
      <Button
        disabled={busy}
        aria-busy={publish.isPending || undefined}
        onClick={() =>
          void publish.submit(input).then((outcome) => {
            if (outcome.status === 'success')
              notify.success('Anket yayımlandı; öğrenci ve veliler açılış gününde yanıtlayabilir.')
          })
        }
      >
        Anketi yayımla
      </Button>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          void archive.submit(input).then((outcome) => {
            if (outcome.status !== 'success') return
            notify.success('Taslak kaldırıldı.')
            onClose()
          })
        }
      >
        Taslağı kaldır
      </Button>
    </div>
  )
}

function CloseAction({ survey }: { survey: TeacherFeedbackDetail }) {
  const close = useCloseTeacherFeedbackSurvey()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={close.isPending}
        aria-busy={close.isPending || undefined}
        onClick={() =>
          void close.submit({ surveyId: survey.id, version: survey.version }).then((outcome) => {
            if (outcome.status === 'success')
              notify.success('Anket kapatıldı; sonuçlar eşik geçen öğretmenler için açıldı.')
          })
        }
      >
        Anketi şimdi kapat
      </Button>
      <span className="text-sm text-muted-foreground">
        Kapatılan anket yanıt almaz ve yeniden açılmaz; sonuçlar kapanınca gösterilir.
      </span>
    </div>
  )
}

function SurveyResults({ surveyId }: { surveyId: string }) {
  const result = useTeacherFeedbackResults(surveyId)
  const [selected, setSelected] = useState<string | null>(null)
  const view = result.data?.data
  return (
    <section aria-labelledby="og-sonuclar" className="grid gap-3">
      <h3 id="og-sonuclar" className="text-base font-semibold">
        Öğretmen başına sonuçlar
      </h3>
      {result.error ? (
        <QueryError error={result.error} onRetry={() => void result.refetch()} />
      ) : view === undefined ? (
        <p className="text-sm">Sonuç yükleniyor…</p>
      ) : view.teachers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz değerlendirme yok.</p>
      ) : (
        <ResultList view={view} selected={selected} onSelect={setSelected} />
      )}
    </section>
  )
}

function ResultList({
  view,
  selected,
  onSelect,
}: {
  view: TeacherFeedbackResultsView
  selected: string | null
  onSelect: (teacherId: string | null) => void
}) {
  const current = view.teachers.find((row) => row.teacherId === selected) ?? null
  return (
    <div className="grid gap-3">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Öğretmen başına sonuçlar</caption>
        <thead>
          <tr>
            <th scope="col" className="font-medium">
              Öğretmen
            </th>
            <th scope="col" className="font-medium">
              Yanıt
            </th>
            <th scope="col" className="font-medium">
              Ortalama
            </th>
            <th scope="col" className="font-medium">
              <span className="sr-only">İşlem</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.teachers.map((row) => (
            <tr key={row.teacherId}>
              <td>{row.teacherName}</td>
              <td>{String(row.responses)}</td>
              <td>
                {row.visible
                  ? teacherFeedbackAverageText(row.average)
                  : row.hiddenReason === 'not_closed'
                    ? 'Kapanınca'
                    : 'Eşik altında'}
              </td>
              <td>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`${row.teacherName} sonucunu göster`}
                  aria-pressed={row.teacherId === selected}
                  onClick={() => onSelect(row.teacherId === selected ? null : row.teacherId)}
                >
                  Ayrıntı
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {current === null ? null : (
        <section aria-label={`${current.teacherName} sonucu`} className="grid gap-3 border-t pt-3">
          <h4 className="font-semibold">{current.teacherName}</h4>
          <TeacherFeedbackResultBody
            result={current}
            threshold={view.threshold}
            label={current.teacherName}
          />
          <TeacherTrend teacherId={current.teacherId} name={current.teacherName} />
        </section>
      )}
    </div>
  )
}

function TeacherTrend({ teacherId, name }: { teacherId: string; name: string }) {
  const trend = useTeacherFeedbackTrend(teacherId)
  if (trend.error) return <QueryError error={trend.error} onRetry={() => void trend.refetch()} />
  if (trend.data === undefined) return <p className="text-sm">Eğilim yükleniyor…</p>
  return (
    <TeacherFeedbackTrendTable
      trend={trend.data.data.trend}
      caption={`${name} · dönemler arası eğilim`}
    />
  )
}
