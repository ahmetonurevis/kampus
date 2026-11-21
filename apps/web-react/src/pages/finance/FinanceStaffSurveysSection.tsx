import { useMemo, useState } from 'react'
import {
  useArchiveStaffSurvey,
  useAssignedStaffSurveys,
  useCopyStaffSurvey,
  usePublishStaffSurvey,
  useStaffSurvey,
  useStaffSurveyResult,
  useStaffSurveys,
  type AssignedStaffSurvey,
  type StaffSurveyDetail,
  type StaffSurveyResultView,
  type StaffSurveyRow,
} from '@kampus/react-shared/use-finance-staff-surveys.ts'
import {
  STAFF_SURVEY_PHASE_LABELS,
  STAFF_SURVEY_PHASES,
  STAFF_SURVEY_QUESTION_KIND_LABELS,
  STAFF_SURVEY_SCALES,
  type StaffSurveyPhase,
} from '@kampus/school-core/lib/finance-staff-surveys.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { StaffSurveyAnswerForm, StaffSurveyForm } from './FinanceStaffSurveyForms.tsx'
import {
  assignedSurveyStatus,
  STAFF_SURVEY_PHASE_TONES,
  staffSurveyAudienceText,
  staffSurveyAverageText,
  staffSurveyEnpsText,
  staffSurveyHiddenText,
  staffSurveyParticipationText,
} from './finance-staff-survey-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['title', 'phase']
const FILTERS = [
  {
    key: 'phase',
    label: 'Aşama',
    type: 'select' as const,
    options: STAFF_SURVEY_PHASES.map((value) => ({
      value,
      label: STAFF_SURVEY_PHASE_LABELS[value],
    })),
  },
]
const isPhase = (value: unknown): value is StaffSurveyPhase =>
  (STAFF_SURVEY_PHASES as readonly unknown[]).includes(value)
const day = (value: string) => dateLabel(`${value}T09:00:00.000Z`, { year: 'numeric' })
const range = (survey: { openDate: string; closeDate: string }) =>
  `${day(survey.openDate)} – ${day(survey.closeDate)}`

/**
 * Personel anketleri (DOM-FIN-143; ON-191): Finans "Personel anketleri" sekmesi. Her personel
 * (yönetici, ön büro) kendi yanıtlayacağı anketleri görür ve bir kez yanıtlar (K-485). Yönetici
 * ayrıca anket taslağı açar, düzeltir, yayımlar, yeni sürüm açar, katılım oranını izler ve
 * kapanan anketin toplu sonucunu okur (K-484, K-486). Öğretmenin yanıt ekranı API'dedir; öğretmen
 * yüzeyi ayrı iştir.
 */
export function FinanceStaffSurveysSection({ isManager }: { isManager: boolean }) {
  return (
    <div className="grid gap-6">
      <AssignedSurveys />
      {isManager ? <ManagedSurveys /> : null}
    </div>
  )
}

function AssignedSurveys() {
  const assigned = useAssignedStaffSurveys()
  const [answering, setAnswering] = useState<AssignedStaffSurvey | null>(null)
  const rows = assigned.data?.data ?? []
  return (
    <section
      aria-labelledby="yanitlayacagim-anketler"
      className="panel overflow-hidden rounded-card border bg-surface px-6 py-6"
    >
      <h2 id="yanitlayacagim-anketler" className="text-lg font-semibold">
        Yanıtlayacağım anketler
      </h2>
      <p className="text-sm text-muted-foreground">
        Anonim personel anketleri: yanıtınız adınızla saklanmaz, sonuçlar yalnız toplu gösterilir.
      </p>
      {assigned.error ? (
        <QueryError error={assigned.error} onRetry={() => void assigned.refetch()} />
      ) : assigned.isPending ? (
        <p className="mt-3 text-sm">Anketler yükleniyor…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Yanıtlayacağınız açık anket yok.</p>
      ) : (
        <ul aria-label="Yanıtlayacağım anketler" className="mt-3 grid gap-2">
          {rows.map((survey) => {
            const status = assignedSurveyStatus(survey)
            return (
              <li
                key={survey.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2"
              >
                <span className="grid gap-1">
                  <span className="font-medium">{survey.title}</span>
                  <span className="text-sm text-muted-foreground">{range(survey)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge text={status.text} tone={status.tone} />
                  {!survey.responded && survey.phase === 'open' ? (
                    <Button
                      size="sm"
                      aria-label={`${survey.title} anketini yanıtla`}
                      onClick={() => setAnswering(survey)}
                    >
                      Yanıtla
                    </Button>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <Modal
        open={answering !== null}
        onOpenChange={(open) => (open ? undefined : setAnswering(null))}
        title={answering?.title ?? 'Anket'}
        size="wide"
      >
        {answering === null ? null : (
          <StaffSurveyAnswerForm survey={answering} onDone={() => setAnswering(null)} />
        )}
      </Modal>
    </section>
  )
}

type SurveyTableRow = {
  id: string
  title: string
  dates: string
  audience: string
  participation: string
  survey: StaffSurveyRow
}

function ManagedSurveys() {
  const list = useListState('personel-anketi', { urlPrefix: 'pa_' })
  const search = useDebouncedValue(list.state.query).trim()
  const phase = list.state.filters.phase
  const surveys = useStaffSurveys({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isPhase(phase) ? { phase } : {}),
  })
  const [creating, setCreating] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  const rows = useMemo(
    () =>
      surveys.data?.data.map((survey): SurveyTableRow => ({
        id: survey.id,
        title:
          survey.revision > 1
            ? `${survey.title} (${String(survey.revision)}. sürüm)`
            : survey.title,
        dates: range(survey),
        audience: staffSurveyAudienceText(survey),
        participation: staffSurveyParticipationText(survey),
        survey,
      })),
    [surveys.data],
  )
  const columns = useMemo<DataColumn<SurveyTableRow>[]>(
    () => [
      { key: 'title', label: 'Anket' },
      { key: 'dates', label: 'Açık olduğu günler' },
      {
        key: 'phase',
        label: 'Aşama',
        cell: (row) => (
          <StatusBadge
            text={STAFF_SURVEY_PHASE_LABELS[row.survey.phase]}
            tone={STAFF_SURVEY_PHASE_TONES[row.survey.phase]}
          />
        ),
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
      aria-labelledby="personel-anketleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="personel-anketleri" className="text-lg font-semibold">
            Personel anketleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Anonim memnuniyet anketleri. Katılım oranı yayımdan itibaren izlenir; sonuçlar anket
            kapanınca, anonimlik eşiği geçildiyse ve yalnız toplu gösterilir. Kimin ne yanıtladığı
            hiçbir yerde görünmez.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Yeni anket</Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={surveys.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Personel anketleri"
        empty="Henüz personel anketi yok."
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
        title="Yeni personel anketi"
        description="Taslak olarak açılır; yayımlanana kadar düzeltilebilir."
        size="wide"
      >
        {creating ? (
          <StaffSurveyForm
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
        title="Personel anketi"
        size="wide"
      >
        {opened === null ? null : <SurveyPanel surveyId={opened} onOpen={setOpened} />}
      </Modal>
    </section>
  )
}

function SurveyPanel({
  surveyId,
  onOpen,
}: {
  surveyId: string
  onOpen: (surveyId: string | null) => void
}) {
  const detail = useStaffSurvey(surveyId)
  const [editing, setEditing] = useState(false)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (detail.data === undefined) return <p className="text-sm">Anket yükleniyor…</p>
  const survey = detail.data.data
  return (
    <div className="grid gap-4">
      <SurveySummary survey={survey} />
      {survey.status === 'draft' ? (
        editing ? (
          <StaffSurveyForm key={survey.version} survey={survey} onDone={() => setEditing(false)} />
        ) : (
          <DraftActions
            survey={survey}
            onEdit={() => setEditing(true)}
            onClose={() => onOpen(null)}
          />
        )
      ) : (
        <>
          <PublishedActions survey={survey} onOpen={onOpen} />
          <SurveyResults survey={survey} />
        </>
      )}
    </div>
  )
}

function SurveySummary({ survey }: { survey: StaffSurveyDetail }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2">
        <dt className="font-medium">Başlık</dt>
        <dd>
          {survey.title}
          {survey.revision > 1 ? ` (${String(survey.revision)}. sürüm)` : ''}
        </dd>
      </div>
      <div>
        <dt className="font-medium">Aşama</dt>
        <dd>
          <StatusBadge
            text={STAFF_SURVEY_PHASE_LABELS[survey.phase]}
            tone={STAFF_SURVEY_PHASE_TONES[survey.phase]}
          />
        </dd>
      </div>
      <div>
        <dt className="font-medium">Açık olduğu günler</dt>
        <dd>{range(survey)}</dd>
      </div>
      <div>
        <dt className="font-medium">Hedef kitle</dt>
        <dd>
          {staffSurveyAudienceText(survey)} · {String(survey.audienceSize)} kişi
        </dd>
      </div>
      <div>
        <dt className="font-medium">Anonimlik eşiği</dt>
        <dd>En az {String(survey.anonymityThreshold)} yanıt</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="font-medium">Katılım</dt>
        <dd>{staffSurveyParticipationText(survey)}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="font-medium">Sorular</dt>
        <dd>
          <ol className="grid list-decimal gap-1 ps-5">
            {survey.questions.map((question, index) => (
              <li key={`${String(index)}-${question.text}`}>
                {question.text} · {STAFF_SURVEY_QUESTION_KIND_LABELS[question.kind]}
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
  survey: StaffSurveyDetail
  onEdit: () => void
  onClose: () => void
}) {
  const publish = usePublishStaffSurvey()
  const archive = useArchiveStaffSurvey()
  const busy = publish.isPending || archive.isPending
  const tooSmall = survey.audienceSize < survey.anonymityThreshold
  return (
    <div className="grid gap-2">
      {tooSmall ? (
        <p role="status" className="text-sm text-muted-foreground">
          Hedef kitlede {String(survey.audienceSize)} kişi var; anonimlik için en az{' '}
          {String(survey.anonymityThreshold)} kişi gerekir.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={onEdit}>
          Taslağı düzenle
        </Button>
        <Button
          disabled={busy}
          aria-busy={publish.isPending || undefined}
          onClick={() =>
            void publish
              .submit({ surveyId: survey.id, version: survey.version })
              .then((outcome) => {
                if (outcome.status === 'success')
                  notify.success('Anket yayımlandı; katılımcı listesi dondu.')
              })
          }
        >
          Anketi yayımla
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void archive
              .submit({ surveyId: survey.id, version: survey.version })
              .then((outcome) => {
                if (outcome.status !== 'success') return
                notify.success('Taslak kaldırıldı.')
                onClose()
              })
          }
        >
          Taslağı kaldır
        </Button>
      </div>
    </div>
  )
}

function PublishedActions({
  survey,
  onOpen,
}: {
  survey: StaffSurveyDetail
  onOpen: (surveyId: string) => void
}) {
  const copy = useCopyStaffSurvey()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={copy.isPending}
        aria-busy={copy.isPending || undefined}
        onClick={() =>
          void copy.submit({ surveyId: survey.id }).then((outcome) => {
            if (outcome.status !== 'success') return
            notify.success('Yeni sürüm taslak olarak açıldı.')
            onOpen(outcome.data.data.id)
          })
        }
      >
        Yeni sürüm aç
      </Button>
      <span className="text-sm text-muted-foreground">
        Yayımlanan anket değişmez; soruları değiştirmek için yeni sürüm açın.
      </span>
    </div>
  )
}

const ALL_UNITS = ''

function SurveyResults({ survey }: { survey: StaffSurveyDetail }) {
  const [unit, setUnit] = useState(ALL_UNITS)
  const result = useStaffSurveyResult(survey.id, unit === ALL_UNITS ? null : unit)
  const view = result.data?.data
  return (
    <section aria-labelledby="anket-sonuclari" className="grid gap-3">
      <h3 id="anket-sonuclari" className="text-base font-semibold">
        Sonuçlar
      </h3>
      {result.error ? (
        <QueryError error={result.error} onRetry={() => void result.refetch()} />
      ) : view === undefined ? (
        <p className="text-sm">Sonuç yükleniyor…</p>
      ) : (
        <>
          {view.units.length > 0 || unit !== ALL_UNITS ? (
            <FormField id="pa-sonuc-birim" label="Birim kırılımı">
              {(control) => (
                <NativeSelect
                  {...control}
                  className="w-full sm:w-72"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                >
                  <NativeSelectOption value={ALL_UNITS}>Bütün yanıtlar</NativeSelectOption>
                  {view.units.map((row) => (
                    <NativeSelectOption key={row.unit} value={row.unit}>
                      {row.name} ({String(row.responses)} yanıt)
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          ) : null}
          <ResultBody view={view} />
        </>
      )}
    </section>
  )
}

function ResultBody({ view }: { view: StaffSurveyResultView }) {
  const hidden = staffSurveyHiddenText(view)
  if (hidden !== null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {hidden}
      </p>
    )
  return (
    <ol className="grid gap-4">
      {view.questions.map((question, index) => (
        <li key={`${String(index)}-${question.text}`} className="grid gap-1 border-b pb-3">
          <span className="font-medium">
            {String(index + 1)}. {question.text}
          </span>
          {question.hidden ? (
            <span className="text-sm text-muted-foreground">
              Bu sorunun sonucu gizli: cevap sayısı anonimlik eşiğinin altında.
            </span>
          ) : question.kind === 'open' ? (
            question.texts.length === 0 ? (
              <span className="text-sm text-muted-foreground">Cevap yok.</span>
            ) : (
              <ul
                aria-label={`${String(index + 1)}. soru cevapları`}
                className="grid gap-1 text-sm"
              >
                {question.texts.map((text, position) => (
                  <li key={`${String(position)}-${text}`} className="whitespace-pre-line">
                    {text}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <ScaleResult question={question} />
          )}
        </li>
      ))}
    </ol>
  )
}

function ScaleResult({ question }: { question: StaffSurveyResultView['questions'][number] }) {
  if (question.kind === 'open') return null
  const { min } = STAFF_SURVEY_SCALES[question.kind]
  return (
    <div className="grid gap-1 text-sm">
      <span>
        Ortalama {staffSurveyAverageText(question.average)} · {String(question.answered ?? 0)} cevap
        {question.enps === null ? '' : ` · eNPS ${staffSurveyEnpsText(question.enps.score)}`}
      </span>
      {question.enps === null ? null : (
        <span className="text-muted-foreground">
          Tavsiye eden {String(question.enps.promoters)} · nötr {String(question.enps.passives)} ·
          kötüleyen {String(question.enps.detractors)}
        </span>
      )}
      <table className="w-full max-w-md text-left">
        <caption className="sr-only">{question.text} dağılımı</caption>
        <thead>
          <tr>
            <th scope="col" className="font-medium">
              Puan
            </th>
            <th scope="col" className="font-medium">
              Yanıt
            </th>
          </tr>
        </thead>
        <tbody>
          {question.distribution.map((total, offset) => (
            <tr key={String(min + offset)}>
              <td>{String(min + offset)}</td>
              <td>{String(total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
