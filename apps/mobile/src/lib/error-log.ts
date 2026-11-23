// Yapılandırılmış yerel hata günlüğü. Teknik ayrıntı (hata metni) yalnız burada tutulur;
// kullanıcıya Türkçe, ayrıntısız bildirim gösterilir (bkz. `lib/error-message.ts`).
export type LogLevel = 'error' | 'warn'
export type LogEntry = {
  date: string
  level: LogLevel
  critical: boolean
  context: string
  message: string
}

export const MAX_LOG_ENTRIES = 100
export const logs: LogEntry[] = []

export function recordError(error: unknown, context: string, level: LogLevel = 'error') {
  logs.push({
    date: new Date().toISOString(),
    level,
    critical: level === 'error',
    context,
    message: String(error),
  })
  if (logs.length > MAX_LOG_ENTRIES) logs.shift()
}
