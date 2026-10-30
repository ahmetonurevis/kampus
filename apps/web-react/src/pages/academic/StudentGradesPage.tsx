import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { GradesView } from './GradesView.tsx'

/** Notlarım (öğrenci): kendi notları; ders bazında ortalama kayıtlardan hesaplanır. */
export function StudentGradesPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <GradesView audience="student" title="Notlarım" />
    </>
  )
}
