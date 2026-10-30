import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Keyboard, View } from 'react-native'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import { useActiveSchool } from '../store/SchoolProvider.tsx'
import { usePersistentDraft } from '../store/use-persistent-draft.ts'
import { context, nameOf, rowsFor, type Row } from '../model/school.ts'
import { appendMessage, conversationFor } from '../model/messaging.ts'
import {
  Button,
  Field,
  SearchField,
  Select,
  Sheet,
  T,
  styles,
  useColors,
} from '../ui/components.tsx'
import {
  EmptyResults,
  ListRow,
  Notice,
  Pagination,
  Screen,
  TextAction,
} from '../ui/SchoolLayout.tsx'
import { KeyboardFrame } from '../ui/KeyboardLayout.tsx'
import DraftStatus from '../ui/DraftStatus.tsx'
import OperationForm from '../ui/OperationForm.tsx'
import type { ScreenProps } from '../route-types.ts'

type Message = Row<'conversation'>['source']['messages'][number]

export default function Conversations({ navigation }: ScreenProps<'Module'>) {
  const { data, session } = useActiveSchool(),
    scope = context(data, session)
  const [query, setQuery] = useState(''),
    [audience, setAudience] = useState(''),
    [filters, setFilters] = useState(false),
    [form, setForm] = useState(false),
    [page, setPage] = useState(0)
  const rows = useMemo(
    () =>
      rowsFor(data, session, 'mesajlar').sort((a, b) =>
        (b.source.messages.at(-1)?.date || '').localeCompare(a.source.messages.at(-1)?.date || ''),
      ),
    [data, session.role, session.childId],
  )
  const filtered = rows.filter(
    (r) =>
      (!audience || r.source.audience === audience) &&
      `${r.title} ${r.body}`.toLocaleLowerCase('tr').includes(query.trim().toLocaleLowerCase('tr')),
  )
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 12) - 1))
  return (
    <>
      <Screen>
        <T muted size={14}>
          {scope.teacher
            ? 'Selin Kaya · Öğrenci ve veli görüşmeleri'
            : `${scope.student.name} · ${scope.classroom.name}`}
        </T>
        <View style={{ gap: 8 }}>
          <SearchField
            value={query}
            onChange={(value) => {
              setQuery(value)
              setPage(0)
            }}
            placeholder="Kişi veya son mesajı ara"
          />
          <View style={styles.between}>
            <T muted size={13}>
              {filtered.length} konuşma
            </T>
            {scope.teacher ? (
              <TextAction onPress={() => setFilters(true)}>
                Filtrele{audience ? ' (aktif)' : ''} ⌄
              </TextAction>
            ) : (
              <TextAction onPress={() => setForm(true)}>Yeni mesaj</TextAction>
            )}
          </View>
        </View>
        <View>
          {filtered.slice(current * 12, current * 12 + 12).map((row) => {
            const last = row.source.messages.at(-1)
            return (
              <ListRow
                key={row.id}
                title={row.title}
                eyebrow={
                  last
                    ? dateLabel(last.date, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Yeni konuşma'
                }
                onPress={() => navigation.navigate('Detail', { row })}
                label={`${row.title} konuşmasını aç`}
              >
                <T muted size={14} numberOfLines={2}>
                  {row.body || 'Henüz mesaj yok.'}
                </T>
              </ListRow>
            )
          })}
        </View>
        {!filtered.length && (
          <EmptyResults
            noun="konuşma"
            onClear={() => {
              setQuery('')
              setAudience('')
            }}
          />
        )}
        <Pagination count={filtered.length} index={current} pageSize={12} onChange={setPage} />
      </Screen>
      {filters && (
        <Sheet
          visible
          compact
          title="Konuşma filtreleri"
          onClose={() => setFilters(false)}
          footer={
            <Button primary onPress={() => setFilters(false)}>
              Konuşmaları göster
            </Button>
          }
        >
          <Select
            label="Kişi grubu"
            value={audience}
            onChange={(value) => {
              setAudience(value)
              setPage(0)
            }}
            options={[
              { value: 'student', label: 'Öğrenciler' },
              { value: 'parent', label: 'Veliler' },
            ]}
          />
        </Sheet>
      )}
      {form && <OperationForm descriptor={{ kind: 'message' }} onClose={() => setForm(false)} />}
    </>
  )
}

export function ConversationDetail({ route }: ScreenProps<'Detail'>) {
  const { data, session, commit, busy, notify } = useActiveSchool(),
    c = useColors()
  const conversation = conversationFor(data, session, route.params.row.id)
  const draft = usePersistentDraft(
    'message',
    route.params.row.id,
    { text: '' },
    conversation?.messages.at(-1)?.id || '',
  )
  const list = useRef<FlatList<Message>>(null),
    [limit, setLimit] = useState(40),
    [error, setError] = useState(''),
    [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible?.() || false)
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  const ownSender =
    session.role === 'ogretmen' ? 'teacher' : session.role === 'veli' ? 'parent' : 'student'
  const messages = useMemo(
    () => [...(conversation?.messages || [])].reverse().slice(0, limit),
    [conversation?.messages, limit],
  )
  if (!conversation)
    return (
      <Screen>
        <Notice
          title="Konuşma kullanılamıyor"
          text="Konuşma kaldırılmış veya iletişim modülü kapatılmış olabilir."
        />
      </Screen>
    )
  const student = data.students.find((s) => s.id === conversation.studentId)
  const send = async () => {
    if (draft.value.text.trim().length < 2 || draft.value.text.trim().length > 2000) {
      setError('Mesaj 2–2.000 karakter arasında olmalı.')
      notify('Mesaj 2–2.000 karakter arasında olmalı.', 'error')
      return
    }
    const ok = await commit(
      (s, id) => appendMessage(s, session, conversation.id, draft.value.text, id),
      '',
    )
    if (ok) {
      await draft.clear({ text: '' })
      setError('')
      list.current?.scrollToOffset({ offset: 0, animated: true })
    }
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
        <T muted size={13}>
          {student?.name} · {nameOf(data, 'classes', student?.classId ?? '')} ·{' '}
          {conversation.audience === 'parent' ? 'Veli görüşmesi' : 'Öğrenci görüşmesi'}
        </T>
      </View>
      <FlatList
        ref={list}
        inverted
        data={messages}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: 16, gap: 10 }}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={5}
        ListEmptyComponent={<T muted>İlk mesajını aşağıdan yazabilirsin.</T>}
        ListFooterComponent={
          conversation.messages.length > limit ? (
            <TextAction onPress={() => setLimit(limit + 40)}>Önceki mesajları göster</TextAction>
          ) : null
        }
        renderItem={({ item, index }) => {
          const own = item.sender === ownSender,
            older = messages[index + 1]
          return (
            <View style={{ gap: 10 }}>
              {(!older || dayKey(older.date) !== dayKey(item.date)) && (
                <T muted size={12} style={{ textAlign: 'center', paddingVertical: 6 }}>
                  {dateLabel(item.date, { year: 'numeric' })}
                </T>
              )}
              <View
                style={{
                  alignSelf: own ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  padding: 14,
                  borderRadius: 14,
                  gap: 6,
                  backgroundColor: own ? c.primarySoft : c.soft,
                }}
              >
                <T size={15} selectable>
                  {item.text}
                </T>
                <T muted size={11} style={{ alignSelf: 'flex-end' }}>
                  {timeLabel(item.date)}
                  {own ? ' · Gönderildi' : ''}
                </T>
              </View>
            </View>
          )
        }}
      />
      <View
        style={{
          padding: 12,
          gap: 8,
          borderTopWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
        }}
      >
        {!!error && (
          <T size={13} style={{ color: c.red }} accessibilityRole="alert">
            {error}
          </T>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Field
              label="Mesajın"
              hideLabel
              compact
              multiline
              value={draft.value.text}
              editable={draft.ready && !busy}
              maxLength={2000}
              onChange={(text) => {
                draft.set({ text })
                setError('')
              }}
              placeholder="Mesajını yaz…"
            />
          </View>
          <Button primary small disabled={!draft.ready || busy} onPress={send}>
            {busy ? 'Gönderiliyor…' : 'Gönder'}
          </Button>
        </View>
        {!keyboardVisible && <DraftStatus draft={draft} />}
      </View>
    </KeyboardFrame>
  )
}
