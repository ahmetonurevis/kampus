import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  createPackageSchema,
  extendPackageSaleSchema,
  PACKAGE_SALE_READ_ROLES,
  PACKAGE_SELL_ROLES,
  packageQuoteSchema,
  sellPackageSchema,
  updatePackageSchema,
} from '@kampus/school-core/lib/finance-packages.ts'

import type { ROLES } from '../auth.ts'
import { NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  archivePackageCommand,
  createPackageCommand,
  extendPackageSaleCommand,
  getPackageFor,
  getPackageSaleFor,
  listPackagesFor,
  listPackageSalesFor,
  quotePackageSaleFor,
  sellPackageCommand,
  updatePackageCommand,
} from '../services/finance-packages.ts'
import { getInstitutionModules } from '../services/modules.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  packageArchiveResponse,
  packageListQuery,
  packageListResponse,
  packageParams,
  packageResponse,
  quoteResponse,
  saleDetailResponse,
  saleListQuery,
  saleListResponse,
  saleParams,
  saleResponse,
} from './finance-packages.schemas.ts'

/**
 * Dil okulu paket ve ders saati satışı uçları (IST-078; docs/domain/dil-okulu.md DOM-DIL-006, -050,
 * -051; finans.md DOM-FIN-002, -006). Modül `finance`. Paket yalnız dil okulundadır: öteki kurum
 * türlerinde her uç her rol için 404, rol denetiminden önce (DOM-YTK-012). Sıra: 401 → 403 modül →
 * 404 tür → 403 rol → `If-Match` → 400 → işlem. Tanım yönetici, satış yönetici ve ön büro; okuma
 * kapsamı `/finance/students/:id/balance` ile aynıdır. Çevrim içi satış kanalı yoktur (DOM-FIN-042).
 */

const MANAGE_ROLES = WRITE_ACTION_ROLES['tariff.manage']
const CATALOG_READ_ROLES = PACKAGE_SELL_ROLES

const LANGUAGE_ONLY =
  'Yalnız dil okulunda (`language_school`); öteki türlerde her rol için 404, rol denetiminden önce.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinancePackageRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const languageSchool: preValidationAsyncHookHandler = async function (request) {
    const ctx = contextOf(request)
    const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
    if (institution?.type !== 'language_school') throw new NotFoundError()
  }
  const guarded = (roles: readonly (typeof ROLES)[number][]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    languageSchool,
    app.requireRole(roles),
  ]

  typed.get(
    '/api/v1/finance/packages',
    {
      preValidation: guarded(CATALOG_READ_ROLES),
      schema: {
        operationId: 'listLessonPackages',
        tags: ['finance-packages'],
        summary: 'Paketleri listele',
        description: `Etkin paketler, ada göre (DOM-DIL-050). \`q\` adda arar, \`kind\` ve \`courseId\` süzer; arşivli paket görünmez. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`.`,
        querystring: packageListQuery,
        response: { 200: packageListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, kind, courseId } = request.query
      const { items, total } = await listPackagesFor(contextOf(request), {
        page,
        pageSize,
        q,
        kind,
        courseId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/packages',
    {
      preValidation: [...guarded(MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createLessonPackage',
        tags: ['finance-packages'],
        summary: 'Paket tanımla',
        description: `Kur ücreti, saat paketi ya da özel ders paketi (IST-078). Paket tutar taşımaz: fiyat satışta yayımlı tarifeden hesaplanır; \`hourlyCents\` yalnız ilan altı saat ücretidir (DOM-DIL-050). Kur ücretinde saat ve seviye kurdan gelir (DOM-DIL-006). \`validityDays\` kullanım süresidir, boşsa son kullanma tarihi yoktur (DOM-DIL-051). Aynı ad 409 \`package_name_exists\`; olmayan kur 404, arşivli kur 422 \`package_course_inactive\`. ${LANGUAGE_ONLY} Roller: \`yonetici\`.`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createPackageSchema,
        response: { 201: packageResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPackageCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = packageResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/finance/packages/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/packages/:packageId',
    {
      preValidation: guarded(CATALOG_READ_ROLES),
      schema: {
        operationId: 'getLessonPackage',
        tags: ['finance-packages'],
        summary: 'Paket ayrıntısı',
        description: `Olmayan, arşivli ya da başka kurumun paketi 404. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`.`,
        params: packageParams,
        response: { 200: packageResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getPackageFor(contextOf(request), request.params.packageId),
    }),
  )

  typed.patch(
    '/api/v1/finance/packages/:packageId',
    {
      preValidation: [...guarded(MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateLessonPackage',
        tags: ['finance-packages'],
        summary: 'Paketi düzelt',
        description: `Yalnız sonraki satışları etkiler; satış satırı kopyadır. Tür ve kur bağı değişmez. Kur ücreti paketinde saat 422 \`package_hours_from_course\`, kura bağlı pakette seviye 422 \`package_level_from_course\`. Olmayan paket 404, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${LANGUAGE_ONLY} Roller: \`yonetici\`.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: packageParams,
        body: updatePackageSchema,
        response: { 200: packageResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updatePackageCommand(
        contextOf(request),
        request.params.packageId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return packageResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    '/api/v1/finance/packages/:packageId',
    {
      preValidation: [...guarded(MANAGE_ROLES), requireIfMatch()],
      schema: {
        operationId: 'archiveLessonPackage',
        tags: ['finance-packages'],
        summary: 'Paketi arşivle',
        description: `Arşivli paket satılamaz; geçmiş satışlar ve bakiyeleri kalır. Olmayan paket 404, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${LANGUAGE_ONLY} Roller: \`yonetici\`.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: packageParams,
        response: { 200: packageArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archivePackageCommand(
        contextOf(request),
        request.params.packageId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return packageArchiveResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/package-sales/quote',
    {
      preValidation: [...guarded(PACKAGE_SELL_ROLES), captureInput()],
      schema: {
        operationId: 'quotePackageSale',
        tags: ['finance-packages'],
        summary: 'Paket satışını önizle',
        description: `Hiçbir kayıt yazmaz; satışla aynı kuralları çalıştırır (DOM-DIL-050). Saat × saat ücreti − ilanlı indirimler, taksitler ve son kullanma günü döner. Yayımlı tarife yoksa 422 \`tariff_not_published\`, ilan üstü saat ücreti 422 \`package_above_tariff\`, indirim ve ilan altı fiyat toplamı %50'yi aşarsa 422 \`discount_cap_exceeded\`, kur etkin değilse 422 \`package_course_inactive\`. Olmayan paket ya da öğrenci 404. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`.`,
        body: packageQuoteSchema,
        response: { 200: quoteResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await quotePackageSaleFor(contextOf(request), request.commandInput),
    }),
  )

  typed.post(
    '/api/v1/finance/package-sales',
    {
      preValidation: [...guarded(PACKAGE_SELL_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'sellPackage',
        tags: ['finance-packages'],
        summary: 'Paket sat',
        description: `Satış satırını, sözleşmeyi ve taksitleri tek işlemde yazar (IST-078, DOM-FIN-010). Tutar girdi değildir, yayımlı tarifeden hesaplanır (DOM-FIN-002); saat ve seviye satışa kopyalanır (DOM-DIL-006). Ek kalem ayrı taksittir (DOM-FIN-003). Son kullanma günü paketin kullanım süresinden çıkar. Tarife değiştiyse 409 \`tariff_changed\`, pasif kursiyer 422 \`student_inactive\`; öteki ret kodları önizlemeyle aynıdır. Kapsam dışı ya da olmayan kayıt 404. \`Idempotency-Key\` zorunludur. Başarı 201 ve \`Location\`. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: sellPackageSchema,
        response: { 201: saleResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await sellPackageCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = saleResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/finance/package-sales/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/package-sales',
    {
      preValidation: guarded(PACKAGE_SALE_READ_ROLES),
      schema: {
        operationId: 'listPackageSales',
        tags: ['finance-packages'],
        summary: 'Paket satışlarını listele',
        description: `Satın alınan, tüketilen, iade edilen ve kalan saatle (DOM-DIL-051); yeni satış önce. Yönetici ve ön büro kurum geneli; veli bağlı çocuğunu ve ödeyicisi olduğu öğrenciyi, öğrenci kendisini görür (DOM-FIN-052). \`studentId\` ve \`packageId\` süzer; kapsam dışı öğrenci boş liste verir. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`, \`veli\`, \`ogrenci\`.`,
        querystring: saleListQuery,
        response: { 200: saleListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, studentId, packageId } = request.query
      const { items, total } = await listPackageSalesFor(contextOf(request), {
        page,
        pageSize,
        studentId,
        packageId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/package-sales/:saleId',
    {
      preValidation: guarded(PACKAGE_SALE_READ_ROLES),
      schema: {
        operationId: 'getPackageSale',
        tags: ['finance-packages'],
        summary: 'Paket satışı ayrıntısı',
        description: `Satın alınan, kullanılan ve kalan saat, son kullanma günü ve sözleşmenin yalnız kendi taksitleri (IST-078, DOM-FIN-012). Süre dolsa da kalan saat silinmez (\`status: expired\`; DOM-DIL-051, H-19 doğrulanmalı). Kapsam listeyle aynıdır; kapsam dışı, olmayan ya da başka kurumun satışı 404. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`, \`veli\`, \`ogrenci\`.`,
        params: saleParams,
        response: { 200: saleDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getPackageSaleFor(contextOf(request), request.params.saleId),
    }),
  )

  typed.post(
    '/api/v1/finance/package-sales/:saleId/extend',
    {
      preValidation: [...guarded(PACKAGE_SELL_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'extendPackageSale',
        tags: ['finance-packages'],
        summary: 'Son kullanma tarihini uzat',
        description: `Kursiyerin seçimiyle kullanım süresini uzatır (DOM-DIL-051); gerekçe yalnız denetim kaydına yazılır. Süresiz paket 422 \`package_no_expiry\`, saati biten paket 422 \`package_depleted\`, mevcut günden sonra olmayan ya da geçmiş gün 422 \`package_extension_not_later\`. Olmayan ya da başka kurumun satışı 404, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: saleParams,
        body: extendPackageSaleSchema,
        response: { 200: saleResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await extendPackageSaleCommand(
        contextOf(request),
        request.params.saleId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return saleResponse.parse(sendBody(reply, result))
    },
  )
}
