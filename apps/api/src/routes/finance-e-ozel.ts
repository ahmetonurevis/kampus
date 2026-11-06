import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  E_OZEL_KINDS,
  eOzelDateRangeRule,
  eOzelFilterSchema,
  eOzelFilterShape,
  eOzelMarkSchema,
} from '@kampus/school-core/lib/finance-e-ozel.ts'
import { PROGRESSION_OUTCOMES } from '@kampus/school-core/cefr/progression.ts'
import { enumKeys } from '@kampus/school-core/content/taxonomy.ts'

import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  assertEOzelInstitution,
  exportEOzelItems,
  listEOzelItems,
  setEOzelMarkCommand,
} from '../services/finance-e-ozel.ts'
import { captureInput, options, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * e-Özel işlem listesi (IST-085, DOM-KAY-015). Modül `finance`; roller yönetici ve ön büro. Okulda
 * rol denetiminden önce 404 (DOM-YTK-012). Platform e-Özel'e bağlanmaz; liste elle işlem içindir.
 */

const ROLES = ['yonetici', 'onburo'] as const

const NO_LINK =
  "Platform e-Özel'e bağlanmaz; satırların e-Özel alanlarıyla birebir eşleşmesi doğrulanmalıdır."

const place = {
  groupName: z.string().nullable().describe('Kur grubu ya da sınıf adı'),
  courseName: z.string().nullable(),
}

const itemSchema = z.object({
  kind: z.enum(E_OZEL_KINDS),
  sourceId: z.string().describe('Kaynak kaydın kimliği; işaret ucunun yol parametresi'),
  learnerId: z.string(),
  learnerName: z.string(),
  date: z.string().nullable().describe('Satır günü (YYYY-MM-DD, Europe/Istanbul)'),
  version: z.number().int().describe('`If-Match` için sürüm; işareti olmayan satırda 1'),
  recordedAt: z.string().nullable().describe('İşlendi olarak işaretlendiği an (ISO 8601 UTC)'),
  recordedByName: z.string().nullable().describe('İşaretleyen personel'),
  learner: z
    .object({
      identityKind: z.string().nullable(),
      maskedIdentity: z.string().nullable().describe('Yalnız maskeli (`*******1234`)'),
      birthDate: z.string().nullable(),
      status: z.enum(['active', 'cancelled']).describe('Kayıt durumu: aktif ya da kayıt iptal'),
    })
    .nullable(),
  fee: z
    .object({
      amountCents: z.number().int().describe('Tutar (kuruş)'),
      receipt: z.string().describe('Kurum dekont numarası'),
      method: z.string(),
      reference: z.string().nullable(),
    })
    .nullable(),
  attendance: z
    .object({
      ...place,
      lessonHourId: z.string().nullable().describe('Ders saati; gün bazlı yoklamada boş'),
      excused: z.boolean(),
    })
    .nullable(),
  courseEnd: z
    .object({
      ...place,
      outcome: z.enum(enumKeys(PROGRESSION_OUTCOMES)),
      certificateNumber: z.string().nullable().describe('MEBBİS belge izi varsa belge no'),
    })
    .nullable(),
})

const listQuerySchema = z
  .strictObject({ ...pageQuerySchema.shape, ...eOzelFilterShape })
  .refine(eOzelDateRangeRule.check, eOzelDateRangeRule.options)

const markParamsSchema = z.object({
  kind: z.enum(E_OZEL_KINDS).describe('Satır türü'),
  sourceId: z.string().min(1).max(200).describe('Kaynak kaydın kimliği'),
})

const markResponseSchema = dataResponse(
  z.object({
    kind: z.enum(E_OZEL_KINDS),
    sourceId: z.string(),
    version: z.number().int(),
    recordedAt: z.string().nullable(),
  }),
)

/** Sayaç doğrulanmış kullanıcıyadır; istemcinin değiştirebildiği başlığa bağlanmaz. */
function exportRateKey(request: FastifyRequest): string {
  return request.auth?.userId ?? request.ip
}

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceEOzelRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  const courseInstitution: preValidationAsyncHookHandler = async function (request) {
    await assertEOzelInstitution(contextOf(request))
  }
  const guard = [
    app.authenticate,
    app.requireModule('finance'),
    courseInstitution,
    app.requireRole(ROLES),
  ]

  typed.get(
    '/api/v1/finance/e-ozel/items',
    {
      preValidation: guard,
      schema: {
        operationId: 'listEOzelItems',
        tags: ['finance-exports'],
        summary: "e-Özel'e işlenecek kayıtlar",
        description: `e-Özel'e elle girilecek kursiyer, ücret/dekont, devamsızlık ve kurs sonu satırları (IST-085, DOM-KAY-015); varsayılan yalnız işlenmemişler. ${NO_LINK} Kimlik numarası yalnız maskeli döner; bu bilgiyi içeren sayfa denetime yazılır (\`finance.e_ozel_read\`, yalnız alan adları). Devamsızlık ve kurs sonu \`academic\` modülünün verisidir: modül kapalıyken genel listede yer almaz, \`kind\` ile istenirse 403 \`module_disabled\`. \`crm\` kapalıyken kimlik alanları boş döner. Ters gün aralığı ve bilinmeyen parametre 400. Sayfalıdır, \`pageSize\` en çok 100. Okulda 404. Roller: \`yonetici\`, \`onburo\`.`,
        querystring: listQuerySchema,
        response: { 200: pageResponse(itemSchema), ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listEOzelItems(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/e-ozel/export',
    {
      config: {
        // `preHandler`: kimlik `preValidation`'da doğrulanır, anahtar kullanıcı kimliği olur.
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: exportRateKey,
        },
      },
      preValidation: [...guard, app.requireFreshSession],
      schema: {
        operationId: 'exportEOzelItems',
        tags: ['finance-exports'],
        summary: 'e-Özel işlem listesi dosyası',
        description: `Listeyle aynı süzgeçle bütün satırları CSV olarak döner: \`;\` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı (IST-085). ${NO_LINK} Tam kimlik numarası dosyaya yazılmaz. Her aktarım denetime yazılır (\`finance.e_ozel_export\`, DOM-YTK-052). Taze oturum ister: eskiyse 403 \`reauthentication_required\`; kullanıcı başına 10/dk. Okulda 404. Roller: \`yonetici\`, \`onburo\`.`,
        querystring: eOzelFilterSchema,
        response: { 200: z.string().describe('CSV dosyası'), ...commandErrors },
      },
    },
    async (request, reply) => {
      const csv = await exportEOzelItems(contextOf(request), request.query)
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="e-ozel-islem-listesi.csv"')
        .serializer((payload: unknown) => String(payload))
        .send(`${String.fromCodePoint(0xfeff)}${csv}`)
    },
  )

  typed.post(
    '/api/v1/finance/e-ozel/items/:kind/:sourceId/record',
    {
      preValidation: [...guard, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'setEOzelMark',
        tags: ['finance-exports'],
        summary: 'e-Özel "işlendi" işaretini yaz ya da geri al',
        description: `\`recorded: true\` satırı işlendi olarak işaretler, kim ve ne zaman saklanır; \`false\` işareti geri alır (IST-085, DOM-KAY-015). ${NO_LINK} Ücret satırı tahsilatın MEBBİS işaretidir, ikisi aynı kayıttır (DOM-FIN-032). İşlenmiş satırı yeniden işlemek 409 \`e_ozel_already_recorded\`, işlenmemiş satırın işaretini kaldırmak 409 \`e_ozel_not_recorded\`, sürüm tutmazsa 409. Olmayan, listeye girmeyen (iptal edilmiş tahsilat, düzeltilmiş yoklama, eski karar) ya da başka kurumun kaydı 404. Denetime yalnız alan adı düşer. \`If-Match\` ve \`Idempotency-Key\` zorunludur. Okulda 404. Roller: \`yonetici\`, \`onburo\`.`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: markParamsSchema,
        body: eOzelMarkSchema,
        response: { 200: markResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { idempotency, expectedVersion } = options(request, 'required')
      if (expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await setEOzelMarkCommand(
        contextOf(request),
        request.params,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return markResponseSchema.parse(sendBody(reply, result))
    },
  )
}
