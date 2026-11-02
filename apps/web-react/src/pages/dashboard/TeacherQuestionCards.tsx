import { useMemo } from 'react'
import { Link } from 'react-router'
import { dateLabel, number } from '@kampus/school-core/lib/format.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { OVERDUE_LABEL } from '../learning/question-rows.ts'
import { CardList, ListCard, StatCard } from './DashboardParts.tsx'
import { defineCard, type DashboardCardContext } from './dashboard-cards-model.ts'
import { dashboardHref } from './dashboard-model.ts'
import { openQuestions } from './dashboard-teacher-model.ts'
import { StudentName } from './StudentName.tsx'

/**
 * Öğretmenin yanıt bekleyen soruları: Soru Kuyruğu sayfasıyla aynı koleksiyon ve önbellek
 * (`GET /collections/questions`; yalnız kendisine atanan sorular, kapsamı sunucu uygular). Sunucuda
 * "yanıtsız ve geri çekilmemiş" süzgeci yoktur (durum saklanmaz), bu yüzden sayı satırlardan
 * core `questionStatus` ile sayılır; kuyruk bir öğretmenin açık sorularıyla sınırlıdır.
 * TODO(api-question-status-filter): türetilmiş durum süzgeci ve sayımı API'ye girince sayı
 * `meta.total`'dan okunur, liste ilk sayfayla sınırlanır.
 */
function useOpenQuestions(ctx: DashboardCardContext) {
  const questions = useCoreAll('questions')
  const summary = useMemo(
    () => (questions.data ? openQuestions(questions.data, ctx.now.toISOString()) : undefined),
    [questions.data, ctx.now],
  )
  const state = {
    isPending: questions.isPending,
    error: questions.error,
    retry: () => void questions.refetch(),
  }
  return { summary, state }
}

function OpenQuestionCount({ ctx }: { ctx: DashboardCardContext }) {
  const { summary, state } = useOpenQuestions(ctx)
  return (
    <StatCard
      label="Yanıt bekleyen soru"
      icon="MessageCircleQuestion"
      value={number(summary?.total)}
      note={
        summary && summary.overdue > 0
          ? `${number(summary.overdue)} sorunun yanıt süresi aşıldı`
          : 'Yanıt süresi aşılan soru yok'
      }
      href={dashboardHref(ctx.role, 'sorular')}
      state={state}
    />
  )
}

function OpenQuestionList({ ctx }: { ctx: DashboardCardContext }) {
  const { summary, state } = useOpenQuestions(ctx)
  return (
    <ListCard
      title="Yanıt bekleyen sorular"
      description="Öğrencilerinizden gelen en eski sorular"
      action={{ label: 'Soru kuyruğunu aç', href: dashboardHref(ctx.role, 'sorular') }}
      state={state}
      isEmpty={summary?.total === 0}
      emptyText="Yanıt bekleyen soru yok."
    >
      <CardList label="Yanıt bekleyen sorular">
        {summary?.items.map((row) => (
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
                name={row.student}
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
    section: (data) => data.learning,
    area: 'stat',
    order: 50,
    component: OpenQuestionCount,
  }),
  defineCard({
    id: 'ogretmen.yanit-bekleyen-sorular',
    roles: ['ogretmen'],
    module: 'learning',
    section: (data) => data.learning,
    area: 'side',
    order: 210,
    component: OpenQuestionList,
  }),
]
