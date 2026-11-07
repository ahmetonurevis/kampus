import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  accessRemainingMs,
  useConversationMessages,
  useMarkConversationRead,
  type ConversationSummary,
} from '@kampus/react-shared/use-communication.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import type { RoleKey } from '@/lib/navigation.ts'
import { cn } from '@/lib/utils'
import { AccessBanner, AccessGate } from './AccessGate.tsx'
import {
  canOpenAccess,
  deliveryLabel,
  messageStamp,
  senderLabel,
  type ConversationLabel,
} from '@kampus/react-shared/conversation-model.ts'
import { MessageComposer } from './MessageComposer.tsx'

type Props = {
  conversation: ConversationSummary
  label: ConversationLabel
  role: RoleKey
  /** Yöneticinin gerekçeli erişim bitişi; yoksa ya da geçmişse içerik kilitlidir. */
  accessExpiresAt: string | undefined
  now: number
  onAccessOpened: (expiresAt: string) => void
  /** Dar ekranda listeye dönüş; geniş ekranda verilmez. */
  onBack?: () => void
}

/**
 * Yazışma akışı: eskiden yeniye mesajlar (`role="log"`), "Daha eski mesajlar" ve yazma alanı.
 * Açılınca (yönetici dışında) okunmamışlar okundu yazılır. Yönetici yazmaz; içeriği gerekçeli
 * erişim süresince görür, süre bitince kilit geri gelir.
 */
export function ConversationThread({
  conversation,
  label,
  role,
  accessExpiresAt,
  now,
  onAccessOpened,
  onBack,
}: Props) {
  const isAdmin = role === 'yonetici'
  const remaining = accessExpiresAt ? accessRemainingMs(accessExpiresAt, now) : 0
  const locked = isAdmin && remaining <= 0
  return (
    <section
      aria-label={`${label.title} yazışması`}
      className="flex min-h-0 flex-1 flex-col rounded-card border bg-surface"
    >
      <header className="flex items-center gap-3 border-b px-4 py-3">
        {onBack ? (
          <Button type="button" variant="secondary" size="sm" onClick={onBack}>
            <Icon name="ArrowLeft" size={16} />
            Listeye dön
          </Button>
        ) : null}
        <Avatar name={label.title} size="medium" />
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{label.title}</h2>
          <p className="truncate text-xs text-muted-foreground">{label.subtitle}</p>
        </div>
      </header>
      {locked ? (
        <AccessGate
          conversationId={conversation.id}
          canOpen={canOpenAccess(conversation)}
          onOpened={onAccessOpened}
        />
      ) : (
        <>
          {isAdmin ? <AccessBanner remainingMs={remaining} /> : null}
          <MessageFlow conversation={conversation} isAdmin={isAdmin} />
          {isAdmin ? null : <MessageComposer conversationId={conversation.id} />}
        </>
      )}
    </section>
  )
}

function MessageFlow({
  conversation,
  isAdmin,
}: {
  conversation: ConversationSummary
  isAdmin: boolean
}) {
  const query = useConversationMessages(conversation.id)
  const markRead = useMarkConversationRead()
  const markedKey = useRef('')
  const scroller = useRef<HTMLDivElement>(null)
  const seen = useRef<{ first: string; last: string }>({ first: '', last: '' })
  const restore = useRef<{ height: number; top: number } | null>(null)
  const { messages, refetch } = query
  const firstId = messages[0]?.id ?? ''
  const lastId = messages.at(-1)?.id ?? ''

  // Arka plan işlemi (dış sistem): yönetici dışındaki taraf açınca okunmamışları okundu yazar.
  // Aynı okunmamış sayısı için tek kez; yeni mesaj gelirse sayı değişir ve yeniden yazılır.
  const unread = conversation.unreadCount
  const mutateRead = markRead.mutate
  useEffect(() => {
    if (isAdmin || unread === 0 || !query.isSuccess) return
    const key = `${conversation.id}:${unread}`
    if (markedKey.current === key) return
    markedKey.current = key
    mutateRead(conversation.id)
  }, [isAdmin, unread, query.isSuccess, conversation.id, mutateRead])

  // Liste tazelenince karşı tarafın yeni mesajı akışta yoksa akış yeniden okunur.
  const listedLastId = conversation.lastMessage?.id ?? ''
  useEffect(() => {
    if (query.isSuccess && listedLastId !== '' && lastId !== '' && listedLastId !== lastId)
      void refetch()
  }, [query.isSuccess, listedLastId, lastId, refetch])

  // Kaydırma (dış sistem): ilk yükleme ve yeni mesaj alta iner; eski sayfa eklenince konum korunur.
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || messages.length === 0) return
    const previous = seen.current
    if (restore.current && firstId !== previous.first && lastId === previous.last) {
      element.scrollTop = element.scrollHeight - restore.current.height + restore.current.top
      restore.current = null
    } else if (lastId !== previous.last) {
      element.scrollTop = element.scrollHeight
    }
    seen.current = { first: firstId, last: lastId }
  }, [messages.length, firstId, lastId])

  function loadOlder() {
    const element = scroller.current
    if (element) restore.current = { height: element.scrollHeight, top: element.scrollTop }
    void query.fetchNextPage()
  }

  if (query.isError) return <QueryError error={query.error} onRetry={() => void refetch()} />
  return (
    <div
      ref={scroller}
      role="region"
      tabIndex={0}
      aria-label="Mesajlar"
      className="min-h-[240px] flex-1 overflow-y-auto p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {query.hasNextPage ? (
        <div className="mb-3 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={loadOlder}
            disabled={query.isFetchingNextPage}
            aria-busy={query.isFetchingNextPage}
          >
            Daha eski mesajlar
          </Button>
        </div>
      ) : null}
      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Mesajlar yükleniyor…
        </p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Henüz mesaj yok. İlk mesajı aşağıdan yazabilirsiniz.
        </p>
      ) : (
        <ol role="log" aria-label="Mesaj akışı" className="m-0 grid list-none gap-3 p-0">
          {messages.map((message) => {
            const delivery = deliveryLabel(message)
            return (
              <li
                key={message.id}
                className={cn('flex flex-col gap-1', message.fromMe ? 'items-end' : 'items-start')}
              >
                <span className="text-xs text-muted-foreground">
                  {message.fromMe ? 'Siz' : senderLabel(message.sender)} ·{' '}
                  {messageStamp(message.sentAt)}
                </span>
                <p
                  className={cn(
                    'm-0 max-w-[min(72ch,85%)] rounded-card px-3 py-2 text-sm break-words whitespace-pre-wrap',
                    message.fromMe
                      ? 'bg-primary-soft text-foreground'
                      : 'border bg-surface-soft text-foreground',
                  )}
                >
                  {message.text}
                </p>
                {delivery ? (
                  <span className="text-2xs text-muted-foreground">{delivery}</span>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
