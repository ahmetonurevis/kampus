import { Link } from 'react-router'
import type { DashboardOf } from '@kampus/react-shared/dashboard.ts'
import { dateLabel, number } from '@kampus/school-core/lib/format.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { OVERDUE_LABEL } from '../learning/question-rows.ts'
import { CardList, ListCard, StatCard } from './DashboardParts.tsx'
import { defineCard, type DashboardCardContext } from './dashboard-cards-model.ts'
import { dashboardHref } from './dashboard-model.ts'
import { openQuestionsNote } from './dashboard-teacher-model.ts'
import { StudentName } from './StudentName.tsx'

type Ctx = DashboardCardContext<DashboardOf<'ogretmen'>>

/**
 * Öğretmenin yanıt bekleyen soruları: değerler özet yanıtının `questions` bölümüdür (sunucu
 * `questions?answered=false&withdrawn=false` okuması; yalnız öğretmene atanan sorular). Sayı Soru
 * Kuyruğu'ndaki "Bekliyor" satırlarının toplamıdır; kart soru kayıtlarını ayrıca çekmez.
 */
function OpenQuestionCount({ ctx }: { ctx: Ctx }) {
  const questions = ctx.data?.questions
  return (
    <StatCard
      label="Yanıt bekleyen soru"
      icon="MessageCircleQuestion"
      value={number(questions?.total)}
      note={openQuestionsNote(questions)}
      href={dashboardHref(ctx.role, 'sorular')}
      state={ctx.state}
    />
  )
}

function OpenQuestionList({ ctx }: { ctx: Ctx }) {
  const questions = ctx.data?.questions
  return (
    <ListCard
      title="Yanıt bekleyen sorular"
      description="Öğrencilerinizden gelen en eski sorular"
      action={{ label: 'Soru kuyruğunu aç', href: dashboardHref(ctx.role, 'sorular') }}
      state={ctx.state}
      isEmpty={questions?.total === 0}
      emptyText="Yanıt bekleyen soru yok."
    >
      <CardList label="Yanıt bekleyen sorular">
        {questions?.items.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <span className="grid min-w-0 gap-1">
              <Link
                to={dashboardHref(ctx.role, 'sorular', { soru: row.id })}
                className="min-h-6 font-medium [overflow-wrap:anywhere] hover:underline"
              >
                {row.title}
              </Link>
              <StudentName
                name={row.studentName ?? ''}
                detail={[row.className, dateLabel(row.createdAt)].filter(Boolean).join(' · ')}
              />
            </span>
            {row.overdue ? <StatusBadge text={OVERDUE_LABEL} tone="red" /> : null}
          </li>
        ))}
      </CardList>
    </ListCard>
  )
}

/** Öğretmen Genel Bakışı: yanıt bekleyen soru sayacı (stat) ve en eski soruların listesi. */
export const TEACHER_QUESTION_CARDS = [
  defineCard({
    id: 'ogretmen.yanit-bekleyen-soru',
    roles: ['ogretmen'],
    module: 'learning',
    section: (data) => data.questions,
    area: 'stat',
    order: 50,
    component: OpenQuestionCount,
  }),
  defineCard({
    id: 'ogretmen.yanit-bekleyen-sorular',
    roles: ['ogretmen'],
    module: 'learning',
    section: (data) => data.questions,
    area: 'side',
    order: 210,
    component: OpenQuestionList,
  }),
]
