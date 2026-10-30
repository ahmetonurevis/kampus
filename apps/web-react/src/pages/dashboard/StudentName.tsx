import { Avatar } from '@/components/Avatar.tsx'
import { useCoreItem } from '@/hooks/use-core-collection.ts'

type StudentNameProps = {
  studentId: string
  /** Adın altındaki kısa bilgi (taksit, vade, sınıf). */
  detail?: string
}

/**
 * Kısa listede öğrenci adı ve avatarı. Liste kaydı adı taşımadığından ad tek kayıt ucundan
 * okunur (önbellekte paylaşılır); büyük `students` koleksiyonu ad eşlemesi için çekilmez.
 * TODO(api-joined-fields): liste yanıtı bağlı adları (`studentName`) verince istek kalkar.
 */
export function StudentName({ studentId, detail }: StudentNameProps) {
  const student = useCoreItem('students', studentId)
  const name = student.data?.record.name
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={name ?? ''} size="small" />
      <span className="grid min-w-0">
        <strong className="font-medium [overflow-wrap:anywhere]">
          {name ?? (student.isPending ? 'Yükleniyor…' : 'Öğrenci bulunamadı')}
        </strong>
        {detail ? <small className="text-sm text-muted-foreground">{detail}</small> : null}
      </span>
    </span>
  )
}
