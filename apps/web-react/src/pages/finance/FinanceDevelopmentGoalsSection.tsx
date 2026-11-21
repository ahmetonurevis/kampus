import { useMemo, useState } from 'react'
import {
  useDevelopmentGoal,
  useDevelopmentGoals,
  type DevelopmentGoal,
  type DevelopmentGoalDetail,
} from '@kampus/react-shared/use-finance-development-goals.ts'
import {
  DEVELOPMENT_GOAL_SOURCE_LABELS,
  DEVELOPMENT_GOAL_STATUS_LABELS,
  DEVELOPMENT_GOAL_STATUSES,
  type DevelopmentGoalStatus,
} from '@kampus/school-core/lib/finance-observation-debriefs.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { FollowUpForm, GoalCreateForm, GoalEditForm } from './FinanceDevelopmentGoalForms.tsx'
import { goalStatusLabel, goalTone } from './finance-development-goal-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['teacherName', 'status']
const OVERDUE = 'gecikmis'
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: DEVELOPMENT_GOAL_STATUSES.map((value) => ({
      value,
      label: DEVELOPMENT_GOAL_STATUS_LABELS[value],
    })),
  },
  {
    key: 'takip',
    label: 'Takip',
    type: 'select' as const,
    options: [{ value: OVERDUE, label: 'Takip tarihi geçmiş' }],
  },
]
const isStatus = (value: unknown): value is DevelopmentGoalStatus =>
  (DEVELOPMENT_GOAL_STATUSES as readonly unknown[]).includes(value)
const day = (value: string) => dateLabel(`${value}T09:00:00.000Z`, { year: 'numeric' })
const instant = (value: string) => dateLabel(value, { year: 'numeric' })

type GoalRow = {
  id: string
  teacherName: string
  title: string
  source: string
  followUpDate: string
  goal: DevelopmentGoal
}

/**
 * Gelişim hedefleri (DOM-FIN-133; ON-209): Finans "Gelişim hedefleri" sekmesi, yalnız yönetici
 * (K-456). Hedefler takip tarihi yakın önce; durum ve "takip tarihi geçmiş" süzgeci (K-455).
 * "Yeni hedef" doğrudan hedef açar (gözlem görüşmesinden hedef "Ders gözlemleri" penceresinde).
 * Hedef penceresi düzeltme, takip notu ve değişmez takip geçmişini gösterir.
 */
export function FinanceDevelopmentGoalsSection() {
  const list = useListState('gelisim-hedefi', { urlPrefix: 'gh_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = list.state.filters.status
  const overdue = list.state.filters.takip === OVERDUE
  const goals = useDevelopmentGoals({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(overdue ? { overdue: 'true' as const } : {}),
  })
  const [creating, setCreating] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  const rows = useMemo(
    () =>
      goals.data?.data.map((goal): GoalRow => ({
        id: goal.id,
        teacherName: goal.teacherName,
        title: goal.title,
        source:
          goal.source === 'observation_debrief' && goal.observedDate !== null
            ? `Gözlem ${day(goal.observedDate)}`
            : DEVELOPMENT_GOAL_SOURCE_LABELS[goal.source],
        followUpDate: day(goal.followUpDate),
        goal,
      })),
    [goals.data],
  )
  const columns = useMemo<DataColumn<GoalRow>[]>(
    () => [
      { key: 'teacherName', label: 'Öğretmen' },
      { key: 'title', label: 'Hedef' },
      { key: 'source', label: 'Kaynak' },
      {
        key: 'followUpDate',
        label: 'Takip tarihi',
        cell: (row) =>
          row.goal.overdue
            ? `${row.followUpDate} (${String(row.goal.overdueDays)} gün geçti)`
            : row.followUpDate,
      },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={row.goal.overdue ? 'Gecikti' : goalStatusLabel(row.goal.status)}
            tone={goalTone(row.goal)}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="outline"
            aria-label={`${row.teacherName} hedefini aç: ${row.title}`}
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
      aria-labelledby="gelisim-hedefleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="gelisim-hedefleri" className="text-lg font-semibold">
            Gelişim hedefleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Öğretmenlerin gelişim hedefleri, takip tarihi yakın olan önce. Hedef açık, sürüyor,
            ulaşıldı ya da bırakıldı olur; her takip notu geçmişte kalır. Hedeflerin açılışı denetim
            kaydına yazılır.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Yeni hedef</Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={goals.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Gelişim hedefleri"
        empty="Henüz gelişim hedefi yok."
        emptyFiltered="Bu seçimle eşleşen hedef yok."
        loading={goals.isPending}
        fetching={goals.isFetching && !goals.isPending}
        error={
          goals.error ? (
            <QueryError error={goals.error} onRetry={() => void goals.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni gelişim hedefi"
        description="Doğrudan hedef; gözlem görüşmesinden hedef ders gözlemi penceresinde açılır."
      >
        {creating ? <GoalCreateForm debriefId={null} onDone={() => setCreating(false)} /> : null}
      </Modal>
      <Modal
        open={opened !== null}
        onOpenChange={(open) => (open ? undefined : setOpened(null))}
        title="Gelişim hedefi"
        size="wide"
      >
        {opened === null ? null : <GoalPanel goalId={opened} />}
      </Modal>
    </section>
  )
}

function GoalPanel({ goalId }: { goalId: string }) {
  const detail = useDevelopmentGoal(goalId)
  const [editing, setEditing] = useState(false)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (detail.data === undefined) return <p className="text-sm">Hedef yükleniyor…</p>
  const goal = detail.data.data
  return (
    <div className="grid gap-4">
      <GoalSummary goal={goal} />
      {goal.active ? (
        editing ? (
          <GoalEditForm key={goal.version} goal={goal} onDone={() => setEditing(false)} />
        ) : (
          <div>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Hedefi düzenle
            </Button>
          </div>
        )
      ) : (
        <p className="text-sm text-muted-foreground">Hedef kapandı; değiştirilemez.</p>
      )}
      <GoalHistory goal={goal} />
      {goal.active && !editing ? (
        <FollowUpForm key={goal.version} goal={goal} onDone={() => undefined} />
      ) : null}
    </div>
  )
}

function GoalSummary({ goal }: { goal: DevelopmentGoalDetail }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="font-medium">Öğretmen</dt>
        <dd>{goal.teacherName}</dd>
      </div>
      <div>
        <dt className="font-medium">Durum</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <StatusBadge text={goalStatusLabel(goal.status)} tone={goalTone(goal)} />
          {goal.overdue ? <span>Takip {String(goal.overdueDays)} gün gecikti</span> : null}
        </dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="font-medium">Hedef</dt>
        <dd>{goal.title}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="font-medium">Ölçüt</dt>
        <dd className="whitespace-pre-line">{goal.successCriterion}</dd>
      </div>
      <div>
        <dt className="font-medium">Takip tarihi</dt>
        <dd>{day(goal.followUpDate)}</dd>
      </div>
      <div>
        <dt className="font-medium">Kaynak</dt>
        <dd>
          {DEVELOPMENT_GOAL_SOURCE_LABELS[goal.source]}
          {goal.observedDate === null ? '' : ` (gözlem ${day(goal.observedDate)})`}
        </dd>
      </div>
      <div>
        <dt className="font-medium">Performans dönemi</dt>
        <dd>{goal.performancePeriodName ?? '—'}</dd>
      </div>
    </dl>
  )
}

function GoalHistory({ goal }: { goal: DevelopmentGoalDetail }) {
  return (
    <section aria-labelledby="hedef-gecmisi" className="grid gap-2">
      <h3 id="hedef-gecmisi" className="text-base font-semibold">
        Takip geçmişi
      </h3>
      {goal.notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz takip notu yok.</p>
      ) : (
        <ol className="grid gap-2">
          {goal.notes.map((note) => (
            <li key={note.id} className="grid gap-1 border-b pb-2 text-sm">
              <span className="text-muted-foreground">
                {instant(note.createdAt)}
                {note.authorName === null ? '' : ` · ${note.authorName}`}
                {note.statusTo === null
                  ? ''
                  : ` · ${goalStatusLabel(note.statusFrom)} → ${goalStatusLabel(note.statusTo)}`}
                {note.nextFollowUpDate === null
                  ? ''
                  : ` · sonraki takip ${day(note.nextFollowUpDate)}`}
              </span>
              <span className="whitespace-pre-line">{note.note}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
