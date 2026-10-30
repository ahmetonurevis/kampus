import type { ReactNode } from 'react'
import { Avatar } from '@/components/Avatar.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { StudentHomeworkView } from './StudentHomeworkView.tsx'
import { StudentQuizzesView } from './StudentQuizzesView.tsx'
import { useLearningStudent } from './use-learning-student.ts'

type Student = CoreRecord<'students'>

/** Öğrencinin kaydı gelene kadar yükleniyor/hata/boş durumlarını çizer; sonra `children`. */
export function LearningStudentGate({
  page,
  children,
}: {
  page: NavPage
  children: (student: Student) => ReactNode
}) {
  useDocumentTitle(page.title)
  const { student, noChild, isPending, error, retry } = useLearningStudent()
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
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

/** Ödevlerim (öğrenci, Vue `Learning.vue` `/odevler`). */
export function StudentHomeworkPage({ page }: { page: NavPage }) {
  return (
    <LearningStudentGate page={page}>
      {(student) => <StudentHomeworkView student={student} title="Ödevlerim" />}
    </LearningStudentGate>
  )
}

/** Quiz & Testler (öğrenci, Vue `Learning.vue` `/soru-coz` sonuç listesi). */
export function StudentQuizzesPage({ page }: { page: NavPage }) {
  return (
    <LearningStudentGate page={page}>
      {(student) => <StudentQuizzesView student={student} title="Quizlerim" />}
    </LearningStudentGate>
  )
}

export function StudentSummary({ student }: { student: Student }) {
  return (
    <section
      aria-label="Öğrenci özeti"
      className="panel mb-6 flex flex-wrap items-center gap-4 rounded-card border bg-surface px-6 py-5"
    >
      <Avatar name={student.name} size="large" />
      <div className="min-w-0">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{student.name}</h2>
        <p className="text-sm text-muted-foreground">Okul no: {student.number ?? '—'}</p>
      </div>
    </section>
  )
}
