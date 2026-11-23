import { useMemo } from 'react'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import {
  useParentContactReveal,
  type ParentContactField,
  type RevealParentContactInput,
} from '@kampus/react-shared/use-parent-contact.ts'
import { SummarySection } from '../management/SummaryParts.tsx'
import {
  parentContactRows,
  type ContactStudent,
  type ParentContactRow,
} from './parent-contact-rows.ts'

const FIELD_LABELS: Record<ParentContactField, string> = { phone: 'Telefon', email: 'E-posta' }
const FIELD_NOUNS: Record<ParentContactField, string> = {
  phone: 'telefonunu',
  email: 'e-postasını',
}

/**
 * Sınıf özetinde öğrencilerin velileri ve maskeli iletişim bilgisi (DOM-YTK-055). Liste sunucudan
 * maskeli gelir (`0532 *** ** 12`); "Göster" tam değeri ayrı uçtan alır, sunucu her açılışı
 * denetim kaydına yazar. Açılan değer yalnız bu bileşenin belleğindedir; panel kapanınca kaybolur,
 * adrese ve kalıcı depoya yazılmaz. İletişim modülü kapalıysa düğme gösterilmez.
 */
export function ParentContactSection({
  students,
  canReveal,
  emptyText = 'Bu sınıfta kayıtlı veli yok.',
}: {
  students: readonly ContactStudent[]
  canReveal: boolean
  /** Eşleşen veli yokken gösterilen metin (sınıf özetinde sınıf, profilde öğrenci için). */
  emptyText?: string
}) {
  const parents = useCoreAll('parents')
  const contact = useParentContactReveal()
  const rows = useMemo(
    () =>
      parentContactRows(
        (parents.data ?? []).map((item) => item.record),
        students,
      ),
    [parents.data, students],
  )

  return (
    <SummarySection title="Veli iletişimi">
      {parents.error ? (
        <QueryError error={parents.error} onRetry={() => void parents.refetch()} />
      ) : !parents.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Veliler yükleniyor…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            İletişim bilgisi gizlilik için maskelidir. Gerektiğinde &quot;Göster&quot; ile açın; her
            açılış kayıt altına alınır.
          </p>
          <ul className="grid gap-2" aria-label="Veli iletişim bilgileri">
            {rows.map((row) => (
              <li key={row.key} className="rounded-xl border px-3.5 py-2.5 text-sm">
                <p className="font-medium">{row.parentName}</p>
                <p className="mb-1 text-xs text-muted-foreground">{row.student.name} velisi</p>
                <dl className="grid gap-1">
                  {(['phone', 'email'] as const).map((field) => (
                    <ContactField
                      key={field}
                      field={field}
                      masked={row[field]}
                      row={row}
                      canReveal={canReveal}
                      contact={contact}
                    />
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </SummarySection>
  )
}

function ContactField({
  field,
  masked,
  row,
  canReveal,
  contact,
}: {
  field: ParentContactField
  masked: string | undefined
  row: ParentContactRow
  canReveal: boolean
  contact: ReturnType<typeof useParentContactReveal>
}) {
  const input: RevealParentContactInput = {
    parentId: row.parentId,
    studentId: row.student.id,
    field,
  }
  const value = contact.valueOf(input)
  const subject = `${row.parentName} (${row.student.name} velisi) ${FIELD_NOUNS[field]}`
  const locked = value === undefined && contact.isPending
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <dt className="text-muted-foreground">{FIELD_LABELS[field]}</dt>
      <dd className="flex items-center gap-2 text-right">
        {masked ? (
          <>
            <span className="font-mono tabular-nums" aria-live="polite">
              {value ?? masked}
            </span>
            {canReveal ? (
              // Tek düğme: açınca aynı öğe "Gizle" olur, klavye odağı yerinde kalır.
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`${subject} ${value === undefined ? 'göster' : 'gizle'}`}
                // `disabled` odağı düğmeden düşürür; istek sürerken kilit `aria-disabled` ile.
                aria-busy={locked || undefined}
                aria-disabled={locked || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={() => {
                  if (locked) return
                  if (value === undefined) void contact.reveal(input)
                  else contact.hide(input)
                }}
              >
                {value === undefined ? 'Göster' : 'Gizle'}
              </Button>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">Kayıtlı değil</span>
        )}
      </dd>
    </div>
  )
}
