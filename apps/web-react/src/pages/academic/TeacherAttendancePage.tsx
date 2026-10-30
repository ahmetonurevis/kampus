import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { AttendanceView } from './AttendanceView.tsx'

/**
 * Yoklama (öğretmen): kapsamdaki sınıfların yoklama geçmişi. Sınıf, durum ve tarih süzülür;
 * öğretmen yalnız ders verdiği veya danışmanı olduğu sınıfların kayıtlarını görür.
 */
export function TeacherAttendancePage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <AttendanceView audience="teacher" title="Yoklama geçmişi" />
    </>
  )
}
