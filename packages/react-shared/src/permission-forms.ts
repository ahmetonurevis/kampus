import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'
import { PERMISSION_FORM_TOPICS } from '@kampus/school-core/lib/permission-forms.ts'

import { runRequest } from './api-result.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { fetchAllPages, type ListPage } from './institution-lists.ts'

/**
 * İzin formu uçlarının (`/permission-forms`, IST-067; DOM-ILT-030, -031, -036…039) saf
 * yardımcıları: istek kurucular, Türkçe hata metinleri, hata → form alanı eşlemesi ve sorgu
 * anahtarı. Kancalar `use-permission-forms.ts`'tedir; burası React olmadan sahte istemciyle
 * sınanır. Her yazma `Idempotency-Key` taşır (`useApiCommand`); düzenleme, kapatma ve arşiv formun
 * okunan `version`'ını `If-Match` olarak gönderir, sürüm yoksa istek atılmaz (`requireIfMatch`).
 * Karar (`decisions`) yeni satırdır, sürümlü değildir. Son günün ve karar verebilmenin hakemi
 * sunucudur (`acceptingDecisions`); istemci saati karar vermez.
 */

export type PermissionForm = components['schemas']['PermissionForm']
export type PermissionFormListItem = components['schemas']['PermissionFormListItem']
export type PermissionFormDetail = components['schemas']['PermissionFormDetail']
export type PermissionFormStudent = components['schemas']['PermissionFormStudent']
export type PermissionFormDecision = components['schemas']['PermissionDecision']
export type PermissionDecisionResult = components['schemas']['PermissionDecisionResult']
export type PermissionCounts = components['schemas']['PermissionCounts']
export type PermissionFormListQuery = NonNullable<
  operations['listPermissionForms']['parameters']['query']
>
export type PermissionFormStatusFilter = NonNullable<PermissionFormListQuery['status']>
export type PermissionFormTopic = NonNullable<PermissionFormListQuery['topic']>
export type PermissionStatus = PermissionFormStudent['status']
export type PermissionDecisionValue = PermissionFormDecision['decision']

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreatePermissionFormBody = JsonBody<'createPermissionForm'>
export type UpdatePermissionFormBody = JsonBody<'updatePermissionForm'>
export type DecidePermissionBody = JsonBody<'decidePermissionForm'>

/** Sorgu anahtarının kökü (etkin kurum kendiliğinden eklenir); yazma sonrası bu önek tazelenir. */
export const PERMISSION_FORMS_KEY = ['permission-forms'] as const

export const PERMISSION_FORMS_INVALIDATES = [PERMISSION_FORMS_KEY] as const

/** Konu türü etiketleri (core tablosu). */
export const PERMISSION_TOPIC_LABELS: Readonly<Record<PermissionFormTopic, string>> =
  PERMISSION_FORM_TOPICS

export const PERMISSION_STATUS_LABELS = {
  pending: 'Bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
} as const satisfies Record<PermissionStatus, string>

export const PERMISSION_DECISION_LABELS = {
  approved: 'Onayladı',
  rejected: 'Reddetti',
} as const satisfies Record<PermissionDecisionValue, string>

export const PERMISSION_FORM_CHANGED_MESSAGE =
  'İzin formu bu arada değişti. Güncel hâli yüklendi; kontrol edip yeniden deneyin.'

const FORM_CLOSED_MESSAGE = 'Bu izin formu kapatılmış; artık karar verilemez ya da değiştirilemez.'

/** Yazma işlemine özgü kod metinleri (DOM-ILT-030, -036…038); listede olmayan kodda sunucunun mesajı. */
const COMMON_MESSAGES = {
  version_conflict: PERMISSION_FORM_CHANGED_MESSAGE,
  not_found: 'İzin formu bulunamadı. Liste güncellendi.',
  permission_form_closed: FORM_CLOSED_MESSAGE,
} as const satisfies CommandMessages

export const PERMISSION_FORM_MESSAGES = {
  ...COMMON_MESSAGES,
  permission_form_scope_denied:
    'Bu sınıf ya da öğrenciler için izin formu açamazsınız; yalnız rehber öğretmeni olduğunuz sınıflar.',
  permission_form_deadline_in_past: 'Son gün geçmişte olamaz. Bugün ya da ileri bir gün seçin.',
  permission_form_deadline_passed: 'Son günü geçmiş formun son günü değiştirilemez.',
  permission_form_no_students: 'Seçilen sınıflarda izin istenecek öğrenci yok.',
  permission_form_scope_locked:
    'Karar verilmiş formun hedefinden sınıf ya da öğrenci çıkarılamaz; yalnız eklenebilir.',
  permission_form_not_owner: 'Bu formu yalnız açan öğretmen ya da yönetici değiştirebilir.',
  permission_form_has_decisions:
    'Karar verilmiş form arşivlenemez; formu kapatın. Kararlar korunur.',
  record_inactive: 'Seçilen sınıf etkin değil. Etkin bir sınıf seçin.',
  student_inactive: 'Seçilen öğrencilerden birinin kaydı pasif. Listeden çıkarıp yeniden deneyin.',
} as const satisfies CommandMessages

export const PERMISSION_DECISION_MESSAGES = {
  ...COMMON_MESSAGES,
  not_found: 'İzin formu ya da öğrenci bulunamadı. Liste güncellendi.',
  permission_form_deadline_passed: 'Son gün geçtiği için karar verilemez ya da değiştirilemez.',
  permission_adult_self: 'Öğrenci 18 yaşını doldurduğu için izni kendisi verir.',
  permission_guardian_required:
    '18 yaşından küçük öğrenci için izni velayet sahibi veli verir; bu karar sizden alınmaz.',
  student_inactive: 'Kaydı pasif öğrenci için karar verilemez.',
} as const satisfies CommandMessages

/** Formun türü: alan eşlemesi yalnız o formda bulunan alana yapılır, gerisi toast'tur. */
export type PermissionFormKind = 'form' | 'decision'

/** Alana bağlanamayan, formun kendi içinde gösterilen hata yeri. */
export const PERMISSION_FORM_ROOT = 'root.server'

const FORM_FIELDS = {
  form: [
    'topic',
    'title',
    'description',
    'deadline',
    'classIds',
    'studentIds',
    PERMISSION_FORM_ROOT,
  ],
  decision: ['decision', 'note', PERMISSION_FORM_ROOT],
} as const satisfies Record<PermissionFormKind, readonly string[]>

/** Hata kodunun bağlandığı form alanı (mesaj yalnız o alanın altında görünür). */
export const PERMISSION_ERROR_FIELDS = {
  permission_form_deadline_in_past: 'deadline',
  permission_form_deadline_passed: 'deadline',
  permission_form_no_students: 'classIds',
  permission_form_scope_denied: 'classIds',
  record_inactive: 'classIds',
  student_inactive: 'studentIds',
  // Form artık bu işleme kapalı: açık formun içinde, formu kapatmadan gösterilir.
  permission_form_closed: PERMISSION_FORM_ROOT,
  permission_form_scope_locked: PERMISSION_FORM_ROOT,
  permission_form_has_decisions: PERMISSION_FORM_ROOT,
  permission_form_not_owner: PERMISSION_FORM_ROOT,
  permission_adult_self: PERMISSION_FORM_ROOT,
  permission_guardian_required: PERMISSION_FORM_ROOT,
} as const satisfies Readonly<Record<string, string>>

const isMappedCode = (code: string): code is keyof typeof PERMISSION_ERROR_FIELDS =>
  Object.hasOwn(PERMISSION_ERROR_FIELDS, code)

/**
 * Hatanın formdaki alanı: önce kod eşlemesi, yoksa sunucunun yollu ilk maddesi; alan o formda
 * yoksa `undefined` (toast). Yetki ve bulunamadı hataları alana bağlanmaz. Karar formunda
 * `deadline` ve `studentIds` yoktur: o kodlar formun içine (`root.server`) düşer.
 */
export function permissionErrorField(
  error: ApiError,
  form: PermissionFormKind,
): string | undefined {
  if (error.status === 401 || error.status === 404) return undefined
  const fields: readonly string[] = FORM_FIELDS[form]
  const mapped = isMappedCode(error.code) ? PERMISSION_ERROR_FIELDS[error.code] : undefined
  if (error.status === 403 && mapped !== PERMISSION_FORM_ROOT) return undefined
  const path = error.issues.find((issue) => issue.path.length > 0)?.path
  const field = mapped ?? (path ? String(path[0]) : undefined)
  if (field === undefined) return undefined
  if (fields.includes(field)) return field
  return form === 'decision' && mapped !== undefined ? PERMISSION_FORM_ROOT : undefined
}

/** 409 `version_conflict`: form kendi uyarısını gösterir (toast yok). */
export const isPermissionVersionConflict = (error: ApiError) =>
  error.status === 409 && error.code === 'version_conflict'

/**
 * Ekrandaki form eskidi (sürüm çakıştı, form yok oldu, kapandı, son gün geçti, karar alındı):
 * ilgili sorgular tazelenir.
 */
export const permissionStale = (error: ApiError) =>
  error.status === 404 ||
  (error.status === 409 &&
    (error.code === 'version_conflict' ||
      error.code === 'permission_form_closed' ||
      error.code === 'permission_form_has_decisions')) ||
  (error.status === 422 &&
    (error.code === 'permission_form_closed' || error.code === 'permission_form_deadline_passed'))

/** Var olan forma yazmanın hedefi; `version` okunan `version`'dır. */
export interface PermissionFormTarget {
  formId: string
  version: number
}

/** Boş süzgeç gönderilmez (sunucu boş değerde 400 verir); `status` varsayılanı `all`'dır. */
export function permissionFormListParams(query: PermissionFormListQuery): PermissionFormListQuery {
  const params: PermissionFormListQuery = {}
  if (query.page !== undefined) params.page = query.page
  if (query.pageSize !== undefined) params.pageSize = query.pageSize
  if (query.status && query.status !== 'all') params.status = query.status
  if (query.topic) params.topic = query.topic
  return params
}

/** Sorgu anahtarı: süzgeçler sabit sırayla (aynı süzgeç aynı önbellek). */
export function permissionFormListKey(query: PermissionFormListQuery): unknown[] {
  const params = permissionFormListParams(query)
  return [
    ...PERMISSION_FORMS_KEY,
    'list',
    Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))),
  ]
}

export const permissionFormItemKey = (formId: string): unknown[] => [
  ...PERMISSION_FORMS_KEY,
  'item',
  formId,
]

export function listPermissionFormsRequest(
  client: KampusClient,
  query: PermissionFormListQuery,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/permission-forms', {
    params: { query: permissionFormListParams(query) },
    ...(signal ? { signal } : {}),
  })
}

export async function fetchPermissionFormPage(
  client: KampusClient,
  query: PermissionFormListQuery,
  signal?: AbortSignal,
): Promise<ListPage<PermissionFormListItem>> {
  const body = await runRequest(() => listPermissionFormsRequest(client, query, signal))
  return { rows: body.data, ...body.meta }
}

/** Süzgece uyan bütün formlar (veli ve öğrencinin çocuk bazlı listesi; sayfa istemcide süzülür). */
export function fetchAllPermissionForms(
  client: KampusClient,
  query: Omit<PermissionFormListQuery, 'page' | 'pageSize'>,
  signal?: AbortSignal,
): Promise<PermissionFormListItem[]> {
  return fetchAllPages<PermissionFormListQuery, PermissionFormListItem>(
    (page, pageSignal) => fetchPermissionFormPage(client, page, pageSignal),
    query,
    signal,
  )
}

export function getPermissionFormRequest(
  client: KampusClient,
  formId: string,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/permission-forms/{formId}', {
    params: { path: { formId } },
    ...(signal ? { signal } : {}),
  })
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function createPermissionFormRequest(
  client: KampusClient,
  body: CreatePermissionFormBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/permission-forms', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function updatePermissionFormRequest(
  client: KampusClient,
  input: PermissionFormTarget & { body: UpdatePermissionFormBody },
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/permission-forms/{formId}', {
    params: { path: { formId: input.formId }, header: versioned(headers) },
    body: input.body,
  })
}

export function closePermissionFormRequest(
  client: KampusClient,
  input: PermissionFormTarget,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/permission-forms/{formId}/close', {
    params: { path: { formId: input.formId }, header: versioned(headers) },
  })
}

export function archivePermissionFormRequest(
  client: KampusClient,
  input: PermissionFormTarget,
  headers: CommandHeaders,
) {
  return client.DELETE('/api/v1/permission-forms/{formId}', {
    params: { path: { formId: input.formId }, header: versioned(headers) },
  })
}

export function decidePermissionRequest(
  client: KampusClient,
  input: { formId: string; body: DecidePermissionBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/permission-forms/{formId}/decisions', {
    params: {
      path: { formId: input.formId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: input.body,
  })
}

/** Karar gövdesi: boş not gönderilmez (not isteğe bağlıdır). */
export function decidePermissionBody(input: {
  studentId: string
  decision: PermissionDecisionValue
  note: string
}): DecidePermissionBody {
  const note = input.note.trim()
  return {
    studentId: input.studentId,
    decision: input.decision,
    ...(note ? { note } : {}),
  }
}

/**
 * Karar verilebilir mi: hakem sunucudur (`acceptingDecisions`; açık ve son gün geçmemiş). Verilemiyorsa
 * düğmenin yanında gösterilen gerekçe; verilebiliyorsa `null`. Elle kapatılmış form (`closedAt`)
 * ile son günü geçmiş form ayrı söylenir (DOM-ILT-038).
 */
export function decisionBlockedReason(
  form: Pick<PermissionForm, 'acceptingDecisions' | 'closedAt' | 'deadline'>,
): string | null {
  if (form.acceptingDecisions) return null
  return form.closedAt !== null
    ? 'Form kapatıldı; artık karar verilemez ya da değiştirilemez.'
    : 'Son gün geçti; artık karar verilemez ya da değiştirilemez.'
}

/**
 * Kararı olan formda hedeften çıkarma ve arşiv yasaktır (DOM-ILT-038). Hakem sunucunun
 * `hasDecisions` alanıdır: herhangi bir karar satırı (velayeti kalkan velinin geçerli sayılmayan
 * kararı da) kilitler; görünen onay/ret sayıları bunu söyleyemez. Alan yalnız formu yönetene
 * (yönetici, formun öğretmeni) döner; yoksa kilit yok sayılır, sunucu yine reddeder.
 */
export const hasDecisions = (form: Pick<PermissionForm, 'hasDecisions'>) =>
  form.hasDecisions === true

const target = (input: { version: number }) => input.version

/** Komut tanımları (`useApiCommand` seçenekleri); kancalar ve testler aynısını kullanır. */
export const createPermissionFormCommand = {
  request: createPermissionFormRequest,
  invalidates: PERMISSION_FORMS_INVALIDATES,
  messages: PERMISSION_FORM_MESSAGES,
} as const
export const updatePermissionFormCommand = {
  request: updatePermissionFormRequest,
  version: target,
  invalidates: PERMISSION_FORMS_INVALIDATES,
  refreshOn: permissionStale,
  messages: PERMISSION_FORM_MESSAGES,
} as const
export const closePermissionFormCommand = {
  request: closePermissionFormRequest,
  version: target,
  invalidates: PERMISSION_FORMS_INVALIDATES,
  refreshOn: permissionStale,
  messages: PERMISSION_FORM_MESSAGES,
} as const
export const archivePermissionFormCommand = {
  request: archivePermissionFormRequest,
  version: target,
  invalidates: PERMISSION_FORMS_INVALIDATES,
  refreshOn: permissionStale,
  messages: PERMISSION_FORM_MESSAGES,
} as const
export const decidePermissionCommand = {
  request: decidePermissionRequest,
  invalidates: PERMISSION_FORMS_INVALIDATES,
  refreshOn: permissionStale,
  messages: PERMISSION_DECISION_MESSAGES,
} as const
