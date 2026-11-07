import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import { importFileInputSchema } from '@kampus/school-core/lib/enrollment-import-cells.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { importStudents } from '../services/enrollment-import.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { idempotencyOf } from './command-support.ts'
import { rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { studentImportResponseSchema } from './enrollment-imports.schemas.ts'

/** Aktarım yanıtı; tekrarlanan yanıt veritabanından geldiği için şemayla yeniden okunur. */
export function sendImport<T>(
  reply: FastifyReply,
  response: CommandResponse,
  schema: z.ZodType<T>,
) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return schema.parse(response.body)
}

/** Gövde sınırı: 5 MB dosyanın base64'ü (4/3 kat) ve küçük JSON zarfı. */
export const IMPORT_BODY_LIMIT = 7 * 1024 * 1024

export const IMPORT_ACCESS =
  'Yalnız yönetici (diğer roller 403; rol ve pasiflik kurum kilidi altında yeniden doğrulanır); taze oturum ister (15 dakikadan eski oturum 403 `reauthentication_required`). Kurum oturumdan gelir; dosyadaki değerler yalnız bu kurumda aranır. Dosya saklanmaz, içerik loglanmaz; denetim kaydına yalnız alan adları ve sayılar yazılır.'

/** Pilot verisi aktarımı: öğrenci ve veli (IST-007, ON-060; DOM-KAY-010, -012, -013). */
export function registerEnrollmentImportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.post(
    '/api/v1/prospects/student-imports',
    {
      preValidation: [
        app.authenticate,
        app.requireModule('crm'),
        app.requireRole(['yonetici']),
        app.requireFreshSession,
        rejectIfMatch(),
      ],
      bodyLimit: IMPORT_BODY_LIMIT,
      schema: {
        operationId: 'importStudents',
        tags: ['prospects'],
        summary: 'Öğrenci ve veliyi dosyadan aktar',
        description: `Okul canlıya geçerken mevcut öğrenci ve velileri CSV ya da Excel (.xlsx, ilk sayfa) dosyasıyla yükler (IST-007, DOM-KAY-012, DOM-KAY-013). \`fileBase64\`: dosyanın base64'ü, en çok 5 MB; tür içerikten anlaşılır. En çok 1.000 veri satırı. Sütunlar: \`öğrenci adı\`, \`sınıf\`, \`kimlik no\`, \`doğum tarihi\`, \`veli adı\`, \`veli telefonu\`, \`yakınlık\`; isteğe bağlı \`kampüs\`, \`kimlik türü\`, \`öğrenci telefonu\`. \`dryRun: true\` önizlemedir: 200 ve satır bazında sorun ve bilgi döner, hiçbir şey yazmaz; kimlik ve telefon maskelidir. Onayda bütün satırlar kurum kilidi altında yeniden doğrulanır: hata varsa 422 \`student_import_invalid\` (\`issues\` yolu \`['rows', satır, alan]\`) ve hiçbir kayıt yazılmaz, başarı 201. Öğrenci, veli, \`student_identities\` ve \`student_guardians\` tek transaction'da yazılır. Aynı telefon ve aynı veli adı kardeşleri aynı veli kaydına bağlar; önizleme eşleşmeyi gösterir, onay öneriyi kabul eder (DOM-KAY-013). Telefon aynı, ad farklıysa satır hatalıdır (\`guardian_phone_conflict\`). Kurumda kayıtlı kimlikte aynı adlı etkin öğrencinin satırı atlanır (\`skipped\`): ikinci yükleme mükerrer kayıt açmaz. Dosya düzeyindeki sorun 422 ve sorunun kodu (ör. \`csv_too_many_rows\`, \`import_file_legacy_excel\`). \`Idempotency-Key\` zorunlu (önizlemede saklanmaz). ${IMPORT_ACCESS}`,
        body: importFileInputSchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: {
          200: studentImportResponseSchema,
          201: studentImportResponseSchema,
          ...commandErrors,
        },
      },
    },
    async (request, reply) => {
      const response = await importStudents(
        contextOf(request),
        request.body,
        idempotencyOf(request, true),
      )
      return sendImport(reply, response, studentImportResponseSchema)
    },
  )
}
