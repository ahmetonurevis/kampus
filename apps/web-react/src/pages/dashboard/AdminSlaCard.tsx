import { useTeacherMetrics } from '@kampus/react-shared/use-management-metrics.ts'
import { number } from '@kampus/school-core/lib/format.ts'
import type { DashboardOf } from '@kampus/react-shared/dashboard.ts'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { SLA_HOURS, slaBreachTotal } from '../management/sla-rows.ts'
import { combineStates, StatCard } from './DashboardParts.tsx'
import { defineCard, type DashboardCardContext } from './dashboard-cards-model.ts'
import { dashboardHref } from './dashboard-model.ts'

function SlaBreachCard({ ctx }: { ctx: DashboardCardContext<DashboardOf<'yonetici'>> }) {
  const metrics = useTeacherMetrics()
  const teachers = useCoreAll('teachers')
  const state = combineStates(metrics, teachers)
  const breaches =
    metrics.data && teachers.data ? slaBreachTotal(teachers.data, metrics.data.data) : 0
  return (
    <StatCard
      label="SLA ihlali"
      icon="Timer"
      value={number(breaches)}
      note={
        breaches === 0
          ? `${SLA_HOURS} saat hedefini aşan soru yok`
          : `${SLA_HOURS} saat yanıt hedefini aşan soru`
      }
      href={dashboardHref(ctx.role, 'sla-raporu')}
      state={state}
    />
  )
}

/**
 * Yönetici "SLA ihlali" sayacı: yanıt süresi hedefini (24 saat) aşan, hâlâ bekleyen ya da geç
 * yanıtlanmış öğrenci sorularının sayısı; SLA Raporu'nun "Süre aşımı" toplamıyla aynı sayıdır
 * (`slaBreachTotal`). Dashboard soru kayıtlarını çekmez (rapor sayfasının `TODO(api-sla-aggregate)`
 * 5000 kayıt çekişi yinelenmez): öğretmen başına ihlal sunucu toplamından (`/teacher-metrics`)
 * ve aktif öğretmen listesinden gelir. Soru-cevap (`learning`) modülü kapalıysa kart çizilmez.
 */
export const SLA_CARDS = [
  defineCard({
    id: 'yonetici.sla-ihlali',
    roles: ['yonetici'],
    module: 'learning',
    area: 'stat',
    order: 60,
    component: SlaBreachCard,
  }),
]
