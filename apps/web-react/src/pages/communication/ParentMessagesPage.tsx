import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState.tsx'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import type { NavPage } from '@/lib/navigation.ts'
import { MessagesPage } from './MessagesPage.tsx'

type Tab = 'mesajlar' | 'randevular'
const TAB_PARAM = 'sekme'
const TABS: readonly LineTabOption<Tab>[] = [
  { value: 'mesajlar', label: 'Mesajlar', icon: 'MessagesSquare' },
  { value: 'randevular', label: 'Randevular', icon: 'CalendarCheck2' },
]

/**
 * Veli "Randevu & Mesajlar" sayfası: sekme adreste (`?sekme=randevular`) tutulur. Mesajlar
 * sekmesi öğretmen yazışmasıdır; randevular henüz taşınmadı.
 * TODO(web-randevu): randevu talebi ve listesi web'e taşınınca yer tutucu yerine geçer.
 */
export function ParentMessagesPage({ page }: { page: NavPage }) {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get(TAB_PARAM) === 'randevular' ? 'randevular' : 'mesajlar'

  function select(next: Tab) {
    const updated = new URLSearchParams(params)
    updated.delete('yazisma')
    if (next === 'mesajlar') updated.delete(TAB_PARAM)
    else updated.set(TAB_PARAM, next)
    setParams(updated, { replace: true })
  }

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="grid gap-4">
        <LineTabs label="Randevu ve mesajlar" value={tab} options={TABS} onChange={select} />
        {tab === 'mesajlar' ? (
          <MessagesPage page={page} heading={false} />
        ) : (
          <EmptyState
            icon="CalendarCheck2"
            title="Randevular taşınıyor"
            description="Randevu talebi ve listesi yeni web uygulamasına aktarılıyor. Hazır olduğunda burada görünecek."
          />
        )}
      </div>
    </>
  )
}
