import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { StudentTaskSection } from '../tasks/StudentTaskSection.tsx'
import { QUIZ_PARAM, StudentQuizWorkspace } from '../tasks/StudentQuizWorkspace.tsx'
import { StudentWritingWorkspace, WRITING_PARAM } from '../tasks/StudentWritingWorkspace.tsx'
import { StudentHomeworkView } from './StudentHomeworkView.tsx'
import { QUIZ_SOLVE_PARAM, StudentQuizSolve } from './StudentQuizSolve.tsx'
import { StudentQuizzesView } from './StudentQuizzesView.tsx'
import { useLearningStudent } from './use-learning-student.ts'

type Student = CoreRecord<'students'>

/** Öğrencinin kaydı gelene kadar yükleniyor/hata/boş durumlarını çizer; sonra `children`. */
export function LearningStudentGate({
  page,
  before,
  children,
}: {
  page: NavPage
  /** Öğrenci kaydından bağımsız içerik (API'li görev listesi); başlığın hemen altında. */
  before?: ReactNode
  children: (student: Student) => ReactNode
}) {
  useDocumentTitle(page.title)
  const { student, noChild, isPending, error, retry } = useLearningStudent()
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {before}
      {noChild ? (
        <EmptyState
          title="Bağlı öğrenci bulunamadı."
          description="Hesabınıza bağlı bir öğrenci olduğunda ödev ve quiz sonuçları burada görünür."
        />
      ) : error ? (
        <QueryError error={error} onRetry={retry} />
      ) : student ? (
        children(student)
      ) : isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Öğrenci bilgileri yükleniyor…
        </p>
      ) : (
        <EmptyState
          title="Öğrenci kaydı bulunamadı."
          description="Seçili öğrenciye ait kayıt görüntülenemiyor."
        />
      )}
    </>
  )
}

/**
 * Ödevlerim (öğrenci). Üstte API'li yazma görevleri (`?yaz=` çalışma alanı), altta henüz
 * görev modeline geçmemiş eski ödev kayıtları (Vue `Learning.vue` `/odevler`).
 * TODO(demo-kalicilik): eski ödev kayıtları veri migration'ıyla (ADR 0004 Açık soru 4) taşınınca
 * alt bölüm kalkar.
 */
export function StudentHomeworkPage({ page }: { page: NavPage }) {
  const [params] = useSearchParams()
  const writing = params.get(WRITING_PARAM) ?? ''
  // Anahtar görev kimliğidir: `?yaz=A` → `?yaz=B` geçişinde kayıt, sayaç ve gösterim durumu
  // (liste ekranına uğramadan geçmişte gezilirse) önceki görevden taşınmaz.
  if (writing) return <StudentWritingWorkspace key={writing} page={page} assignmentId={writing} />
  return (
    <LearningStudentGate page={page} before={<StudentTaskSection mode="teacher" />}>
      {(student) => <StudentHomeworkView student={student} title="Ödevlerim" mode="student" />}
    </LearningStudentGate>
  )
}

/**
 * Quiz & Testler (öğrenci). Üstte API'li quiz görevleri (`?coz=` çalışma alanı), altta sınıfın
 * quizleri (`/quizzes`; `?quiz=` sonuç paneli, `?quiz-coz=` çözme ekranı; IST-095).
 */
export function StudentQuizzesPage({ page }: { page: NavPage }) {
  const [params] = useSearchParams()
  const task = params.get(QUIZ_PARAM) ?? ''
  const solving = params.get(QUIZ_SOLVE_PARAM) ?? ''
  if (task) return <StudentQuizWorkspace page={page} assignmentId={task} />
  if (solving) return <StudentQuizSolve key={solving} page={page} quizId={solving} />
  return (
    <LearningStudentGate page={page} before={<StudentTaskSection mode="auto" />}>
      {(student) => <StudentQuizzesView student={student} title="Quizlerim" mode="student" />}
    </LearningStudentGate>
  )
}
