import { requiredText } from '@kampus/school-core/lib/domain.js'

export function conversationFor(state, session, id) {
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
export function appendMessage(state, session, conversationId, text, makeId) {
  const conversation = conversationFor(state, session, conversationId)
  if (!conversation) throw new Error('Bu konuşmaya erişilemiyor.')
  conversation.messages.push({
    id: makeId('msg'),
    text: requiredText.parse(text),
    sender: session.role === 'ogretmen' ? 'teacher' : conversation.audience,
    date: new Date().toISOString(),
  })
}
