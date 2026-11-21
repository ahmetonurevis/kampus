import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_PERSONNEL_FILE_READ_ROLES,
  FINANCE_PERSONNEL_FILE_WRITE_ROLES,
  personnelFileInputSchema,
  personnelFileUpdateSchema,
} from '@kampus/school-core/lib/finance-personnel-files.ts'

import { fieldCipherFromConfig } from '../lib/field-crypto.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createPersonnelFileCommand,
  getPersonnelFileFor,
  listPersonnelFilesFor,
  revealPersonnelNationalIdFor,
  updatePersonnelFileCommand,
  type PersonnelFileDeps,
} from '../services/finance-personnel-files.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  personnelFileListQuery,
  personnelFileListResponse,
  personnelFileParams,
  personnelFileResponse,
  personnelFileResponseFor,
  personnelNationalIdResponse,
} from './finance-personnel-files.schemas.ts'

/**
 * Personel özlük kartı uçları (docs/domain/finans.md DOM-FIN-140; ON-172). Modül `finance`. Okuma
 * yönetici ve ön büro (ön büro yalnız acil durum kişilerini görür), yazma yalnız yönetici; muhasebe
 * rolü açılınca kimlik ve iletişimi okur, bankayı yazar (K-475). Yanıt role göre süzülür. Kart açma
 * `Idempotency-Key`, düzeltme `If-Match` ister. Tam T.C. kimlik no ayrı uçtan, yalnız yöneticiye ve
 * denetimle döner (K-476).
 */

const ACCESS =
  'Rol: okuma `yonetici` (bütün gruplar) ve `onburo` (yalnız acil durum kişileri); yazma yalnız `yonetici`. Muhasebe rolü açılınca kimlik (maskeli) ve iletişimi okur, bankayı yazar (K-475). Öğretmen, veli ve öğrenci 403. Modül `finance`.'
const URL = '/api/v1/finance/personnel-files'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinancePersonnelFileRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Anahtar uygulama kurulurken bir kez türetilir (`config.ts` doğrulamıştır).
  const deps: PersonnelFileDeps = { cipher: fieldCipherFromConfig(app.config) }
  const readers: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_PERSONNEL_FILE_READ_ROLES),
  ]
  const writers: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_PERSONNEL_FILE_WRITE_ROLES),
  ]
  const tags = ['finance-personnel-files']

  typed.get(
    URL,
    {
      preValidation: readers,
      schema: {
        operationId: 'listPersonnelFiles',
        tags,
        summary: 'Personel ve özlük kartı durumu',
        description: `Kurumun yönetici, öğretmen ve ön büro üyelikleri ada göre; kartı var mı, sürümü ve dolu gruplar (yalnız okuyanın görebildiği gruplar; değer yok). Ad, durum (\`active\`, \`passive\`) ve kart (\`with\`, \`without\`) ile süzülür. ${ACCESS}`,
        querystring: personnelFileListQuery,
        response: { 200: personnelFileListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, file } = request.query
      const { items, total } = await listPersonnelFilesFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        file,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${URL}/:membershipId`,
    {
      preValidation: readers,
      schema: {
        operationId: 'getPersonnelFile',
        tags,
        summary: 'Personelin özlük kartı',
        description: `Kartın okuyanın görebildiği grupları (K-475): kimlik (maskeli T.C. kimlik no, doğum günü), kişisel iletişim, eğitim geçmişi ve özlük belgelerinden sertifika özeti, banka (maskeli IBAN, hesap sahibi), acil durum kişileri. Okunamayan grubun anahtarı yanıtta yoktur. \`access\` grup başına okuma/yazma, \`canRevealNationalId\` tam kimlik no ucunu gösterir. Kartı olmayan, personel olmayan ya da başka kurumun üyeliği 404. ${ACCESS}`,
        params: personnelFileParams,
        response: { 200: personnelFileResponse, ...commandErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      const data = await getPersonnelFileFor(ctx, deps, request.params.membershipId)
      return personnelFileResponseFor(ctx.actor.role).parse({ data })
    },
  )

  typed.get(
    `${URL}/:membershipId/national-id`,
    {
      preValidation: writers,
      schema: {
        operationId: 'getPersonnelNationalId',
        tags,
        summary: 'Tam T.C. kimlik numarası',
        description: `Kartın tam T.C. kimlik numarası (K-476): yalnız yönetici. Okuma aynı transaction'da denetime yazılır (\`finance.personnel_file.national_id_read\`, alan adı; değer yazılmaz); denetim yazılamazsa değer dönmez. Kartta yoksa \`null\`. Kartı olmayan ya da başka kurumun üyeliği 404. Ön büro 403. Modül \`finance\`.`,
        params: personnelFileParams,
        response: { 200: personnelNationalIdResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await revealPersonnelNationalIdFor(
        contextOf(request),
        deps,
        request.params.membershipId,
      ),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...writers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPersonnelFile',
        tags,
        summary: 'Özlük kartı aç',
        description: `Personel ve en az bir grup: kimlik (T.C. kimlik no kontrol haneli, doğum günü 1920 sonrası ve en az 14 yaş), kişisel iletişim (adres 10–500, telefon 0XXXXXXXXXX, e-posta), eğitim geçmişi (en çok 10 satır), banka (TR IBAN mod-97 ve hesap sahibi birlikte), acil durum kişileri (en çok 5). T.C. kimlik no ve IBAN şifreli saklanır. Rolün yazamadığı grup 403 \`personnel_file_group_forbidden\`. Olmayan üyelik 422 \`personnel_file_staff_not_found\`, öğrenci ya da veli 422 \`personnel_file_not_staff\`, pasif personel 422 \`personnel_file_staff_inactive\`, kart zaten varsa 409 \`personnel_file_exists\`; doğum günü 422 \`personnel_file_birth_date_invalid\`, eksik banka 422 \`personnel_file_bank_incomplete\`. Denetim kaydına dolu grupların adları yazılır. \`Idempotency-Key\` zorunlu. ${ACCESS}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: personnelFileInputSchema,
        response: { 201: personnelFileResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const result = await createPersonnelFileCommand(
        ctx,
        deps,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = personnelFileResponseFor(ctx.actor.role).parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.membershipId}`)
      return body
    },
  )

  typed.patch(
    `${URL}/:membershipId`,
    {
      preValidation: [...writers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updatePersonnelFile',
        tags,
        summary: 'Özlük kartını düzelt',
        description: `Kısmi: verilmeyen grup ve alan değişmez, \`null\` temizler; eğitim ve acil durum listeleri bütün olarak yazılır; \`bank: null\` banka bilgisini siler. Birleşik kart açılış kurallarından geçer; değişiklik yoksa 422 \`personnel_file_unchanged\`. Rolün yazamadığı grup 403 \`personnel_file_group_forbidden\`. Pasif personelin kartı düzeltilebilir. Denetim kaydına değişen alanların adları yazılır. \`If-Match\` zorunlu; sürüm tutmazsa 409. Kartı olmayan ya da başka kurumun üyeliği 404. ${ACCESS}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: personnelFileParams,
        body: personnelFileUpdateSchema,
        response: { 200: personnelFileResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const opts = options(request, 'optional')
      const result = await updatePersonnelFileCommand(
        ctx,
        deps,
        request.params.membershipId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return personnelFileResponseFor(ctx.actor.role).parse(sendBody(reply, result))
    },
  )
}
