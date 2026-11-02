import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Aday/CRM yazma komutları (`POST /prospects`, `PATCH /prospects/:id`,
// `POST /prospects/:id/{notes,meetings,trial-lessons,enroll}`; core `prospect.create`
// `prospect.stage` `prospect.stageRevert` `prospect.note` `prospect.meeting` `prospect.trial` `prospect.enroll`,
// docs/domain/kayit-ve-crm.md DOM-KAY-001…011, DOM-KAY-030…035, DOM-DIL-030). Okuma genel
// koleksiyon kancalarındadır (`prospects`).
// Hepsi `exclusive`: yollu `issues` (mükerrer aday `phone`, kardeş `siblingOfId`, görüşme çakışması
// `date`, veli onayı `guardianConsent`) yalnız form alanında görünür, toast çıkmaz; yolsuz hata
// tek toast olur. Aday ekleme `Idempotency-Key` taşır; var olan adayı değiştiren komutlar okunan
// sürümü `If-Match` olarak taşır, sürüm yoksa istek atılmaz (`requireIfMatch`). Kesin kayıt
// ikisini birden taşır: mükerrer öğrenci ve taksit üretilmez (DOM-KAY-011).

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateProspectBody = JsonBody<'createProspect'>
export type ChangeProspectStageBody = JsonBody<'changeProspectStage'>
export type RevertProspectStageBody = JsonBody<'revertProspectStage'>
export type AddProspectNoteBody = JsonBody<'addProspectNote'>
export type ScheduleProspectMeetingBody = JsonBody<'scheduleProspectMeeting'>
export type ScheduleTrialLessonBody = JsonBody<'scheduleTrialLesson'>
export type EnrollProspectBody = JsonBody<'enrollProspect'>

/** Var olan adayı değiştiren komut: okunan sürüm `If-Match` olarak zorunludur. */
interface ProspectCommandInput<TBody> {
  prospectId: string
  version: number
  body: TBody
}
export type ChangeProspectStageInput = ProspectCommandInput<ChangeProspectStageBody>
export type RevertProspectStageInput = ProspectCommandInput<RevertProspectStageBody>
export type AddProspectNoteInput = ProspectCommandInput<AddProspectNoteBody>
export type ScheduleProspectMeetingInput = ProspectCommandInput<ScheduleProspectMeetingBody>
export type ScheduleTrialLessonInput = ProspectCommandInput<ScheduleTrialLessonBody>
export type EnrollProspectInput = ProspectCommandInput<EnrollProspectBody>

/** Aday bu arada başka biri tarafından güncellendi (`If-Match` tutmadı): güncel kart yüklenir. */
export const PROSPECT_CHANGED_MESSAGE =
  'Aday kartı başka biri tarafından güncellendi. Güncel hâlini yükleyip yeniden deneyin.'

export const PROSPECT_MESSAGES = {
  version_conflict: PROSPECT_CHANGED_MESSAGE,
} as const satisfies CommandMessages

/**
 * Kesin kayıt `crm` yanında `finance` modülünü ister (taksit ve sözleşme yazar, DOM-YTK-040);
 * kapalıysa sunucunun genel modül iletisi yerine hangi modülün gerektiği söylenir. Yollu iş
 * kuralı hataları (`class_campus_mismatch` → `classId`) `exclusive` ile alana gider.
 */
export const ENROLL_MODULE_DISABLED_MESSAGE =
  'Kesin kayıt için aday (CRM) ve finans modüllerinin açık olması gerekir.'

export const ENROLL_PROSPECT_MESSAGES = {
  ...PROSPECT_MESSAGES,
  module_disabled: ENROLL_MODULE_DISABLED_MESSAGE,
} as const satisfies CommandMessages

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function createProspectRequest(
  client: KampusClient,
  body: CreateProspectBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/prospects', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function changeProspectStageRequest(
  client: KampusClient,
  { prospectId, body }: ChangeProspectStageInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/prospects/{prospectId}', {
    params: { path: { prospectId }, header: versioned(headers) },
    body,
  })
}

export function revertProspectStageRequest(
  client: KampusClient,
  { prospectId, body }: RevertProspectStageInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/prospects/{prospectId}/stage-revert', {
    params: { path: { prospectId }, header: versioned(headers) },
    body,
  })
}

export function addProspectNoteRequest(
  client: KampusClient,
  { prospectId, body }: AddProspectNoteInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/prospects/{prospectId}/notes', {
    params: { path: { prospectId }, header: versioned(headers) },
    body,
  })
}

export function scheduleProspectMeetingRequest(
  client: KampusClient,
  { prospectId, body }: ScheduleProspectMeetingInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/prospects/{prospectId}/meetings', {
    params: { path: { prospectId }, header: versioned(headers) },
    body,
  })
}

export function scheduleTrialLessonRequest(
  client: KampusClient,
  { prospectId, body }: ScheduleTrialLessonInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/prospects/{prospectId}/trial-lessons', {
    params: { path: { prospectId }, header: versioned(headers) },
    body,
  })
}

export function enrollProspectRequest(
  client: KampusClient,
  { prospectId, body }: EnrollProspectInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/prospects/{prospectId}/enroll', {
    params: { path: { prospectId }, header: versioned(headers) },
    body,
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}

/**
 * Başarıda ve 409'da geçersiz kılınan sorgular: aday listesi ve kartı (`prospects` koleksiyonu).
 * Genel Bakış her açılışta tazelenir (`staleTime: 0`); ayrıca düşürülmez.
 */
export const PROSPECT_INVALIDATES: readonly (readonly unknown[])[] = [
  collectionKeyPrefix('prospects'),
]
/**
 * Kesin kayıt adayı kapatır ve öğrenci, veli, taksit ile sözleşme doğurur: başarıda ve 409'da bu
 * koleksiyonların etkin kurum sorguları da tazelenir (öğrenci listesi, finans ekranları).
 */
export const ENROLL_PROSPECT_INVALIDATES: readonly (readonly unknown[])[] = [
  collectionKeyPrefix('prospects'),
  collectionKeyPrefix('students'),
  collectionKeyPrefix('parents'),
  collectionKeyPrefix('invoices'),
  collectionKeyPrefix('contracts'),
]
const versionOf = <TBody>(input: ProspectCommandInput<TBody>) => input.version
const success = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** Ön büro yeni aday açar (201); aday listesi tazelenir (DOM-KAY-009). */
export function useCreateProspect(options: CommandOptions = {}) {
  return useApiCommand({
    request: createProspectRequest,
    invalidates: PROSPECT_INVALIDATES,
    messages: PROSPECT_MESSAGES,
    exclusive: true,
    ...success(options),
  })
}

/** Adayın aşamasını değiştirir; vazgeçmede neden, yeniden açmada kardeş seçilir (DOM-KAY-030). */
export function useChangeProspectStage(options: CommandOptions = {}) {
  return useApiCommand({
    request: changeProspectStageRequest,
    version: versionOf<ChangeProspectStageBody>,
    invalidates: PROSPECT_INVALIDATES,
    messages: PROSPECT_MESSAGES,
    exclusive: true,
    ...success(options),
  })
}

/** Yönetici yanlışlıkla ileri alınan açık aşamayı gerekçeyle geri alır (DOM-KAY-030). */
export function useRevertProspectStage(options: CommandOptions = {}) {
  return useApiCommand({
    request: revertProspectStageRequest,
    version: versionOf<RevertProspectStageBody>,
    invalidates: PROSPECT_INVALIDATES,
    messages: PROSPECT_MESSAGES,
    exclusive: true,
    ...success(options),
  })
}

/** Aday kartına not ekler (201); yazar adı sunucuda oturumdan alınır (DOM-KAY-032). */
export function useAddProspectNote(options: CommandOptions = {}) {
  return useApiCommand({
    request: addProspectNoteRequest,
    version: versionOf<AddProspectNoteBody>,
    invalidates: PROSPECT_INVALIDATES,
    messages: PROSPECT_MESSAGES,
    exclusive: true,
    ...success(options),
  })
}

/** Tanışma görüşmesi planlar veya yeniden planlar (DOM-KAY-033). */
export function useScheduleProspectMeeting(options: CommandOptions = {}) {
  return useApiCommand({
    request: scheduleProspectMeetingRequest,
    version: versionOf<ScheduleProspectMeetingBody>,
    invalidates: PROSPECT_INVALIDATES,
    messages: PROSPECT_MESSAGES,
    exclusive: true,
    ...success(options),
  })
}

/** Dil okulunda deneme dersi planlar; okulda uç 404'tür (DOM-DIL-030, DOM-KAY-034). */
export function useScheduleTrialLesson(options: CommandOptions = {}) {
  return useApiCommand({
    request: scheduleTrialLessonRequest,
    version: versionOf<ScheduleTrialLessonBody>,
    invalidates: PROSPECT_INVALIDATES,
    messages: PROSPECT_MESSAGES,
    exclusive: true,
    ...success(options),
  })
}

/** Adayın telefonuyla eşleşen veliler; öneridir, birleştirmez (DOM-KAY-013). */
export function useGuardianMatches(prospectId: string) {
  return useApiQuery({
    key: ['prospects', prospectId, 'guardian-matches'],
    enabled: prospectId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/prospects/{prospectId}/guardian-matches', {
        params: { path: { prospectId } },
        signal,
      }),
  })
}

/**
 * Adayı kesin kayda alır (201; `entity` yeni öğrenci): okunan aday sürümü `If-Match`, her eylem
 * `Idempotency-Key` taşır (DOM-KAY-011, DOM-KAY-035). Modül kapalıysa toast
 * `ENROLL_MODULE_DISABLED_MESSAGE`; 400 ve 422 `issues` alanlara yazılır (`classId`, `identity`,
 * `guardian`, `discounts`). Tutar gövdede yoktur, yayımlanmış tarifeden hesaplanır (DOM-FIN-002).
 */
export function useEnrollProspect(options: CommandOptions = {}) {
  return useApiCommand({
    request: enrollProspectRequest,
    version: versionOf<EnrollProspectBody>,
    invalidates: ENROLL_PROSPECT_INVALIDATES,
    messages: ENROLL_PROSPECT_MESSAGES,
    exclusive: true,
    ...success(options),
  })
}
