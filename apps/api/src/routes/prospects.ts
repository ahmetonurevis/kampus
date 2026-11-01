import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import {
  addProspectNoteSchema,
  changeProspectStageSchema,
  createProspectSchema,
  scheduleMeetingSchema,
  scheduleTrialLessonSchema,
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
  scheduleProspectMeetingCommand,
  scheduleTrialLessonCommand,
} from '../services/prospects.ts'
import { sendCommand } from './command-support.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import { enrollProspectBodySchema, prospectParamsSchema } from './prospects.schemas.ts'

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
 * §1 alan komutu; yeni kaynak doğduğu için 201). Yetki core `requireAuthorized(…,
 * 'prospect.enroll', …)` ile serviste ayrıca denetlenir (DOM-KAY-035).
 */

/**
 * Core komut tablosunun tek modülüne ek olarak istenen modüller (DOM-YTK-040: modül kapanınca
 * ilgili uçlar reddeder). Kesin kayıt taksit ve sözleşme, yani finans kaydı yazar: `finance`
 * kapalıysa `crm` açık olsa da 403 `module_disabled`, hiçbir kayıt yazılmaz.
 */
const EXTRA_MODULES: Partial<Record<WriteAction, readonly string[]>> = {
  'prospect.enroll': ['finance'],
}

const response = { 200: commandResponseSchema, ...commandErrors }
const created = { 201: commandResponseSchema, ...commandErrors }
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
      ...(action === 'prospect.trial' ? [requireLanguageSchool()] : []),
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
        description: `Açık aşamalar arasında yalnız ileri gidilir, aşama atlanabilir (core \`changeProspectStage\`, DOM-KAY-005, DOM-KAY-030). Geri dönüş 422 \`prospect_stage_backward\`; \`Görüşme planlandı\` yalnız planlamayla (422 \`prospect_meeting_required\`), \`Kayıt oldu\` yalnız kesin kayıtla girilir (422 \`prospect_enroll_required\`). \`Vazgeçti\` nedenle girilir (422 \`prospect_lost_reason_required\`) ve ileri tarihli görüşmeyi ve deneme dersini kaldırır. Vazgeçen aday yalnız \`İletişime geçildi\` ile yeniden açılır ve tekillik denetiminden geçer (409 \`prospect_duplicate\`, \`prospect_contact_shared\`); iletişimi paylaşan açık aday varsa \`siblingOfId\` ile kardeş seçilir (DOM-KAY-031, 422 \`sibling_not_found\`). Aynı aşama 409 \`prospect_stage_unchanged\`, kayıtlı aday 409 \`prospect_enrolled\`. ${ifMatchNote} Roller: ${rolesOf('prospect.stage')}.`,
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
    '/api/v1/prospects/:prospectId/enroll',
    {
      preValidation: guard('prospect.enroll', 'required'),
      schema: {
        operationId: 'enrollProspect',
        tags: ['prospects'],
        summary: 'Adayı kesin kayda al',
        description: `Açık aşamadaki adayı kesin kayda alır: öğrenci, veli, taksit planı ve sözleşme oluşturulur, aday \`Kayıt oldu\` olur; hepsi tek işlemde yazılır, hata olursa hiçbir kayıt değişmez (core \`enrollProspect\`, DOM-KAY-001, DOM-KAY-011, DOM-KAY-035). Yetki core \`prospect.enroll\` işlemden önce ayrıca denetlenir. Gövde: \`classId\`, \`totalCents\` (eğitim bedeli, kuruş, tamsayı, 10.000–100.000.000), \`count\` (1–12 taksit), \`startDate\` (ilk vade, \`YYYY-MM-DD\`); sayısal alanlar metin olarak gelirse, aday kimliği gövdede olursa veya bilinmeyen alan varsa 400 \`validation_failed\`. Tutar şimdilik tam lira olmalıdır: 100'ün katı olmayan \`totalCents\` 422 \`amount_not_whole_lira\` (\`issues\` yolu \`totalCents\`). Olmayan veya başka kurumun aday ya da sınıfı 404; dolu sınıf 422 \`class_capacity_full\`, geçersiz ilk vade 422 \`invalid_payment_date\`. Kayıtlı aday 409 \`prospect_already_enrolled\`, vazgeçmiş veya tanınmayan aşamadaki aday 409 \`prospect_closed\` (önce \`İletişime geçildi\` ile yeniden açılır). İşlem kurum kilidi altındadır; aynı adayı eşzamanlı kayda alan iki istekten yalnız biri yazılır, öteki 409 alır. Aday telefonu, e-postası ve veli adı loglanmaz; denetim kaydına yalnız alan adları ve kimlikler yazılır. Modüller \`crm\` ve \`finance\` (taksit ve sözleşme yazılır); biri kapalıysa 403 \`module_disabled\`. \`Idempotency-Key\` zorunludur (mükerrer öğrenci ve taksit üretilmez). ${ifMatchNote} Başarı 201; \`entity\` yeni öğrencidir ve \`Location\` öğrenci kaydını gösterir. Roller: ${rolesOf('prospect.enroll')}.`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: prospectParamsSchema,
        body: enrollProspectBodySchema,
        response: created,
      },
    },
    async (request, reply) => {
      const body = sendCommand(
        reply,
        await enrollProspectCommand(
          contextOf(request),
          request.params.prospectId,
          request.body,
          options(request, 'required'),
        ),
      )
      const entity = body.data.entity
      if (entity) reply.header('location', location(entity.id, 'students'))
      return body
    },
  )
}
