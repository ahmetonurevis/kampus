import { useMemo, useState } from 'react'
import { useAuth } from '@/auth/use-auth.ts'
import type { Session } from '@/auth/auth-port.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import { RemoveDialog, SlotForm } from '../assessment/SlotParts.tsx'
import type { AvailabilityRow } from '../assessment/tutoring-model.ts'
import { TableSection } from '../academic/AcademicParts.tsx'
import { useSourcesState } from '../workflows/use-workflow-state.ts'
import { collectionSources, coreSession } from '../workflows/workflow-state.ts'
import {
  TEACHER_SLOT_SOURCES,
  ownSlotTeacher,
  teacherSlotRows,
  type TeacherSlotRow,
} from './teacher-availability.ts'

const NEW_SLOT = 'yeni'
const MOBILE_COLUMNS = ['startsAt', 'time'] as const

/**
 * Öğretmenin Etüt & Görüşmeler sayfasındaki "Müsaitlik saatlerim" bölümü (Vue `Communication.vue`):
 * kendi gelecek saatleri, Dolu/Müsait durumu, "Müsaitlik ekle" (sağ panel) ve boş saati kaldırma.
 * Öğrenci ve veli randevuyu bu saatlerden talep eder. Saat ekleme ve kaldırma etüt komutlarıdır
 * (`slot`, `slot-remove`); yetki, kural ve rol kapsamı sunucudadır, ekran yalnız gösterir. Öğretmen
 * alanı oturumdaki öğretmene sabittir; randevuya bağlı saat kaldırılamaz (DOM-ILT-101) ve satırda
 * nedeni yazar. Etüt modülü kapalıysa komutlar kapalıdır, bölüm hiç görünmez.
 */
export function TeacherAvailabilitySection() {
  const { session } = useAuth()
  if (!session || session.role !== 'ogretmen' || session.modules.tutoring !== true) return null
  return <SectionView session={session} />
}

function SectionView({ session }: { session: Session }) {
  const actor = useMemo(() => coreSession(session, ''), [session])
  const sources = useMemo(
    () => collectionSources(TEACHER_SLOT_SOURCES, session.role),
    [session.role],
  )
  const data = useSourcesState(sources, session)
  const panel = useDetailPanel('musaitlik-form')
  const now = useMinuteClock()
  const rows = teacherSlotRows(data.state, actor, now)
  const teacher = ownSlotTeacher(data.state, actor)
  const [removing, setRemoving] = useState<TeacherSlotRow | null>(null)

  const columns = useMemo<DataColumn<TeacherSlotRow>[]>(
    () => [
      // Anahtar sıralama değeridir (ISO an); metin `cell`'den gelir.
      { key: 'startsAt', label: 'Tarih', cell: (row) => row.day },
      { key: 'time', label: 'Saat' },
      { key: 'duration', label: 'Süre (dk)' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={row.booked ? 'gray' : 'green'} />,
      },
      {
        key: 'actions',
        label: 'İşlem',
        cell: (row) =>
          row.booked ? (
            <span className="text-xs text-muted-foreground">
              Randevuya bağlı; önce randevuyu iptal edin
            </span>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`${row.day} ${row.time} müsaitlik saatini kaldır`}
              onClick={() => setRemoving(row)}
            >
              Kaldır
            </Button>
          ),
      },
    ],
    [],
  )

  const open = rows.filter((row) => !row.booked).length
  const removingRow: AvailabilityRow | null = removing
    ? {
        id: removing.id,
        teacherId: teacher?.id ?? '',
        teacher: teacher?.name ?? '',
        date: removing.startsAt,
        when: `${removing.day} ${removing.time}`,
        duration: removing.duration,
        manageable: true,
        past: false,
      }
    : null

  return (
    <>
      <TableSection
        title="Müsaitlik saatlerim"
        subtitle={`${rows.length} saat · ${open} müsait · öğrenci ve veliler bu saatlerden randevu talep eder`}
        action={
          teacher ? (
            <Button onClick={() => panel.open(NEW_SLOT)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Müsaitlik ekle
            </Button>
          ) : undefined
        }
      >
        {data.error ? (
          <div className="px-6 pb-4 max-[650px]:px-4">
            <QueryError error={data.error} onRetry={data.retry} />
          </div>
        ) : null}
        <DataTable
          listKey="musaitlik-saatlerim"
          rows={rows}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          searchKeys={['startsAt', 'time']}
          caption="Müsaitlik saatlerim"
          empty="Henüz müsaitlik saati tanımlanmamış."
        />
      </TableSection>
      <SidePanel
        open={panel.selectedId === NEW_SLOT && teacher !== undefined}
        onOpenChange={(next) => (next ? undefined : panel.close())}
        title="Müsaitlik ekle"
        description="Öğrenci ve veliler randevuyu bu saatlerden talep eder."
      >
        {teacher ? <SlotForm teachers={[teacher]} admin={false} onClose={panel.close} /> : null}
      </SidePanel>
      {removingRow ? (
        <RemoveDialog
          row={removingRow}
          version={data.versions.get(removingRow.id)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  )
}
