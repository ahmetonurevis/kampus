import { useState } from 'react'
import { FormField } from '@/components/FormField.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type { CoreRow } from '@/hooks/use-core-collection.ts'
import { MeetingForm } from './ProspectPlanPanel.tsx'

type Props = {
  open: boolean
  /** Açık aşamadaki adaylar (Tanışma Görüşmeleri'nin okuduğu liste). */
  prospects: readonly CoreRow<'prospects'>[]
  canPickTeacher: boolean
  onClose: () => void
}

/**
 * Tanışma Görüşmeleri'nden görüşme planlama (Vue `Crm.vue` "Tanışma görüşmesi planla" penceresi):
 * önce açık aday seçilir, sonra aday detayındakiyle aynı form açılır (DOM-KAY-033). Kayıt olmuş ya
 * da vazgeçmiş aday listede yoktur. Seçim panel her açıldığında sıfırdan başlar.
 */
export function MeetingPlanPanel({ open, prospects, canPickTeacher, onClose }: Props) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Tanışma görüşmesi planla"
    >
      {open ? (
        <PlanContent prospects={prospects} canPickTeacher={canPickTeacher} onClose={onClose} />
      ) : null}
    </SidePanel>
  )
}

function PlanContent({ prospects, canPickTeacher, onClose }: Omit<Props, 'open'>) {
  const [prospectId, setProspectId] = useState('')
  const selected = prospects.find((row) => row.id === prospectId)
  const options = prospects.toSorted((a, b) => a.record.name.localeCompare(b.record.name, 'tr'))
  return (
    <div className="grid gap-5">
      <FormField id="gorusme-aday" label="Aday">
        {(control) => (
          <NativeSelect
            {...control}
            value={prospectId}
            onChange={(event) => setProspectId(event.target.value)}
            className="w-full"
          >
            <NativeSelectOption value="">Aday seçin</NativeSelectOption>
            {options.map((row) => (
              <NativeSelectOption key={row.id} value={row.id}>
                {row.record.name} · {row.record.interest}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {selected ? (
        <MeetingForm
          key={selected.id}
          prospect={selected.record}
          version={selected.version}
          canPickTeacher={canPickTeacher}
          onClose={onClose}
        />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {options.length === 0
            ? 'Görüşme planlanabilecek açık aday yok.'
            : 'Görüşme planlamak için aday seçin.'}
        </p>
      )}
    </div>
  )
}
