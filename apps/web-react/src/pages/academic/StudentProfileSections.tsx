// Öğretmenin öğrenci profili bölümleri: ödev durumu, quiz sonuçları, hedefler ve rehberlik.
// Veri kapsamlı koleksiyon uçlarından gelir; satırlar `student-profile-model.ts`'te hesaplanır.
import { useMemo } from 'react'
import { Link } from 'react-router'
import { isUnreadableCollectionError } from '@kampus/react-shared/collections.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import type { HomeworkRow } from '../learning/learning-rows.ts'
import { TableGate } from '../learning/LearningParts.tsx'
import { TableSection } from './AcademicParts.tsx'
import { scoreText, scoreTone, type AcademicLookups } from './academic-rows.ts'
import {
  goalRows,
  guidanceRows,
  profileHomeworkRows,
  quizResultRows,
  type GoalRow,
  type QuizResultRow,
} from './student-profile-model.ts'

const NONE: readonly never[] = []

/** Bölümlerin ortak girdisi: öğrenci, öğretmenin kimliği ve sınıftaki görevi. */
export type ProfileContext = {
  studentId: string
  classId: string
  teacherId: string
  homeroom: boolean
  lookups: AcademicLookups
}

const WORK_NOTE = 'Yalnız sizin verdiğiniz işler; sınıf danışmanı sınıfın bütün işlerini görür.'

function retryAll(...queries: readonly { error: unknown; refetch: () => unknown }[]) {
  return () => {
    for (const query of queries) if (query.error) void query.refetch()
  }
}

const HOMEWORK_COLUMNS: DataColumn<HomeworkRow>[] = [
  { key: 'title', label: 'Ödev' },
  { key: 'subject', label: 'Ders' },
  { key: 'dueDate', label: 'Son teslim', cell: (row) => dateLabel(row.dueDate) },
  { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
  {
    key: 'score',
    label: 'Puan',
    cell: (row) =>
      row.score === null ? (
        'Henüz notlandırılmadı'
      ) : (
        <StatusBadge text={scoreText(row.score)} tone={scoreTone(row.score)} />
      ),
  },
]

/** Ödev durumu (Vue profil "Ödev durumu"): sınıfın ödevleri ve öğrencinin teslim durumu. */
export function ProfileHomework({ context }: { context: ProfileContext }) {
  // Sınıf süzgeci yok: sınıf değiştirmiş öğrencinin eski sınıftaki ödevi de gelir, satırları
  // `profileHomeworkRows` ayıklar. Kapsamı sunucu uygular (DOM-AKD-074).
  const homework = useCoreAll('homework')
  const submissions = useCoreAll('submissions', { filters: { studentId: context.studentId } })
  const now = useMinuteClock()
  const rows = useMemo(() => {
    if (!homework.data || !submissions.data) return undefined
    return profileHomeworkRows(
      homework.data.map((row) => row.record),
      submissions.data.map((row) => row.record),
      { ...context, now: new Date(now) },
    )
  }, [homework.data, submissions.data, context, now])
  return (
    <TableSection title="Ödev durumu" subtitle={WORK_NOTE}>
      <TableGate
        error={homework.error ?? submissions.error}
        onRetry={retryAll(homework, submissions)}
        loading={rows === undefined}
      >
        <DataTable
          listKey="profil-odevler"
          urlPrefix="odev-"
          rows={rows ?? NONE}
          columns={HOMEWORK_COLUMNS}
          mobileColumns={['dueDate', 'status']}
          searchKeys={['title', 'subject']}
          caption="Ödev durumu"
          empty="Bu öğrenci için görebileceğiniz ödev yok."
        />
      </TableGate>
    </TableSection>
  )
}

const QUIZ_COLUMNS: DataColumn<QuizResultRow>[] = [
  { key: 'title', label: 'Quiz' },
  { key: 'subject', label: 'Ders' },
  { key: 'date', label: 'Tarih', cell: (row) => dateLabel(row.date) },
  { key: 'result', label: 'Sonuç' },
  {
    key: 'score',
    label: 'Puan',
    cell: (row) =>
      row.score === null ? '—' : <StatusBadge text={`%${row.score}`} tone={scoreTone(row.score)} />,
  },
]

/** Quiz sonuçları: öğrencinin denemeleri; puan sunucuda cevaplardan hesaplanmıştır. */
export function ProfileQuizResults({ context }: { context: ProfileContext }) {
  const attempts = useCoreAll('quizAttempts', { filters: { studentId: context.studentId } })
  // Denemeler öğrenciye göre süzülür; quiz sınıfa değil öğretmene bağlı okunur (DOM-AKD-079).
  const quizzes = useCoreAll('quizzes')
  const rows = useMemo(() => {
    if (!attempts.data || !quizzes.data) return undefined
    return quizResultRows(
      attempts.data.map((row) => row.record),
      quizzes.data.map((row) => row.record),
      context.lookups.subjects,
      context,
    )
  }, [attempts.data, quizzes.data, context])
  return (
    <TableSection title="Quiz sonuçları" subtitle={WORK_NOTE}>
      <TableGate
        error={attempts.error ?? quizzes.error}
        onRetry={retryAll(attempts, quizzes)}
        loading={rows === undefined}
      >
        <DataTable
          listKey="profil-quizler"
          urlPrefix="quiz-"
          rows={rows ?? NONE}
          columns={QUIZ_COLUMNS}
          mobileColumns={['date', 'score']}
          searchKeys={['title', 'subject']}
          caption="Quiz sonuçları"
          empty="Bu öğrencinin görebileceğiniz quiz sonucu yok."
        />
      </TableGate>
    </TableSection>
  )
}

const GOAL_COLUMNS: DataColumn<GoalRow>[] = [
  { key: 'title', label: 'Hedef' },
  { key: 'subject', label: 'Ders' },
  { key: 'targetNet', label: 'Hedef net' },
  { key: 'deadline', label: 'Son tarih', cell: (row) => dateLabel(row.deadline) },
  { key: 'steps', label: 'Adımlar' },
  { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
]

/** Hedefler: öğretmen kendi dersinin ve genel net hedeflerini görür (kapsam sunucuda). */
export function ProfileGoals({ context }: { context: ProfileContext }) {
  const goals = useCoreAll('studentGoals', { filters: { studentId: context.studentId } })
  const rows = useMemo(
    () =>
      goals.data &&
      goalRows(
        goals.data.map((row) => row.record),
        context.lookups.subjects,
        context.studentId,
      ),
    [goals.data, context],
  )
  if (goals.error && isUnreadableCollectionError(goals.error)) return null
  return (
    <TableSection
      title="Hedefler"
      subtitle="Dersinizin ve genel net hedefleri; ilerleme deneme sonuçlarından hesaplanır."
      action={<PageLink to="/ogretmen/hedef-plani" label="Hedef & Gelişim Planı" />}
    >
      <TableGate error={goals.error} onRetry={retryAll(goals)} loading={rows === undefined}>
        <DataTable
          listKey="profil-hedefler"
          urlPrefix="hedef-"
          rows={rows ?? NONE}
          columns={GOAL_COLUMNS}
          mobileColumns={['deadline', 'status']}
          search={false}
          caption="Hedefler"
          empty="Bu öğrencinin görebileceğiniz hedefi yok."
        />
      </TableGate>
    </TableSection>
  )
}

/**
 * Rehberlik: paylaşılan destek planı ve takip tarihi. Kurum içi görüşme notu profilde hiç
 * gösterilmez (DOM-YTK-020); rehberlik görevli öğretmen onu Rehberlik & Takip sayfasında okur.
 */
export function ProfileGuidance({ context }: { context: ProfileContext }) {
  const cases = useCoreAll('guidanceCases', { filters: { studentId: context.studentId } })
  const rows = useMemo(
    () =>
      cases.data &&
      guidanceRows(
        cases.data.map((row) => row.record),
        context.studentId,
      ),
    [cases.data, context.studentId],
  )
  if (cases.error && isUnreadableCollectionError(cases.error)) return null
  return (
    <TableSection
      title="Rehberlik"
      subtitle="Veli ve öğrenciyle paylaşılan destek planı."
      action={<PageLink to="/ogretmen/rehberlik" label="Rehberlik & Takip" />}
    >
      <TableGate error={cases.error} onRetry={retryAll(cases)} loading={rows === undefined}>
        {rows && rows.length > 0 ? (
          <ul aria-label="Rehberlik dosyaları" className="grid divide-y border-t">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-1.5 px-6 py-4 max-[650px]:px-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-md font-semibold [overflow-wrap:anywhere]">{row.title}</h3>
                  <StatusBadge text={row.status} />
                </div>
                <p className="text-sm [overflow-wrap:anywhere]">{row.plan}</p>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {row.sharedNote}
                </p>
                <p className="text-xs text-muted-foreground">
                  Sonraki takip: {dateLabel(row.followUp)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t px-6 py-5 text-sm text-muted-foreground">
            Bu öğrenci için görebileceğiniz rehberlik dosyası yok.
          </p>
        )}
      </TableGate>
    </TableSection>
  )
}

function PageLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="text-link inline-flex min-h-6 items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      {label}
      <Icon name="ArrowRight" size={14} aria-hidden="true" />
    </Link>
  )
}
