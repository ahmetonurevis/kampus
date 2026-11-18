import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_LEAVE_CALENDAR_ROLES,
  FINANCE_LEAVE_CALENDAR_SETTINGS_ROLES,
  leaveCalendarSettingsSchema,
} from '@kampus/school-core/lib/finance-leave-calendar.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  leaveCalendarFor,
  leaveCalendarSettingsFor,
  setLeaveCalendarSettingsCommand,
} from '../services/finance-leave-calendar.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  leaveCalendarQuery,
  leaveCalendarResponse,
  leaveCalendarSettingsResponse,
} from './finance-leave-calendar.schemas.ts'

/**
 * İzin takvimi ve ayarı (docs/domain/finans.md DOM-FIN-123; ON-183; K-420…K-422). Modül
 * `finance`. Takvimi yönetici ve ön büro okur (ön büro yalnız onaylı izni türsüz); ayarı yalnız
 * yönetici okur ve yazar. Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 */

const CALENDAR = '/api/v1/finance/leave-calendar'
const SETTINGS = '/api/v1/finance/leave-calendar-settings'
const MANAGER = 'Rol: yalnız `yonetici`. Modül `finance`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceLeaveCalendarRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const manager = app.requireRole(FINANCE_LEAVE_CALENDAR_SETTINGS_ROLES)
  const tags = ['finance-leave-requests']

  typed.get(
    CALENDAR,
    {
      preValidation: [app.authenticate, finance, app.requireRole(FINANCE_LEAVE_CALENDAR_ROLES)],
      schema: {
        operationId: 'getLeaveCalendar',
        tags,
        summary: 'İzin takvimi',
        description:
          'Aralığa (en çok 62 gün) değen izinler: bekleyen ve onaylı izin talepleri, elle yazılmış kullanılmış izin kayıtları ve sağlık raporları (talepten doğan kayıt talebiyle tek görünür). Yönetici tür adını görür; rapor türü ve tanı gösterilmez, rapor yalnız `sick` ("Raporlu") kategorisindedir. Ön büro yalnız onaylı izinleri `absent` kategorisinde türsüz görür, `status` süzgeci onda etkisizdir, `busyDays` ve eşik boştur (K-420). Branş öğretmen kaydının dersidir (K-421). Sınav haftaları ve yönetici için aynı branşta izinli sayısının eşiğe ulaştığı günler (K-422). Rol: `yonetici`, `onburo` (okuma). Modül `finance`.',
        querystring: leaveCalendarQuery,
        response: { 200: leaveCalendarResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { startDate, endDate, subjectId, role, status } = request.query
      return {
        data: await leaveCalendarFor(contextOf(request), {
          startDate,
          endDate,
          subjectId,
          role,
          status,
        }),
      }
    },
  )

  typed.get(
    SETTINGS,
    {
      preValidation: [app.authenticate, finance, manager],
      schema: {
        operationId: 'getLeaveCalendarSettings',
        tags,
        summary: 'İzin takvimi ayarı',
        description: `Aynı branşta eşzamanlı izin eşiği (varsayılan 2) ve sınav haftaları; ayar hiç kaydedilmediyse varsayılan ve sürüm 1 (K-421, K-422). ${MANAGER}`,
        response: { 200: leaveCalendarSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await leaveCalendarSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS,
    {
      preValidation: [app.authenticate, finance, manager, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'setLeaveCalendarSettings',
        tags,
        summary: 'İzin takvimi ayarını kaydet',
        description: `Eşik (2–20) ve sınav haftaları (en çok 40, her biri en çok 31 gün, birbiriyle çakışmaz; 400) değişir; gönderilmeyen alan korunur, sınav haftası listesi bütün olarak yazılır, boş liste uyarıyı kapatır. Değişiklik yoksa 422 \`leave_calendar_settings_unchanged\`. \`If-Match\` zorunlu (\`GET\` yanıtındaki sürüm; hiç kaydedilmediyse 1); sürüm tutmazsa 409 \`version_conflict\`. Uyarılar engel değildir. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: leaveCalendarSettingsSchema,
        response: { 200: leaveCalendarSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await setLeaveCalendarSettingsCommand(
        contextOf(request),
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return leaveCalendarSettingsResponse.parse(sendBody(reply, result))
    },
  )
}
