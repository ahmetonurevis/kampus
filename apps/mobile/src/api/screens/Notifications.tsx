import { useState } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'
import { messageStamp } from '@kampus/react-shared/conversation-model.ts'
import {
  useNotifications,
  useReadAllNotifications,
  useReadNotification,
  useUnreadNotificationCount,
  type NotificationView,
} from '@kampus/react-shared/use-notifications.ts'
import type { ApiScreenProps } from '../../route-types.ts'
import { Button, Empty, Sheet, T, useColors } from '../../ui/components.tsx'
import { DetailPair, Screen, Tabs, TextAction } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import {
  displayUnread,
  emptyNotificationsText,
  NO_SCREEN_NOTICE,
  notificationBellVisible,
  notificationPress,
  notificationRowLabel,
  notificationTopicLabel,
  unreadSummary,
} from '../notifications.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useNotify } from '../toast.tsx'

type Filter = 'all' | 'unread'

const FILTERS = [
  { value: 'all', label: 'Tümü' },
  { value: 'unread', label: 'Okunmamış' },
] as const

/**
 * Bildirim merkezi: oturum sahibinin bildirimleri, en yeni üstte ve imleçle sayfa sayfa. Dokununca
 * okunmamış bildirim okundu yazılır (arka plan işlemi) ve konunun ekranı telefonda kayıtlıysa oraya
 * gidilir; değilse ayrıntı pencere içinde açılır. Liste ve sayı yalnız sunucu yanıtıyla değişir
 * (iyimser güncelleme yok), aşağı çekince ve uygulama öne gelince tazelenir. Cihaza hiçbir şey
 * yazılmaz.
 */
export default function Notifications({ navigation }: ApiScreenProps<'ApiNotifications'>) {
  const session = useApiSession()
  const notify = useNotify()
  const c = useColors()
  const open = notificationBellVisible(session)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const list = useNotifications({ unreadOnly: filter === 'unread' }, { enabled: open })
  const count = useUnreadNotificationCount({ enabled: open })
  const readOne = useReadNotification()
  const readAll = useReadAllNotifications({
    onSuccess: () => notify('Bildirimler okundu işaretlendi.'),
  })
  const unread = displayUnread(count.data?.data.unread, list.data ? list.notifications : undefined)
  const selected = list.notifications.find((item) => item.id === selectedId)
  const refreshing = (list.isRefetching && !list.isFetchingNextPage) || count.isRefetching

  if (!open)
    return (
      <Screen>
        <Empty
          title="Bildirim yok"
          text="Bu hesap için uygulama içi bildirim yok ya da bildirim merkezi kapalı."
        />
      </Screen>
    )

  function select(item: NotificationView) {
    const press = notificationPress(session, item)
    // Arka plan işlemi: başarısızlık sayfaya gitmeyi engellemez, kısa Türkçe uyarı gösterilir.
    if (press.markRead)
      readOne.mutate(item.id, { onError: (error) => notify(error.message, 'error') })
    if (press.screen) navigation.navigate(press.screen)
    else setSelectedId(item.id)
  }

  function refresh() {
    void list.refetch()
    void count.refetch()
  }

  const header = (
    <View style={{ gap: 12, marginBottom: 14 }}>
      <T bold accessibilityLiveRegion="polite">
        {unreadSummary(unread)}
      </T>
      <Tabs value={filter} onChange={setFilter} options={FILTERS} />
      <Button
        icon="CheckCheck"
        disabled={!unread || readAll.isPending}
        onPress={() => void readAll.submit()}
      >
        {readAll.isPending ? 'İşaretleniyor…' : 'Tümünü okundu işaretle'}
      </Button>
    </View>
  )

  const sheet = selected ? (
    <Sheet visible title="Bildirim" onClose={() => setSelectedId(null)}>
      <T bold size={18}>
        {selected.title}
      </T>
      <DetailPair label="Konu" value={notificationTopicLabel(selected.topic)} />
      <DetailPair label="Zaman" value={messageStamp(selected.createdAt)} />
      <DetailPair label="Durum" value={selected.readAt === null ? 'Okunmamış' : 'Okundu'} />
      <T muted size={14}>
        {NO_SCREEN_NOTICE}
      </T>
    </Sheet>
  ) : null

  if (list.error && !list.data)
    return (
      <Screen>
        {header}
        <QueryError error={list.error} onRetry={refresh} />
      </Screen>
    )
  if (!list.data)
    return (
      <Screen>
        {header}
        <ListLoading label="Bildirimler yükleniyor…" />
      </Screen>
    )

  const empty = emptyNotificationsText(filter === 'unread')
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={list.notifications}
        keyExtractor={(item) => item.id}
        accessibilityRole="list"
        contentContainerStyle={{ padding: 20, gap: 10, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            colors={[c.primary]}
            tintColor={c.primary}
          />
        }
        ListHeaderComponent={header}
        ListEmptyComponent={<Empty title={empty.title} text={empty.text} />}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          <View style={{ gap: 8 }}>
            {list.isError && (
              <QueryError error={list.error} onRetry={() => void list.fetchNextPage()} />
            )}
            {list.isFetchingNextPage ? (
              <ListLoading label="Daha eski bildirimler yükleniyor…" />
            ) : list.hasNextPage ? (
              <TextAction onPress={() => void list.fetchNextPage()}>
                Daha eski bildirimler
              </TextAction>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <NotificationRow item={item} onPress={() => select(item)} />}
      />
      {sheet}
    </View>
  )
}

function NotificationRow({ item, onPress }: { item: NotificationView; onPress: () => void }) {
  const c = useColors()
  const session = useApiSession()
  const unread = item.readAt === null
  const time = messageStamp(item.createdAt)
  const opensScreen = notificationPress(session, item).screen !== null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={notificationRowLabel(item, time, opensScreen)}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 64,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: unread ? c.primary : c.border,
        borderRadius: 12,
        backgroundColor: c.surface,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: unread ? c.primary : 'transparent',
        }}
      />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <T size={13} style={{ color: c.primary }}>
          {notificationTopicLabel(item.topic)} · {time}
        </T>
        <T bold={unread} size={16}>
          {item.title}
        </T>
      </View>
    </Pressable>
  )
}
