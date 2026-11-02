import { Link } from 'react-router'
import type { AnnouncementRecord } from '@kampus/react-shared/announcement-model.ts'
import { useCollectionList } from '@kampus/react-shared/use-collection.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { CardList, ListCard } from './DashboardParts.tsx'
import { defineCard, type DashboardCardContext } from './dashboard-cards-model.ts'
import { dashboardHref } from './dashboard-model.ts'
import { newsExcerpt, newsItems, NEWS_FETCH_SIZE } from './dashboard-news-model.ts'

const QUERY = { sort: ['-date'], page: 1, pageSize: NEWS_FETCH_SIZE } as const

/**
 * Kampüsten haberler (Vue `Dashboard.vue`, beş rol): rolün görebileceği son duyurular. Liste
 * Duyurular sayfasıyla aynı uçtan okunur (`GET /collections/announcements`, yeniden eskiye, tek
 * sayfa); kurum, rol ve hedef kitle kapsamını sunucu uygular, istemci yeniden süzmez. Geri çekilen
 * duyuru gösterilmez. Başlık duyuruyu sağ panelde açar (`?duyuru=`).
 */
function NewsCard({ ctx }: { ctx: DashboardCardContext }) {
  const announcements = useCollectionList<AnnouncementRecord>('announcements', QUERY)
  const items = newsItems(announcements.data?.rows ?? [])
  const state = {
    isPending: announcements.isPending,
    error: announcements.error,
    retry: () => void announcements.refetch(),
  }
  return (
    <ListCard
      title="Kampüsten haberler"
      description="Güncel duyurular ve gelişmeler"
      action={{ label: 'Duyuruları aç', href: dashboardHref(ctx.role, 'duyurular') }}
      state={state}
      isEmpty={items.length === 0}
      emptyText="Yayında duyuru yok."
    >
      <CardList label="Kampüsten haberler">
        {items.map((item) => (
          <li key={item.id} className="grid gap-1 py-2.5 first:pt-0 last:pb-0">
            <Link
              to={dashboardHref(ctx.role, 'duyurular', { duyuru: item.id })}
              className="min-h-6 font-medium [overflow-wrap:anywhere] hover:underline"
            >
              {item.title}
            </Link>
            <span className="text-sm text-muted-foreground">
              <time dateTime={item.date}>{dateLabel(item.date, { year: 'numeric' })}</time>
              {item.category !== '—' ? ` · ${item.category}` : ''}
            </span>
            {item.text ? (
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {newsExcerpt(item.text)}
              </p>
            ) : null}
          </li>
        ))}
      </CardList>
    </ListCard>
  )
}

/**
 * Haber kartı: yönetici ve ön büroda tek başına geniş sütunda, öğretmen/öğrenci/veli Genel
 * Bakışı'nda akademik kartın yanında dar sütundadır. İletişim modülü kapalıysa çizilmez.
 */
export const NEWS_CARDS = [
  defineCard({
    id: 'haberler.yonetim',
    roles: ['yonetici', 'onburo'],
    module: 'communication',
    area: 'main',
    order: 400,
    component: NewsCard,
  }),
  defineCard({
    id: 'haberler.ogrenme',
    roles: ['ogretmen', 'ogrenci', 'veli'],
    module: 'communication',
    area: 'side',
    order: 230,
    component: NewsCard,
  }),
]
