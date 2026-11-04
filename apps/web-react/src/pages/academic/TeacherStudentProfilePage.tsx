import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { isApiError } from '@kampus/api-client/errors.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { LookupError, StatGrid } from './AcademicParts.tsx'
import { AttendanceView } from './AttendanceView.tsx'
import { ExamResultsSection } from './ExamResultsSection.tsx'
import { GradeAnalysis } from './GradeAnalysis.tsx'
import { GradesView } from './GradesView.tsx'
import { HealthProfileSection } from './HealthProfileSection.tsx'
import { ParentContactSection } from './ParentContactSection.tsx'
import {
  ProfileGoals,
  ProfileGuidance,
  ProfileHomework,
  ProfileQuizResults,
  type ProfileContext,
} from './StudentProfileSections.tsx'
import {
  profileMetrics,
  profileReturnPath,
  profileTab,
  profileTabs,
  teacherDuty,
  type ProfileTab,
} from './student-profile-model.ts'
import { useAcademicLookups } from './use-academic-lookups.ts'

type Student = CoreRecord<'students'>

/**
 * Öğrenci profili (öğretmen, Vue `Academic.vue` `/ogretmen/ogrenci/:id`): kimlik özeti, veli
 * iletişimi ve sekmelerle akademik gelişim, not geçmişi, devamsızlık, ödev durumu, quiz/deneme
 * sonuçları, hedef ve rehberlik. Öğrenci tek kayıt ucundan okunur; öğretmenin ders vermediği ya da
 * danışmanı olmadığı sınıfın öğrencisi sunucuda 404'tür ve "bulunamadı" gösterilir (DOM-YTK-022).
 * Kimlik no, doğum tarihi ve finans bilgisi sunucudan hiç gelmez; rehberlik iç notu profilde yoktur.
 * Sağlık ve acil bilgi bölümü düzeye göre görünür: danışman tam bilgiyi, derse giren öğretmen yalnız
 * acil bilgiyi okur (DOM-ILT-035); erişimi olmayanda bölüm çizilmez.
 * Menüde ayrı girdisi yoktur; Sınıflarım'daki sınıf özetinden "Profili aç" ile açılır.
 */
export function TeacherStudentProfilePage({ page }: { page: NavPage }) {
  const { studentId = '' } = useParams()
  const location = useLocation()
  const backHref = profileReturnPath(location.state)
  const item = useCoreItem('students', studentId)
  useDocumentTitle(item.data?.record.name ?? page.title)

  const back = (
    <Button variant="secondary" asChild>
      <Link to={backHref}>
        <Icon name="ArrowLeft" size={16} aria-hidden="true" />
        Listeye dön
      </Link>
    </Button>
  )

  if (item.error)
    return (
      <>
        <PageHeading title={page.title} actions={back} />
        {isApiError(item.error) && item.error.status === 404 ? (
          <EmptyState
            icon="UsersRound"
            title="Öğrenci bulunamadı."
            description="Bu öğrenci sınıflarınıza kayıtlı değil veya kayıt artık mevcut değil."
          />
        ) : (
          <div className="rounded-card border bg-surface p-8">
            <QueryError error={item.error} onRetry={() => void item.refetch()} />
          </div>
        )}
      </>
    )
  if (!item.data) return <SummaryLoading />
  return <Profile key={item.data.record.id} student={item.data.record} back={back} page={page} />
}

function Profile({ student, back, page }: { student: Student; back: ReactNode; page: NavPage }) {
  const { session } = useAuth()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { lookups, pending, error, retry } = useAcademicLookups()
  // Öğretmenin `teachers` okuması yalnız kendi kaydını döndürür.
  const teacherId = [...lookups.teachers.keys()][0] ?? ''
  const schoolClass = lookups.classes.get(student.classId)
  const campus = lookups.branches.get(schoolClass?.branchId ?? '')
  const homeroom = teacherId !== '' && schoolClass?.teacherId === teacherId
  const context = useMemo<ProfileContext>(
    () => ({ studentId: student.id, classId: student.classId, teacherId, homeroom, lookups }),
    [student.id, student.classId, teacherId, homeroom, lookups],
  )

  const modules = session?.modules ?? {}
  const tabs = profileTabs(modules)
  const tab = profileTab(params.get('sekme'), tabs)
  // Sekme değişince bölümlerin süzgeç ve panel parametreleri sıfırlanır; geri dönüş adresi
  // (`state.from`) korunur. Çizgi sekme odak ve tıklamada aynı seçimi iki kez bildirir; gezinme
  // henüz tamamlanmadığından ikincisi geçmişe fazladan girdi eklerdi (geri bir adım atlanırdı).
  const requested = useRef<ProfileTab>(tab)
  useEffect(() => {
    requested.current = tab
  }, [tab])
  const selectTab = (next: ProfileTab) => {
    if (requested.current === next) return
    requested.current = next
    setParams(next === tabs[0]?.value ? {} : { sekme: next }, {
      preventScrollReset: true,
      state: location.state,
    })
  }

  const grades = useCoreAll('grades', { filters: { studentId: student.id } })
  const attendance = useCoreAll('attendance', { filters: { studentId: student.id } })
  const metrics = profileMetrics(
    grades.data?.map((row) => row.record),
    attendance.data?.map((row) => row.record),
  )

  return (
    <>
      <PageHeading title={student.name} description={page.description} actions={back} />
      {error ? <LookupError error={error} onRetry={retry} /> : null}
      <div className="mb-6 grid gap-[var(--space-section)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section
          aria-label="Öğrenci özeti"
          className="panel rounded-card border bg-surface px-6 py-5 max-[650px]:px-4"
        >
          <div className="mb-5 flex flex-wrap items-center gap-4">
            <Avatar name={student.name} size="large" />
            <div className="min-w-0">
              <p className="text-lg font-semibold [overflow-wrap:anywhere]">{student.name}</p>
              <p className="text-sm text-muted-foreground">
                {[schoolClass?.name, campus?.name, student.number ? `No: ${student.number}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="text-sm text-muted-foreground">Göreviniz: {teacherDuty(homeroom)}</p>
            </div>
          </div>
          <StatGrid
            label="Öğrenci göstergeleri"
            items={[
              {
                label: 'Not ortalaması',
                value: metrics.average === null ? '—' : `${metrics.average}/100`,
                note: 'Görebildiğiniz notlardan',
              },
              {
                label: 'Devamsızlık',
                value: metrics.absent === null ? '—' : `${metrics.absent} gün`,
                note: 'Gelmedi kayıtları (gün bazlı)',
              },
            ]}
          />
        </section>
        <section
          aria-label="Veli iletişimi"
          className="panel rounded-card border bg-surface px-6 py-5 max-[650px]:px-4 [&_.detail-section]:mb-0 [&_.detail-section]:border-t-0 [&_.detail-section]:pt-0"
        >
          <ParentContactSection
            students={[{ id: student.id, name: student.name }]}
            canReveal={modules.communication === true}
            emptyText="Bu öğrenciye bağlı kayıtlı veli yok."
          />
        </section>
      </div>
      <HealthProfileSection studentId={student.id} />
      <div className="mb-6">
        <LineTabs
          label="Öğrenci profili bölümleri"
          value={tab}
          options={tabs}
          onChange={selectTab}
        />
      </div>
      {error ? null : pending ? (
        // Öğretmen kaydı gelmeden `teacherId` boştur; bölümler süzülmüş (yanlış boş) çizilmesin.
        <p role="status" className="text-sm text-muted-foreground">
          Profil bölümleri yükleniyor…
        </p>
      ) : (
        <ProfileSection tab={tab} context={context} modules={modules} />
      )}
    </>
  )
}

function ProfileSection({
  tab,
  context,
  modules,
}: {
  tab: ProfileTab
  context: ProfileContext
  modules: Readonly<Record<string, boolean | undefined>>
}) {
  switch (tab) {
    case 'gelisim':
      return (
        <GradeAnalysis
          scope={{ studentId: context.studentId }}
          classId={context.classId}
          lookups={context.lookups}
        />
      )
    case 'notlar':
      return (
        <GradesView
          audience="student"
          studentId={context.studentId}
          urlPrefix="not-"
          title="Not geçmişi"
        />
      )
    case 'devamsizlik':
      return (
        <AttendanceView
          audience="student"
          studentId={context.studentId}
          urlPrefix="yoklama-"
          title="Devamsızlık"
        />
      )
    case 'odevler':
      return <ProfileHomework context={context} />
    case 'sinavlar':
      return (
        <>
          {modules.learning === true ? <ProfileQuizResults context={context} /> : null}
          {modules.exams === true ? <ExamResultsSection studentId={context.studentId} /> : null}
        </>
      )
    case 'takip':
      return (
        <>
          {modules.goals === true ? <ProfileGoals context={context} /> : null}
          {modules.guidance === true ? <ProfileGuidance context={context} /> : null}
        </>
      )
    default:
      return tab satisfies never
  }
}
