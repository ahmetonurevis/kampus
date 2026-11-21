import { useMemo } from 'react'
import { useCoreCounts } from '@/hooks/use-core-collection.ts'
import { gradeSpark } from './dashboard-grade-trend-model.ts'
import type { TrendPoint } from './dashboard-model.ts'

/**
 * "Genel not ortalaması" sayacının mini grafiği: seçili öğrencinin aylık not ortalaması (Vue
 * `gradeSpark`). Not eğilimi kartıyla aynı sayım sorgusunu kullanır; istek önbellekten paylaşılır.
 * Öğrenci bilinmiyorsa istek atılmaz; iki aydan az veri varsa grafik çizilmez.
 */
export function useGradeSpark(studentId: string | undefined): TrendPoint[] {
  const counts = useCoreCounts(
    'grades',
    { groupBy: 'date:month', sum: 'score', ...(studentId ? { filters: { studentId } } : {}) },
    { enabled: studentId !== undefined },
  )
  return useMemo(
    () => (counts.isPlaceholderData ? [] : gradeSpark(counts.data?.groups ?? [])),
    [counts.data, counts.isPlaceholderData],
  )
}
