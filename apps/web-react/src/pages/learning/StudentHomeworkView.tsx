import { useMemo, useState } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { SidePanel } from '@/components/SidePanel.tsx'
import { SummaryLoading, SummarySection } from '../management/SummaryParts.tsx'
import { Facts, SummaryTitle, TableGate } from './LearningParts.tsx'
import { homeworkRow, type HomeworkRow } from './learning-rows.ts'

type Student = CoreRecord<'students'>
type Props = { student: Student; title: string }

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['subject', 'dueDate', 'status']

/**
 * Seçili öğrencinin ödevleri (öğrencide kendisi, velide seçili çocuk): sınıfının ödevleri ve
 * kendi teslimleri. Durum core `homeworkStatus` ile hesaplanır, saklanmaz. Teslim yazma
 * TODO(api-homework-submit): dosya depolama ADR'si (0003) onaylanınca eklenir.
 */
export function StudentHomeworkView({ student, title }: Props) {
  const homework = useCoreAll('homework', { filters: { classId: student.classId } })
  const submissions = useCoreAll('submissions', { filters: { studentId: student.id } })
  const classes = useCoreAll('classes')
  const rows = useMemo(() => {
    if (!homework.data || !submissions.data) return undefined
    const entries = submissions.data.map((row) => row.record)
    const now = new Date()
    return homework.data.map((item) => homeworkRow(item, entries, student.id, now))
  }, [homework.data, submissions.data, student.id])

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
            for (const query of [homework, submissions, classes])
              if (query.error) void query.refetch()
          }}
          loading={rows === undefined}
        >
          <DataTable
            listKey="odevlerim"
            rows={rows ?? NONE}
            columns={columns}
            mobileColumns={MOBILE_COLUMNS}
            caption={title}
            searchKeys={['title', 'subject']}
            onRowClick={(row) => openHomework(row.id)}
          />
        </TableGate>
      </section>
      <StudentHomeworkPanel
        homeworkId={panel.selectedId}
        studentId={student.id}
        classNameOf={(classId) =>
          classes.data?.find((row) => row.record.id === classId)?.record.name ?? '—'
        }
        onClose={panel.close}
      />
    </>
  )
}

type PanelProps = {
  homeworkId: string
  studentId: string
  classNameOf: (classId: string) => string
  onClose: () => void
}

function StudentHomeworkPanel({ homeworkId, studentId, classNameOf, onClose }: PanelProps) {
  return (
    <SidePanel
      open={homeworkId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ödev ayrıntısı"
    >
      {homeworkId ? (
        <HomeworkDetail homeworkId={homeworkId} studentId={studentId} classNameOf={classNameOf} />
      ) : null}
    </SidePanel>
  )
}

function HomeworkDetail({ homeworkId, studentId, classNameOf }: Omit<PanelProps, 'onClose'>) {
  // Tek kayıt ucu kapsamı uygular: kapsam dışı ödev 404 döner ve "bulunamadı" görünür.
  const item = useCoreItem('homework', homeworkId)
  const submissions = useCoreAll('submissions', { filters: { homeworkId, studentId } })
  const [now] = useState(() => new Date())
  const error = item.error ?? submissions.error
  if (error)
    return (
      <QueryError
        error={error}
        onRetry={() => {
          if (item.error) void item.refetch()
          if (submissions.error) void submissions.refetch()
        }}
      />
    )
  if (!item.data || !submissions.data) return <SummaryLoading />
  const row = homeworkRow(
    item.data,
    submissions.data.map((entry) => entry.record),
    studentId,
    now,
  )
  const submission = submissions.data[0]?.record
  return (
    <>
      <SummaryTitle
        icon="NotebookPen"
        title={row.title}
        subtitle={`${classNameOf(item.data.record.classId)} · ${row.subject}`}
      />
      <Facts
        items={[
          ['Durum', <StatusBadge key="durum" text={row.status} />],
          ['Son teslim', dateLabel(row.dueDate, { year: 'numeric' })],
          [
            'Teslim tarihi',
            submission
              ? dateLabel(submission.submittedAt, { year: 'numeric' })
              : 'Henüz teslim edilmedi',
          ],
          ['Teslim dosyası', submission?.fileName ?? '—'],
          ['Not', row.score === null ? '—' : row.score],
        ]}
      />
      <SummarySection title="Ödev açıklaması">
        <p className="text-sm [overflow-wrap:anywhere]">{row.description}</p>
      </SummarySection>
      {submission?.feedback ? (
        <SummarySection title="Öğretmen geri bildirimi">
          <p className="text-sm [overflow-wrap:anywhere]">{submission.feedback}</p>
        </SummarySection>
      ) : null}
    </>
  )
}
