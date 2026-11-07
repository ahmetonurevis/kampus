import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { FactRow } from '@kampus/react-shared/finance-parent-model.ts'
import { Empty, T } from '../../ui/components.tsx'
import { DetailPair, Notice, Screen } from '../../ui/SchoolLayout.tsx'
import { isFinanceOutOfScope, OUT_OF_SCOPE_NOTICE } from '../finance-parent.ts'
import { ListLoading, QueryError, resolveChild, useSelectedChild } from '../shell.ts'
import { useFinanceChildOptions } from './finance-children.ts'
import { ChildPicker } from './parent-child-picker.tsx'

/**
 * Veli finans ekranlarının ortak çerçevesi: kapalı modül, çocuk listesi ve çocuk seçici. Çocuklar
 * sunucunun veli kapsamından gelir (velayetli ve iletişim kısıtı olmayan bağlı çocuklar ve
 * velayeti olmasa da ödeyicisi olunan çocuklar; ON-313, K-04, `useFinanceChildOptions`); seçim
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
  const childList = useFinanceChildOptions(open)
  const options = childList.options
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
      {childList.error ? (
        <QueryError error={childList.error} onRetry={childList.retry} />
      ) : childList.loading ? (
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
