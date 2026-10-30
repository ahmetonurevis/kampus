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
type DateInput = string | number | Date

const dateFormatters = new Map<string, Intl.DateTimeFormat>()
export const money = (cents: number | null | undefined) =>
  moneyFormatter.format((cents || 0) / 100) + ' ₺'
export const number = (value: number | null | undefined) => numberFormatter.format(value || 0)
export function dateLabel(
  value: DateInput | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
) {
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
    // Önbellek sınırı aşılınca en eski biçimleyici atılır.
    const oldest = dateFormatters.keys().next().value
    if (dateFormatters.size >= 32 && oldest !== undefined) dateFormatters.delete(oldest)
    dateFormatters.set(key, formatter)
  }
  return formatter.format(new Date(value))
}
export const timeLabel = (value: DateInput) => timeFormatter.format(new Date(value))
export const dayKey = (value: DateInput = new Date()) => dayFormatter.format(new Date(value))
export const initials = (name: string | null | undefined) =>
  (name || '')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
export const sum = <K extends PropertyKey>(list: readonly Record<K, number>[], key: K) =>
  list.reduce((total, item) => total + item[key], 0)
export const average = (values: readonly number[]) =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
export function invoiceStatus(
  invoice: { paidAt?: string | null; dueDate: DateInput },
  today = dayKey(),
) {
  return invoice.paidAt ? 'Ödendi' : dayKey(invoice.dueDate) < today ? 'Gecikmiş' : 'Yaklaşan'
}
type SlaQuestion = { createdAt: DateInput; answeredAt?: string | null }
export function slaStatus(question: SlaQuestion, now = Date.now()) {
  const hours = (new Date(question.createdAt).getTime() + 86400000 - now) / 3600000
  return question.answeredAt
    ? 'Yanıtlandı'
    : hours <= 0
      ? 'Süre aşıldı'
      : hours <= 4
        ? 'Süre azalıyor'
        : 'Bekliyor'
}
export function slaLabel(question: SlaQuestion, now = Date.now()) {
  if (question.answeredAt) return 'Yanıtlandı'
  const minutes = Math.ceil((new Date(question.createdAt).getTime() + 86400000 - now) / 60000)
  const abs = Math.abs(minutes)
  return `${Math.floor(abs / 60)} sa ${abs % 60} dk ${minutes < 0 ? 'aşıldı' : 'kaldı'}`
}
export function homeworkStatus(
  homework: { id: string; dueDate: DateInput },
  submissions: readonly { homeworkId: string; studentId: string; score?: number | null }[],
  studentId: string,
  now: DateInput = new Date(),
) {
  const submission = submissions.find(
    (s) => s.homeworkId === homework.id && s.studentId === studentId,
  )
  return submission
    ? submission.score != null
      ? 'Değerlendirildi'
      : 'Teslim edildi'
    : new Date(homework.dueDate) < new Date(now)
      ? 'Gecikmiş'
      : 'Bekliyor'
}
