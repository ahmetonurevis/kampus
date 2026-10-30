import { useState } from 'react'
import { View } from 'react-native'
import { useConversations } from '@kampus/react-shared/use-communication.ts'
import type { ApiScreenProps } from '../../route-types.ts'
import { Button, Empty, T } from '../../ui/components.tsx'
import { ListRow, Screen } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import {
  awaitingBadge,
  conversationLabel,
  messagePreview,
  messageStamp,
  unreadLabel,
} from '@kampus/react-shared/conversation-model.ts'
import type { StatusBadge } from '@kampus/react-shared/status-badge.ts'
import { canUseMessages } from '../communication.ts'
import { canOpenScreen } from '../pages.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { BadgeRow } from './communication-parts.tsx'
import { NewConversationSheet } from './NewConversationSheet.tsx'
import { useConversationNames } from './use-conversation-names.ts'

/**
 * Mesajlar (öğretmen, öğrenci, veli): yazışma listesi, son etkinliğe göre. Okunmamış sayısı ve
 * (öğretmende) "Yanıt bekliyor" rozeti listede görünür; satır akışı açar. Yönetici ve ön büro
 * mobilde mesaj ekranı görmez, gerekçeli erişim web'dedir.
 * TODO(mobil-yazisma-sayfalama): liste ilk 100 yazışmayla sınırlıdır (web ile aynı).
 */
export default function Messages({ navigation }: ApiScreenProps<'Messages'>) {
  const session = useApiSession()
  const role = session.role
  const open = canOpenScreen(session, 'Messages') && canUseMessages(role)
  const conversations = useConversations({ enabled: open })
  const { names, students, teachers } = useConversationNames(role)
  const [starting, setStarting] = useState(false)

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  const error = conversations.error ?? students.error ?? teachers.error
  const items = conversations.data?.items
  return (
    <Screen>
      <View style={{ gap: 12 }}>
        <T muted>
          {role === 'ogretmen'
            ? 'Öğrencileriniz ve velileriyle yazışın.'
            : 'Öğretmeninizle yazışın.'}
        </T>
        <Button primary icon="Plus" onPress={() => setStarting(true)}>
          Yeni yazışma
        </Button>
      </View>
      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            for (const query of [conversations, students, teachers])
              if (query.error) void query.refetch()
          }}
        />
      ) : !items ? (
        <ListLoading label="Yazışmalar yükleniyor…" />
      ) : items.length === 0 ? (
        <Empty
          title="Henüz yazışma yok"
          text="Yeni yazışma düğmesiyle ilk mesajı başlatabilirsiniz."
        />
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {items.map((conversation) => {
            const label = conversationLabel(conversation, role, names)
            const last = conversation.lastMessage
            const badges: StatusBadge[] = []
            if (conversation.unreadCount > 0)
              badges.push({ text: `${conversation.unreadCount} okunmamış`, tone: 'primary' })
            const awaiting = awaitingBadge(conversation.awaitingReply, role)
            if (awaiting) badges.push(awaiting)
            return (
              <ListRow
                key={conversation.id}
                card
                title={label.title}
                eyebrow={last ? messageStamp(last.sentAt) : undefined}
                subtitle={label.subtitle}
                label={[
                  `${label.title} yazışmasını aç`,
                  conversation.unreadCount > 0 ? unreadLabel(conversation.unreadCount) : '',
                ]
                  .filter(Boolean)
                  .join(', ')}
                onPress={() =>
                  navigation.navigate('ApiConversation', { conversationId: conversation.id })
                }
              >
                <T size={14} numberOfLines={2}>
                  {last ? messagePreview(last.text) : 'Henüz mesaj yok.'}
                </T>
                <BadgeRow badges={badges} />
              </ListRow>
            )
          })}
        </View>
      )}
      {starting && (
        <NewConversationSheet
          onClose={() => setStarting(false)}
          onStarted={(conversationId) => {
            setStarting(false)
            navigation.navigate('ApiConversation', { conversationId })
          }}
        />
      )}
    </Screen>
  )
}
