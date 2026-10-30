import { useState } from 'react'
import { FlatList, View } from 'react-native'
import {
  useConversations,
  type ConversationSummary,
} from '@kampus/react-shared/use-communication.ts'
import type { ApiScreenProps } from '../../route-types.ts'
import { Button, Empty, T } from '../../ui/components.tsx'
import { ListRow, Screen, TextAction } from '../../ui/SchoolLayout.tsx'
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
 * Liste sayfa sayfa gelir (`FlatList` `onEndReached`); web ile aynı kanca.
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
  const items = conversations.data ? conversations.items : undefined
  function renderRow(conversation: ConversationSummary) {
    const label = conversationLabel(conversation, role, names)
    const last = conversation.lastMessage
    const badges: StatusBadge[] = []
    if (conversation.unreadCount > 0)
      badges.push({ text: `${conversation.unreadCount} okunmamış`, tone: 'primary' })
    const awaiting = awaitingBadge(conversation.awaitingReply, role)
    if (awaiting) badges.push(awaiting)
    return (
      <ListRow
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
        onPress={() => navigation.navigate('ApiConversation', { conversationId: conversation.id })}
      >
        <T size={14} numberOfLines={2}>
          {last ? messagePreview(last.text) : 'Henüz mesaj yok.'}
        </T>
        <BadgeRow badges={badges} />
      </ListRow>
    )
  }

  const intro = (
    <View style={{ gap: 12 }}>
      <T muted>
        {role === 'ogretmen' ? 'Öğrencileriniz ve velileriyle yazışın.' : 'Öğretmeninizle yazışın.'}
      </T>
      <Button primary icon="Plus" onPress={() => setStarting(true)}>
        Yeni yazışma
      </Button>
    </View>
  )
  const sheet = starting ? (
    <NewConversationSheet
      onClose={() => setStarting(false)}
      onStarted={(conversationId) => {
        setStarting(false)
        navigation.navigate('ApiConversation', { conversationId })
      }}
    />
  ) : null

  // Kayıt varken liste kendi kaydırıcısıdır: son satırlara yaklaşınca sıradaki sayfa gelir.
  if (!error && items && items.length > 0)
    return (
      <View style={{ flex: 1 }}>
        <FlatList
          data={items}
          keyExtractor={(conversation) => conversation.id}
          accessibilityRole="list"
          contentContainerStyle={{ padding: 20, gap: 10 }}
          ListHeaderComponent={<View style={{ marginBottom: 14 }}>{intro}</View>}
          onEndReached={() => {
            if (conversations.hasNextPage && !conversations.isFetchingNextPage)
              void conversations.fetchNextPage()
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            conversations.isFetchingNextPage ? (
              <ListLoading label="Yazışmalar yükleniyor…" />
            ) : conversations.hasNextPage ? (
              <TextAction onPress={() => void conversations.fetchNextPage()}>
                Daha fazla yükle
              </TextAction>
            ) : null
          }
          renderItem={({ item }) => renderRow(item)}
        />
        {sheet}
      </View>
    )
  return (
    <Screen>
      {intro}
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
      ) : (
        <Empty
          title="Henüz yazışma yok"
          text="Yeni yazışma düğmesiyle ilk mesajı başlatabilirsiniz."
        />
      )}
      {sheet}
    </Screen>
  )
}
