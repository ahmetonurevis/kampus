import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'

export type RecordActionHandlers = {
  /** Yalnız yönetici (`canManageStructure`); aksi hâlde düğmeler hiç çizilmez. */
  canManage: boolean
  onEdit: (id: string) => void
  onArchive: (id: string) => void
  onRestore: (id: string) => void
  /** Geri alma sürüyor: düğme kilitli. */
  restoring?: boolean
}

type Props = RecordActionHandlers & {
  id: string
  name: string
  archived: boolean
  /** Tablo hücresinde küçük, panelde normal boy. */
  size?: 'sm' | 'default'
}

/**
 * Kayıt işlemleri: "Düzenle" görünür, "Arşivle" sakin (ikincil); arşivdeki kayıtta yalnız
 * "Geri al". Erişilebilir adlar kayıt adını taşır (`<ad> düzenle`, `<ad> arşivle`, `<ad> geri al`).
 */
export function RecordActions({
  id,
  name,
  archived,
  size = 'sm',
  canManage,
  onEdit,
  onArchive,
  onRestore,
  restoring = false,
}: Props) {
  if (!canManage) return null
  if (archived)
    return (
      <Button
        variant="secondary"
        size={size}
        aria-label={`${name} geri al`}
        disabled={restoring}
        aria-busy={restoring || undefined}
        onClick={() => onRestore(id)}
      >
        <Icon name="RefreshCw" size={15} aria-hidden="true" />
        Geri al
      </Button>
    )
  return (
    <>
      <Button
        variant="secondary"
        size={size}
        aria-label={`${name} düzenle`}
        onClick={() => onEdit(id)}
      >
        <Icon name="Pencil" size={15} aria-hidden="true" />
        Düzenle
      </Button>
      <Button
        variant="ghost"
        size={size}
        aria-label={`${name} arşivle`}
        aria-haspopup="dialog"
        onClick={() => onArchive(id)}
      >
        <Icon name="Archive" size={15} aria-hidden="true" />
        Arşivle
      </Button>
    </>
  )
}
