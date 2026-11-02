import { useMemo, useState } from 'react'
import type { Session as CoreSession } from '@kampus/school-core/lib/domain.ts'
import type { Session } from '@/auth/auth-port.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import { useSourcesState } from '../workflows/use-workflow-state.ts'
import { collectionSources } from '../workflows/workflow-state.ts'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import { RemoveDialog, SlotForm } from './SlotParts.tsx'
import {
  availabilityRows,
  AVAILABILITY_SOURCES,
  slotTeachers,
  type AvailabilityRow,
} from './tutoring-model.ts'

const MOBILE_COLUMNS = ['when', 'duration'] as const
type Props = { session: Session; actor: CoreSession }

/**
 * Öğretmen uygunluk saatleri (etüt planlamasının girdisi): yönetici herkes için, öğretmen kendisi
 * için saat ekler ve kaldırır; kural ve yetkiyi sunucu zorlar (ekran yalnız gizler). Saat
 * kaldırmak mevcut etütleri iptal etmez; geri alınamayacağından kısa bir onay istenir.
 */
export function AvailabilitySection({ session, actor }: Props) {
  const sources = useMemo(
    () => collectionSources(AVAILABILITY_SOURCES, session.role),
    [session.role],
  )
  const data = useSourcesState(sources, session)
  const now = useMinuteClock()
  const rows = availabilityRows(data.state, actor, now)
  const teachers = slotTeachers(data.state, actor)
  const [removing, setRemoving] = useState<AvailabilityRow | null>(null)

  const columns = useMemo<DataColumn<AvailabilityRow>[]>(
    () => [
      { key: 'teacher', label: 'Öğretmen' },
      { key: 'when', label: 'Başlangıç' },
      { key: 'duration', label: 'Süre (dk)' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.past ? 'Geçmiş' : 'Açık'} />,
      },
      {
        key: 'actions',
        label: 'İşlem',
        cell: (row) =>
          row.manageable ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`${row.when} uygunluk saatini kaldır`}
              onClick={() => setRemoving(row)}
            >
              Kaldır
            </Button>
          ) : null,
      },
    ],
    [],
  )

  return (
    <AssessmentPanel
      id="uygunluk-saatleri"
      title="Öğretmen uygunluk saatleri"
      description="Otomatik etüt planı yalnız bu saatlere etüt yerleştirir."
      flush
    >
      {data.error || teachers.length ? (
        <div className="grid gap-4 px-6 pt-2 pb-6 max-[650px]:px-4">
          {data.error ? <QueryError error={data.error} onRetry={data.retry} /> : null}
          {teachers.length ? (
            <SlotForm
              key={teachers[0]?.id}
              teachers={teachers}
              admin={session.role === 'yonetici'}
            />
          ) : null}
        </div>
      ) : null}
      <DataTable
        listKey="uygunluk-saatleri"
        rows={rows}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        searchKeys={['teacher', 'when']}
        caption="Öğretmen uygunluk saatleri"
        empty="Henüz uygunluk saati yok."
      />
      {removing ? (
        <RemoveDialog
          row={removing}
          version={data.versions.get(removing.id)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </AssessmentPanel>
  )
}
