import { EmptyState } from '@/components/EmptyState.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { LookupError } from './AcademicParts.tsx'
import { ExamResultsSection } from './ExamResultsSection.tsx'
import { GradeAnalysis } from './GradeAnalysis.tsx'
import { useAnalysisStudent } from './use-analysis-student.ts'

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
          <GradeAnalysis
            scope={{ studentId: student.id }}
            classId={student.classId}
            lookups={lookups}
          />
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
