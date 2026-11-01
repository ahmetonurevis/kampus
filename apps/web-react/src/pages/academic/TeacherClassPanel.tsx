import { Link } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { ROLE_HOMEROOM, type AcademicLookups } from './academic-rows.ts'
import { ParentContactSection } from './ParentContactSection.tsx'

type StudentRow = { id: string; name: string; number: string }
const STUDENT_COLUMNS: DataColumn<StudentRow>[] = [
  { key: 'name', label: 'Öğrenci' },
  { key: 'number', label: 'Okul numarası' },
]

type Props = {
  classId: string
  teacherId: string
  lookups: AcademicLookups
  onClose: () => void
}

/**
 * Sınıf özeti (Vue "Öğrenci listesi" bölümü): sınıf tek kayıt ucundan okunur; öğretmenin
 * kapsamı dışındaki sınıf 404 olur ve "bulunamadı" gösterilir. Öğrenciler yalnız kapsamdakilerdir;
 * velilerin iletişim bilgisi maskeli gelir, "Göster" ile denetimli açılır (DOM-YTK-055).
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
            columns={STUDENT_COLUMNS}
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
