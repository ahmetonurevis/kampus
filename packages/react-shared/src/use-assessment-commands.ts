import type { KampusClient } from '@kampus/api-client/client.ts'
import { toApiError, type ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'
import { ASSESSMENT_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { isFieldFailure } from './assessment-feedback.ts'
import { collectionKeyPrefix } from './collections.ts'
import type { CommandHeaders, CommandMessages } from './commands.ts'
import { useNotifyError, type NotifyError } from './kampus-context.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiMutation } from './use-api-mutation.ts'

/**
 * Optik değerlendirme ve otomatik etüt komutları (`POST /api/v1/assessment/<komut>`). Komutlar
 * `useApiCommand` kalıbıdır: `Idempotency-Key` her kullanıcı eylemine bir kez üretilir ve ağ/5xx
 * sonrası aynı gövdeyle yeniden denemede aynı kalır; çift tıklama tek istek atar; başarıda ve 409'da
 * komutun koleksiyonları tazelenir. Önizlemeler hiçbir şey yazmaz ve anahtar taşımaz.
 */

type JsonBody<TName extends keyof operations> = operations[TName] extends {
  requestBody: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type EvaluationPreview = components['schemas']['EvaluationPreview']
export type TutoringPlanPreview = components['schemas']['TutoringPlanPreview']
export type PreviewEvaluationInput = JsonBody<'previewAssessmentEvaluation'>
export type PreviewPlanInput = JsonBody<'previewAssessmentPlan'>
export type EvaluateInput = JsonBody<'runAssessmentEvaluate'>
export type ConfirmPlanInput = JsonBody<'runAssessmentPlan'>
export type OpticalProfileBody = JsonBody<'runAssessmentProfile'>
export type AvailabilitySlotBody = JsonBody<'runAssessmentSlot'>

/** Önizlemedeki değerlendirme güncel sonuçtan farklı (409 `evaluation_stale`). */
export const EVALUATION_STALE_CODE = 'evaluation_stale'
/** Önizlemedeki plan sunucunun yeniden hesapladığı plandan farklı (409 `tutoring_plan_stale`). */
export const TUTORING_PLAN_STALE_CODE = 'tutoring_plan_stale'
/** Plan onayında oluşturulacak yeni etüt kalmadı (422; ikinci eşzamanlı onay veya zaten planlı). */
export const NOTHING_TO_CREATE_CODE = 'tutoring_nothing_to_create'

export const ASSESSMENT_MESSAGES = {
  [EVALUATION_STALE_CODE]: 'Veri değişti. Dosyayı yeniden önizleyip tekrar onaylayın.',
  [TUTORING_PLAN_STALE_CODE]:
    'Etüt planı değişmiş. Planı yeniden önizleyip farkı kontrol ederek tekrar onaylayın.',
  [NOTHING_TO_CREATE_CODE]:
    'Planlanacak yeni etüt kalmadı. Etütler zaten oluşturulmuş olabilir; etüt listesini kontrol edin.',
  version_conflict:
    'Kayıt başka biri tarafından değiştirildi. Güncel bilgiler yüklendi; yeniden deneyin.',
} as const satisfies CommandMessages

export type PreviewOutcome<TData> =
  { status: 'success'; data: TData } | { status: 'failed'; error: ApiError }

/**
 * Yazmayan önizleme çağrısı: hata fırlatmaz, sonucu döner. 413/422 alan hatasıdır (ekran forma
 * yazar); diğer hatalar toast olur.
 */
async function runPreview<TVariables, TEnvelope extends { data: unknown }>(
  mutateAsync: (variables: TVariables) => Promise<TEnvelope>,
  notifyError: NotifyError | undefined,
  variables: TVariables,
): Promise<PreviewOutcome<TEnvelope['data']>> {
  try {
    const envelope = await mutateAsync(variables)
    return { status: 'success', data: envelope.data }
  } catch (cause) {
    const error = toApiError(cause)
    if (error.status !== 401 && !isFieldFailure(error)) notifyError?.(error.message, error)
    return { status: 'failed', error }
  }
}

/** Okuyucu dosyasını önizler (`POST /assessment/evaluate/preview`); `digest` onayda gönderilir. */
export function usePreviewEvaluation() {
  const notifyError = useNotifyError()
  const mutation = useApiMutation({
    request: (client, body: PreviewEvaluationInput) =>
      client.POST('/api/v1/assessment/evaluate/preview', { body }),
  })
  return {
    preview: (input: PreviewEvaluationInput): Promise<PreviewOutcome<EvaluationPreview>> =>
      runPreview(mutation.mutateAsync, notifyError, input),
    isPending: mutation.isPending,
  }
}

/** Etüt planını önizler (`POST /assessment/plan/preview`); `expectedPlan` onayda gönderilir. */
export function usePreviewTutoringPlan() {
  const notifyError = useNotifyError()
  const mutation = useApiMutation({
    request: (client, body: PreviewPlanInput) =>
      client.POST('/api/v1/assessment/plan/preview', { body }),
  })
  return {
    preview: (input: PreviewPlanInput): Promise<PreviewOutcome<TutoringPlanPreview>> =>
      runPreview(mutation.mutateAsync, notifyError, input),
    isPending: mutation.isPending,
  }
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}

function collectionsOf(command: keyof typeof ASSESSMENT_COMMANDS) {
  return ASSESSMENT_COMMANDS[command].collections.map((name) => collectionKeyPrefix(name))
}

/** Konusu olmayan uçlar `If-Match` taşımaz (sunucu 400 `if_match_not_supported` döner). */
function keyOnly(headers: CommandHeaders) {
  return { 'idempotency-key': headers['idempotency-key'] }
}

export function evaluateOpticalRequest(
  client: KampusClient,
  body: EvaluateInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/assessment/evaluate', { params: { header: keyOnly(headers) }, body })
}

/**
 * Önizlenen sonuçları kaydeder. `expectedDigest` önizlemedeki özettir; sonuç değiştiyse hiçbir şey
 * yazılmaz (409 `evaluation_stale`). Aynı dosya aynı anahtarla yeniden gönderilirse sonuç çoğalmaz.
 */
export function useEvaluateOptical(options: CommandOptions = {}) {
  return useApiCommand({
    request: evaluateOpticalRequest,
    invalidates: collectionsOf('evaluate'),
    messages: ASSESSMENT_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

export interface SaveOpticalProfileInput {
  /** Verilirse mevcut profil güncellenir (profilin sınavı değişmez); yoksa oluşturulur. */
  recordId?: string | undefined
  /** Güncellemede profilin okunan sürümü (`If-Match`); oluşturmada gönderilmez. */
  version?: number | null | undefined
  body: OpticalProfileBody
}

export function saveOpticalProfileRequest(
  client: KampusClient,
  { recordId, body }: SaveOpticalProfileInput,
  headers: CommandHeaders,
) {
  if (recordId === undefined)
    return client.POST('/api/v1/assessment/profile', { params: { header: keyOnly(headers) }, body })
  return client.POST('/api/v1/assessment/profile/{recordId}', {
    params: { path: { recordId }, header: headers },
    body,
  })
}

/** Optik profil ve cevap anahtarını oluşturur veya günceller (yalnız yönetici; sunucu zorlar). */
export function useSaveOpticalProfile(options: CommandOptions = {}) {
  return useApiCommand({
    request: saveOpticalProfileRequest,
    version: (input: SaveOpticalProfileInput) =>
      input.recordId === undefined ? null : input.version,
    invalidates: collectionsOf('profile'),
    messages: ASSESSMENT_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

export function confirmTutoringPlanRequest(
  client: KampusClient,
  body: ConfirmPlanInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/assessment/plan', { params: { header: keyOnly(headers) }, body })
}

/**
 * Etüt planını onaylar. Sunucu planı güncel veriyle yeniden hesaplar; `expectedPlan` farklıysa
 * hiçbir şey yazılmaz (409 `tutoring_plan_stale`, `issues` farkı taşır). Çift tıklama ve aynı
 * anahtarla yeniden deneme etütleri çoğaltmaz.
 */
export function useConfirmTutoringPlan(options: CommandOptions = {}) {
  return useApiCommand({
    request: confirmTutoringPlanRequest,
    invalidates: collectionsOf('plan'),
    messages: ASSESSMENT_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

export function addAvailabilitySlotRequest(
  client: KampusClient,
  body: AvailabilitySlotBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/assessment/slot', { params: { header: keyOnly(headers) }, body })
}

/** Öğretmen uygunluk saati ekler (öğretmen kendi saatini, yönetici herkesinkini; sunucu zorlar). */
export function useAddAvailabilitySlot(options: CommandOptions = {}) {
  return useApiCommand({
    request: addAvailabilitySlotRequest,
    invalidates: collectionsOf('slot'),
    messages: ASSESSMENT_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

export interface RemoveAvailabilitySlotInput {
  slotId: string
  /** Uygunluk kaydının okunan sürümü (`If-Match`); yoksa başlık gönderilmez. */
  version?: number | null | undefined
}

export function removeAvailabilitySlotRequest(
  client: KampusClient,
  { slotId }: RemoveAvailabilitySlotInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/assessment/slot-remove/{recordId}', {
    params: { path: { recordId: slotId }, header: headers },
    body: {},
  })
}

/** Uygunluk saatini kaldırır; saati kaldırmak mevcut etüdü iptal etmez. */
export function useRemoveAvailabilitySlot(options: CommandOptions = {}) {
  return useApiCommand({
    request: removeAvailabilitySlotRequest,
    version: (input: RemoveAvailabilitySlotInput) => input.version,
    invalidates: collectionsOf('slot-remove'),
    messages: ASSESSMENT_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
