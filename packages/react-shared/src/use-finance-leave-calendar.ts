import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { STAFF_LEAVE_KEY } from './use-finance-staff-leave.ts'

// İzin takvimi kancaları (`/finance/leave-calendar`; DOM-FIN-123, ON-183). Takvim personel izin
// anahtarının altındadır: talep, onay ve izin kaydı yazmaları takvimi de tazeler. Ayar değişikliği
// talep uyarılarını değiştirdiği için izin anahtarının tamamını tazeler.

type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never

export type LeaveCalendarQuery = Query<'getLeaveCalendar'>
export type LeaveCalendar =
  operations['getLeaveCalendar']['responses'][200]['content']['application/json']['data']
export type LeaveCalendarEntry = LeaveCalendar['entries'][number]
export type LeaveCalendarSettings =
  operations['getLeaveCalendarSettings']['responses'][200]['content']['application/json']['data']
export type LeaveCalendarSettingsBody = NonNullable<
  operations['setLeaveCalendarSettings']['requestBody']
>['content']['application/json']

export const LEAVE_CALENDAR_KEY = [...STAFF_LEAVE_KEY, 'calendar'] as const
const MESSAGES = {
  version_conflict: 'İzin takvimi ayarı başka biri tarafından değiştirildi. Ayar güncellendi.',
}

/** Takvim (yönetici ve ön büro okuma); `null` sorgu kapalı. */
export function useLeaveCalendar(query: LeaveCalendarQuery | null) {
  return useApiQuery({
    key: [...LEAVE_CALENDAR_KEY, 'view', query],
    enabled: query !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/leave-calendar', {
        params: { query: query ?? { startDate: '', endDate: '' } },
        signal,
      }),
  })
}

/** Eşik ve sınav haftaları (yalnız yönetici). */
export function useLeaveCalendarSettings(enabled = true) {
  return useApiQuery({
    key: [...LEAVE_CALENDAR_KEY, 'settings'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/leave-calendar-settings', { signal }),
  })
}

/** Ayarı kaydeder; sürüm `If-Match` ile denetlenir. */
export function useSetLeaveCalendarSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number; body: LeaveCalendarSettingsBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/leave-calendar-settings', {
        params: {
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [STAFF_LEAVE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
