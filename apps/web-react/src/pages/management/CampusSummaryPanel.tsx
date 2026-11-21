import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { recordStatus, type CampusSummary, type ManagementLookups } from './management-rows.ts'
import { RecordActions, type RecordActionHandlers } from './RecordActions.tsx'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryList,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from './SummaryParts.tsx'

type Props = {
  campusId: string
  campuses: readonly CampusSummary[]
  lookups: ManagementLookups
  /** Düzenle, arşivle, geri al (yalnız yönetici). */
  actions: RecordActionHandlers
  onClose: () => void
}

/** Kampüs özeti: adres, aktif sınıf/öğrenci/öğretmen sayıları ve sınıfların doluluğu. */
export function CampusSummaryPanel({ campusId, campuses, lookups, actions, onClose }: Props) {
  return (
    <SidePanel
      open={campusId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Kampüs özeti"
    >
      {campusId ? (
        <CampusDetail campusId={campusId} campuses={campuses} lookups={lookups} actions={actions} />
      ) : null}
    </SidePanel>
  )
}

function CampusDetail({ campusId, campuses, lookups, actions }: Omit<Props, 'onClose'>) {
  const item = useCoreItem('branches', campusId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const record = item.data.record
  const summary = campuses.find((campus) => campus.id === record.id)
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="School" />}
        title={record.name}
        subtitle={record.address}
        status={recordStatus(record)}
      />
      <SummaryMetrics
        items={[
          { label: 'Aktif sınıf', value: summary?.classes.length ?? 0 },
          { label: 'Aktif öğrenci', value: summary?.students ?? 0 },
          { label: 'Eğitim kadrosu', value: summary?.teachers ?? 0 },
        ]}
      />
      <SummarySection title="Sınıflar">
        <SummaryList
          empty="Bu kampüste aktif sınıf yok."
          items={(summary?.classes ?? []).map((schoolClass) => ({
            key: schoolClass.id,
            label: schoolClass.name,
            value: `${lookups.studentCounts.get(schoolClass.id) ?? 0} / ${schoolClass.capacity} öğrenci · Derslik ${schoolClass.room}`,
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
