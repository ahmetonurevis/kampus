import { use } from 'react'
import { dateLabel, homeworkStatus, money, number } from '@kampus/school-core/lib/format.ts'
import type { DashboardOf } from '@kampus/react-shared/dashboard.ts'
import { useDashboard } from '@kampus/react-shared/use-dashboard.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import type { Session } from '@/auth/auth-port.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { scoreText, scoreTone } from '../academic/academic-rows.ts'
import { AbsenceTrend } from './AbsenceTrend.tsx'
import {
  CardList,
  combineStates,
  DashboardGrid,
  ListCard,
  ShareBar,
  StatCard,
  StatGrid,
  type CardState,
} from './DashboardParts.tsx'
import {
  attendanceSummary,
  dashboardHref,
  overallAverage,
  subjectAverageRows,
} from './dashboard-model.ts'

type Props = { session: Session; now: Date }
type Summary = DashboardOf<'ogrenci'> | DashboardOf<'veli'>

/**
 * Öğrenci ve veli Genel Bakış (Vue `Dashboard.vue` öğrenci/veli): not ortalaması, devamsızlık,
 * ödev teslimi; yaklaşan ödevler, ders ortalamaları ve son notlar. Bütün değerler tek özet
 * isteğinden gelir (`useDashboard`). Velide özet seçili çocuğa göredir (`?cocuk=`, istekte
 * `studentId`); çocuk değişince özet o çocuk için yeniden okunur. Öğrencinin özetinde ödeme alanı
 * hiç yoktur (sunucu şeması); veli kendi çocuğunun bakiyesini görür (DOM-FIN-052).
 */
export function StudentDashboard({ session, now }: Props) {
  const parent = session.role === 'veli'
  const childId = use(ViewScopeContext)
  const noChild = parent && childId === ''
  const query = useDashboard(parent ? 'veli' : 'ogrenci', parent ? { studentId: childId } : {}, {
    enabled: !noChild,
  })
  if (noChild)
    return (
      <EmptyState
        title="Bağlı öğrenci bulunamadı."
        description="Hesabınıza bağlı bir öğrenci olduğunda özet burada görünür."
      />
    )
  if (query.error) return <QueryError error={query.error} onRetry={() => void query.refetch()} />
  if (!query.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Öğrenci bilgileri yükleniyor…
      </p>
    )
  return (
    <StudentSummary session={session} now={now} data={query.data} state={combineStates(query)} />
  )
}

function StudentSummary({
  session,
  now,
  data,
  state,
}: Props & { data: Summary; state: CardState }) {
  const role = session.role
  const parent = data.role === 'veli'
  const { student, academic, learning } = data
  const balance = data.role === 'veli' ? data.balance : null
  const child = parent ? student.id : ''

  const averages = academic ? subjectAverageRows(academic.grades) : []
  const average = academic ? overallAverage(academic.grades) : null
  const absence = academic ? attendanceSummary(academic.attendance) : null
  const upcoming = learning?.homework ?? []
  // Ödev durumu core `homeworkStatus` ile: teslim ve puan sunucudan, son teslim isteğin anına göre.
  const submissions = upcoming.flatMap((item) =>
    item.submission
      ? [{ homeworkId: item.id, studentId: student.id, score: item.submission.score }]
      : [],
  )

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
              note={`${number(academic.grades.count)} değerlendirme`}
              href={link('notlarim', 'notlar')}
              state={state}
            />
            <StatCard
              label="Devamsızlık"
              icon="ClipboardCheck"
              value={`${number(absence?.absent)} gün`}
              note={`${number(absence?.late)} geç kalma · ${number(absence?.total)} yoklama`}
              href={link('devamsizlik', 'devamsizlik', { durum: 'absent' })}
              state={state}
            />
          </>
        ) : null}
        {learning ? (
          <StatCard
            label="Teslim edilen ödev"
            icon="NotebookPen"
            value={`${number(learning.submitted)}/${number(learning.assigned)}`}
            note="Sınıfa verilen ödevlerden"
            href={link('odevler', 'odevler')}
            state={state}
          />
        ) : null}
        {balance ? (
          <StatCard
            label="Güncel bakiye"
            icon="Wallet"
            value={money(balance.outstanding)}
            note={`${number(balance.overdueCount)} gecikmiş taksit`}
            href={dashboardHref(role, 'finans', {}, child)}
            state={state}
          />
        ) : null}
      </StatGrid>

      <DashboardGrid>
        {learning ? (
          <ListCard
            title="Yaklaşan ödevler"
            description="Son teslim tarihi gelmemiş ödevler"
            action={{ label: 'Ödevleri aç', href: link('odevler', 'odevler') }}
            state={state}
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
                  <StatusBadge text={homeworkStatus(item, submissions, student.id, now)} />
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
            state={state}
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
          <AbsenceTrend
            weeks={academic.weeklyAbsences}
            state={state}
            href={link('devamsizlik', 'devamsizlik', { durum: 'absent' })}
          />
          <ListCard
            title="Son notlar"
            description="En son girilen değerlendirmeler"
            action={{ label: 'Tümünü gör', href: link('notlarim', 'notlar') }}
            state={state}
            isEmpty={academic.recentGrades.length === 0}
            emptyText="Henüz not girilmedi."
          >
            <CardList label="Son notlar">
              {academic.recentGrades.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="grid min-w-0">
                    <strong className="font-medium [overflow-wrap:anywhere]">{row.title}</strong>
                    <small className="text-sm text-muted-foreground">
                      {dateLabel(row.date, { year: 'numeric' })}
                    </small>
                  </span>
                  {row.score === undefined ? null : (
                    <StatusBadge text={scoreText(row.score)} tone={scoreTone(row.score)} />
                  )}
                </li>
              ))}
            </CardList>
          </ListCard>
        </DashboardGrid>
      ) : null}
    </>
  )
}
