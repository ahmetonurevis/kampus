import { useState } from 'react'
import { Link } from 'react-router'
import {
  useNotifications,
  useReadAllNotifications,
  useReadNotification,
  useUnreadNotificationCount,
  type NotificationView,
} from '@kampus/react-shared/use-notifications.ts'
import { Icon } from '@/components/Icon.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Session } from '@/auth/auth-port.ts'
import { cn } from '@/lib/utils'
import {
  bellLabel,
  notificationAction,
  notificationTime,
  unreadBadgeText,
} from './notification-model.ts'

type Filter = 'all' | 'unread'

const rowClass =
  'flex min-h-12 w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-accent focus-visible:bg-accent max-[860px]:min-h-14'

/**
 * Üst çubuk bildirim zili (IST-065): okunmamış sayısı rozeti ve son bildirimlerin popover'ı. Cam
 * yalnız popover zemininde; liste opak yüzeydedir. Liste açılınca okunur, rozet sayısı sürekli
 * izlenir. Kapsam (öğrenci/veli çocuğu) sunucudadır; veli bütün çocuklarının bildirimini görür,
 * başlık çocuğun adını taşır.
 */
export function NotificationBell({ session }: { session: Session }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const count = useUnreadNotificationCount()
  const unread = count.data?.data.unread
  const list = useNotifications({ unreadOnly: filter === 'unread' }, { enabled: open })
  const readOne = useReadNotification()
  const readAll = useReadAllNotifications()
  const badge = unreadBadgeText(unread)

  function select(item: NotificationView, markRead: boolean) {
    // Okundu arka plan işlemidir; başarısızlığı sayfaya gitmeyi engellemez.
    if (markRead) readOne.mutate(item.id)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={bellLabel(unread)}
        className="relative grid size-9 place-items-center rounded-2xl text-muted-foreground hover:bg-surface hover:text-foreground max-[860px]:size-11"
      >
        <Icon name="Bell" size={19} />
        {badge ? (
          <span
            aria-hidden="true"
            data-testid="notification-badge"
            className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-danger-solid px-1 text-[10px] leading-4 font-semibold text-on-danger"
          >
            {badge}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        collisionPadding={12}
        aria-label="Bildirimler"
        className="w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl p-1.5"
      >
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
          <div role="group" aria-label="Bildirim süzgeci" className="flex gap-1">
            {(
              [
                ['all', 'Tümü'],
                ['unread', 'Okunmamış'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  'min-h-8 rounded-field px-2.5 text-xs font-medium max-[860px]:min-h-11',
                  filter === value
                    ? 'bg-primary-soft text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!unread || readAll.isPending}
            onClick={() => void readAll.submit()}
            className="min-h-8 rounded-field px-2 text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline max-[860px]:min-h-11"
          >
            Tümünü okundu işaretle
          </button>
        </div>
        <div className="max-h-[min(24rem,70dvh)] overflow-y-auto rounded-xl border bg-surface">
          <NotificationList session={session} list={list} filter={filter} onSelect={select} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NotificationList({
  session,
  list,
  filter,
  onSelect,
}: {
  session: Session
  list: ReturnType<typeof useNotifications>
  filter: Filter
  onSelect: (item: NotificationView, markRead: boolean) => void
}) {
  if (list.isPending)
    return (
      <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
        Bildirimler yükleniyor…
      </p>
    )
  if (list.isError)
    return (
      <div role="alert" className="flex flex-col items-center gap-2 px-4 py-6 text-sm">
        <span>Bildirimler yüklenemedi.</span>
        <button
          type="button"
          onClick={() => void list.refetch()}
          className="min-h-8 rounded-field px-2 font-medium text-primary hover:underline"
        >
          Yeniden dene
        </button>
      </div>
    )
  if (list.notifications.length === 0)
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        {filter === 'unread' ? 'Okunmamış bildirim yok.' : 'Henüz bildirim yok.'}
      </p>
    )
  return (
    <>
      <ul className="divide-y">
        {list.notifications.map((item) => {
          const action = notificationAction(session.role, item, session.modules)
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  item.readAt === null ? 'bg-primary' : 'bg-transparent',
                )}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={cn(item.readAt === null && 'font-semibold')}>{item.title}</span>
                <span className="text-xs text-muted-foreground">
                  {item.readAt === null ? <span className="sr-only">Okunmamış. </span> : null}
                  {notificationTime(item.createdAt)}
                </span>
              </span>
            </>
          )
          return (
            <li key={item.id}>
              {action.href ? (
                <Link
                  to={action.href}
                  className={rowClass}
                  onClick={() => onSelect(item, action.markRead)}
                >
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  className={rowClass}
                  onClick={() => onSelect(item, action.markRead)}
                >
                  {content}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {list.hasNextPage ? (
        <button
          type="button"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
          className="min-h-10 w-full border-t px-4 text-sm font-medium text-primary hover:bg-accent max-[860px]:min-h-12"
        >
          {list.isFetchingNextPage ? 'Yükleniyor…' : 'Daha eski bildirimler'}
        </button>
      ) : null}
    </>
  )
}
