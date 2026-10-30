import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { ScheduleView } from './ScheduleView.tsx'

/** Ders Programım (öğretmen: verdiği dersler; öğrenci: kendi sınıfının dersleri). */
export function SchedulePage({
  page,
  audience,
}: {
  page: NavPage
  audience: 'teacher' | 'student'
}) {
  useDocumentTitle(page.title)
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <ScheduleView audience={audience} />
    </>
  )
}
