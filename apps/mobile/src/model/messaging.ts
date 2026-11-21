import type { State } from '@kampus/school-core/data/seed.ts'
import { addConversationMessage, messagesOf } from '@kampus/school-core/lib/communication.ts'
import { requiredText, type MakeId, type Session } from '@kampus/school-core/lib/domain.ts'

export function conversationFor(state: State, session: Session, id: string) {
  if (!state.modules.communication) return null
  const conversation = state.conversations.find((item) => item.id === id)
  if (!conversation) return null
  if (session.role === 'ogretmen') return conversation.teacherId === 't1' ? conversation : null
  if (!['ogrenci', 'veli'].includes(session.role)) return null
  const childId = session.role === 'veli' ? session.childId : 's1'
  return conversation.studentId === childId &&
    conversation.audience === (session.role === 'veli' ? 'parent' : 'student')
    ? conversation
    : null
}

/** Görünen yazışmanın mesajları, eklenme sırasıyla (mesajlar ayrı koleksiyondadır). */
export function messagesFor(state: State, session: Session, id: string) {
  return conversationFor(state, session, id) ? messagesOf(state, id) : []
}

export function appendMessage(
  state: State,
  session: Session,
  conversationId: string,
  text: string,
  makeId: MakeId,
) {
  const conversation = conversationFor(state, session, conversationId)
  if (!conversation) throw new Error('Bu konuşmaya erişilemiyor.')
  addConversationMessage(state, conversation, {
    id: makeId('msg'),
    text: requiredText.parse(text),
    sender: session.role === 'ogretmen' ? 'teacher' : conversation.audience,
    date: new Date().toISOString(),
  })
}
