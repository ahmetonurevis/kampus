import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import { recordVideoProgressSchema } from '@kampus/school-core/lib/video-progress.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { recordVideoProgressCommand } from '../services/video-progress.ts'
import { idempotencyOf } from './command-support.ts'
import { rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { videoProgressParamsSchema, videoProgressResponseSchema } from './video-progress.schemas.ts'

/**
 * Video izleme ilerlemesi ucu (IST-041; docs/domain/kaynak-platformu.md DOM-KYN-005). Kural, rol
 * ve kapsam core `lib/video-progress.ts`'dedir. Modül `learning` (core komut tablosu): kapalıysa
 * 403 `module_disabled`. Sıra: 401 → 403 modül → 403 rol → `If-Match` yasak → 400 gövde → işlem
 * (403, 404, 422). Okuma ayrı uç değildir: ilerleme `GET /collections/videoProgress`'ten okunur.
 */

const LEARNING = OPERATION_COMMANDS['video.progress'].module ?? 'learning'

export function registerVideoProgressRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.post(
    '/api/v1/videos/:videoId/progress',
    {
      preValidation: [
        app.authenticate,
        app.requireModule(LEARNING),
        app.requireRole(WRITE_ACTION_ROLES['video.progress']),
        rejectIfMatch(),
      ],
      schema: {
        operationId: 'recordVideoProgress',
        tags: ['videos'],
        summary: 'Video izleme ilerlemesini yaz',
        description: `Öğrenci kendi video izleme ilerlemesini yazar (core \`recordVideoProgress\`, DOM-KYN-005). Öğrenci oturumdan gelir; gövdede oynatıcının son konumu (\`positionSeconds\`) ve video süresi (\`durationSeconds\`, saniye) bulunur. Yüzde sunucuda hesaplanır, 0–100'e sıkıştırılır ve geri gitmez (izlenen en yüksek değer); son konum her istekte güncellenir ve konum süreyi aşamaz. İlk istek kaydı açar, sonrakiler günceller; aynı istek tekrarlanınca kayıt değişmez. Öğrencinin düzeyi dışındaki video, olmayan video ve başka kurumun videosu 404 \`not_found\`, bağlantısız öğrenci 403 \`student_scope_denied\`, pasif öğrenci 422 \`student_inactive\`. Okuma \`GET /collections/videoProgress\`'tedir (öğrenci yalnız kendi kaydını, veli çocuğununkini, öğretmen sınıflarındakini görür). Sık çağrılır (istemci 15 sn'de bir): denetim satırı yazılmaz. \`Idempotency-Key\` isteğe bağlıdır, \`If-Match\` kabul edilmez. Modül \`learning\`. Roller: ${WRITE_ACTION_ROLES['video.progress'].map((role) => `\`${role}\``).join(', ')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: videoProgressParamsSchema,
        body: recordVideoProgressSchema,
        response: { 200: videoProgressResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const response = await recordVideoProgressCommand(
        contextOf(request),
        request.params.videoId,
        request.body,
        idempotencyOf(request, false),
      )
      if (response.replayed) reply.header('idempotent-replayed', 'true')
      reply.status(200)
      return videoProgressResponseSchema.parse(response.body)
    },
  )
}
