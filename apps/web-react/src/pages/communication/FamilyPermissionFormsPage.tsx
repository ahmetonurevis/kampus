import { useMemo } from 'react'
import { useAllPermissionForms } from '@kampus/react-shared/use-permission-forms.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { useLearningStudent } from '../learning/use-learning-student.ts'
import { PermissionDecisionCard } from './PermissionDecisionCard.tsx'
import { formsForStudent, type DecisionAudience } from './permission-forms.ts'

/**
 * İzin formlarım / Onay bekleyenler (veli ve öğrenci; IST-067, DOM-ILT-030, -037, -038): seçili
 * çocuğun (öğrencide kendisinin) hedef olduğu formlar ve onay ya da ret kararı. Veli çocuk seçicisi
 * kabuktan gelir (`ViewScopeContext`, `?cocuk=`); listeyi sunucu velinin 18 yaş altındaki çocuklarına,
 * öğrencide kendisine daraltır, burada çocuk bazında süzülür. Liste satırı kartın ihtiyacı olan
 * öğrenci satırlarını (durum, kendi kararı, `canDecide`) taşır: sayfa tek liste sorgusudur, kart
 * başına ayrıntı isteği atılmaz. 18 yaşından küçük öğrenci durumu izler; kararı velisi verir.
 */
export function FamilyPermissionFormsPage({
  page,
  audience,
}: {
  page: NavPage
  audience: DecisionAudience
}) {
  useDocumentTitle(page.title)
  const learner = useLearningStudent()
  const studentId = learner.student?.id ?? ''
  const forms = useAllPermissionForms({}, { enabled: studentId !== '' })
  const rows = useMemo(
    () => (forms.data ? formsForStudent(forms.data, studentId) : undefined),
    [forms.data, studentId],
  )
  const heading = <PageHeading title={page.title} description={page.description} />

  if (learner.noChild)
    return (
      <>
        {heading}
        <EmptyState
          title="Bağlı öğrenci bulunamadı."
          description="Hesabınıza bağlı bir öğrenci olduğunda izin formları burada görünür."
        />
      </>
    )
  if (learner.error)
    return (
      <>
        {heading}
        <QueryError error={learner.error} onRetry={learner.retry} />
      </>
    )
  if (forms.error)
    return (
      <>
        {heading}
        <QueryError error={forms.error} onRetry={() => void forms.refetch()} />
      </>
    )
  return (
    <>
      {heading}
      {!rows ? (
        <p role="status" className="text-sm text-muted-foreground">
          İzin formları yükleniyor…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="FileCheck"
          title="İzin formu yok."
          description={
            audience === 'guardian'
              ? 'Okul çocuğunuz için izin istediğinde form burada görünür ve bildirim gelir.'
              : 'Okul sizin için izin istediğinde form burada görünür.'
          }
        />
      ) : (
        <ul aria-label="İzin formları" className="grid gap-4">
          {rows.map((item) => (
            <li key={`${item.id}:${studentId}`}>
              <PermissionDecisionCard item={item} studentId={studentId} audience={audience} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
