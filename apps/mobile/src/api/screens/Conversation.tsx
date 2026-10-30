import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Keyboard, View } from 'react-native'
import {
  SENSITIVE_INFO_NOTICE,
  useConversationMessages,
  useConversations,
  useMarkConversationRead,
  useSendMessage,
  type ConversationMessage,
  type ConversationSummary,
} from '@kampus/react-shared/use-communication.ts'
import type { ApiScreenProps } from '../../route-types.ts'
import { Button, Empty, Field, T, useColors } from '../../ui/components.tsx'
import { KeyboardFrame } from '../../ui/KeyboardLayout.tsx'
import { Notice, Screen, TextAction } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import {
  canUseMessages,
  conversationLabel,
  deliveryLabel,
  messageStamp,
  readMarkKey,
  senderLabel,
  validateMessageText,
  type ConversationLabel,
} from '../communication.ts'
import { canOpenScreen } from '../pages.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useConversationNames } from './use-conversation-names.ts'

/**
 * Yazışma akışı: en yeni mesaj altta (ters liste), "Daha eski mesajlar" imleçle yükler. Açılınca
 * okunmamışlar okundu yazılır. Gönderimde iyimser güncelleme yoktur: mesaj sunucu yanıtından
 * sonra akışa gelir. Yazma alanı klavye açıkken görünür kalır; DOM-ILT-014 notu alanın üstünde
 * sabittir. Metin cihaza yazılmaz (taslak saklanmaz).
 */
export default function Conversation({ route }: ApiScreenProps<'ApiConversation'>) {
  const { conversationId } = route.params
  const session = useApiSession()
  const role = session.role
  const open = canOpenScreen(session, 'Messages') && canUseMessages(role)
  const conversations = useConversations({ enabled: open })
  const { names } = useConversationNames(role)
  const conversation = conversations.data?.items.find((item) => item.id === conversationId)

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  if (conversations.error)
    return (
      <Screen>
        <QueryError error={conversations.error} onRetry={() => void conversations.refetch()} />
      </Screen>
    )
  // Yeni açılan yazışma liste tazelenene kadar bulunamayabilir; o sürede yükleniyor gösterilir.
  if (!conversation)
    return (
      <Screen>
        {conversations.isFetching ? (
          <ListLoading label="Yazışma yükleniyor…" />
        ) : (
          <Notice
            title="Yazışma bulunamadı"
            text="Yazışma kaldırılmış olabilir. Mesajlar listesinden başka bir yazışma seçin."
          />
        )}
      </Screen>
    )
  return <Thread conversation={conversation} label={conversationLabel(conversation, role, names)} />
}

function Thread({
  conversation,
  label,
}: {
  conversation: ConversationSummary
  label: ConversationLabel
}) {
  const c = useColors()
  const query = useConversationMessages(conversation.id)
  const markRead = useMarkConversationRead()
  const send = useSendMessage()
  const markedKey = useRef('')
  const list = useRef<FlatList<ConversationMessage>>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible?.() || false)
  const { messages, refetch } = query
  const lastId = messages.at(-1)?.id ?? ''
  // Ters liste en yeniyi başa alır; "eski mesajlar" düğmesi görsel olarak üstte (altbilgi) durur.
  const newestFirst = useMemo(() => [...messages].reverse(), [messages])

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  // Arka plan işlemi (dış sistem): açınca okunmamışlar okundu yazılır; aynı okunmamış sayısı için
  // tek kez, yeni mesaj gelirse sayı değişir ve yeniden yazılır.
  const unread = conversation.unreadCount
  const mutateRead = markRead.mutate
  useEffect(() => {
    const key = readMarkKey(conversation.id, unread, query.isSuccess)
    if (key === null || markedKey.current === key) return
    markedKey.current = key
    mutateRead(conversation.id)
  }, [unread, query.isSuccess, conversation.id, mutateRead])

  // Liste tazelenince karşı tarafın yeni mesajı akışta yoksa akış yeniden okunur.
  const listedLastId = conversation.lastMessage?.id ?? ''
  useEffect(() => {
    if (query.isSuccess && listedLastId !== '' && lastId !== '' && listedLastId !== lastId)
      void refetch()
  }, [query.isSuccess, listedLastId, lastId, refetch])

  async function submit() {
    const checked = validateMessageText(text)
    if (!checked.ok) {
      setError(checked.message)
      return
    }
    setError('')
    // Başarısızlıkta (429 dahil) metin korunur; Türkçe mesajı komut katmanı bildirir.
    const outcome = await send.submit({ conversationId: conversation.id, text: checked.text })
    if (outcome.status !== 'success') return
    setText('')
    list.current?.scrollToOffset({ offset: 0, animated: true })
  }

  return (
    <KeyboardFrame style={{ flex: 1 }}>
      <View
        style={{
          paddingHorizontal: 20,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderColor: c.border,
        }}
      >
        <T bold size={16} accessibilityRole="header">
          {label.title}
        </T>
        <T muted size={13}>
          {label.subtitle}
        </T>
      </View>
      {query.isError ? (
        <View style={{ padding: 20 }}>
          <QueryError error={query.error} onRetry={() => void refetch()} />
        </View>
      ) : query.isPending ? (
        <View style={{ padding: 20 }}>
          <ListLoading label="Mesajlar yükleniyor…" />
        </View>
      ) : (
        <FlatList
          ref={list}
          inverted
          accessibilityLabel="Mesaj akışı"
          data={newestFirst}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: 16, gap: 10 }}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={5}
          ListEmptyComponent={<T muted>Henüz mesaj yok. İlk mesajı aşağıdan yazabilirsiniz.</T>}
          ListFooterComponent={
            query.hasNextPage ? (
              <TextAction
                disabled={query.isFetchingNextPage}
                onPress={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? 'Yükleniyor…' : 'Daha eski mesajlar'}
              </TextAction>
            ) : null
          }
          renderItem={({ item }) => {
            const delivery = deliveryLabel(item)
            return (
              <View
                style={{
                  alignSelf: item.fromMe ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  padding: 14,
                  borderRadius: 14,
                  gap: 6,
                  backgroundColor: item.fromMe ? c.primarySoft : c.soft,
                }}
              >
                <T size={15} selectable>
                  {item.text}
                </T>
                <T muted size={11} style={{ alignSelf: 'flex-end' }}>
                  {item.fromMe ? 'Siz' : senderLabel(item.sender)} · {messageStamp(item.sentAt)}
                  {delivery ? ` · ${delivery}` : ''}
                </T>
              </View>
            )
          }}
        />
      )}
      <View
        style={{
          padding: 12,
          gap: 8,
          borderTopWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
        }}
      >
        <T muted size={12} numberOfLines={keyboardVisible ? 1 : undefined}>
          {SENSITIVE_INFO_NOTICE}
        </T>
        {!!error && (
          <T size={13} style={{ color: c.red }} accessibilityRole="alert">
            {error}
          </T>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Field
              label="Mesajınız"
              hideLabel
              compact
              multiline
              value={text}
              editable={!send.isPending}
              maxLength={2000}
              onChange={(value) => {
                setText(value)
                setError('')
              }}
              placeholder="Mesajınızı yazın…"
            />
          </View>
          <Button primary small disabled={send.isPending} onPress={() => void submit()}>
            {send.isPending ? 'Gönderiliyor…' : 'Gönder'}
          </Button>
        </View>
      </View>
    </KeyboardFrame>
  )
}
