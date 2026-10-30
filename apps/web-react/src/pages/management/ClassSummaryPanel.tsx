import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { recordStatus, type ManagementLookups } from './management-rows.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryList,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from './SummaryParts.tsx'

type StudentRow = { id: string; name: string; number: string }
const STUDENT_COLUMNS: DataColumn<StudentRow>[] = [
  { key: 'name', label: 'Öğrenci' },
  { key: 'number', label: 'Okul numarası' },
]

type Props = {
  classId: string
  lookups: ManagementLookups
  onClose: () => void
}

/**
 * Sınıf özeti (Vue "Sınıf özeti" çekmecesi): kayıt tek kayıt ucundan okunur (bağlantıyla
 * gelinen ve listede görünmeyen sınıf da açılır); atama ve öğrenciler başvuru eşlemelerinden.
 */
export function ClassSummaryPanel({ classId, lookups, onClose }: Props) {
  // TODO(D1b2): yazma uçları gelince "Sınıfı düzenle" geniş formu panel altından açılır.
  return (
    <SidePanel
      open={classId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sınıf özeti"
    >
      {classId ? <ClassSummary classId={classId} lookups={lookups} /> : null}
    </SidePanel>
  )
}

function ClassSummary({ classId, lookups }: Omit<Props, 'onClose'>) {
  const item = useCoreItem('classes', classId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const record = item.data.record
  const students = lookups.studentsByClass.get(record.id) ?? []
  const assignments = lookups.assignmentsByClass.get(record.id) ?? []
  const branch = lookups.branches.get(record.branchId)?.name ?? '—'
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="School" />}
        title={record.name}
        subtitle={`${branch} · Derslik ${record.room}`}
        status={recordStatus(record)}
      />
      <SummaryMetrics
        items={[
          { label: 'Öğrenci / Kontenjan', value: `${students.length} / ${record.capacity}` },
          {
            label: 'Sınıf danışmanı',
            value: lookups.teachers.get(record.teacherId)?.name ?? '—',
          },
        ]}
      />
      <SummarySection title="Ders ve öğretmen atamaları">
        <SummaryList
          empty="Henüz ders atanmamış."
          items={assignments.map((assignment) => ({
            key: assignment.id,
            label: lookups.subjects.get(assignment.subjectId)?.name ?? assignment.subjectId,
            value: lookups.teachers.get(assignment.teacherId)?.name ?? '—',
          }))}
        />
      </SummarySection>
      <SummarySection title="Öğrenciler">
        <div className="overflow-hidden rounded-card border">
          <DataTable
            key={record.id}
            listKey={`class-summary-${record.id}`}
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
    </>
  )
}
