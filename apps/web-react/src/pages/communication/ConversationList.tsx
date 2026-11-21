import type { ConversationSummary } from '@kampus/react-shared/use-communication.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { cn } from '@/lib/utils'
import {
  awaitingBadge,
  conversationLabel,
  messagePreview,
  messageStamp,
  unreadLabel,
  type PartyNames,
} from '@kampus/react-shared/conversation-model.ts'
import type { RoleKey } from '@/lib/navigation.ts'

type Props = {
  items: readonly ConversationSummary[]
  role: RoleKey
  names: PartyNames
  selectedId: string
  /** Yöneticide gerekçeli erişimi açık yazışmalar; diğerlerinin içeriği kapalı gösterilir. */
  accessIds: ReadonlySet<string>
  onSelect: (id: string) => void
}

/**
 * Yazışma listesi: karşı taraf, bağlı öğrenci, son mesaj önizlemesi ve rozetler. Yöneticide son
 * mesaj yoktur (yalnız üst veri); satır "İçerik kapalı" der, erişim açılınca bu yazı kalkar.
 * Satırlar opak yüzeydir; seçili satır `aria-current` taşır.
 */
export function ConversationList({ items, role, names, selectedId, accessIds, onSelect }: Props) {
  return (
    <ul aria-label="Yazışmalar" className="m-0 grid list-none gap-1 p-0">
      {items.map((conversation) => {
        const label = conversationLabel(conversation, role, names)
        const selected = conversation.id === selectedId
        const awaiting = awaitingBadge(conversation.awaitingReply, role)
        const last = conversation.lastMessage
        return (
          <li key={conversation.id}>
            <button
              type="button"
              onClick={() => onSelect(conversation.id)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'flex w-full items-start gap-3 rounded-card border px-3 py-3 text-left transition-colors',
                'hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                selected ? 'border-primary bg-primary-soft' : 'border-transparent bg-surface',
              )}
            >
              <Avatar name={label.title} size="medium" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{label.title}</span>
                  {last ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {messageStamp(last.sentAt)}
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">{label.subtitle}</span>
                {role === 'yonetici' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Icon name={accessIds.has(conversation.id) ? 'LockOpen' : 'Lock'} size={12} />
                    {accessIds.has(conversation.id) ? 'Gerekçeli erişim açık' : 'İçerik kapalı'}
                    {` · ${conversation.messageCount} mesaj`}
                  </span>
                ) : (
                  <span className="truncate text-sm text-foreground/80">
                    {last ? messagePreview(last.text) : 'Henüz mesaj yok.'}
                  </span>
                )}
                {conversation.unreadCount > 0 || awaiting ? (
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {conversation.unreadCount > 0 ? (
                      <span className="inline-flex">
                        <span aria-hidden="true">
                          <StatusBadge
                            text={String(conversation.unreadCount)}
                            tone="purple"
                            className="min-w-6 justify-center"
                          />
                        </span>
                        <span className="sr-only">{unreadLabel(conversation.unreadCount)}</span>
                      </span>
                    ) : null}
                    {awaiting ? <StatusBadge text={awaiting.text} tone={awaiting.tone} /> : null}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
