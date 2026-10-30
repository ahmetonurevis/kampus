import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { AttendanceView } from './AttendanceView.tsx'

/** Devamsızlığım (öğrenci): kendi yoklama kayıtları ve katılım özeti. */
export function StudentAttendancePage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <AttendanceView audience="student" title="Devamsızlığım" />
    </>
  )
}
