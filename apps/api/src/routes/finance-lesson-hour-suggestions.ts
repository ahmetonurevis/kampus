import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  LESSON_SUGGESTION_ROLES,
  lessonSuggestionQuerySchema,
  lessonSuggestionTransferSchema,
} from '@kampus/school-core/lib/finance-lesson-hour-suggestions.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  lessonHourSuggestionDetailFor,
  lessonHourSuggestionsFor,
  transferLessonHourSuggestionsCommand,
} from '../services/finance-lesson-hour-suggestions.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  lessonSuggestionDetailParams,
  lessonSuggestionDetailResponse,
  lessonSuggestionParams,
  lessonSuggestionResponse,
} from './finance-lesson-hour-suggestions.schemas.ts'

/**
 * Programdan ek ders önerisi uçları (docs/domain/finans.md DOM-FIN-165; ON-195; K-550…K-552).
 * Modül `finance`; yalnız yönetici (döküm izin ve rapor günlerini ele verir). Yalnız okul türünde
 * kurumda vardır; dil okulunda 404. Aktarım `Idempotency-Key` ister. Sıra: 401 → 403 modül → 403
 * rol → 400 → işlem.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-552). Modül `finance`; yalnız okul türünde kurum.'
const URL = '/api/v1/finance/lesson-hour-suggestions'
const RULES =
  'Ders programındaki her ders 40 dakikalık ders saati sayısı kadar (en az 1) sayılır; iptal, kurum tatili (okul takvimi), öğretmenin izinli ya da raporlu olduğu gün ve henüz bitmemiş ders sayılmaz; yedek atanan ders yedeğe sayılır; telafi kendi kaydıyla sayılır (K-550). Hafta hafta (pazartesi–pazar) ilk `weeklyLoad` saat maaş karşılığı, `weeklyCap` saate kadarı ek derstir, üstü sayılmaz; ay sonunu kesen haftada ek ders dersin gününün ayına yazılır; saat ya da ders saati ücretli öğretmene öneri verilmez (K-551). Öneri saklanmaz.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceLessonHourSuggestionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const manager: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(LESSON_SUGGESTION_ROLES),
  ]
  const tags = ['finance-lesson-hour-suggestions']

  typed.get(
    `${URL}/:month`,
    {
      preValidation: manager,
      schema: {
        operationId: 'getLessonHourSuggestions',
        tags,
        summary: 'Ayın programdan ek ders önerisi',
        description: `Ayın ek ders saati önerisi (DOM-FIN-165): ayda dersi olan, personel üyeliğine bağlı her öğretmen için önerilen ek ders saati, sayım özeti, haftalar, ayın elle girilen ek ders saatiyle fark ve son aktarım. ${RULES} Dersi olup üyeliğe bağlı olmayan öğretmen kaydı \`unlinked\`'tedir. \`transferable\` aktarımın yapılabildiğini gösterir. Tutar dönmez; okuma denetime düşmez. ${MANAGER}`,
        params: lessonSuggestionParams,
        querystring: lessonSuggestionQuerySchema,
        response: { 200: lessonSuggestionResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await lessonHourSuggestionsFor(contextOf(request), request.params.month, request.query),
    }),
  )

  typed.get(
    `${URL}/:month/teachers/:membershipId`,
    {
      preValidation: manager,
      schema: {
        operationId: 'getLessonHourSuggestionDetail',
        tags,
        summary: 'Öğretmenin gün gün ek ders dökümü',
        description: `Öğretmenin ay dökümü (K-550): gün gün hangi ders, hangi sınıf, kaç ders saati, sayıldı mı ve neden (\`counted\`, \`cancelled\`, \`holiday\`, \`leave\`, \`substituted_out\`, \`upcoming\`), yedek ve telafi, maaş karşılığı/ek ders/üst sınır üstü dağılımı, yoklama işareti; ayın aktarımları. İzin ve rapor ayrılmaz. Ayda dersi olmayan, üyeliğe bağlı olmayan ya da başka kurumun üyeliği 404. ${MANAGER}`,
        params: lessonSuggestionDetailParams,
        querystring: lessonSuggestionQuerySchema,
        response: { 200: lessonSuggestionDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await lessonHourSuggestionDetailFor(
        contextOf(request),
        request.params.month,
        request.params.membershipId,
        request.query,
      ),
    }),
  )

  typed.post(
    `${URL}/:month/transfers`,
    {
      preValidation: [...manager, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'transferLessonHourSuggestions',
        tags,
        summary: 'Öneriyi elle ek ders girişine aktar',
        description: `Öğretmen başına öneri (ya da düzeltilmiş saat) ayın elle girilen ek ders (\`extra\`) saatine yazılır; kayıt yoksa açılır, varsa saati düzeltilir (notu korunur). Tek ya da toplu (en çok 200) aktarım tek işlemdir: biri reddedilirse hiçbiri yazılmaz (K-552). \`suggestedHours\` ekrandaki öneridir; sunucunun öneriyle aynı değilse 409 \`lesson_suggestion_changed\`. Öneriden farklı saat gerekçe ister (5–500; yoksa 422 \`lesson_suggestion_reason_required\`); elle giriş zaten bu saatteyse 422 \`lesson_suggestion_unchanged\`; öneri yoksa (dersi yok, saat ücretli, başka kurumun üyeliği) 422 \`lesson_suggestion_not_found\`; gelecek ay 422 \`payroll_lesson_hours_future_month\`. Müdür onaylı ayda 409 \`lesson_hours_locked\`, bordro dönemi kilitli ayda 409 \`payroll_period_locked\` (K-410). Her satır değişmez aktarım kaydı (önerilen, önceki ve yazılan saat, gerekçe, parametreler) ve denetim kaydı yazar; denetime saat ve gerekçe yazılmaz. Teyit alınmış personelin teyidi saat değişince yeniden istenir (DOM-FIN-120). Yanıt güncel öneridir. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: lessonSuggestionParams,
        body: lessonSuggestionTransferSchema,
        response: { 200: lessonSuggestionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await transferLessonHourSuggestionsCommand(
        contextOf(request),
        request.params.month,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return lessonSuggestionResponse.parse(sendBody(reply, result))
    },
  )
}
