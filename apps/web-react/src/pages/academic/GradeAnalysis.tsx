import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { isUnreadableCollectionError } from '@kampus/react-shared/collections.ts'
import { average } from '@kampus/school-core/lib/format.ts'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { combineStates, DashboardGrid, ListCard } from '../dashboard/DashboardParts.tsx'
import { StatGrid } from './AcademicParts.tsx'
import type { AcademicLookups } from './academic-rows.ts'
import { ScoreBars, TrendChart } from './AnalysisParts.tsx'
import {
  ALL_SUBJECTS,
  extremes,
  gradeTrend,
  subjectScores,
  topicScores,
  type TopicScore,
} from './exam-analysis-model.ts'

const NONE: readonly never[] = []

/**
 * Analiz kapsamı: tek öğrenci (öğrenci ve veli sınav analizi) ya da bir sınıf (öğretmen sınıf
 * analizi). Kapsamı sunucu uygular; `classId` süzgeci notta kaydın sınıfı ya da öğrencinin güncel
 * sınıfı, quiz sonucunda öğrencinin güncel sınıfıdır.
 */
export type AnalysisScope = { studentId: string } | { classId: string }

type AnalysisProps = {
  scope: AnalysisScope
  /** Quizlerin okunduğu sınıf (öğrencinin ya da seçili sınıf). */
  classId: string
  lookups: AcademicLookups
}

/**
 * Ders ve konu bazlı başarı özeti, çubuklar ve aylık not eğilimi (Vue `Academic.vue` analiz
 * görünümü). Ortalamalar notlardan hesaplanır, hiçbiri saklanmaz.
 */
export function GradeAnalysis({ scope, classId, lookups }: AnalysisProps) {
  const [params, setParams] = useSearchParams()
  const { state: historyState } = useLocation()
  const grades = useCoreAll('grades', { filters: scope })
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
  const attempts = useCoreAll('quizAttempts', { filters: scope }, { enabled: detail })
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
      // `state.from` (geri dönüş adresi) seçimle silinmez.
      { preventScrollReset: true, state: historyState },
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
