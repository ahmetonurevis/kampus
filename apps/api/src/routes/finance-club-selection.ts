import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  CLUB_SELECTION_ENTRY_ROLES,
  CLUB_SELECTION_FAMILY_ROLES,
  CLUB_SELECTION_MANAGE_ROLES,
  clubSelectionConfirmSchema,
  clubSelectionPeriodCreateSchema,
  clubSelectionPeriodUpdateSchema,
  clubSelectionPreferenceSchema,
} from '@kampus/school-core/lib/finance-club-selection.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveClubSelectionPeriodCommand,
  confirmClubSelectionCommand,
  createClubSelectionPeriodCommand,
  drawClubSelectionCommand,
  getClubSelectionPeriodFor,
  getClubSelectionPreviewFor,
  listClubSelectionPeriodsFor,
  listMyClubSelectionsFor,
  setClubSelectionPreferenceCommand,
  updateClubSelectionPeriodCommand,
} from '../services/finance-club-selection.ts'
import { assertSchoolLifeModule } from '../services/finance-transport.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  clubSelectionArchivedResponse,
  clubSelectionListQuery,
  clubSelectionParams,
  clubSelectionPeriodListResponse,
  clubSelectionPeriodResponse,
  clubSelectionPreferenceResponse,
  clubSelectionPreviewResponse,
  myClubSelectionsResponse,
} from './finance-club-selection.schemas.ts'

/**
 * Kulüp tercihi ve kontenjanlı dağıtım uçları (docs/domain/finans.md DOM-FIN-150; ON-169; IST-099;
 * K-505…K-507). Modül `finance` ve okul yaşamıyla ortak `clubs` anahtarı. Dönem, kura ve onay
 * yönetici ve ön büroda; tercih yönetici ve ön büroda herkes adına, velide kendi çocuğu, öğrencide
 * kendisi için. Oluşturma, tercih, kura ve onay `Idempotency-Key`; düzenleme ve arşiv `If-Match`
 * ister. Onay üyelikleri mevcut kulüp üyeliği tablosuna yazar (DOM-FIN-142).
 */

const MANAGE =
  'Rol: `yonetici`, `onburo`; diğer roller 403. Modüller `finance` ve `clubs` (kapalıysa 403).'
const BASE = '/api/v1/finance/club-selection'
const PERIODS = `${BASE}/periods`
const PERIOD = `${PERIODS}/:periodId`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function versionOf(request: FastifyRequest) {
  const opts = options(request, 'optional')
  if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
  return { expectedVersion: opts.expectedVersion, idempotency: opts.idempotency }
}

export function registerFinanceClubSelectionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const schoolLife: preValidationAsyncHookHandler = async (request) =>
    assertSchoolLifeModule(contextOf(request), 'clubs')
  const guarded = (roles: readonly Role[]) => [
    app.authenticate,
    app.requireModule('finance'),
    schoolLife,
    app.requireRole(roles),
  ]
  const manage = guarded(CLUB_SELECTION_MANAGE_ROLES)
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const tags = ['finance-club-selection']

  typed.get(
    `${BASE}/my`,
    {
      preValidation: guarded(CLUB_SELECTION_FAMILY_ROLES),
      schema: {
        operationId: 'listMyClubSelections',
        tags,
        summary: 'Kendi (çocuğumun) kulüp tercihleri',
        description:
          'Son 20 tercih döneminde velinin bağlı çocuklarının ya da öğrencinin kendisinin (hedef düzeyde ve kaydı etkin ya da tercihi olan) dönem bilgisi, kulüpler (gün, saat, öğretmen), girilen sıralı tercih ve onaylandıysa sonuç (atandığı kulüpler, yedek sırası) (K-505, K-507). Başka öğrencilerin tercihi ve kura sırası dönmez. Rol: `veli`, `ogrenci`; diğer roller 403. Modüller `finance` ve `clubs`.',
        response: { 200: myClubSelectionsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listMyClubSelectionsFor(contextOf(request)) }),
  )

  typed.get(
    PERIODS,
    {
      preValidation: manage,
      schema: {
        operationId: 'listClubSelectionPeriods',
        tags,
        summary: 'Kulüp tercih dönemleri',
        description: `Arşivlenmemiş dönemler, açılış günü yeni önce; aşama, kulüp ve tercih sayısı. ${MANAGE}`,
        querystring: clubSelectionListQuery,
        response: { 200: clubSelectionPeriodListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listClubSelectionPeriodsFor(contextOf(request), {
        page,
        pageSize,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    PERIODS,
    {
      preValidation: [...manage, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createClubSelectionPeriod',
        tags,
        summary: 'Tercih dönemi aç',
        description: `Ad, eğitim yılı ve dönem, açılış–kapanış günü (Europe/Istanbul, dahil; kapanış bugünden önce 422 \`club_selection_closes_past\`), kurumun kulüpleri (bulunamayan 422 \`club_selection_club_not_found\`), en çok tercih (kulüp sayısını aşamaz), atanacak kulüp sayısı (varsayılan 1, tercih sayısını aşamaz) ve isteğe bağlı sınıf düzeyleri (K-505). \`Idempotency-Key\` zorunlu. ${MANAGE}`,
        headers: createHeaders,
        body: clubSelectionPeriodCreateSchema,
        response: { 201: clubSelectionPeriodResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createClubSelectionPeriodCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = clubSelectionPeriodResponse.parse(sendBody(reply, result))
      reply.header('location', `${PERIODS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    PERIOD,
    {
      preValidation: manage,
      schema: {
        operationId: 'getClubSelectionPeriod',
        tags,
        summary: 'Tercih dönemi ayrıntısı',
        description: `Kulüpler (güncel üye ve boş yer), hedef düzeydeki etkin öğrenci sayısı, etkin tercihler (girenin rolü, dağıtıma girip girmediği), kura tohumu ve onaylandıysa kulüp başına atananlar ile yedek listesi (sonradan üye olan ve kaydı etkin olmayan işaretli; boş yer varsa ilk bekleyen önerilir, otomatik eklenmez; K-507). Başka kurumun ya da arşivli dönem 404. ${MANAGE}`,
        params: clubSelectionParams,
        response: { 200: clubSelectionPeriodResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getClubSelectionPeriodFor(contextOf(request), request.params.periodId),
    }),
  )

  typed.patch(
    PERIOD,
    {
      preValidation: [...manage, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateClubSelectionPeriod',
        tags,
        summary: 'Tercih dönemini düzenle',
        description: `Gönderilen alanlar değişir. Kura çekildiyse 422 \`club_selection_locked\`; tercih girilmişse yalnız ad ve tarihler (422 \`club_selection_has_preferences\`); kapanış açılıştan önce 422 \`club_selection_date_order\`, tarih değişirse kapanış bugünden önce olamaz; tercih sayısı kulüp sayısını (\`club_selection_choices_over_clubs\`), atanacak sayı tercih sayısını (\`club_selection_seats_over_choices\`) aşamaz; değişiklik yoksa 422 \`club_selection_unchanged\` (K-505). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: clubSelectionParams,
        body: clubSelectionPeriodUpdateSchema,
        response: { 200: clubSelectionPeriodResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateClubSelectionPeriodCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return clubSelectionPeriodResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    PERIOD,
    {
      preValidation: [...manage, requireIfMatch()],
      schema: {
        operationId: 'archiveClubSelectionPeriod',
        tags,
        summary: 'Tercih dönemini arşivle',
        description: `Dönem listeden kalkar; onaylı dönemde yazılan kulüp üyelikleri kalır (K-505). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: clubSelectionParams,
        response: { 200: clubSelectionArchivedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await archiveClubSelectionPeriodCommand(
        contextOf(request),
        request.params.periodId,
        expectedVersion,
        idempotency,
      )
      return clubSelectionArchivedResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${PERIOD}/preferences`,
    {
      preValidation: [...guarded(CLUB_SELECTION_ENTRY_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'setClubSelectionPreference',
        tags,
        summary: 'Kulüp tercihi gir',
        description:
          'Öğrencinin sıralı tercihini yazar; önceki tercih arşivlenir, boş liste geri çeker (tercih yoksa 422 `club_selection_no_preference`). Yalnız dönem açıkken (422 `club_selection_not_open`; kapanınca kimse değiştiremez). Öğrenci kurumun etkin öğrencisi (422 `club_selection_student_not_found`, `club_selection_student_inactive`) ve hedef düzeyde (422 `club_selection_grade_excluded`); tercih sayısı üst sınırı aşamaz (422 `club_selection_too_many_choices`), her tercih dönemin kulübü (422 `club_selection_club_not_in_period`) (K-505). `Idempotency-Key` zorunlu. Rol: `yonetici`, `onburo` herkes adına; `veli` yalnız bağlı çocuğu, `ogrenci` yalnız kendisi (kapsam dışı öğrenci 404); öğretmen 403. Modüller `finance` ve `clubs`.',
        headers: createHeaders,
        params: clubSelectionParams,
        body: clubSelectionPreferenceSchema,
        response: { 200: clubSelectionPreferenceResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await setClubSelectionPreferenceCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return clubSelectionPreferenceResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${PERIOD}/draw`,
    {
      preValidation: [...manage, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'drawClubSelection',
        tags,
        summary: 'Kulüp kurasını çek',
        description: `Kapanmış dönemde bir kez kura tohumu üretilir ve saklanır; yanıt dağıtım önizlemesidir. Dönem açıksa 422 \`club_selection_still_open\`, tercih yoksa 422 \`club_selection_no_preferences\`, ikinci kura 409 \`club_selection_already_drawn\`, onaylı dönem 409 \`club_selection_already_confirmed\` (K-506). \`Idempotency-Key\` zorunlu. ${MANAGE}`,
        headers: createHeaders,
        params: clubSelectionParams,
        response: { 200: clubSelectionPreviewResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await drawClubSelectionCommand(
        contextOf(request),
        request.params.periodId,
        options(request, 'required').idempotency,
      )
      return clubSelectionPreviewResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${PERIOD}/allocation`,
    {
      preValidation: manage,
      schema: {
        operationId: 'getClubSelectionAllocation',
        tags,
        summary: 'Dağıtım önizlemesi',
        description: `Saklanan tohumla rastgele kura sırası ve tercih sırasına göre seri diktatörlük (çok kulüpte yılan sıralı turlar); kontenjan güncel üyelerle hesaplanır, üye olunan kulüp atlanır; atamalar, kulüp başına yedek listesi ve onayda gönderilecek özet (\`digest\`) (K-506). Kura çekilmediyse 422 \`club_selection_not_drawn\`, onaylı dönem 409 \`club_selection_already_confirmed\`. ${MANAGE}`,
        params: clubSelectionParams,
        response: { 200: clubSelectionPreviewResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getClubSelectionPreviewFor(contextOf(request), request.params.periodId),
    }),
  )

  typed.post(
    `${PERIOD}/confirm`,
    {
      preValidation: [...manage, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'confirmClubSelection',
        tags,
        summary: 'Dağıtımı onayla',
        description: `Dağıtım kurum kilidi altında aynı tohumla yeniden hesaplanır; özet önizlemeyle tutmazsa 409 \`club_selection_preview_stale\`. Atananların kulüp üyelikleri, sonuç ve yedek listesi tek işlemde yazılır; kontenjan aşılmaz. Kura çekilmediyse 422 \`club_selection_not_drawn\`, ikinci onay 409 \`club_selection_already_confirmed\` (K-507). \`Idempotency-Key\` zorunlu. ${MANAGE}`,
        headers: createHeaders,
        params: clubSelectionParams,
        body: clubSelectionConfirmSchema,
        response: { 200: clubSelectionPeriodResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await confirmClubSelectionCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return clubSelectionPeriodResponse.parse(sendBody(reply, result))
    },
  )
}
