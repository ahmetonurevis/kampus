import { useId, useMemo } from 'react'
import { useAuth } from '@/auth/use-auth.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { combineStates, DashboardGrid, ListCard, ShareBar } from '../dashboard/DashboardParts.tsx'
import { CefrProfileCards } from '../language/CefrProfileParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { LookupError } from './AcademicParts.tsx'
import { ScoreBars, TrendChart } from './AnalysisParts.tsx'
import { gradeTrend, studyPriority, subjectScores } from './exam-analysis-model.ts'
import type { ProgressAudience } from './skill-progress-model.ts'
import { SkillProgressPanel } from './SkillProgressPanel.tsx'
import { useAnalysisStudent } from './use-analysis-student.ts'

const NONE: readonly never[] = []

/**
 * Akademik Gelişim (öğrenci ve veli, Vue `Academic.vue` `seviye-takibi`): dönem ilerlemesi, ders
 * başına çalışma önceliği, ders başarısı ve not geçmişi. Öğrencide kendi, velide seçili çocuğun
 * kayıtları. Ders ortalamaları ve eğilim notlardan hesaplanır, saklanmaz. Dil okulunda sayfa CEFR
 * profilini gösterir (OG-054; IST-060): güncel seviye, tahmini seviye, karar geçmişi ve tespitler;
 * öğrenci ve veli görünümünde kararın gerekçesi ve vereni sunucudan gelmez. İki kurum türünde de
 * `learning` modülü açıksa beceri gelişimi kartı (OG-080; IST-057, DOM-BEC-035) dört beceriyi
 * değerlendirme görevlerinin puanlarıyla gösterir.
 */
export function AcademicProgressPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  if (session?.institution.type === 'language_school') return <LanguageProgress page={page} />
  return <SchoolProgress page={page} />
}

/** Beceri gelişimi kartı; `learning` modülü kapalıysa gösterilmez. */
function SkillProgress({ studentId, childId }: { studentId: string; childId: string }) {
  const { session } = useAuth()
  if (session?.modules.learning !== true) return null
  const audience: ProgressAudience = childId ? { kind: 'parent', childId } : { kind: 'student' }
  return <SkillProgressPanel key={studentId} studentId={studentId} audience={audience} />
}

/** Dil okulu: seçili öğrencinin (velide çocuğun) CEFR profili ve beceri gelişimi. */
function LanguageProgress({ page }: { page: NavPage }) {
  const { student, childId, error, retry, pending } = useAnalysisStudent()
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {error ? <LookupError error={error} onRetry={retry} /> : null}
      {student ? (
        <>
          <CefrProfileCards key={student.id} studentId={student.id} />
          <SkillProgress studentId={student.id} childId={childId} />
        </>
      ) : pending ? (
        <SummaryLoading />
      ) : !error ? (
        <EmptyState
          title="Bağlı öğrenci bulunamadı."
          description="Hesabınıza bağlı bir öğrenci olduğunda seviye gelişimi burada görünür."
        />
      ) : null}
    </>
  )
}

function SchoolProgress({ page }: { page: NavPage }) {
  const { student, childId, lookups, error, retry, pending } = useAnalysisStudent()
  const grades = useCoreAll(
    'grades',
    { filters: { studentId: student?.id ?? '' } },
    { enabled: student !== undefined },
  )
  const records = useMemo(() => grades.data?.map((row) => row.record) ?? NONE, [grades.data])
  const scores = useMemo(() => subjectScores(records, lookups.subjects), [records, lookups])
  const trend = useMemo(() => gradeTrend(records), [records])
  const heroId = useId()
  const state = combineStates(grades)
  const schoolClass = lookups.classes.get(student?.classId ?? '')

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {error ? <LookupError error={error} onRetry={retry} /> : null}
      {student ? (
        <>
          <section
            aria-labelledby={heroId}
            className="panel mb-[var(--space-section)] flex flex-wrap items-center gap-5 rounded-card border bg-surface p-6 max-[650px]:p-4"
          >
            <div
              aria-hidden="true"
              className="grid size-20 shrink-0 place-items-center rounded-card bg-primary-soft text-primary"
            >
              <span className="grid text-center leading-none">
                <strong className="text-3xl font-semibold">{schoolClass?.grade ?? '—'}</strong>
                <small className="mt-1 text-2xs font-medium">SINIF</small>
              </span>
            </div>
            <div className="min-w-0 flex-1 basis-64">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                AKADEMİK GELİŞİM YOLCULUĞU
              </p>
              <h2 id={heroId} className="mt-1 text-xl font-semibold [overflow-wrap:anywhere]">
                {student.name}, her gün biraz daha ileri.
              </h2>
              <p className="mt-1 mb-3 text-sm text-muted-foreground">
                {schoolClass?.name ?? '—'} · Dönem hedeflerine ilerleme %{student.progress}
              </p>
              <div
                role="meter"
                aria-label="Dönem hedeflerine ilerleme"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={student.progress}
                aria-valuetext={`%${student.progress}`}
              >
                <ShareBar value={student.progress} />
              </div>
            </div>
          </section>

          <ListCard
            className="mb-[var(--space-section)]"
            title="Akademik hedefler"
            description="Ders sonuçlarına göre kişisel çalışma öncelikleri"
            state={state}
            isEmpty={scores.length === 0}
            emptyText="Çalışma önceliği için not kaydı yok."
          >
            <ul
              aria-label="Çalışma öncelikleri"
              className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3"
            >
              {scores.map((subject) => {
                const priority = studyPriority(subject.score)
                return (
                  <li
                    key={subject.subjectId}
                    className="grid content-start gap-2 rounded-card border p-4"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary"
                    >
                      <Icon name={priority.strong ? 'Award' : 'Target'} size={20} />
                    </span>
                    <strong className="[overflow-wrap:anywhere]">{subject.topic}</strong>
                    <span>
                      <StatusBadge
                        text={priority.label}
                        tone={priority.strong ? 'green' : 'amber'}
                      />
                    </span>
                    <p className="text-sm text-muted-foreground">{priority.advice}</p>
                  </li>
                )
              })}
            </ul>
          </ListCard>

          <SkillProgress studentId={student.id} childId={childId} />

          <DashboardGrid>
            <ListCard
              title="Ders bazlı başarı"
              description="Ders notlarının ortalaması"
              state={state}
              isEmpty={scores.length === 0}
              emptyText="Ders başarısı için not kaydı yok."
            >
              <ScoreBars
                label="Ders başarıları"
                items={scores.map((item) => ({
                  key: item.subjectId,
                  name: item.topic,
                  score: item.score,
                  text: `%${item.score}`,
                }))}
              />
            </ListCard>
            <ListCard
              title="Gelişim geçmişi"
              description="Not tarihlerine göre ortalama puan"
              state={state}
              isEmpty={trend.length === 0}
              emptyText="Gelişim geçmişi için not kaydı yok."
            >
              <TrendChart points={trend} unit="puan" />
            </ListCard>
          </DashboardGrid>
        </>
      ) : !pending && !error ? (
        <EmptyState
          title="Bağlı öğrenci bulunamadı."
          description="Hesabınıza bağlı bir öğrenci olduğunda akademik gelişim burada görünür."
        />
      ) : null}
    </>
  )
}
