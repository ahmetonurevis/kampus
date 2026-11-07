import { useMemo, type ReactNode } from 'react'
import { View } from 'react-native'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { FactRow } from '@kampus/react-shared/finance-parent-model.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { Empty, T } from '../../ui/components.tsx'
import { DetailPair, Notice, Screen } from '../../ui/SchoolLayout.tsx'
import { isFinanceOutOfScope, OUT_OF_SCOPE_NOTICE } from '../finance-parent.ts'
import { ListLoading, QueryError, resolveChild, useSelectedChild } from '../shell.ts'
import { childOptions, ChildPicker } from './parent-child-picker.tsx'

type StudentRecord = State['students'][number]
type ClassRecord = State['classes'][number]

/**
 * Veli finans ekranlarının ortak çerçevesi: kapalı modül, çocuk listesi ve çocuk seçici. Çocuklar
 * sunucunun veli kapsamından gelir (velayetli ve iletişim kısıtı olmayan bağlı çocuklar); seçim
 * ekranlar arasında bellekte korunur (`useSelectedChild`). Bağlı çocuk yoksa boş durum gösterilir,
 * istek atılmaz. Gövde çocuk değişince yeniden kurulur ki liste durumu çocuklar arasında karışmasın.
 */
export function ParentFinanceFrame({
  open,
  intro,
  children,
}: {
  open: boolean
  intro: string
  children: (childId: string) => ReactNode
}) {
  const [selected, setSelected] = useSelectedChild()
  const students = useCollectionAll<StudentRecord>('students', {}, { enabled: open })
  const classes = useCollectionAll<ClassRecord>('classes', {}, { enabled: open })
  const options = useMemo(
    () => childOptions(students.data ?? [], classes.data ?? []),
    [students.data, classes.data],
  )
  const childId = resolveChild(
    options.map((option) => option.id),
    selected,
  )

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return (
    <Screen>
      <T muted>{intro}</T>
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : !students.data ? (
        <ListLoading label="Çocuklarınız yükleniyor…" />
      ) : !childId ? (
        <Empty
          title="Bağlı öğrenci yok"
          text="Hesabınıza bağlı bir öğrenci olduğunda ödeme bilgileri burada görünür."
        />
      ) : (
        <>
          <ChildPicker options={options} value={childId} onChange={setSelected} />
          <View key={childId} style={{ gap: 16 }}>
            {children(childId)}
          </View>
        </>
      )}
    </Screen>
  )
}

/** Finans ucunun hatası: kapsam dışı öğrenci boş durumdur, diğerleri yeniden dene ile. */
export function FinanceQueryError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  if (isFinanceOutOfScope(error))
    return <Empty title={OUT_OF_SCOPE_NOTICE.title} text={OUT_OF_SCOPE_NOTICE.text} />
  return <QueryError error={error} onRetry={onRetry} />
}

export function FactList({ rows }: { rows: readonly FactRow[] }) {
  return (
    <View style={{ gap: 12 }}>
      {rows.map(([label, value]) => (
        <DetailPair key={label} label={label} value={value} />
      ))}
    </View>
  )
}

/** Belgeler (dekont, ekstre, taahhütname PDF'i) telefonda henüz yoktur; web'e yönlendirilir. */
export function DocumentsOnWeb({ text }: { text: string }) {
  return <Notice title="Belgeler web uygulamasında" text={text} />
}
