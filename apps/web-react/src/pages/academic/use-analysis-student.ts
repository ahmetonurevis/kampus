import { use } from 'react'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { useAcademicLookups } from './use-academic-lookups.ts'

/**
 * Analiz sayfalarının öğrencisi: velide kabuktaki seçili çocuk (`?cocuk=`), öğrencide kapsamdaki
 * tek kayıt (kendisi; kapsamı sunucu daraltır). Öğrenci kaydı gelene kadar `undefined`; sorgular
 * o zaman bekler.
 */
export function useAnalysisStudent() {
  const childId = use(ViewScopeContext)
  const data = useAcademicLookups()
  const student = childId
    ? data.lookups.students.get(childId)
    : data.sources.students.find((item) => item.record.isActive)?.record
  return { ...data, childId, student }
}
