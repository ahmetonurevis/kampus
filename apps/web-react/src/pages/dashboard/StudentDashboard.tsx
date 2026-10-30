import { useMemo } from 'react'
import { dateLabel, homeworkStatus, money, number } from '@kampus/school-core/lib/format.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll, useCoreCounts, useCoreList } from '@/hooks/use-core-collection.ts'
import type { Session } from '@/auth/auth-port.ts'
import { scoreText, scoreTone } from '../academic/academic-rows.ts'
import { useLearningStudent } from '../learning/use-learning-student.ts'
import {
  CardList,
  combineStates,
  DashboardGrid,
  ListCard,
  ShareBar,
  StatCard,
  StatGrid,
} from './DashboardParts.tsx'
import {
  attendanceSummary,
  dashboardHref,
  invoiceStatusSlices,
  outstandingAmount,
  overallAverage,
  subjectAverageRows,
  upcomingByDueDate,
} from './dashboard-model.ts'

const NONE: readonly never[] = []
const HOMEWORK_WINDOW = 20

type Props = { session: Session; now: Date }

/**
 * Öğrenci ve veli Genel Bakış (Vue `Dashboard.vue` öğrenci/veli): not ortalaması, devamsızlık,
 * ödev teslimi; yaklaşan ödevler, ders ortalamaları ve son notlar. Velide özet seçili çocuğa
 * göredir (`?cocuk=`); çocuk değişince sayfa yeniden kurulur ve sorgular çocuğun `studentId`/
 * `classId`'siyle yeniden okunur. Öğrenciye ödeme bilgisi gösterilmez ve `invoices` hiç istenmez;
 * veli kendi çocuğunun bakiyesini görür (DOM-FIN-052).
 */
export function StudentDashboard({ session, now }: Props) {
  const { student, noChild, isPending, error, retry } = useLearningStudent()
  if (noChild)
    return (
      <EmptyState
        title="Bağlı öğrenci bulunamadı."
        description="Hesabınıza bağlı bir öğrenci olduğunda özet burada görünür."
      />
    )
  if (error) return <QueryError error={error} onRetry={retry} />
  if (isPending || !student)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Öğrenci bilgileri yükleniyor…
      </p>
    )
  return <StudentSummary session={session} now={now} student={student} />
}

type Student = NonNullable<ReturnType<typeof useLearningStudent>['student']>

function StudentSummary({ session, now, student }: Props & { student: Student }) {
  const role = session.role
  const parent = role === 'veli'
  const academic = session.modules.academic === true
  const learning = session.modules.learning === true
  // Öğrenci ödemeleri gösterilmez; veli kendi çocuğunun bakiyesini görür.
  const showBalance = parent && session.modules.finance === true
  const studentId = student.id
  const child = parent ? studentId : ''
  const own = { studentId } as const

  const grades = useCoreCounts(
    'grades',
    { groupBy: 'subjectId', sum: 'score', filters: own },
    { enabled: academic },
  )
  const attendance = useCoreCounts(
    'attendance',
    { groupBy: 'status', filters: own },
    { enabled: academic },
  )
  const submitted = useCoreCounts(
    'submissions',
    { groupBy: 'studentId', filters: own },
    { enabled: learning },
  )
  const assigned = useCoreCounts(
    'homework',
    { groupBy: 'classId', filters: { classId: student.classId } },
    { enabled: learning },
  )
  const invoices = useCoreCounts(
    'invoices',
    { groupBy: 'status', sum: 'amount', filters: own },
    { enabled: showBalance },
  )
  const homework = useCoreList(
    'homework',
    { filters: { classId: student.classId }, sort: ['-dueDate'], pageSize: HOMEWORK_WINDOW },
    { enabled: learning },
  )
  const recentGrades = useCoreList(
    'grades',
    { filters: own, sort: ['-date'], pageSize: 5 },
    { enabled: academic },
  )
  const subjects = useCoreAll('subjects', {}, { enabled: academic })

  const upcoming = upcomingByDueDate(
    (homework.data?.rows ?? NONE).map((row) => row.record),
    now,
    5,
  )
  const submissions = useCoreList(
    'submissions',
    { filters: { studentId, homeworkId: upcoming.map((item) => item.id) }, pageSize: 5 },
    { enabled: learning && upcoming.length > 0 },
  )
  const subjectNames = useMemo(
    () => new Map((subjects.data ?? NONE).map((row) => [row.record.id, row.record.name])),
    [subjects.data],
  )
  const averages = grades.data ? subjectAverageRows(grades.data, subjectNames) : []
  const average = grades.data ? overallAverage(grades.data) : null
  const absence = attendance.data ? attendanceSummary(attendance.data) : null
  const overdue = invoices.data
    ? invoiceStatusSlices(invoices.data).find((slice) => slice.key === 'gecikmis')
    : undefined
  const submissionRecords = (submissions.data?.rows ?? NONE).map((row) => row.record)

  const link = (studentPath: string, tab: string, params: Record<string, string> = {}) =>
    parent
      ? dashboardHref(role, 'akademik-takip', { sekme: tab }, child)
      : dashboardHref(role, studentPath, params)

  return (
    <>
      <StatGrid label={parent ? `${student.name} özeti` : 'Özetim'}>
        {academic ? (
          <>
            <StatCard
              label="Genel not ortalaması"
              icon="Award"
              value={average === null ? '—' : `${average}/100`}
              note={`${number(grades.data?.total)} değerlendirme`}
              href={link('notlarim', 'notlar')}
              state={combineStates(grades)}
            />
            <StatCard
              label="Devamsızlık"
              icon="ClipboardCheck"
              value={`${number(absence?.absent)} gün`}
              note={`${number(absence?.late)} geç kalma · ${number(absence?.total)} yoklama`}
              href={link('devamsizlik', 'devamsizlik', { durum: 'absent' })}
              state={combineStates(attendance)}
            />
          </>
        ) : null}
        {learning ? (
          <StatCard
            label="Teslim edilen ödev"
            icon="NotebookPen"
            value={`${number(submitted.data?.total)}/${number(assigned.data?.total)}`}
            note="Sınıfa verilen ödevlerden"
            href={link('odevler', 'odevler')}
            state={combineStates(submitted, assigned)}
          />
        ) : null}
        {showBalance ? (
          <StatCard
            label="Güncel bakiye"
            icon="Wallet"
            value={money(invoices.data ? outstandingAmount(invoices.data) : 0)}
            note={`${number(overdue?.count)} gecikmiş taksit`}
            href={dashboardHref(role, 'finans', {}, child)}
            state={combineStates(invoices)}
          />
        ) : null}
      </StatGrid>

      <DashboardGrid>
        {learning ? (
          <ListCard
            title="Yaklaşan ödevler"
            description="Son teslim tarihi gelmemiş ödevler"
            action={{ label: 'Ödevleri aç', href: link('odevler', 'odevler') }}
            state={combineStates(homework, submissions)}
            isEmpty={upcoming.length === 0}
            emptyText="Teslim süresi devam eden ödev yok."
          >
            <CardList label="Yaklaşan ödevler">
              {upcoming.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="grid min-w-0">
                    <strong className="font-medium [overflow-wrap:anywhere]">{item.title}</strong>
                    <small className="text-sm text-muted-foreground">
                      Son teslim · {dateLabel(item.dueDate, { weekday: 'long' })}
                    </small>
                  </span>
                  <StatusBadge text={homeworkStatus(item, submissionRecords, studentId, now)} />
                </li>
              ))}
            </CardList>
          </ListCard>
        ) : null}
        {academic ? (
          <ListCard
            title="Ders ortalamaları"
            description="Bütün değerlendirmelerden"
            action={{ label: 'Notları aç', href: link('notlarim', 'notlar') }}
            state={combineStates(grades, subjects)}
            isEmpty={averages.length === 0}
            emptyText="Henüz not girilmedi."
          >
            <CardList label="Ders ortalamaları">
              {averages.map((row) => (
                <li key={row.subjectId} className="grid gap-1.5 py-2 first:pt-0 last:pb-0">
                  <span className="flex items-center justify-between gap-3">
                    <span className="[overflow-wrap:anywhere]">{row.name}</span>
                    <strong className="font-semibold tabular-nums">{row.average}</strong>
                  </span>
                  <ShareBar
                    value={row.average}
                    tone={scoreTone(row.average) === 'amber' ? 'warning' : 'success'}
                  />
                </li>
              ))}
            </CardList>
          </ListCard>
        ) : null}
      </DashboardGrid>

      {academic ? (
        <DashboardGrid>
          <ListCard
            title="Son notlar"
            description="En son girilen değerlendirmeler"
            action={{ label: 'Tümünü gör', href: link('notlarim', 'notlar') }}
            state={combineStates(recentGrades)}
            isEmpty={recentGrades.data?.rows.length === 0}
            emptyText="Henüz not girilmedi."
          >
            <CardList label="Son notlar">
              {recentGrades.data?.rows.map(({ id, record }) => (
                <li
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="grid min-w-0">
                    <strong className="font-medium [overflow-wrap:anywhere]">{record.title}</strong>
                    <small className="text-sm text-muted-foreground">
                      {dateLabel(record.date, { year: 'numeric' })}
                    </small>
                  </span>
                  <StatusBadge text={scoreText(record.score)} tone={scoreTone(record.score)} />
                </li>
              ))}
            </CardList>
          </ListCard>
        </DashboardGrid>
      ) : null}
    </>
  )
}
