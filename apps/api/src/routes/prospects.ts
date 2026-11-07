import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import { enrollProspectSchema, PARENT_MATCH_KINDS } from '@kampus/school-core/lib/enrollment.ts'
import {
  addProspectNoteSchema,
  changeProspectStageSchema,
  createProspectSchema,
  scheduleMeetingSchema,
  recordTrialResultSchema,
  revertProspectStageSchema,
  scheduleTrialLessonSchema,
  setMarketingConsentSchema,
  updateProspectDetailsSchema,
} from '@kampus/school-core/lib/prospects.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { getInstitutionModules } from '../services/modules.ts'
import {
  addProspectNoteCommand,
  changeProspectStageCommand,
  createProspectCommand,
  enrollProspectCommand,
  guardianMatchesFor,
  prospectLossBreakdownFor,
  scheduleProspectMeetingCommand,
  recordTrialResultCommand,
  revertProspectStageCommand,
  scheduleTrialLessonCommand,
  setMarketingConsentCommand,
  updateProspectDetailsCommand,
  studentIdentityFor,
} from '../services/prospects.ts'
import { sendCommand } from './command-support.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import { dataResponse } from './common.schemas.ts'
import { prospectLossBreakdownSchema, prospectParamsSchema } from './prospects.schemas.ts'

/**
 * Aday/CRM yazma uçları (docs/domain/kayit-ve-crm.md DOM-KAY-001…011, DOM-KAY-030…035; deneme
 * dersi docs/domain/dil-okulu.md DOM-DIL-030). Okuma genel koleksiyon ucundadır
 * (`GET /collections/prospects`). Roller yalnız `yonetici` ve `onburo` (core `WRITE_ACTION_ROLES`),
 * modül `crm` (kesin kayıtta ayrıca `finance`). Sıra komut uçlarıyla aynıdır: 401 → 403 `module_disabled` → (deneme dersinde okulda
 * 404) → 403 `forbidden` → `If-Match` → 400 gövde → işlem (404, 409 sürüm, 422, 409).
 *
 * Aday oluşturma `Idempotency-Key` ister, `If-Match` kabul etmez. Var olan adayı değiştiren
 * komutlar (aşama, not, görüşme, deneme dersi, kesin kayıt) `If-Match` ister: aynı adayın notu
 * veya görüşmesi bayat görüntüyle sessizce üzerine yazılmaz.
 *
 * Kesin kayıt (`POST /prospects/:id/enroll`) öğrenci, veli, taksit ve sözleşme oluşturduğu için
 * hem `If-Match` hem `Idempotency-Key` ister ve 201 + öğrenciye `Location` döner (api-tasarimi.md
 * §1 alan komutu; yeni kaynak doğduğu için 201). Tutar yayımlanmış tarifeden hesaplanır
 * (`enrollProspectWithTariff`); yetki core `requireAuthorized(…, 'prospect.enroll', …)` ile
 * serviste ayrıca denetlenir (DOM-KAY-035).
 */

/**
 * Core komut tablosunun tek modülüne ek olarak istenen modüller (DOM-YTK-040: modül kapanınca
 * ilgili uçlar reddeder). Kesin kayıt taksit ve sözleşme, yani finans kaydı yazar: `finance`
 * kapalıysa `crm` açık olsa da 403 `module_disabled`, hiçbir kayıt yazılmaz.
 */
const EXTRA_MODULES: Partial<Record<WriteAction, readonly string[]>> = {
  'prospect.enroll': ['finance'],
}

const STAFF = ['yonetici', 'onburo'] as const
const response = { 200: commandResponseSchema, ...commandErrors }
const created = { 201: commandResponseSchema, ...commandErrors }
const enrollResponseSchema = z.object({
  data: commandResponseSchema.shape.data.extend({
    tariffCarriedOverFromYear: z
      .number()
      .int()
      .optional()
      .describe('Önceki yılın tarifesi uygulandıysa o yıl (DOM-FIN-002); aksi halde yoktur'),
  }),
})
const location = (id: string, collection: 'prospects' | 'students' = 'prospects') =>
  `/api/v1/collections/${collection}/${encodeURIComponent(id)}`

export function registerProspectRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /**
   * Deneme dersi yalnız dil okulunda vardır (DOM-DIL-030): okulda her rol için 404, rol
   * denetiminden önce (core `authorize` ile aynı sıra; yetkisiz rol 403 ile işlemin varlığını
   * öğrenmez, DOM-YTK-012).
   */
  function requireLanguageSchool(): preValidationAsyncHookHandler {
    return async function (request) {
      const ctx = contextOf(request)
      const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
      if (institution?.type !== 'language_school') throw new NotFoundError()
    }
  }

  /**
   * Kimlik → modül (core komut tablosu, sonra `EXTRA_MODULES`) → [kurum türü] → rol → `If-Match`
   * → ham gövde.
   */
  function guard(
    action: WriteAction,
    ifMatch: 'reject' | 'required',
  ): preValidationAsyncHookHandler[] {
    const module = OPERATION_COMMANDS[action].module
    return [
      app.authenticate,
      ...(module === null ? [] : [app.requireModule(module)]),
      ...(EXTRA_MODULES[action] ?? []).map((extra) => app.requireModule(extra)),
      ...(action === 'prospect.trial' || action === 'prospect.trialResult'
        ? [requireLanguageSchool()]
        : []),
      app.requireRole(WRITE_ACTION_ROLES[action]),
      ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
      captureInput(),
    ]
  }
  const rolesOf = (action: WriteAction) =>
    WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')
  const input = (request: FastifyRequest) => request.commandInput
  const ifMatchNote =
    '`If-Match` zorunludur (adayın sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Olmayan veya başka kurumun adayı sürüm ne olursa olsun 404.'

  typed.post(
    '/api/v1/prospects',
    {
      preValidation: guard('prospect.create', 'reject'),
      schema: {
        operationId: 'createProspect',
        tags: ['prospects'],
        summary: 'Aday ekle',
        description: `Ön büro yeni aday açar; aday \`Yeni aday\` aşamasında başlar, akademik veya finansal kayıt üretmez (core \`createProspect\`, DOM-KAY-001, DOM-KAY-009). Gövde katıdır: ad, telefon, isteğe bağlı e-posta, kampüs, ilgi, kaynak, aydınlatma metni sürümü, kanal bazında ticari ileti onayı; T.C. kimlik no, doğum tarihi, adres ve bilinmeyen alan 400 \`validation_failed\`. 18 yaş altı adayda veli adı zorunlu (422 \`prospect_guardian_required\`); dil okulunda yaş seçimi zorunlu (422 \`prospect_age_required\`). Pasif kampüs 422 \`branch_unavailable\`, olmayan referans öğrencisi 422 \`referrer_not_found\`. Aynı telefon veya e-posta ve aynı adla açık aday 409 \`prospect_duplicate\`, iletişimi paylaşan farklı adlı aday kardeş seçilmeden 409 \`prospect_contact_shared\` (DOM-KAY-002, DOM-KAY-031); ret eşleşen adayın kimliğini ve iletişim bilgisini taşımaz. Tekillik kurumun bütün adaylarına kurum kilidi altında bakar; aynı adayı eşzamanlı iki istekten yalnız biri açar. Telefon, e-posta ve veli adı loglanmaz. Modül \`crm\`. \`Idempotency-Key\` zorunludur. Başarı 201 ve \`Location\`. Roller: ${rolesOf('prospect.create')}.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: createProspectSchema,
        response: created,
      },
    },
    async (request, reply) => {
      const body = sendCommand(
        reply,
        await createProspectCommand(
          contextOf(request),
          input(request),
          options(request, 'required'),
        ),
      )
      const entity = body.data.entity
      if (entity) reply.header('location', location(entity.id))
      return body
    },
  )

  typed.patch(
    '/api/v1/prospects/:prospectId',
    {
      preValidation: guard('prospect.stage', 'required'),
      schema: {
        operationId: 'changeProspectStage',
        tags: ['prospects'],
        summary: 'Adayın aşamasını değiştir',
        description: `Açık aşamalar arasında yalnız ileri gidilir, aşama atlanabilir (core \`changeProspectStage\`, DOM-KAY-005, DOM-KAY-030). Geri dönüş 422 \`prospect_stage_backward\`; \`Görüşme planlandı\` yalnız planlamayla (422 \`prospect_meeting_required\`), \`Kayıt oldu\` yalnız kesin kayıtla girilir (422 \`prospect_enroll_required\`). \`Vazgeçti\` nedenle girilir (422 \`prospect_lost_reason_required\`) ve ileri tarihli görüşmeyi ve deneme dersini kaldırır. Vazgeçen aday yalnız \`İletişime geçildi\` ile yeniden açılır ve tekillik denetiminden geçer (409 \`prospect_duplicate\`, \`prospect_contact_shared\`); iletişimi paylaşan açık aday varsa \`siblingOfId\` ile kardeş seçilir (DOM-KAY-031, 422 \`sibling_not_found\`). İsteğe bağlı \`lostToInstitution\` tercih edilen kurumdur (en çok 120 karakter, yalnız \`Vazgeçti\`te, yeniden açılışta silinir, loglanmaz). Aynı aşama 409 \`prospect_stage_unchanged\`, kayıtlı aday 409 \`prospect_enrolled\`. ${ifMatchNote} Roller: ${rolesOf('prospect.stage')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: prospectParamsSchema,
        body: changeProspectStageSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await changeProspectStageCommand(
          contextOf(request),
          request.params.prospectId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/prospects/:prospectId/notes',
    {
      preValidation: guard('prospect.note', 'required'),
      schema: {
        operationId: 'addProspectNote',
        tags: ['prospects'],
        summary: 'Aday kartına not ekle',
        description: `Aday kartına not eklenir; not değiştirilmez ve silinmez (core \`addProspectNote\`, DOM-KAY-032). Notu yazan kişi ve an saklanır; gösterilen yazar adı oturum kullanıcısından alınır, gövdede \`authorName\` ve bilinmeyen alan 400 \`validation_failed\`. Kayıtlı veya vazgeçmiş adaya not 409 \`prospect_closed\`; aday başına en çok 200 not (409 \`prospect_note_limit\`). Not metni loglanmaz. ${ifMatchNote} Başarı 201 ve \`Location\` (aday kaydı). Roller: ${rolesOf('prospect.note')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: prospectParamsSchema,
        body: addProspectNoteSchema,
        response: created,
      },
    },
    async (request, reply) => {
      const body = sendCommand(
        reply,
        await addProspectNoteCommand(
          contextOf(request),
          request.params.prospectId,
          input(request),
          options(request, 'optional'),
        ),
      )
      const entity = body.data.entity
      if (entity) reply.header('location', location(entity.id))
      return body
    },
  )

  typed.post(
    '/api/v1/prospects/:prospectId/meetings',
    {
      preValidation: guard('prospect.meeting', 'required'),
      schema: {
        operationId: 'scheduleProspectMeeting',
        tags: ['prospects'],
        summary: 'Tanışma görüşmesi planla',
        description: `Adayın kampüsünde, gelecek bir anda, 15–120 dakikalık görüşme planlar; yeniden planlama öncekinin yerini alır (core \`scheduleProspectMeeting\`, DOM-KAY-006, DOM-KAY-033). Geçmiş an 422 \`meeting_in_past\`, başka kampüsün veya pasif öğretmen 422 \`meeting_teacher_unavailable\`. Aynı kampüste aynı oda veya öğretmen için örtüşen görüşme, öğretmenin dersi/randevusu/etüdü ve odanın kullanımı 409 \`meeting_conflict\`; adayın kendi deneme dersiyle örtüşme 409 \`prospect_schedule_conflict\`. Çakışma kurumun bütün adaylarına kurum kilidi altında bakar. \`Yeni aday\` ve \`İletişime geçildi\` aday \`Görüşme planlandı\` olur. Kapalı aday 409 \`prospect_closed\`. ${ifMatchNote} Roller: ${rolesOf('prospect.meeting')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: prospectParamsSchema,
        body: scheduleMeetingSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await scheduleProspectMeetingCommand(
          contextOf(request),
          request.params.prospectId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/prospects/:prospectId/enroll',
    {
      preValidation: guard('prospect.enroll', 'required'),
      schema: {
        operationId: 'enrollProspect',
        tags: ['prospects'],
        summary: 'Adayı kesin kayda al',
        description: `Açık aşamadaki adayı öğrenci, veli, taksit planı ve sözleşmeyle birlikte tek işlemde kayda alır; aday \`Kayıt oldu\` olur (core \`enrollProspectWithTariff\`, DOM-KAY-001, DOM-KAY-011, DOM-KAY-012, DOM-KAY-035). Tutar girilmez, eğitim yılının yayımlanmış tarifesinden hesaplanır (DOM-FIN-002). O yılın tarifesi yoksa ve ilan dönemi bittiyse (okulda eğitim yılının başladığı yılın mayıs sonu; dil okulu ve kursta ilan dönemi yoktur) önceki yılın yayımlı tarifesi uygulanır: sözleşme o tarifenin kimlik ve sürümünü taşır, eğitim yılı değişmez, yanıtta \`tariffCarriedOverFromYear\` döner. Dönem sürüyorsa ya da önceki yılın da tarifesi yoksa 422 \`tariff_not_published\`. Gövdedeki \`tariffId\` geçerli tarifeden farklıysa 409 \`tariff_changed\`. Düzeyin ücreti yoksa 422 \`tariff_tuition_missing\`. Dil okulunda \`lessonHours\` zorunlu (422 \`lesson_hours_required\`, DOM-FIN-006). İndirimler tarifedeki türlerden seçilir ve ilan ücretinden hesaplanır: ilansız 422 \`discount_not_in_tariff\`, toplam %50'yi aşarsa 422 \`discount_cap_exceeded\`, personel çocuğu istisnası yalnız yönetici (422 \`discount_approval_required\`), kardeş indirimi mevcut veli ve aktif kardeş ister, ücreti düşük çocuğa uygulanır: adayın ilan ücreti kardeşlerinkinden yüksekse aday ilk çocuktur (422 \`sibling_discount_ineligible\`) (DOM-FIN-020…022). Ek hizmet ayrı borç kalemidir; ilansız 422 \`extra_not_in_tariff\` (DOM-FIN-003). Kimlik ayrı tabloda tutulur, yanıtta ve genel okumada yer almaz; aktif öğrencide kayıtlı kimlik 409 \`student_identity_duplicate\`, pasif kaydın kimliği yeniden kullanılır. Veli zorunlu (422 \`guardian_required\`); 18 yaş doğum tarihinden, İstanbul gününe göre hesaplanır. Dil okulunda 18 yaş üstü kursiyerde \`guardian: null\` kursiyeri ödeyici yapar, veli verilirse 422 \`guardian_not_applicable\`; adayın yaş grubu seçimi doğum tarihiyle uyuşmazsa 422 \`birth_date_minor_mismatch\` (DOM-KAY-012). Okulda veli her yaşta zorunludur; kursta 18 yaş ve üstü kursiyer kendi ödeyicisidir. Yetişkin kursiyerin ücretini başka biri ödüyorsa isteğe bağlı \`payer\` (mevcut veli kaydı \`existingParentId\` ya da yeni kişi \`name\`, \`phone\`, \`relationship\`) velayetsiz ödeyici bağı olarak aynı işlemde yazılır (ON-124): ödeyici yalnız finansı görür; sözleşmenin tarafı ve onaylayanı ödeyicidir (\`payer: 'guardian'\`, öğrencinin veli kaydı ödeyicinin kaydı; kullanıcı kararı 2026-11-04); okulda ve 18 yaş altında 422 \`payer_not_applicable\`, kursiyerin kendi satırı ya da iletişim kısıtlı kişi 422 \`payer_not_eligible\`, olmayan kayıt 404 \`not_found\`. \`existingParentId\` mevcut veliye bağlar, olmayan veli 404. Taksit toplamı kuruşu kuruşuna net tutara eşittir (DOM-FIN-011). Olmayan veya başka kurumun adayı, olmayan veya pasif sınıf ya da kampüs 404 \`not_found\`; kayıtlı aday 409 \`prospect_already_enrolled\`, vazgeçmiş aday 409 \`prospect_closed\`; dolu sınıf 422 \`class_capacity_full\`. İşlem kurum kilidi altındadır; aynı adayı eşzamanlı kayda alan iki istekten yalnız biri yazılır, öteki 409 alır. Modüller \`crm\` ve \`finance\` (taksit ve sözleşme yazılır); biri kapalıysa 403 \`module_disabled\`. \`Idempotency-Key\` zorunludur: aynı anahtarla yinelenen istek ikinci borç açmaz, ilk yanıtı döner. ${ifMatchNote} Başarı 201 ve \`Location\` (öğrenci kaydı). Roller: ${rolesOf('prospect.enroll')}. Taksit sayısı yayımlı tarifenin ödeme koşullarından çıkar: ilanda olmayan sayı 422 \`payment_term_not_in_tariff\`, peşin indirimi peşin koşulu dışında 422 \`early_payment_requires_upfront\`; koşulsuz eski tarifede sınır yoktur (DOM-FIN-013).`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: prospectParamsSchema,
        body: enrollProspectSchema,
        response: { 201: enrollResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const body = sendCommand(
        reply,
        await enrollProspectCommand(
          contextOf(request),
          request.params.prospectId,
          input(request),
          options(request, 'required'),
        ),
        enrollResponseSchema,
      )
      const entity = body.data.entity
      if (entity) reply.header('location', location(entity.id, 'students'))
      return body
    },
  )

  typed.get(
    '/api/v1/prospects/loss-breakdown',
    {
      preValidation: [app.authenticate, app.requireModule('crm'), app.requireRole(STAFF)],
      schema: {
        operationId: 'getProspectLossBreakdown',
        tags: ['prospects'],
        summary: 'Kayıp aday kırılımı',
        description:
          'Vazgeçen adayların neden ve tercih ettiği kurum kırılımı (IST-117, DOM-KAY-005). Yalnız sayı ve kurum adı döner, aday kimliği dönmez; kurum adı serbest metindir, loglanmaz. Roller: `yonetici`, `onburo`.',
        querystring: z.strictObject({}),
        response: { 200: dataResponse(prospectLossBreakdownSchema), ...commandErrors },
      },
    },
    async (request) => ({ data: await prospectLossBreakdownFor(contextOf(request)) }),
  )

  typed.get(
    '/api/v1/prospects/:prospectId/guardian-matches',
    {
      preValidation: [app.authenticate, app.requireModule('crm'), app.requireRole(STAFF)],
      schema: {
        operationId: 'listGuardianMatches',
        tags: ['prospects'],
        summary: 'Adayla eşleşen velileri öner',
        description:
          'Adayın telefonuyla ya da kardeş adayının (`siblingOfId`) kesin kaydıyla eşleşen mevcut velileri önerir; kardeş eşleşmesi (`match: sibling`) listenin başındadır; yetişkin kursiyerin kendi satırı ve bir öğrencisinde velayetsiz ya da iletişim kısıtlı veli önerilmez (yetişkin kursiyerin yalnız ödeyici bağı engel değildir, ON-124) (seçilirse kesin kayıt 422 `parent_not_guardian`). Ön büro seçerse `existingParentId` ile bağlanır, yeni veli açılmaz; otomatik birleştirme yapılmaz (DOM-KAY-013). Yanıt telefon ve e-posta taşımaz. Roller: `yonetici`, `onburo`.',
        params: prospectParamsSchema,
        response: {
          200: dataResponse(
            z.array(
              z.object({
                parentId: z.string(),
                name: z.string(),
                studentCount: z.number().int(),
                match: z.enum(PARENT_MATCH_KINDS),
              }),
            ),
          ),
          ...commandErrors,
        },
      },
    },
    async (request) => ({
      data: await guardianMatchesFor(contextOf(request), request.params.prospectId),
    }),
  )

  typed.get(
    '/api/v1/students/:studentId/identity',
    {
      preValidation: [app.authenticate, app.requireModule('crm'), app.requireRole(STAFF)],
      schema: {
        operationId: 'getStudentIdentity',
        tags: ['prospects'],
        summary: 'Öğrencinin kimlik özeti',
        description:
          'Kimlik numarası yalnız maskeli döner (`*******1234`). Her başarılı okuma denetim kaydına `student_identity.read` olarak yazılır (yalnız alan adları; DOM-YTK-052). Kaydı olmayan veya başka kurumun öğrencisi 404. Modül `crm`. Roller: `yonetici`, `onburo`.',
        params: z.object({ studentId: z.string().min(1).max(200).describe('Öğrenci kimliği') }),
        response: {
          200: dataResponse(
            z.object({
              kind: z.string(),
              maskedNumber: z.string(),
              birthDate: z.string(),
              academicYear: z.number().int(),
            }),
          ),
          ...commandErrors,
        },
      },
    },
    async (request) => ({
      data: await studentIdentityFor(contextOf(request), request.params.studentId),
    }),
  )

  typed.post(
    '/api/v1/prospects/:prospectId/trial-lessons',
    {
      preValidation: guard('prospect.trial', 'required'),
      schema: {
        operationId: 'scheduleTrialLesson',
        tags: ['prospects'],
        summary: 'Deneme dersi planla',
        description: `Yalnız dil okulunda: aday kendi kampüsündeki açık grubun gelecek, iptal edilmemiş dersine deneme katılımcısı olarak yazılır (core \`scheduleTrialLesson\`, DOM-DIL-030, DOM-KAY-034). Okul kurumunda uç her rol için 404'tür. Gerçekleşmiş deneme 409 \`trial_already_used\`; olmayan ders 404; iptal edilmiş ders 422 \`lesson_cancelled\`, geçmiş ders 422 \`trial_in_past\`, başka kampüsün veya kapalı grubun dersi 422 \`trial_group_unavailable\`. Derse en çok iki deneme katılımcısı (409 \`trial_lesson_full\`), kursiyer + deneme grup kapasitesini ve 18'i aşamaz (409 \`trial_capacity_full\`). 18 yaş altı adayda veli adı/iletişimi (422 \`trial_guardian_contact_required\`) ve \`guardianConsent: true\` (422 \`trial_guardian_consent_required\`) zorunlu. Adayın görüşmesiyle örtüşme 409 \`prospect_schedule_conflict\`. ${ifMatchNote} Roller: ${rolesOf('prospect.trial')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: prospectParamsSchema,
        body: scheduleTrialLessonSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await scheduleTrialLessonCommand(
          contextOf(request),
          request.params.prospectId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/prospects/:prospectId/trial-result',
    {
      preValidation: guard('prospect.trialResult', 'required'),
      schema: {
        operationId: 'recordTrialResult',
        tags: ['prospects'],
        summary: 'Deneme dersi sonucunu yaz',
        description: `Yalnız dil okulunda: dersin grubunun öğretmeni, deneme dersinden sonra adayın seviye uygunluğunu (\`suitable\`, \`lower_level\`, \`upper_level\`) ve isteğe bağlı kısa notunu yazar (core \`recordTrialResult\`, DOM-DIL-031). Sonuç aday aşamasını değiştirmez; kesin kayıt yalnız kayıt işlemiyle olur. Okul kurumunda uç her rol için 404'tür. Öğretmenin kapsamında olmayan grubun adayı ve denemesi olmayan aday 404'tür (adayın varlığı sızmaz). Henüz yapılmamış ders 409 \`trial_not_held\`, iptal edilmiş ders 409 \`trial_lesson_cancelled\`, kapalı aday 409 \`prospect_closed\`. Sonuç yeniden yazılabilir, son yazılan geçerlidir. ${ifMatchNote} Roller: ${rolesOf('prospect.trialResult')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: prospectParamsSchema,
        body: recordTrialResultSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await recordTrialResultCommand(
          contextOf(request),
          request.params.prospectId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/prospects/:prospectId/stage-revert',
    {
      preValidation: guard('prospect.stageRevert', 'required'),
      schema: {
        operationId: 'revertProspectStage',
        tags: ['prospects'],
        summary: 'Aday aşamasını geri al',
        description: `Yanlışlıkla ileri alınan açık aşamayı bir önceki açık aşamaya geri alır (core \`revertProspectStage\`, DOM-KAY-030). Geri dönüş yasağının istisnasıdır: yalnız yönetici yapar ve gerekçe (en fazla 300 karakter) zorunludur; gerekçe aday kartında saklanır, denetim kaydına yalnız alan adı yazılır. Yalnız açık aşamalar arasında geriye gidilir: aynı veya ileri aşama 422 \`prospect_stage_not_backward\`, görüşmesi olmayan adayda \`Görüşme planlandı\` 422 \`prospect_meeting_required\`. Vazgeçen aday 409 \`prospect_closed\`, kayıtlı aday 409 \`prospect_enrolled\`. Görüşme öncesi aşamaya dönerken ileri tarihli görüşme ve deneme dersi kalkar. ${ifMatchNote} Roller: ${rolesOf('prospect.stageRevert')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: prospectParamsSchema,
        body: revertProspectStageSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await revertProspectStageCommand(
          contextOf(request),
          request.params.prospectId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/prospects/:prospectId/marketing-consent',
    {
      preValidation: guard('prospect.consent', 'required'),
      schema: {
        operationId: 'setProspectMarketingConsent',
        tags: ['prospects'],
        summary: 'Aday ticari ileti onayını ver ya da geri al',
        description: `Adayın kanal bazlı (\`sms\`, \`email\`, \`call\`) ticari elektronik ileti onayını verir ya da geri alır (core \`setProspectMarketingConsent\`, DOM-KAY-004). Geri alma anında etkilidir ve aday aşamasından bağımsızdır; her değişiklik kalıcı olay olarak geçmişe yazılır, denetim kaydına yalnız alan adı yazılır. Aynı karara ikinci istek 409 \`marketing_consent_unchanged\`; e-posta onayı için adayın e-postası yoksa 422 \`consent_contact_missing\`. Randevu teyidi gibi hizmet iletileri onaya bağlı değildir. ${ifMatchNote} Roller: ${rolesOf('prospect.consent')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: prospectParamsSchema,
        body: setMarketingConsentSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await setMarketingConsentCommand(
          contextOf(request),
          request.params.prospectId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.patch(
    '/api/v1/prospects/:prospectId/details',
    {
      preValidation: guard('prospect.update', 'required'),
      schema: {
        operationId: 'updateProspectDetails',
        tags: ['prospects'],
        summary: 'Aday bilgisini düzelt',
        description: `Adayın adını, telefonunu, e-postasını, ilgisini ve 18 yaş altında veli adını düzeltir (core \`updateProspectDetails\`, DOM-KAY-003, KVKK md. 11 düzeltme hakkı). Yalnız gönderilen alanlar değişir; hiçbiri farklı değilse 409 \`prospect_unchanged\`. Açık adayda ad, telefon ve e-posta mükerrer denetiminden yeniden geçer (409 \`prospect_duplicate\`, \`prospect_contact_shared\`; kardeş seçilmiş adayda ortak iletişim kabul edilir). Onayı verilmiş e-posta silinemez (422 \`consent_contact_in_use\`), yetişkin adayda veli adı 422 \`guardian_not_applicable\`. Aşamayı ve ticari ileti onayını değiştirmez; kayda yalnız düzeltilen alan adları yazılır, denetim kaydına iletişim yazılmaz. Kesin kayda dönmüş adayın düzeltmesi öğrenci ve veli kaydına yansımaz. ${ifMatchNote} Roller: ${rolesOf('prospect.update')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: prospectParamsSchema,
        body: updateProspectDetailsSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await updateProspectDetailsCommand(
          contextOf(request),
          request.params.prospectId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )
}
