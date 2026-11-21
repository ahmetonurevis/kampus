import { lazy, Suspense, useId } from 'react'
import { Link } from 'react-router'
import type { SkillCurve } from '@kampus/react-shared/skill-progress.ts'
import { useSkillProgress } from '@kampus/react-shared/use-skill-progress.ts'
import { combineStates, ListCard } from '../dashboard/DashboardParts.tsx'
import {
  chartPoints,
  skillPointRows,
  skillSummary,
  type ProgressAudience,
} from './skill-progress-model.ts'

// recharts yalnız grafik çizileceği anda ayrı parça olarak yüklenir (ADR 0002).
const SkillLine = lazy(() => import('./SkillLine.tsx'))

/**
 * Tek beceri: başlık, özet metni (nokta yoksa "Henüz puanlanmış … görevi yok."), nokta varsa
 * grafik ve görev sonucuna giden satırlar.
 */
function SkillBlock({ curve, audience }: { curve: SkillCurve; audience: ProgressAudience }) {
  const id = useId()
  const rows = skillPointRows(curve, audience)
  return (
    <section
      aria-labelledby={id}
      className="grid min-w-0 content-start gap-3 rounded-card border p-4"
    >
      <header className="grid gap-0.5">
        <h3 id={id} className="text-base font-semibold">
          {curve.label}
        </h3>
        <p className="text-sm text-muted-foreground">{skillSummary(curve)}</p>
      </header>
      {rows.length === 0 ? null : (
        <>
          <Suspense
            fallback={
              <div role="status" className="h-28 text-sm text-muted-foreground">
                Grafik yükleniyor…
              </div>
            }
          >
            <SkillLine points={chartPoints(curve)} />
          </Suspense>
          <ul aria-label={`${curve.label} görev sonuçları`} className="grid gap-1">
            {rows.map((row) => (
              <li key={row.key}>
                <Link
                  to={row.href}
                  aria-label={row.linkLabel}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="grid min-w-0">
                    <span className="font-medium text-primary [overflow-wrap:anywhere]">
                      {row.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{row.date}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{row.percent}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/**
 * Beceri gelişimi kartı (OG-080; IST-057, DOM-BEC-035): okuma, dinleme, yazma ve konuşma ayrı
 * küçük grafiklerle; yalnız değerlendirme görevlerinin kişiye açılmış puanlarından. Öğrenci ve
 * veli Akademik Gelişim sayfasında görür; her satır görevin sonucuna gider. Modül kapalıysa kart
 * gizlenir (`ListCard`).
 */
export function SkillProgressPanel({
  studentId,
  audience,
}: {
  studentId: string
  audience: ProgressAudience
}) {
  const progress = useSkillProgress(studentId)
  const skills = progress.data?.skills ?? []
  return (
    <ListCard
      className="mb-[var(--space-section)]"
      title="Beceri gelişimi"
      description="Değerlendirme görevlerindeki puanlara göre okuma, dinleme, yazma ve konuşma"
      state={combineStates(progress)}
      isEmpty={skills.length === 0}
      emptyText="Beceri gelişimi için görev sonucu yok."
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
        {skills.map((curve) => (
          <SkillBlock key={curve.skill} curve={curve} audience={audience} />
        ))}
      </div>
    </ListCard>
  )
}
