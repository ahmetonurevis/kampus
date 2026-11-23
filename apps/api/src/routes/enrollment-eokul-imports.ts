import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  EOKUL_IMPORT_MAX_ROWS,
  eokulImportInputSchema,
} from '@kampus/school-core/lib/enrollment-eokul-import.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { EOKUL_IMPORT_ROLES, importEokulStudents } from '../services/enrollment-eokul-import.ts'
import { idempotencyOf } from './command-support.ts'
import { rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { eokulImportResponseSchema } from './enrollment-eokul-imports.schemas.ts'
import { IMPORT_BODY_LIMIT, sendImport } from './enrollment-imports.ts'

/** e-Okul öğrenci listesinden içe aktarım (IST-134, ON-062; DOM-KAY-042). */
export function registerEnrollmentEokulImportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.post(
    '/api/v1/prospects/eokul-student-imports',
    {
      preValidation: [
        app.authenticate,
        app.requireModule('crm'),
        app.requireRole([...EOKUL_IMPORT_ROLES]),
        app.requireFreshSession,
        rejectIfMatch(),
      ],
      bodyLimit: IMPORT_BODY_LIMIT,
      schema: {
        operationId: 'importEokulStudents',
        tags: ['prospects'],
        summary: 'e-Okul öğrenci listesini aktar',
        description: `Okul e-Okul'dan indirdiği öğrenci listesini CSV ya da Excel (.xlsx, ilk sayfa) olarak yükler (IST-134, DOM-KAY-042). Yalnız \`school\` türündeki kurumda vardır; öteki türlerde 404. \`fileBase64\`: dosyanın base64'ü, en çok 5 MB; tür içerikten anlaşılır, eski ikili .xls okunmaz (\`import_file_legacy_excel\`). Başlık satırı ilk 20 satırda aranır; en çok ${EOKUL_IMPORT_MAX_ROWS.toLocaleString('tr-TR')} veri satırı. \`mapping\` verilmezse sütunlar başlık adlarından önerilir (\`suggestedMapping\`); kullanıcı düzeltip yeniden önizler. \`branchId\` aramayı bir kampüsle sınırlar, \`fallbackClassId\` sınıf sütunu olmayan dosyada bütün satırların sınıfıdır. Satır kurumdaki öğrenciyle T.C. kimlik no, yoksa okul no ile eşleşir ve \`new\`, \`update\`, \`unchanged\` ya da \`invalid\` olur. Mevcut öğrencide yalnız ad soyad, okul no, aynı düzeyde şube ve eksik kimlik yazılır; düzey farkı ve doğum tarihi farkı bilgidir. Bilinmeyen sınıf hatadır, sınıf açılmaz. Yeni öğrenci pilot aktarımının kuralıyla açılır: kimlik, doğum tarihi, veli adı ve telefonu zorunlu, aynı veli kardeşleri bağlar (DOM-KAY-012, DOM-KAY-013, DOM-KAY-036). \`dryRun: true\` önizlemedir: 200, satır bazında sorun, bilgi ve değişiklik; kimlik ve telefon maskeli; eşleme sorunu \`mappingIssues\`'ta döner ve satır işlenmez. Onay (\`dryRun: false\`) yalnız \`lines\` ile seçilen satırları kurum kilidi altında yeniden doğrular: eşleme sorunu 422 \`eokul_mapping_invalid\` (\`issues\` yolu \`['mapping', alan]\`), seçilen satır sorunu 422 \`eokul_import_invalid\` (\`['rows', satır, alan]\`), başarı 201 ve satırsız özet. Öğrenci, veli, \`student_identities\` ve \`student_guardians\` tek transaction'da yazılır. \`Idempotency-Key\` zorunlu (önizlemede saklanmaz). Yönetici ve ön büro (öteki roller 403; rol ve pasiflik kurum kilidi altında yeniden doğrulanır); taze oturum ister (15 dakikadan eski oturum 403 \`reauthentication_required\`). Kurum oturumdan gelir. Dosya saklanmaz, içerik ve kimlik numarası loglanmaz; denetim kaydına (\`student.eokul_import\`) yalnız alan adları ve sayılar yazılır.`,
        body: eokulImportInputSchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: {
          200: eokulImportResponseSchema,
          201: eokulImportResponseSchema,
          ...commandErrors,
        },
      },
    },
    async (request, reply) => {
      const response = await importEokulStudents(
        contextOf(request),
        request.body,
        idempotencyOf(request, true),
      )
      return sendImport(reply, response, eokulImportResponseSchema)
    },
  )
}
