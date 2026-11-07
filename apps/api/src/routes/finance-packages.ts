import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  createPackageSchema,
  extendPackageSaleSchema,
  PACKAGE_SALE_READ_ROLES,
  PACKAGE_SELL_ROLES,
  packageQuoteSchema,
  sellPackageSchema,
  setPackageUsedHoursSchema,
  updatePackageSchema,
} from '@kampus/school-core/lib/finance-packages.ts'
import { COURSE_OFFER_LIST_ROLES } from '@kampus/school-core/lib/renewal-course-offer-list.ts'

import type { ROLES } from '../auth.ts'
import { NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { listCourseOffersFor } from '../services/finance-course-offers.ts'
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
  setPackageUsedHoursCommand,
  updatePackageCommand,
} from '../services/finance-packages.ts'
import {
  packageReportCsvFor,
  packageReportFor,
  studentPackageBalanceFor,
} from '../services/finance-package-report.ts'
import { getInstitutionModules } from '../services/modules.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  courseOfferListQuery,
  courseOfferListResponse,
  packageArchiveResponse,
  packageBalanceResponse,
  packageReportQuery,
  packageReportResponse,
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
  studentPackageParams,
} from './finance-packages.schemas.ts'

/**
 * Dil okulu paket ve ders saati satışı uçları (IST-078; docs/domain/dil-okulu.md DOM-DIL-006, -050,
 * -051; finans.md DOM-FIN-002, -006). Modül `finance`. Paket yalnız dil okulundadır: öteki kurum
 * türlerinde her uç her rol için 404, rol denetiminden önce (DOM-YTK-012). Sıra: 401 → 403 modül →
 * 404 tür → 403 rol → `If-Match` → 400 → işlem. Tanım yönetici, satış yönetici ve ön büro; okuma
 * kapsamı `/finance/students/:id/balance` ile aynıdır. Çevrim içi satış kanalı yoktur (DOM-FIN-042).
 * Kur yenileme teklif listesi (IST-088, ON-082) satışın girişidir: teklif paket satışıyla açılır.
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

/** Rapor `Accept: text/csv` ile bütün satırları dosya olarak döner (api-tasarimi.md §CSV). */
const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300

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
        description: `Hiçbir kayıt yazmaz; satışla aynı kuralları çalıştırır (DOM-DIL-050). Saat × saat ücreti − ilanlı indirimler, taksitler, ödeme koşulu ve son kullanma günü döner. İlanda olmayan taksit sayısı 422 \`payment_term_not_in_tariff\`, peşin koşulu dışında peşin indirimi 422 \`early_payment_requires_upfront\` (DOM-FIN-013). Yayımlı tarife yoksa 422 \`tariff_not_published\`, ilan üstü saat ücreti 422 \`package_above_tariff\`, indirim ve ilan altı fiyat toplamı %50'yi aşarsa 422 \`discount_cap_exceeded\`, kur etkin değilse 422 \`package_course_inactive\`. Olmayan paket ya da öğrenci 404. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`.`,
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
        description: `Satın alınan, tüketilen, iade edilen ve kalan saatle (DOM-DIL-051); yeni satış önce. Yönetici ve ön büro kurum geneli; veli bağlı çocuğunu ve ödeyicisi olduğu öğrenciyi, öğrenci kendisini görür (DOM-FIN-052). Tutar alanları (\`hourlyCents\`, \`grossCents\`, \`netCents\`) yalnız \`yonetici\` ve \`onburo\` yanıtındadır; veli ve öğrenci yalnız saat, son kullanma, durum ve paket adını alır, tutar anahtarı yanıtta yoktur (K-40). \`studentId\` ve \`packageId\` süzer; kapsam dışı öğrenci boş liste verir. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`, \`veli\`, \`ogrenci\`.`,
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
        description: `Satın alınan, kullanılan ve kalan saat, son kullanma günü ve sözleşmenin yalnız kendi taksitleri (IST-078, DOM-FIN-012). Süre dolsa da kalan saat silinmez (\`status: expired\`; DOM-DIL-051, H-19 doğrulanmalı). Tutar alanları ve taksitler (\`invoices\`) yalnız \`yonetici\` ve \`onburo\` yanıtındadır; veli ve öğrenci yanıtında anahtar yoktur, taksit kendi bölümünde görünür (K-40). Kapsam listeyle aynıdır; kapsam dışı, olmayan ya da başka kurumun satışı 404. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`, \`veli\`, \`ogrenci\`.`,
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

  typed.post(
    '/api/v1/finance/package-sales/:saleId/set-used-hours',
    {
      preValidation: [...guarded(PACKAGE_SELL_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'setPackageSaleUsedHours',
        tags: ['finance-packages'],
        summary: 'Kullanılan saati elle gir',
        description: `Yoklama bağı (OG-116, OG-144) gelene kadar personel satışın o güne kadar kullanılan toplam saatini girer; ayrılıştaki iade bu saate dayanır (K-21, DOM-DIL-051, DOM-FIN-040). Azaltılabilir; gerekçe zorunludur ve yalnız denetim kaydına yazılır, eski değer arşivli saat hareketinde kalır. Alınan saati aşarsa 422 \`package_used_exceeds_purchased\`, derslerden yazılan saatin altına inerse 422 \`package_used_below_lessons\`, aynı değer 422 \`package_used_hours_unchanged\`, ayrılış hesabına girmiş satış 422 \`package_sale_closed\`. Olmayan ya da başka kurumun satışı 404, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: saleParams,
        body: setPackageUsedHoursSchema,
        response: { 200: saleResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await setPackageUsedHoursCommand(
        contextOf(request),
        request.params.saleId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return saleResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/course-offers',
    {
      preValidation: guarded(COURSE_OFFER_LIST_ROLES),
      schema: {
        operationId: 'listCourseOffers',
        tags: ['finance-packages'],
        summary: 'Kur yenileme ve üst kur tekliflerini listele',
        description: `Son kurunun geçerli kur sonu kararı onaylı kursiyerler, ada göre (IST-088; DOM-DIL-070, DOM-DIL-071). Karar \`geçti\` ise teklif zincirdeki sonraki kura ya da üst seviyeye, \`tekrar\` ve \`devamsızlıktan tamamlamadı\` ise aynı kura açılır; üst seviye ya da sonraki kur yoksa satır \`no_next_level\` olur ve teklif açılmaz. Onay bekleyen, reddedilmiş ya da hiç verilmemiş karar ve pasif kursiyer listede yoktur. \`options\` teklife uyan etkin paketlerin kurum tarifesinden indirimsiz fiyatıdır (DOM-DIL-050); tarife, paket ya da tarife kalemi yoksa \`problem\` nedeni söyler. Teklif paket satışıyla (\`POST /api/v1/finance/package-sales\`) açılır; indirim yalnız tarifede ilanlı türden seçilir (DOM-FIN-020). \`saleId\` karar onayından sonra teklif edilen kur ya da seviyede yapılan satıştır. Kararın gerekçesi, dayanağı ve öğretmen notu dönmez. \`q\` kursiyer adında arar, \`outcome\` süzer; \`studentId\` tek kursiyeri verir, olmayan ya da başka kurumun öğrencisi 404. Hiçbir şey yazılmaz. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`.`,
        querystring: courseOfferListQuery,
        response: { 200: courseOfferListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, outcome, studentId } = request.query
      const { items, total } = await listCourseOffersFor(contextOf(request), {
        page,
        pageSize,
        q,
        outcome,
        studentId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/students/:studentId/package-balance',
    {
      preValidation: guarded(PACKAGE_SALE_READ_ROLES),
      schema: {
        operationId: 'getStudentPackageBalance',
        tags: ['finance-packages'],
        summary: 'Öğrencinin paket saat bakiyesi',
        description: `Satılan, kullanılan, iade edilen, kalan ve süresi dolan saat; satış başına ve toplam (IST-114, DOM-DIL-051, DOM-FIN-058). Bakiye saklanmaz, saat hareketlerinden hesaplanır; süresi dolan saat kalan saatin içindedir, silinmez. Ücret payları (\`amounts\`: net ücret, tanınan gelir, iade edilen saat payı, ertelenmiş gelir) yalnız \`yonetici\` ve \`onburo\` yanıtındadır; veli ve öğrenci yanıtında alan yoktur. Kullanılan saat yoklamaya bağlanana kadar elle girilir (K-21); hiç girilmediyse \`usedHoursRecorded: false\`. Kapsam \`/finance/students/:id/balance\` ile aynıdır: veli bağlı çocuğunu ve ödeyicisi olduğu öğrenciyi, öğrenci kendisini okur; kapsam dışı, olmayan ya da başka kurumun öğrencisi 404. ${LANGUAGE_ONLY} Roller: \`yonetici\`, \`onburo\`, \`veli\`, \`ogrenci\`.`,
        params: studentPackageParams,
        response: { 200: packageBalanceResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await studentPackageBalanceFor(contextOf(request), request.params.studentId),
    }),
  )

  // Dosya kişisel veri taşır: taze oturum ve kullanıcı başına 10/dk yalnız CSV isteğinde.
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }
  typed.get(
    '/api/v1/finance/package-report',
    {
      config: {
        rateLimit: {
          max: (request) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (request) =>
            wantsCsv(request)
              ? `package-report-csv:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: [...guarded(['yonetici']), freshForCsv],
      schema: {
        operationId: 'getPackageHourReport',
        tags: ['finance-packages'],
        summary: 'Paket saat raporu',
        description: `Dönemde satılan, kullanılan, iade edilen ve süresi dolan saat ile gelir tanıma dökümü (IST-114, DOM-FIN-058). Satış başına satır, ay dökümü ve toplam döner; eşitlik: açılış kalan + satılan − kullanılan − iade = kapanış kalan, saatte ve kuruşta. Toplam ve ay dökümü bütün satırlardandır, sayfaya bağlı değildir; dönem bugüne kadar alınırsa kapanış öğrenci bakiyelerinin toplamına eşittir. Gelir, net ücretin kullanılan saat payıdır (birikimli, aşağı yuvarlanır); süresi dolan saat gelir sayılmaz, ertelenmiş gelirde kalır (DOM-DIL-051, H-19). İade payı net ücretin saat oranıdır, ödenen iade ve kesinti ayrılış kaydındadır. Elle girilen kullanılan saatin (K-21) değişikliği giriş gününe fark olarak düşer; geçmiş dönem değişmez. Hesap kodu ve KDV dökümü yoktur (M-12 doğrulanmalı). Satır: dönemde hareketi ya da dönem sonunda kalanı olan satış, yeni satış önce. Başlangıç bitişten sonra 422 \`export_period_invalid\`, bir yıldan uzun 422 \`export_period_too_long\`. \`Accept: text/csv\` ile sayfa yok sayılır, bütün satırlar CSV iner: \`;\` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı; taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, denetime yazılır (\`finance.package_report_export\`). ${LANGUAGE_ONLY} Rol: \`yonetici\`.`,
        querystring: packageReportQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur, istemci tipi tek kalsın.
        response: { 200: packageReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { from, to, page, pageSize } = request.query
      const ctx = contextOf(request)
      if (wantsCsv(request)) {
        const csv = await packageReportCsvFor(ctx, { from, to })
        // Metin gövdesi JSON yanıt şemasından geçmez; tip yalnız JSON yanıtı tanır.
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="package-report-${from}-${to}.csv"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      return packageReportFor(ctx, { from, to, page, pageSize })
    },
  )
}
