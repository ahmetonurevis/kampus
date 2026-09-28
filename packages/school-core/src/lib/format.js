// Intl kurucuları Android'de pahalıdır; satır başına yeniden oluşturulmaz.
const moneyFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const numberFormatter = new Intl.NumberFormat('tr-TR')
const timeFormatter = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
})
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const dateFormatters = new Map()
export const money = (cents) => moneyFormatter.format((cents || 0) / 100) + ' ₺'
export const number = (value) => numberFormatter.format(value || 0)
export function dateLabel(value, options = {}) {
  if (!value) return '—'
  const key = JSON.stringify(Object.entries(options).sort(([a], [b]) => a.localeCompare(b)))
  let formatter = dateFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('tr-TR', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Istanbul',
      ...options,
    })
    if (dateFormatters.size >= 32) dateFormatters.delete(dateFormatters.keys().next().value)
    dateFormatters.set(key, formatter)
  }
  return formatter.format(new Date(value))
}
export const timeLabel = (value) => timeFormatter.format(new Date(value))
export const dayKey = (value = new Date()) => dayFormatter.format(new Date(value))
export const initials = (name) =>
  (name || '')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
export const sum = (list, key) => list.reduce((total, item) => total + item[key], 0)
export const average = (values) =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
export function invoiceStatus(invoice, today = dayKey()) {
  return invoice.paidAt ? 'Ödendi' : dayKey(invoice.dueDate) < today ? 'Gecikmiş' : 'Yaklaşan'
}
export function slaStatus(question, now = Date.now()) {
  const hours = (new Date(question.createdAt).getTime() + 86400000 - now) / 3600000
  return question.answeredAt
    ? 'Yanıtlandı'
    : hours <= 0
      ? 'Süre aşıldı'
      : hours <= 4
        ? 'Süre azalıyor'
        : 'Bekliyor'
}
export function slaLabel(question, now = Date.now()) {
  if (question.answeredAt) return 'Yanıtlandı'
  const minutes = Math.ceil((new Date(question.createdAt).getTime() + 86400000 - now) / 60000)
  const abs = Math.abs(minutes)
  return `${Math.floor(abs / 60)} sa ${abs % 60} dk ${minutes < 0 ? 'aşıldı' : 'kaldı'}`
}
export function homeworkStatus(homework, submissions, studentId) {
  const submission = submissions.find(
    (s) => s.homeworkId === homework.id && s.studentId === studentId,
  )
  return submission
    ? submission.score != null
      ? 'Değerlendirildi'
      : 'Teslim edildi'
    : new Date(homework.dueDate) < new Date()
      ? 'Gecikmiş'
      : 'Bekliyor'
}
