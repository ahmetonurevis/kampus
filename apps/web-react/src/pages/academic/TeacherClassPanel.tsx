import { useMemo } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { ROLE_HOMEROOM, type AcademicLookups } from './academic-rows.ts'
import { ParentContactSection } from './ParentContactSection.tsx'
import { studentProfileHref, type ProfileLinkState } from './student-profile-model.ts'

type StudentRow = { id: string; name: string; number: string }

/**
 * Öğrenci sütunları; "Profili aç" öğrenci profiline gider ve bu adresi (panel açık, liste
 * süzgeçleri dahil) geçmiş durumuna yazar: profildeki "Listeye dön" buraya döner.
 */
function studentColumns(from: string): DataColumn<StudentRow>[] {
  const state: ProfileLinkState = { from }
  return [
    { key: 'name', label: 'Öğrenci' },
    { key: 'number', label: 'Okul numarası' },
    {
      key: ACTIONS_KEY,
      label: 'İşlemler',
      cell: (row) => (
        <Link
          to={studentProfileHref(row.id)}
          state={state}
          aria-label={`${row.name} profilini aç`}
          className="text-link inline-flex min-h-6 items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Profili aç
          <Icon name="ArrowRight" size={14} aria-hidden="true" />
        </Link>
      ),
    },
  ]
}

type Props = {
  classId: string
  teacherId: string
  lookups: AcademicLookups
  onClose: () => void
}

/**
 * Sınıf özeti (Vue "Öğrenci listesi" bölümü): sınıf tek kayıt ucundan okunur; öğretmenin
 * kapsamı dışındaki sınıf 404 olur ve "bulunamadı" gösterilir. Öğrenciler yalnız kapsamdakilerdir;
 * velilerin iletişim bilgisi maskeli gelir, "Göster" ile denetimli açılır (DOM-YTK-055). Her
 * öğrenciden öğrenci profiline (`/ogretmen/ogrenci/:id`) geçilir.
 */
export function TeacherClassPanel({ classId, teacherId, lookups, onClose }: Props) {
  return (
    <SidePanel
      open={classId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sınıf özeti"
    >
      {classId ? <ClassSummary classId={classId} teacherId={teacherId} lookups={lookups} /> : null}
    </SidePanel>
  )
}

function ClassSummary({ classId, teacherId, lookups }: Omit<Props, 'onClose'>) {
  const item = useCoreItem('classes', classId)
  const { session } = useAuth()
  const location = useLocation()
  const from = `${location.pathname}${location.search}`
  const columns = useMemo(() => studentColumns(from), [from])
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const record = item.data.record
  const students = lookups.studentsByClass.get(record.id) ?? []
  const branch = lookups.branches.get(record.branchId)?.name ?? '—'
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="UsersRound" />}
        title={record.name}
        subtitle={`${branch} · Derslik ${record.room}`}
        status="Aktif"
      />
      <SummaryMetrics
        items={[
          { label: 'Öğrenci', value: `${students.length} / ${record.capacity}` },
          {
            label: 'Göreviniz',
            value: record.teacherId === teacherId ? ROLE_HOMEROOM : 'Branş öğretmeni',
          },
        ]}
      />
      <SummarySection title="Öğrenciler">
        <div className="overflow-hidden rounded-card border">
          <DataTable
            key={record.id}
            listKey={`teacher-class-${record.id}`}
            urlPrefix="ogrenci-"
            rows={students.map((student) => ({
              id: student.id,
              name: student.name,
              number: student.number ?? '',
            }))}
            columns={columns}
            caption={`${record.name} öğrencileri`}
            empty="Bu sınıfta aktif öğrenci yok."
          />
        </div>
      </SummarySection>
      <ParentContactSection
        students={students}
        canReveal={session?.modules.communication === true}
      />
      <Button asChild variant="secondary">
        <Link to={`?sekme=notlar&not-sinif=${encodeURIComponent(record.id)}`}>
          Bu sınıfın notlarını aç
        </Link>
      </Button>
    </>
  )
}
