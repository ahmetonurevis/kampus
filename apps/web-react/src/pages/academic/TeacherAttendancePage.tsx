import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { AttendanceTaking } from './AttendanceTaking.tsx'
import { AttendanceView } from './AttendanceView.tsx'

/**
 * Yoklama (öğretmen): ders verilen sınıfın bugünkü yoklamasını alma ve kapsamdaki sınıfların
 * yoklama geçmişi. Sınıf, durum ve tarih süzülür; öğretmen yalnız ders verdiği veya danışmanı
 * olduğu sınıfların kayıtlarını görür.
 */
export function TeacherAttendancePage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <AttendanceTaking />
      <AttendanceView audience="teacher" title="Yoklama geçmişi" />
    </>
  )
}
