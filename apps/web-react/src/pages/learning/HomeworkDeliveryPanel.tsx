// Öğretmen ve yönetici ödev paneli (IST-095; DOM-AKD-070…074). Tek sağ panelin içeriği adresteki
// parametreye göre değişir: `?odev=` teslim durumu, `?odev-form=` ödev ver/düzenle, `?odev=…&teslim=`
// teslimi değerlendir. Panel kapatılınca en üstteki adım geri alınır (form → teslim durumu).
import { useMemo, useState } from 'react'
import type { HomeworkDetail, HomeworkSubmission } from '@kampus/react-shared/homework.ts'
import { useHomework } from '@kampus/react-shared/use-homework.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { Icon } from '@/components/Icon.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import { SummaryLoading, SummaryMetrics, SummarySection } from '../management/SummaryParts.tsx'
import { homeworkActions, type HomeworkActor } from './homework-forms.ts'
import {
  ArchiveHomeworkDialog,
  GradeForm,
  HomeworkFormContent,
  NEW_HOMEWORK,
} from './HomeworkForms.tsx'
import { Facts, SummaryTitle } from './LearningParts.tsx'
import { deliverySummary, type DeliveryEntry } from './learning-rows.ts'
import { SubmissionFileList } from './SubmissionFiles.tsx'
import { useClassRoster } from './use-class-roster.ts'

export type PanelControl = {
  selectedId: string
  open: (id: string) => void
  close: () => void
}

type Props = {
  detail: PanelControl
  form: PanelControl
  grading: PanelControl
  actor: HomeworkActor
}

const dueText = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function HomeworkDeliveryPanel({ detail, form, grading, actor }: Props) {
  const mode = form.selectedId
    ? 'form'
    : detail.selectedId
      ? grading.selectedId
        ? 'grade'
        : 'detail'
      : null
  const title =
    mode === 'form'
      ? form.selectedId === NEW_HOMEWORK
        ? 'Ödev ver'
        : 'Ödevi düzenle'
      : mode === 'grade'
        ? 'Teslimi değerlendir'
        : 'Ödev teslim durumu'
  const close = mode === 'form' ? form.close : mode === 'grade' ? grading.close : detail.close
  return (
    <SidePanel
      open={mode !== null}
      onOpenChange={(open) => (open ? undefined : close())}
      title={title}
    >
      {mode === 'form' ? (
        <HomeworkFormContent
          key={form.selectedId}
          target={form.selectedId}
          actor={actor}
          onClose={form.close}
        />
      ) : mode === 'grade' ? (
        <GradeContent
          key={grading.selectedId}
          homeworkId={detail.selectedId}
          submissionId={grading.selectedId}
          onClose={grading.close}
        />
      ) : mode === 'detail' ? (
        <DeliveryDetail
          homeworkId={detail.selectedId}
          actor={actor}
          onEdit={() => form.open(detail.selectedId)}
          onGrade={grading.open}
          onArchived={detail.close}
        />
      ) : null}
    </SidePanel>
  )
}

/**
 * Teslimleri görebilen okur (DOM-AKD-074): yönetici, ödevin öğretmeni ve sınıfın rehber
 * öğretmeni. Aynı sınıfa başka dersle giren öğretmen teslim sayısını da görmez.
 */
function seesSubmissions(
  actor: HomeworkActor,
  homework: Pick<HomeworkDetail, 'teacherId'>,
  guidanceTeacherId: string | undefined,
) {
  if (actor.role === 'yonetici') return true
  return (
    actor.teacherId !== null &&
    (homework.teacherId === actor.teacherId || guidanceTeacherId === actor.teacherId)
  )
}

function DeliveryDetail({
  homeworkId,
  actor,
  onEdit,
  onGrade,
  onArchived,
}: {
  homeworkId: string
  actor: HomeworkActor
  onEdit: () => void
  onGrade: (submissionId: string) => void
  onArchived: () => void
}) {
  // Tek kayıt ucu kapsamı uygular: başka sınıfın ödevi 404 döner ve "bulunamadı" görünür.
  const item = useHomework(homeworkId)
  const homework = item.data?.data
  const classItem = useCoreItem('classes', homework?.classId ?? null)
  const { roster, query: students } = useClassRoster(homework?.classId)
  const now = useMinuteClock()
  const [archiving, setArchiving] = useState(false)
  const summary = useMemo(
    () =>
      homework && roster
        ? deliverySummary(homework, homework.submissions, roster, new Date(now))
        : null,
    [homework, roster, now],
  )
  const error = item.error ?? students.error
  if (error)
    return (
      <QueryError
        error={error}
        onRetry={() => {
          if (item.error) void item.refetch()
          if (students.error) void students.refetch()
        }}
      />
    )
  if (!homework || !summary) return <SummaryLoading />
  const className = classItem.data?.record.name ?? '—'
  const actions = homeworkActions(actor, homework)
  const visible = seesSubmissions(actor, homework, classItem.data?.record.teacherId)
  const byId = new Map(homework.submissions.map((entry) => [entry.id, entry]))
  return (
    <>
      <SummaryTitle
        icon="NotebookPen"
        title={homework.title}
        subtitle={`${className} · ${homework.subject} · Son teslim ${dateLabel(homework.dueDate, { year: 'numeric' })}`}
      />
      <Facts
        items={[
          ['Son teslim', dueText(homework.dueDate)],
          ['Geç teslim', homework.allowLate ? 'Kabul edilir' : 'Kabul edilmez'],
          [
            'Durum',
            <StatusBadge
              key="durum"
              text={homework.status === 'open' ? 'Açık' : 'Süresi doldu'}
              tone={homework.status === 'open' ? 'green' : 'gray'}
            />,
          ],
        ]}
      />
      {actions.manage ? (
        <div className="mb-6 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onEdit}>
            <Icon name="Pencil" size={15} aria-hidden="true" />
            Düzenle
          </Button>
          <Button type="button" variant="outline" onClick={() => setArchiving(true)}>
            <Icon name="Archive" size={15} aria-hidden="true" />
            Arşivle
          </Button>
          <ArchiveHomeworkDialog
            homework={homework}
            open={archiving}
            onOpenChange={setArchiving}
            onArchived={onArchived}
          />
        </div>
      ) : null}
      {visible ? (
        <SummaryMetrics
          items={[
            { label: 'Teslim eden', value: `${summary.delivered} / ${summary.total}` },
            { label: 'Geciken', value: summary.late },
            { label: 'Bekleyen', value: summary.pending },
            { label: 'Değerlendirilen', value: summary.evaluated },
          ]}
        />
      ) : null}
      <SummarySection title="Ödev açıklaması">
        <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">
          {homework.description}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <PdfButton
            type="homework"
            recordId={homework.id}
            label="Çalışma kâğıdını görüntüle"
            size="default"
          />
        </div>
      </SummarySection>
      <SummarySection title="Öğrenci durumu">
        {!visible ? (
          <p className="text-sm text-muted-foreground">
            Teslimleri yalnız ödevin öğretmeni, sınıfın rehber öğretmeni ve yönetici görür.
          </p>
        ) : summary.students.length ? (
          <ul aria-label="Öğrenci teslim durumu" className="detail-list grid gap-2">
            {summary.students.map((entry) => (
              <StudentLine
                key={entry.studentId}
                entry={entry}
                submission={entry.submissionId ? byId.get(entry.submissionId) : undefined}
                canGrade={actions.grade}
                onGrade={onGrade}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Bu sınıfta aktif öğrenci yok.</p>
        )}
      </SummarySection>
    </>
  )
}

function StudentLine({
  entry,
  submission,
  canGrade,
  onGrade,
}: {
  entry: DeliveryEntry
  submission: HomeworkSubmission | undefined
  canGrade: boolean
  onGrade: (submissionId: string) => void
}) {
  return (
    <li className="grid gap-2 rounded-xl border px-3.5 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <strong className="font-medium">{entry.name}</strong>
        <span className="flex flex-wrap items-center justify-end gap-2">
          {entry.late ? <StatusBadge text="Geç teslim" tone="amber" /> : null}
          <StatusBadge text={entry.status} />
          {submission?.score != null ? (
            <span className="font-medium">{submission.score} puan</span>
          ) : null}
        </span>
      </div>
      {submission ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canGrade ? (
            <Button
              type="button"
              size="sm"
              variant={submission.score === null ? 'default' : 'secondary'}
              aria-label={`${entry.name} teslimini ${submission.score === null ? 'değerlendir' : 'yeniden değerlendir'}`}
              onClick={() => onGrade(submission.id)}
            >
              <Icon name="ClipboardCheck" size={15} aria-hidden="true" />
              {submission.score === null ? 'Değerlendir' : 'Yeniden değerlendir'}
            </Button>
          ) : null}
          <PdfButton
            type="submission"
            recordId={submission.id}
            label="Değerlendirme formu"
            ariaLabel={`${entry.name} değerlendirme formunu görüntüle`}
          />
        </div>
      ) : null}
    </li>
  )
}

function GradeContent({
  homeworkId,
  submissionId,
  onClose,
}: {
  homeworkId: string
  submissionId: string
  onClose: () => void
}) {
  const item = useHomework(homeworkId)
  const homework = item.data?.data
  const { roster, query: students } = useClassRoster(homework?.classId)
  // Formun açıldığı andaki teslim: tazeleme girdiyi silmesin.
  const [opened, setOpened] = useState<HomeworkSubmission | null>(null)
  const live = homework?.submissions.find((entry) => entry.id === submissionId)
  if (!opened && live) setOpened(live)

  async function fetchFresh(): Promise<HomeworkSubmission | undefined> {
    const result = await item.refetch()
    if (result.error) return undefined
    return result.data?.data.submissions.find((entry) => entry.id === submissionId)
  }

  if (item.error && !opened)
    return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!homework || (students.isPending && !students.error)) return <SummaryLoading />
  if (!opened)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Teslim bulunamadı ya da görüntüleme yetkiniz yok.
      </p>
    )
  const name = roster?.find((student) => student.id === opened.studentId)?.name ?? 'Öğrenci'
  return (
    <>
      <SummaryTitle
        icon="ClipboardCheck"
        title={name}
        subtitle={`${homework.title} · ${homework.subject}`}
      />
      <Facts
        items={[
          ['Teslim', dueText(opened.submittedAt)],
          ['Geç teslim', opened.late ? 'Evet' : 'Hayır'],
          ['Önceki puan', opened.score === null ? '—' : opened.score],
        ]}
      />
      <SummarySection title="Öğrencinin notu">
        <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">
          {opened.note || 'Not yazılmadı.'}
        </p>
      </SummarySection>
      {opened.fileIds.length ? (
        <SummarySection title="Teslim dosyaları">
          <SubmissionFileList fileIds={opened.fileIds} />
        </SummarySection>
      ) : null}
      <GradeForm
        homeworkId={homeworkId}
        submission={opened}
        fetchFresh={fetchFresh}
        onClose={onClose}
      />
    </>
  )
}
