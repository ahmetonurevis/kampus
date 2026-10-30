import { Avatar } from '@/components/Avatar.tsx'

type StudentNameProps = {
  /** Liste satırının `joined.studentName` değeri; kapsam dışı öğrencide gelmez. */
  name: string | undefined
  /** Adın altındaki kısa bilgi (taksit, vade, sınıf). */
  detail?: string
}

/**
 * Kısa listede öğrenci adı ve avatarı. Ad liste yanıtının bağlı alanından (`joined`) gelir;
 * ayrı öğrenci isteği yapılmaz. Ad gelmediyse "—" gösterilir.
 */
export function StudentName({ name, detail }: StudentNameProps) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={name ?? ''} size="small" />
      <span className="grid min-w-0">
        <strong className="font-medium [overflow-wrap:anywhere]">{name ?? '—'}</strong>
        {detail ? <small className="text-sm text-muted-foreground">{detail}</small> : null}
      </span>
    </span>
  )
}
