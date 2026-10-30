import { use } from 'react'
import { useSearchParams } from 'react-router'
import { Avatar } from '@/components/Avatar.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { CHILD_PARAM } from '@/lib/child-selection.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { AttendanceView } from './AttendanceView.tsx'
import { GradesView } from './GradesView.tsx'
import { ScheduleView } from './ScheduleView.tsx'
import { useAcademicLookups } from './use-academic-lookups.ts'

type Tab = 'notlar' | 'devamsizlik' | 'program'
const TABS: readonly LineTabOption<Tab>[] = [
  { value: 'notlar', label: 'Notlar', icon: 'Award' },
  { value: 'devamsizlik', label: 'Devamsızlık', icon: 'ClipboardCheck' },
  { value: 'program', label: 'Ders programı', icon: 'CalendarDays' },
]
const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab.value === value)

/**
 * Akademik Takip (veli, Vue `Academic.vue` çocuk görünümü): seçili çocuğun notları, devamsızlığı
 * ve ders programı; öğrencinin ekranlarıyla aynı bileşenlerdir. Seçili çocuk kabuktan gelir
 * (`ViewScopeContext`, adreste `?cocuk=`); kapsamı sunucu velinin bağlı çocuklarına daraltır.
 */
export function ParentTrackingPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const childId = use(ViewScopeContext)
  const [params, setParams] = useSearchParams()
  const requested = params.get('sekme')
  const tab: Tab = isTab(requested) ? requested : 'notlar'
  const { lookups } = useAcademicLookups()
  const student = lookups.students.get(childId)
  const schoolClass = lookups.classes.get(student?.classId ?? '')
  const campus = lookups.branches.get(schoolClass?.branchId ?? '')

  if (!childId)
    return (
      <>
        <PageHeading title={page.title} description={page.description} />
        <EmptyState
          title="Bağlı öğrenci bulunamadı."
          description="Hesabınıza bağlı bir öğrenci olduğunda notlar ve devamsızlık burada görünür."
        />
      </>
    )
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {student ? (
        <section
          aria-label="Öğrenci özeti"
          className="panel mb-6 flex flex-wrap items-center gap-4 rounded-card border bg-surface px-6 py-5"
        >
          <Avatar name={student.name} size="large" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{student.name}</h2>
            <p className="text-sm text-muted-foreground">
              {[schoolClass?.name, campus?.name].filter(Boolean).join(' · ')}
            </p>
          </div>
        </section>
      ) : null}
      <div className="mb-6">
        <LineTabs
          label="Akademik takip bölümleri"
          value={tab}
          options={TABS}
          onChange={(next) =>
            setParams({ [CHILD_PARAM]: childId, sekme: next }, { preventScrollReset: true })
          }
        />
      </div>
      {tab === 'notlar' ? (
        <GradesView audience="student" studentId={childId} title="Notlar" />
      ) : tab === 'devamsizlik' ? (
        <AttendanceView audience="student" studentId={childId} title="Devamsızlık" />
      ) : (
        <ScheduleView audience="student" studentId={childId} />
      )}
    </>
  )
}
