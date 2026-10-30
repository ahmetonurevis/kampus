import { useMemo, type ReactNode } from 'react'
import { isUnreadableCollectionError } from '@kampus/react-shared/collections.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { combineStates, ListCard } from '../dashboard/DashboardParts.tsx'
import { LookupError } from './AcademicParts.tsx'
import { homeworkReviews, type ReviewRow } from './exam-analysis-model.ts'
import { useAnalysisStudent } from './use-analysis-student.ts'

const NONE: readonly never[] = []

/**
 * Öğretmen Görüşleri (veli, Vue `Academic.vue` `ogretmen-degerlendirmeleri`): seçili çocuğun
 * ödevlerine öğretmenlerin yazdığı geri bildirimler ve rehberlik görüşmesinin paylaşılan planı.
 * Rehberlik iç notu veliye hiç gelmez: sunucu o alanları yanıttan çıkarır (DOM-YTK-020); bu ekran
 * ayrıca süzmez, yalnız paylaşılan alanları çizer. Vue'daki, ortalama ve devamsızlıktan üretilen
 * şablon metni gerçek bir öğretmen görüşü olmadığı için taşınmadı.
 */
export function TeacherReviewsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { student, lookups, error, retry, pending } = useAnalysisStudent()
  const studentId = student?.id ?? ''
  const enabled = student !== undefined
  const submissions = useCoreAll('submissions', { filters: { studentId } }, { enabled })
  const homework = useCoreAll(
    'homework',
    { filters: { classId: student?.classId ?? '' } },
    { enabled },
  )
  const guidance = useCoreAll('guidanceCases', { filters: { studentId } }, { enabled })

  const reviews = useMemo(
    () =>
      homeworkReviews(
        submissions.data?.map((row) => row.record) ?? NONE,
        homework.data?.map((row) => row.record) ?? NONE,
        lookups.teachers,
      ),
    [submissions.data, homework.data, lookups.teachers],
  )
  const reviewState = combineStates(submissions, homework)
  // Rehberlik modülü kapalı ya da bu kurum türünde yok (dil okulu): bölüm hiç çizilmez.
  const guidanceHidden = guidance.error !== null && isUnreadableCollectionError(guidance.error)
  const cases = guidance.data?.map((row) => row.record) ?? NONE

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {error ? <LookupError error={error} onRetry={retry} /> : null}
      {student ? (
        <div className="grid gap-[var(--space-section)]">
          <ListCard
            title="Ödev geri bildirimleri"
            description="Öğretmenlerin teslim edilen ödevlere yazdığı görüşler"
            state={reviewState}
            isEmpty={reviews.length === 0}
            emptyText="Henüz öğretmen geri bildirimi yok."
          >
            <ul aria-label="Ödev geri bildirimleri" className="grid gap-4 lg:grid-cols-2">
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </ul>
          </ListCard>
          {guidanceHidden ? null : (
            <ListCard
              title="Rehberlik görüşü"
              description="Rehberlik görüşmesinde sizinle paylaşılan destek planı"
              state={combineStates(guidance)}
              isEmpty={cases.length === 0}
              emptyText="Paylaşılan rehberlik görüşü yok."
            >
              <ul aria-label="Rehberlik görüşleri" className="grid gap-4 lg:grid-cols-2">
                {cases.map((item) => (
                  <li
                    key={item.id}
                    className="grid min-w-0 content-start gap-3 rounded-card border p-4"
                  >
                    <Person
                      name={lookups.teachers.get(item.teacherId)?.name ?? 'Rehberlik öğretmeni'}
                      caption={item.title}
                    />
                    <p className="text-sm [overflow-wrap:anywhere]">{item.sharedNote}</p>
                    {item.plan ? (
                      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        <strong className="font-medium text-foreground">Destek planı: </strong>
                        {item.plan}
                      </p>
                    ) : null}
                    <Footer>
                      <StatusBadge text={item.status} />
                      {item.followUp ? (
                        <small className="text-muted-foreground">
                          Takip: {dateLabel(item.followUp, { year: 'numeric' })}
                        </small>
                      ) : null}
                    </Footer>
                  </li>
                ))}
              </ul>
            </ListCard>
          )}
        </div>
      ) : !pending && !error ? (
        <EmptyState
          title="Bağlı öğrenci bulunamadı."
          description="Hesabınıza bağlı bir öğrenci olduğunda öğretmen görüşleri burada görünür."
        />
      ) : null}
    </>
  )
}

function ReviewCard({ review }: { review: ReviewRow }) {
  return (
    <li className="grid min-w-0 content-start gap-3 rounded-card border p-4">
      <Person name={review.teacher} caption={review.title} />
      <p className="text-sm [overflow-wrap:anywhere]">{review.feedback}</p>
      <Footer>
        {review.score === null ? (
          <StatusBadge text="Puan verilmedi" tone="gray" />
        ) : (
          <StatusBadge text={`${review.score}/100`} tone={review.score < 65 ? 'amber' : 'green'} />
        )}
        <small className="text-muted-foreground">
          {dateLabel(review.date, { year: 'numeric' })}
        </small>
      </Footer>
    </li>
  )
}

function Person({ name, caption }: { name: string; caption: string }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} />
      <div className="min-w-0">
        <strong className="block [overflow-wrap:anywhere]">{name}</strong>
        <small className="text-muted-foreground [overflow-wrap:anywhere]">{caption}</small>
      </div>
    </div>
  )
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2">{children}</div>
}
