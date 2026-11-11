import { LineTabs } from '@/components/LineTabs.tsx'
import { archiveViewFilter, isArchiveView } from './management-rows.ts'

type ArchiveTabsProps = {
  archived: boolean
  onChange: (value: string) => void
  /** Etkin sekmenin altındaki açıklama. */
  activeNote: string
}

/** "Aktif kayıtlar / Arşiv" sekmesi (Vue `LineTabs` kayıt durumu); seçim liste filtresidir. */
export function ArchiveTabs({ archived, onChange, activeNote }: ArchiveTabsProps) {
  return (
    <div className="catalog-toolbar mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
      <LineTabs
        label="Kayıt durumu"
        value={archived ? 'arsiv' : 'aktif'}
        options={[
          { value: 'aktif', label: 'Aktif kayıtlar' },
          { value: 'arsiv', label: 'Arşiv', icon: 'Archive' },
        ]}
        onChange={(next) => onChange(archiveViewFilter(isArchiveView(next)))}
      />
      <span className="text-sm text-muted-foreground">
        {archived
          ? 'Geçmişi korunan kayıtları geri alabilirsiniz; aktarılan öğrenci ve görevler geri taşınmaz.'
          : activeNote}
      </span>
    </div>
  )
}
