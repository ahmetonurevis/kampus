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
  if (writing) return <StudentWritingWorkspace page={page} assignmentId={writing} />
  return (
    <LearningStudentGate page={page} before={<StudentTaskSection mode="teacher" />}>
      {(student) => <StudentHomeworkView student={student} title="Ödevlerim" />}
    </LearningStudentGate>
  )
}

/**
 * Quiz & Testler (öğrenci). Üstte API'li quiz görevleri (`?coz=` çalışma alanı), altta eski quiz
 * sonuçları (Vue `Learning.vue` `/soru-coz`). TODO(demo-kalicilik): eski kayıtlar taşınınca
 * alt bölüm kalkar.
 */
export function StudentQuizzesPage({ page }: { page: NavPage }) {
  const [params] = useSearchParams()
  const quiz = params.get(QUIZ_PARAM) ?? ''
  if (quiz) return <StudentQuizWorkspace page={page} assignmentId={quiz} />
  return (
    <LearningStudentGate page={page} before={<StudentTaskSection mode="auto" />}>
      {(student) => <StudentQuizzesView student={student} title="Quizlerim" />}
    </LearningStudentGate>
  )
}
