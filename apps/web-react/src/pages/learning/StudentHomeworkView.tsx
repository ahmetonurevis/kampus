import { useMemo } from 'react'
import type { HomeworkDetail as HomeworkRecord } from '@kampus/react-shared/homework.ts'
import { useAllHomework, useHomework } from '@kampus/react-shared/use-homework.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import { SummaryLoading, SummarySection } from '../management/SummaryParts.tsx'
import { submissionWindow } from './homework-forms.ts'
import { Facts, SummaryTitle, TableGate } from './LearningParts.tsx'
import { homeworkRow, type HomeworkRow } from './learning-rows.ts'
import { StudentSubmissionForm } from './StudentSubmissionForm.tsx'
import { SubmissionFileList } from './SubmissionFiles.tsx'

type Student = CoreRecord<'students'>
/** `student`: kendi ödevleri, teslim formuyla; `parent`: seçili çocuğun ödevleri, salt okur. */
export type HomeworkViewMode = 'student' | 'parent'
type Props = { student: Student; title: string; mode: HomeworkViewMode }

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['subject', 'dueDate', 'status']

const dueText = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * Seçili öğrencinin ödevleri (öğrencide kendisi, velide seçili çocuk; IST-095, DOM-AKD-072…074):
 * sınıfının ödevleri `/homework` ucundan, öğrencinin teslim durumu ve puanı kendi teslim
 * kayıtlarından. Durum core `homeworkStatus` ile hesaplanır, saklanmaz. Öğrenci panelden not ve
 * dosyayla teslim eder; veli teslim durumunu, puanı ve geri bildirimi salt okur.
 */
export function StudentHomeworkView({ student, title, mode }: Props) {
  const homework = useAllHomework({ classId: student.classId })
  // Velinin iki çocuğu aynı sınıfta olabilir: durum ve puan seçili çocuğun teslimlerinden.
  const submissions = useCoreAll('submissions', { filters: { studentId: student.id } })
  const classes = useCoreAll('classes')
  const now = useMinuteClock()
  const rows = useMemo(() => {
    if (!homework.data || !submissions.data) return undefined
    const entries = submissions.data.map((row) => row.record)
    return homework.data.map((item) => homeworkRow(item, entries, student.id, new Date(now)))
  }, [homework.data, submissions.data, student.id, now])

  const panel = useDetailPanel('odev')
  const openHomework = panel.open
  const columns = useMemo<DataColumn<HomeworkRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Ödev',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openHomework(row.id)}
            aria-label={`${row.title} ayrıntısını aç`}
            className="record-link max-w-[340px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'subject', label: 'Ders' },
      {
        key: 'dueDate',
        label: 'Son teslim',
        cell: (row) => dateLabel(row.dueDate, { year: 'numeric' }),
      },
      { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
      { key: 'score', label: 'Not', cell: (row) => (row.score === null ? '—' : row.score) },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.title} ayrıntısı`}
            onClick={() => openHomework(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openHomework],
  )

  const error = homework.error ?? submissions.error ?? classes.error
  return (
    <>
      <section
        aria-labelledby="odev-durumu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="odev-durumu" className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{rows?.length ?? 0} ödev</p>
        </header>
        <TableGate
          error={error}
          onRetry={() => {
            if (homework.error) void homework.refetch()
            if (submissions.error) void submissions.refetch()
            if (classes.error) void classes.refetch()
          }}
          loading={rows === undefined}
        >
          <DataTable
            listKey={mode === 'student' ? 'odevlerim' : 'cocuk-odevleri'}
            rows={rows ?? NONE}
            columns={columns}
            mobileColumns={MOBILE_COLUMNS}
            caption={title}
            searchKeys={['title', 'subject']}
            onRowClick={(row) => openHomework(row.id)}
          />
        </TableGate>
      </section>
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Ödev ayrıntısı"
      >
        {panel.selectedId ? (
          <HomeworkDetail
            key={panel.selectedId}
            homeworkId={panel.selectedId}
            studentId={student.id}
            mode={mode}
            classNameOf={(classId) =>
              classes.data?.find((row) => row.record.id === classId)?.record.name ?? '—'
            }
          />
        ) : null}
      </SidePanel>
    </>
  )
}

function HomeworkDetail({
  homeworkId,
  studentId,
  mode,
  classNameOf,
}: {
  homeworkId: string
  studentId: string
  mode: HomeworkViewMode
  classNameOf: (classId: string) => string
}) {
  // Tek kayıt ucu kapsamı uygular: kapsam dışı ödev 404 döner ve "bulunamadı" görünür. Teslimler
  // okuyanın gördükleridir (öğrencide kendisininki, velide çocuklarınınki; DOM-AKD-074).
  const item = useHomework(homeworkId)
  const now = useMinuteClock()
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const homework = item.data?.data
  if (!homework) return <SummaryLoading />
  const submission = homework.submissions.find((entry) => entry.studentId === studentId)
  const row = homeworkRow(homework, homework.submissions, studentId, new Date(now))
  const phase = submissionWindow(homework, submission, now)
  return (
    <>
      <SummaryTitle
        icon="NotebookPen"
        title={row.title}
        subtitle={`${classNameOf(homework.classId)} · ${row.subject}`}
      />
      <Facts
        items={[
          [
            'Durum',
            <span key="durum" className="inline-flex flex-wrap justify-end gap-2">
              {submission?.late ? <StatusBadge text="Geç teslim" tone="amber" /> : null}
              <StatusBadge text={row.status} />
            </span>,
          ],
          ['Son teslim', dueText(homework.dueDate)],
          ['Geç teslim', homework.allowLate ? 'Kabul edilir' : 'Kabul edilmez'],
          ['Teslim tarihi', submission ? dueText(submission.submittedAt) : 'Henüz teslim edilmedi'],
          ['Teslim dosyası', fileSummary(submission)],
          ['Not', row.score === null ? '—' : row.score],
        ]}
      />
      <SummarySection title="Ödev açıklaması">
        <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{row.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <PdfButton
            type="homework"
            recordId={row.id}
            studentId={studentId}
            label="Çalışma kâğıdını görüntüle"
            size="default"
          />
        </div>
      </SummarySection>
      {submission?.feedback ? (
        <SummarySection title="Öğretmen geri bildirimi">
          <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">
            {submission.feedback}
          </p>
        </SummarySection>
      ) : null}
      {submission ? (
        <SummarySection title={mode === 'student' ? 'Teslimin' : 'Teslim'}>
          <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">
            {submission.note || 'Açıklama yazılmadı.'}
          </p>
          {submission.fileIds.length ? (
            <div className="mt-3">
              <SubmissionFileList fileIds={submission.fileIds} />
            </div>
          ) : null}
        </SummarySection>
      ) : null}
      {mode === 'student' ? (
        <SubmissionArea homework={homework} submission={submission} phase={phase} />
      ) : null}
    </>
  )
}

/** Teslim dosyası özeti: eski kayıtlarda dosya adı, yeni teslimde dosya sayısı. */
function fileSummary(submission: HomeworkRecord['submissions'][number] | undefined): string {
  if (!submission) return '—'
  if (submission.fileName) return submission.fileName
  return submission.fileIds.length ? `${submission.fileIds.length} dosya` : '—'
}

function SubmissionArea({
  homework,
  submission,
  phase,
}: {
  homework: HomeworkRecord
  submission: HomeworkRecord['submissions'][number] | undefined
  phase: ReturnType<typeof submissionWindow>
}) {
  if (phase === 'graded')
    return (
      <p role="status" className="rounded-card border bg-muted p-4 text-sm">
        Teslimin değerlendirildi; değerlendirilmiş teslim değiştirilemez.
      </p>
    )
  if (phase === 'closed')
    return (
      <p role="status" className="rounded-card border bg-muted p-4 text-sm">
        Teslim süresi doldu; bu ödev geç teslime kapalı.
      </p>
    )
  return (
    <SummarySection title={submission ? 'Teslimi güncelle' : 'Teslim et'}>
      <StudentSubmissionForm
        key={`${submission?.id ?? 'yeni'}-${submission?.version ?? 0}`}
        homeworkId={homework.id}
        submission={submission}
        late={phase === 'late'}
      />
    </SummarySection>
  )
}
