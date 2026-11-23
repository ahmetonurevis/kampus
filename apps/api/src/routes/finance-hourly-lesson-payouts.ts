import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  HOURLY_PAYOUT_ROLES,
  HOURLY_PAYOUT_SELF_ROLES,
  hourlyPayoutQuerySchema,
} from '@kampus/school-core/lib/finance-hourly-lesson-payouts.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  hourlyLessonPayoutCsvFor,
  hourlyLessonPayoutDetailFor,
  hourlyLessonPayoutsFor,
  ownHourlyLessonPayoutFor,
} from '../services/finance-hourly-lesson-payouts.ts'
import { commandErrors } from './commands.schemas.ts'
import {
  hourlyPayoutDetailParams,
  hourlyPayoutDetailResponse,
  hourlyPayoutParams,
  hourlyPayoutResponse,
  ownHourlyPayoutResponse,
} from './finance-hourly-lesson-payouts.schemas.ts'

/**
 * Saat ücretli öğretmen ders saati hakediş dökümü uçları (docs/domain/finans.md DOM-FIN-167;
 * ON-075; IST-087; K-556…K-558). Modül `finance`; iki kurum türünde de. Bütün öğretmenler yalnız
 * yöneticide (muhasebe rolü yok); personel `my-…` ucuyla yalnız kendi dökümünü görür. Döküm
 * saklanmaz, bordroya aktarılmaz. PDF verisi (`purpose=pdf`) ve CSV (`Accept: text/csv`) taze
 * oturum ister, kullanıcı başına 10/dk ve denetime düşer. Sıra: 401 → 403 modül → 403 rol → 403
 * taze oturum → 400 → işlem.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-558; muhasebe rolü yok). Modül `finance`.'
const SELF =
  'Rol: personel (`yonetici`, `ogretmen`, `onburo`), yalnız kendi dökümü; öğrenci ve veli 403. Modül `finance`.'
const URL = '/api/v1/finance/hourly-lesson-payouts'
const OWN = '/api/v1/finance/my-hourly-lesson-payouts'
const EXPORTS_PER_MINUTE = 10
const READS_PER_MINUTE = 300
const RULES =
  'Kaynak ders programıdır (iki kurum türünde de); ders durumu programdan ek ders önerisiyle aynı kuraldır: iptal, kurum tatili, öğretmenin kullanılmış izin ya da rapor günü, yedeğe devredilen ve henüz bitmemiş ders verilmemiş sayılır; yedek ders yedeğe, telafi dersi kendi kaydıyla verilmiş sayılır (DOM-FIN-165, K-550). Dil okulunda ayrıca açılmış grupların haftalık kalıbından oturum üretilir (plandan; grup iptal edildiyse iptal anından sonraki oturum iptal, öğretmenin aynı saatte programda dersi varsa oturum sayılmaz; K-557). Yalnız verilen ders ödenir: satır dersin gününde yürürlükteki ana ücretle fiyatlanır, ders saati ücreti × ders saati, saatlik ücret × dakika ÷ 60 (kuruşa yuvarlanır); o gün tanım yoksa ya da aylıksa tutar boş ve uyarılı (K-556). Kapsam: ayda dersi olan, ayla kesişen ana ücretlerinden biri saatlik ya da ders saati olan ya da hiç ana ücreti olmayan personel.'
const EXPORTS =
  'Her PDF verisi (`purpose=pdf`) ve CSV (`Accept: text/csv`; `;` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı, ders başına satır ve öğretmen toplamı) `finance.hourly_lesson_payout.export` denetimine düşer (yalnız alan adları), taze oturum ister (eskiyse 403 `reauthentication_required`), kullanıcı başına 10/dk.'

const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')
/** CSV ya da PDF verisi (sorgu ayrıştırılmadan önce ham sorgudan). */
const isExport = (request: FastifyRequest) =>
  wantsCsv(request) || (request.query as { purpose?: unknown } | undefined)?.purpose === 'pdf'

function sendCsv(reply: FastifyReply, file: { csv: string; filename: string }) {
  return reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${file.filename}"`)
    .serializer((payload: unknown) => String(payload))
    .send(`\uFEFF${file.csv}`)
}

export function registerFinanceHourlyLessonPayoutRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const freshForExport: preValidationAsyncHookHandler = async function (request, reply) {
    if (isExport(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const config = {
    rateLimit: {
      max: (request: FastifyRequest) => (isExport(request) ? EXPORTS_PER_MINUTE : READS_PER_MINUTE),
      timeWindow: '1 minute',
      hook: 'preHandler' as const,
      keyGenerator: (request: FastifyRequest) =>
        isExport(request)
          ? `hourly-lesson-payout-export:${request.auth?.userId ?? request.ip}`
          : request.ip,
    },
  }
  const manager = [...guarded(HOURLY_PAYOUT_ROLES), freshForExport]
  const self = [...guarded(HOURLY_PAYOUT_SELF_ROLES), freshForExport]
  const tags = ['finance-hourly-lesson-payouts']

  typed.get(
    `${URL}/:month`,
    {
      config,
      preValidation: manager,
      schema: {
        operationId: 'getHourlyLessonPayouts',
        tags,
        summary: 'Ayın ders saati hakediş dökümü',
        description: `Saat ücretli öğretmenlerin ay dökümü (DOM-FIN-167, IST-087): öğretmen başına verilen ders ve saat, iptal, telafi, yedek ve yedeğe devredilen ders sayıları, ücret tanımı kırılımı ve tutar; kurum toplamı. ${RULES} Ekran okuması \`finance.hourly_lesson_payout.read\` denetimine düşer (tutar ve izin günü taşır). ${EXPORTS} Döküm bordroya aktarılmaz (K-558). ${MANAGER}`,
        params: hourlyPayoutParams,
        querystring: hourlyPayoutQuerySchema,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur.
        response: { 200: hourlyPayoutResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      if (wantsCsv(request))
        return sendCsv(reply, await hourlyLessonPayoutCsvFor(ctx, request.params.month, null))
      const { data } = await hourlyLessonPayoutsFor(
        ctx,
        request.params.month,
        request.query.purpose,
      )
      return { data }
    },
  )

  typed.get(
    `${URL}/:month/teachers/:membershipId`,
    {
      config,
      preValidation: manager,
      schema: {
        operationId: 'getHourlyLessonPayoutDetail',
        tags,
        summary: 'Öğretmenin gün gün ders saati hakediş dökümü',
        description: `Öğretmenin ay dökümü: gün gün her ders (sınıf ya da grup, ders, dakika, ders saati, durum, tür, telafi bağı, tatil adı, yoklama işareti), birim ücret ve tutar. ${RULES} Dökümde olmayan (aylık ücretli, ayda dersi yok) ya da başka kurumun üyeliği 404. Ekran okuması \`finance.hourly_lesson_payout.read\` denetimine düşer. ${EXPORTS} ${MANAGER}`,
        params: hourlyPayoutDetailParams,
        querystring: hourlyPayoutQuerySchema,
        response: { 200: hourlyPayoutDetailResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { month, membershipId } = request.params
      if (wantsCsv(request))
        return sendCsv(reply, await hourlyLessonPayoutCsvFor(ctx, month, { membershipId }))
      return {
        data: await hourlyLessonPayoutDetailFor(ctx, month, membershipId, request.query.purpose),
      }
    },
  )

  typed.get(
    `${OWN}/:month`,
    {
      config,
      preValidation: self,
      schema: {
        operationId: 'getOwnHourlyLessonPayout',
        tags,
        summary: 'Ders saati hakediş dökümüm',
        description: `Oturumdaki personelin ay dökümü (self-servis, DOM-FIN-166): yönetici dökümüyle aynı içerik. İstekte personel kimliği yoktur. Dökümü yoksa (aylık ücretli ya da ayda dersi yok) \`payout: null\`; PDF ve CSV istenirse 404. ${RULES} Ekran okuması denetime düşmez. ${EXPORTS} ${SELF}`,
        params: hourlyPayoutParams,
        querystring: hourlyPayoutQuerySchema,
        response: { 200: ownHourlyPayoutResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      if (wantsCsv(request))
        return sendCsv(
          reply,
          await hourlyLessonPayoutCsvFor(ctx, request.params.month, { own: true }),
        )
      return {
        data: await ownHourlyLessonPayoutFor(ctx, request.params.month, request.query.purpose),
      }
    },
  )
}
