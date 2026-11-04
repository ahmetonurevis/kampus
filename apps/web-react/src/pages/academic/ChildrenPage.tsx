import { use } from 'react'
import { Link } from 'react-router'
import { Avatar } from '@/components/Avatar.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { withChildParam } from '@/lib/child-selection.ts'
import { pageHref, type NavPage } from '@/lib/navigation.ts'
import { LookupError } from './AcademicParts.tsx'
import { HealthProfileSection } from './HealthProfileSection.tsx'
import {
  attendanceCounts,
  overallAverage,
  scoreText,
  type AcademicLookups,
} from './academic-rows.ts'
import { useAcademicLookups } from './use-academic-lookups.ts'

/**
 * Çocuklarım (veli, Vue `cocuk-secici`): kapsamdaki çocukların kartları; ortalama ve devamsızlık
 * kayıtlardan hesaplanır. Kart, çocuğu seçip Akademik Takip'i açar (seçim adreste `?cocuk=`).
 * Altta seçili çocuğun sağlık ve acil bilgisi (DOM-ILT-035) görünür ve velayetli veli tarafından
 * düzenlenir; erişim yoksa (kısıtlı veli, 18+ öğrenci) bölüm çizilmez.
 */
export function ChildrenPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const data = useAcademicLookups()
  const selected = use(ViewScopeContext)
  const children = data.sources.students.map((item) => item.record)
  // Sağlık ve acil bilgi seçili çocuk içindir; seçim yoksa ilk çocuk.
  const healthChild = children.find((child) => child.id === selected) ?? children[0]
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {data.error ? <LookupError error={data.error} onRetry={data.retry} /> : null}
      {!data.pending && !data.error && children.length === 0 ? (
        <EmptyState
          title="Bağlı öğrenci bulunamadı."
          description="Hesabınıza bağlı bir öğrenci olduğunda burada görünür."
        />
      ) : (
        <ul
          aria-label="Çocuklarım"
          className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4"
        >
          {children.map((child) => (
            <ChildCard
              key={child.id}
              child={child}
              lookups={data.lookups}
              selected={child.id === selected}
            />
          ))}
        </ul>
      )}
      {healthChild ? (
        <div className="mt-6">
          <HealthProfileSection studentId={healthChild.id} studentName={healthChild.name} />
        </div>
      ) : null}
    </>
  )
}

function ChildCard({
  child,
  lookups,
  selected,
}: {
  child: { id: string; name: string; classId: string }
  lookups: AcademicLookups
  selected: boolean
}) {
  const filters = { filters: { studentId: child.id } }
  const grades = useCoreAll('grades', filters)
  const attendance = useCoreAll('attendance', filters)
  const schoolClass = lookups.classes.get(child.classId)
  const campus = lookups.branches.get(schoolClass?.branchId ?? '')
  const absent = attendance.data
    ? attendanceCounts(attendance.data.map((item) => item.record)).absent
    : null
  return (
    <li className="panel flex flex-col items-center gap-3 rounded-card border bg-surface p-6 text-center">
      <Avatar name={child.name} size="large" />
      <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{child.name}</h2>
      <p className="text-sm text-muted-foreground">
        {[schoolClass?.name, campus?.name].filter(Boolean).join(' · ')}
      </p>
      {selected ? <StatusBadge text="Seçili öğrenci" tone="purple" /> : null}
      <dl className="grid w-full grid-cols-2 gap-3">
        <div className="rounded-card border bg-surface-soft px-3 py-2">
          <dt className="text-xs text-muted-foreground">Ortalama</dt>
          <dd className="text-md font-semibold">
            {grades.data ? scoreText(overallAverage(grades.data.map((item) => item.record))) : '—'}
          </dd>
        </div>
        <div className="rounded-card border bg-surface-soft px-3 py-2">
          <dt className="text-xs text-muted-foreground">Devamsızlık</dt>
          <dd className="text-md font-semibold">{absent === null ? '—' : `${absent} ders`}</dd>
        </div>
      </dl>
      <Button asChild variant={selected ? 'default' : 'secondary'}>
        <Link
          to={{
            pathname: pageHref('veli', { path: 'akademik-takip' }),
            search: withChildParam('', child.id),
          }}
          aria-label={`${child.name} akademik takibini aç`}
        >
          {selected ? 'Seçili profili aç' : 'Bu profili seç'}
          <Icon name="ArrowRight" size={16} aria-hidden="true" />
        </Link>
      </Button>
    </li>
  )
}
