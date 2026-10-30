import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { isUnreadableCollectionError } from '@kampus/react-shared/collections.ts'
import { average } from '@kampus/school-core/lib/format.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { PageHeading } from '@/components/PageHeading.tsx'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { combineStates, DashboardGrid, ListCard } from '../dashboard/DashboardParts.tsx'
import { LookupError, StatGrid } from './AcademicParts.tsx'
import type { AcademicLookups } from './academic-rows.ts'
import { ScoreBars, TrendChart } from './AnalysisParts.tsx'
import { ExamResultsSection } from './ExamResultsSection.tsx'
import {
  ALL_SUBJECTS,
  extremes,
  gradeTrend,
  subjectScores,
  topicScores,
  type TopicScore,
} from './exam-analysis-model.ts'
import { useAnalysisStudent } from './use-analysis-student.ts'

const NONE: readonly never[] = []

/**
 * Sınav Analizi (öğrenci ve veli, Vue `Academic.vue` `sinav-analizi`): ders ve konu bazlı başarı,
 * not eğilimi ve deneme sonuçları. Öğrencide kendi, velide seçili çocuğun (`?cocuk=`) kayıtları;
 * kapsamı sunucu uygular. Hiçbir ortalama ve net saklanmaz, kayıtlardan hesaplanır.
 */
export function ExamAnalysisPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { student, error, retry, pending, lookups } = useAnalysisStudent()
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {error ? <LookupError error={error} onRetry={retry} /> : null}
      {student ? (
        <>
          <GradeAnalysis studentId={student.id} classId={student.classId} lookups={lookups} />
          <ExamResultsSection studentId={student.id} />
        </>
      ) : !pending && !error ? (
        <EmptyState
          title="Bağlı öğrenci bulunamadı."
          description="Hesabınıza bağlı bir öğrenci olduğunda sınav analizi burada görünür."
        />
      ) : null}
    </>
  )
}

type AnalysisProps = { studentId: string; classId: string; lookups: AcademicLookups }

function GradeAnalysis({ studentId, classId, lookups }: AnalysisProps) {
  const [params, setParams] = useSearchParams()
  const grades = useCoreAll('grades', { filters: { studentId } })
  const records = useMemo(() => grades.data?.map((row) => row.record) ?? NONE, [grades.data])
  const bySubject = useMemo(
    () => subjectScores(records, lookups.subjects),
    [records, lookups.subjects],
  )

  const requested = params.get('ders') ?? ALL_SUBJECTS
  const subjectId = bySubject.some((item) => item.subjectId === requested)
    ? requested
    : ALL_SUBJECTS
  const subjectName = bySubject.find((item) => item.subjectId === subjectId)?.topic ?? ''

  // Konu kırılımı yalnız ders seçilince gerekir: dersin quiz sonuçları ve quizlerin dersi.
  const detail = subjectId !== ALL_SUBJECTS
  const attempts = useCoreAll('quizAttempts', { filters: { studentId } }, { enabled: detail })
  const quizzes = useCoreAll('quizzes', { filters: { classId } }, { enabled: detail })
  // Öğrenme modülü kapalıysa quiz konuları yoktur; notlardaki konular yine gösterilir.
  const quizError = [attempts.error, quizzes.error].find(
    (item) => item && !isUnreadableCollectionError(item),
  )

  const scores: TopicScore[] = useMemo(
    () =>
      detail
        ? topicScores(
            records,
            attempts.data?.map((row) => row.record) ?? NONE,
            quizzes.data?.map((row) => row.record) ?? NONE,
            subjectId,
          )
        : bySubject,
    [detail, records, attempts.data, quizzes.data, subjectId, bySubject],
  )
  const { strongest, weakest } = extremes(scores)
  const trend = useMemo(() => gradeTrend(records), [records])

  const setSubject = (value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value === ALL_SUBJECTS) next.delete('ders')
        else next.set('ders', value)
        return next
      },
      { preventScrollReset: true },
    )

  const state = combineStates(grades)
  const loadingDetail = detail && (attempts.isPending || quizzes.isPending) && !quizError
  return (
    <>
      <div className="content-filters mb-6 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Ders / konu analizi
          <NativeSelect
            aria-label="Analiz dersi"
            value={subjectId}
            onChange={(event) => setSubject(event.target.value)}
            className="min-h-9 text-sm"
          >
            <NativeSelectOption value={ALL_SUBJECTS}>Tüm dersler</NativeSelectOption>
            {bySubject.map((item) => (
              <NativeSelectOption key={item.subjectId} value={item.subjectId}>
                {item.topic}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      <StatGrid
        label="Başarı özeti"
        items={[
          {
            label: 'Genel başarı',
            value: scores.length ? `${average(scores.map((item) => item.score))}/100` : '—',
            note: 'Seçili ders kapsamındaki ortalama',
          },
          {
            label: 'En güçlü alan',
            value: strongest?.topic ?? '—',
            note: strongest ? `${strongest.score}/100` : 'Kayıt yok',
          },
          {
            label: 'Gelişim odağı',
            value: weakest?.topic ?? '—',
            note: weakest ? `${weakest.score}/100 · bir sonraki çalışma için öneri` : 'Kayıt yok',
          },
        ]}
      />
      <DashboardGrid>
        <ListCard
          title={detail ? `${subjectName} · Konu analizi` : 'Ders bazlı başarı'}
          description="100 puan üzerinden değerlendirme"
          state={{
            ...state,
            isPending: state.isPending || loadingDetail,
            error: state.error ?? quizError ?? null,
          }}
          isEmpty={scores.length === 0}
          emptyText="Bu ders için konu bazlı not kaydı yok."
        >
          <ScoreBars
            label={detail ? 'Konu başarıları' : 'Ders başarıları'}
            hints
            items={scores.map((item) => ({ key: item.topic, name: item.topic, score: item.score }))}
          />
        </ListCard>
        <ListCard
          title="Aylık başarı eğilimi"
          description="Not tarihlerine göre ortalama puan"
          state={state}
          isEmpty={trend.length === 0}
          emptyText="Eğilim için not kaydı yok."
        >
          <TrendChart points={trend} unit="puan" />
        </ListCard>
      </DashboardGrid>
    </>
  )
}
