import { Avatar } from '@/components/Avatar.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { recordStatus, type ManagementLookups } from './management-rows.ts'
import { RecordActions, type RecordActionHandlers } from './RecordActions.tsx'
import {
  SummaryHeader,
  SummaryList,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from './SummaryParts.tsx'

type Props = {
  teacherId: string
  lookups: ManagementLookups
  /** Düzenle, arşivle, geri al (yalnız yönetici). */
  actions: RecordActionHandlers
  onClose: () => void
}

/** Öğretmen özeti: iletişim, branş/kampüs, takip oranları, ders verdiği ve danışmanı olduğu sınıflar. */
export function TeacherSummaryPanel({ teacherId, lookups, actions, onClose }: Props) {
  return (
    <SidePanel
      open={teacherId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Öğretmen özeti"
    >
      {teacherId ? (
        <TeacherDetail teacherId={teacherId} lookups={lookups} actions={actions} />
      ) : null}
    </SidePanel>
  )
}

function TeacherDetail({ teacherId, lookups, actions }: Omit<Props, 'onClose'>) {
  const item = useCoreItem('teachers', teacherId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const record = item.data.record
  const subject = lookups.subjects.get(record.subjectId)?.name ?? record.subject
  const branch = lookups.branches.get(record.branchId)?.name ?? '—'
  const lessons = (lookups.assignmentsByTeacher.get(record.id) ?? []).flatMap((assignment) => {
    const schoolClass = lookups.classes.get(assignment.classId)
    return schoolClass?.isActive ? [{ assignment, schoolClass }] : []
  })
  const advised = [...lookups.classes.values()].filter(
    (schoolClass) => schoolClass.isActive && schoolClass.teacherId === record.id,
  )
  return (
    <>
      <SummaryHeader
        icon={<Avatar name={record.name} />}
        title={record.name}
        subtitle={`${subject} · ${branch}`}
        status={recordStatus(record)}
      />
      <SummaryMetrics
        items={[
          { label: 'E-posta', value: record.email },
          { label: 'Telefon', value: record.phone },
          { label: 'Yoklama', value: `%${record.attendanceRate}` },
          { label: 'Ödev takibi', value: `%${record.homeworkRate}` },
        ]}
      />
      <SummarySection title="Ders verdiği sınıflar">
        <SummaryList
          empty="Henüz ders atanmamış."
          items={lessons.map(({ assignment, schoolClass }) => ({
            key: assignment.id,
            label: schoolClass.name,
            value: lookups.subjects.get(assignment.subjectId)?.name ?? subject,
          }))}
        />
      </SummarySection>
      <SummarySection title="Sınıf danışmanlığı">
        <SummaryList
          empty="Danışmanı olduğu sınıf yok."
          items={advised.map((schoolClass) => ({
            key: schoolClass.id,
            label: schoolClass.name,
            value: lookups.branches.get(schoolClass.branchId)?.name ?? '—',
          }))}
        />
      </SummarySection>
      {actions.canManage ? (
        <div className="mt-6 flex flex-wrap gap-2 border-t pt-4">
          <RecordActions
            {...actions}
            id={record.id}
            name={record.name}
            archived={!record.isActive}
            size="default"
          />
        </div>
      ) : null}
    </>
  )
}
