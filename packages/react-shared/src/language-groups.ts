import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { COURSES_KEY } from './courses.ts'
import { fetchAllPages, type ListPage } from './institution-lists.ts'

/**
 * Dil okulu grup uçlarının (`/groups`, IST-077; DOM-DIL-003, -008, -040…043) saf yardımcıları:
 * istek kurucular, Türkçe hata metinleri, hata → form alanı eşlemesi ve sorgu anahtarı. Kancalar
 * `use-language-groups.ts`'tedir. Uçlar yalnız dil okulunda vardır (okulda 404). Her yazma
 * `Idempotency-Key` taşır; var olan gruba yazma okunan `rowVersion`'ı `If-Match` olarak gönderir.
 * Birleştirmede kaynak grubun sürümü gövdede (`sourceVersion`) gider. Bekleme sırası salt okunurdur;
 * yazması kayıt akışındadır (ON-058).
 */

export type LanguageGroup = components['schemas']['LanguageGroup']
export type GroupSlot = components['schemas']['GroupSlot']
export type GroupMember = components['schemas']['GroupMember']
export type GroupWaitlistItem = components['schemas']['GroupWaitlistItem']
/** Bekleme sırası yanıtı (`GET /groups/:groupId/waitlist`): sıra ve core teklif önerisi. */
export type GroupWaitlist =
  operations['getGroupWaitlist']['responses'][200]['content']['application/json']['data']
export type GroupListQuery = NonNullable<operations['listGroups']['parameters']['query']>

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateGroupBody = JsonBody<'createGroup'>
export type UpdateGroupBody = JsonBody<'updateGroup'>
export type CancelGroupBody = JsonBody<'cancelGroup'>
export type MergeGroupBody = JsonBody<'mergeGroup'>

/** Sorgu anahtarının kökü; yazma sonrası grup listesi, ayrıntı ve bekleme sırası tazelenir. */
export const LANGUAGE_GROUPS_KEY = ['language-groups'] as const

/** Grup yazması kurun arşiv ve en çok mevcut kurallarını da etkiler (kapanmamış grup sayısı). */
export const GROUP_INVALIDATES = [LANGUAGE_GROUPS_KEY, COURSES_KEY] as const

export const GROUP_CHANGED_MESSAGE =
  'Grup bu arada değişti. Güncel hâli yüklendi; kontrol edip yeniden deneyin.'

/**
 * Koda özgü Türkçe metinler. Çakışma ve takvim hatalarının sunucu mesajı hangi oturumun ve hangi
 * grubun çakıştığını söyler ("Öğretmenin Salı 18:00 saatinde "B1 Akşam" grubunda dersi var.");
 * bu kodlar sözlüğe konmaz, alanın altında sunucunun Türkçe mesajı gösterilir
 * (`GROUP_DETAILED_CODES`).
 */
export const GROUP_MESSAGES = {
  version_conflict: GROUP_CHANGED_MESSAGE,
  not_found: 'Grup bulunamadı. Liste güncellendi.',
  group_not_found: 'Grup bulunamadı. Liste güncellendi.',
  course_coordinator_required:
    'Bu seviyenin gruplarını yalnız yönetici ya da seviyenin akademik koordinatörü yönetir.',
  group_below_minimum: 'Grup, kurun asgari açılış sayısına ulaşmadan açılamaz.',
  group_start_passed: 'Başlangıç tarihi geçmiş olamaz. İleri bir tarih seçin.',
  group_merge_consent_required:
    'Gün ya da saat farklı; kursiyerlerin onayını aldığınızı işaretleyin.',
  learner_birth_date_required:
    'Taşınacak kursiyerlerden birinin doğum tarihi yok; önce öğrenci kaydını tamamlayın.',
  group_name_exists: 'Bu adla tanımlı bir grup var. Farklı bir ad yazın.',
  group_closed: 'Tamamlanan ya da iptal edilen grup değiştirilemez.',
  group_schedule_locked:
    'Kursiyeri olan ya da başlamış grupta haftalık program, başlangıç ve yaş bandı değişmez.',
  group_teacher_required: 'Açılan grubun öğretmeni olmalı.',
  group_room_required: 'Yüz yüze grubun dersliği olmalı.',
  group_room_online: 'Çevrim içi grubun dersliği olmaz.',
  group_teacher_invalid: 'Öğretmen kurumda bulunamadı.',
  group_course_inactive: 'Grup yalnız etkin kurdan planlanır.',
  group_course_not_found: 'Kur bulunamadı.',
  group_not_planned: 'Yalnız planlanan grup açılır.',
  group_merge_same: 'Grup kendisiyle birleştirilemez.',
} as const satisfies CommandMessages

/** Sunucu mesajı oturum ve grup adını taşıyan kodlar: metin sözlükten değil sunucudan gelir. */
export const GROUP_DETAILED_CODES = [
  'group_teacher_conflict',
  'group_room_conflict',
  'group_schedule_overlap',
  'group_schedule_mismatch',
  'group_outside_legal_hours',
  'group_minor_late',
  'learner_schedule_conflict',
  'group_capacity_exceeds_course',
  'group_capacity_below_members',
  'group_merge_capacity',
  'group_merge_mismatch',
] as const

/**
 * Hata kodunun bağlandığı form alanı (kod yolu taşımıyorsa). Takvim hataları sunucudan oturumun
 * yolunu taşır (`schedule.<sıra>`); onlar yoldan alana gider.
 */
export const GROUP_ERROR_FIELDS = {
  group_teacher_conflict: 'teacherMembershipId',
  group_teacher_required: 'teacherMembershipId',
  group_teacher_invalid: 'teacherMembershipId',
  group_room_conflict: 'room',
  group_room_required: 'room',
  group_room_online: 'room',
  group_name_exists: 'name',
  group_start_passed: 'startDate',
  group_course_inactive: 'courseId',
  group_course_not_found: 'courseId',
  group_capacity_exceeds_course: 'capacity',
  group_capacity_below_members: 'capacity',
  group_merge_consent_required: 'learnersConsented',
  group_merge_same: 'sourceGroupId',
  group_merge_mismatch: 'sourceGroupId',
  group_merge_capacity: 'sourceGroupId',
  learner_schedule_conflict: 'sourceGroupId',
  learner_birth_date_required: 'sourceGroupId',
} as const satisfies Readonly<Record<string, string>>

/** Takvim kuralları: yol `schedule.<sıra>` (oturum satırı) ya da `schedule` (kalıbın tamamı). */
const SCHEDULE_CODES = new Set([
  'group_schedule_overlap',
  'group_schedule_mismatch',
  'group_outside_legal_hours',
  'group_minor_late',
])

/**
 * Hatanın form alanı. `group_minor_late` birleştirmede de çıkar: orada kaynak grup seçimine
 * bağlanır. Yetki ve varlık hatası alana bağlanmaz (toast).
 */
export function groupErrorField(error: ApiError, form: 'group' | 'merge' = 'group') {
  if (error.status === 403 || error.status === 404) return undefined
  if (form === 'merge' && (error.code === 'group_minor_late' || SCHEDULE_CODES.has(error.code)))
    return 'sourceGroupId'
  const path = error.issues.find((issue) => issue.path.length > 0)?.path.join('.')
  if (SCHEDULE_CODES.has(error.code)) return path?.startsWith('schedule') ? path : 'schedule'
  const mapped = (GROUP_ERROR_FIELDS as Readonly<Record<string, string>>)[error.code]
  if (mapped) return mapped
  if (error.code === 'group_schedule_locked') return path ?? 'schedule'
  return undefined
}

/** Ekrandaki grup eskidi (sürüm çakıştı, grup yok oldu): liste tazelenir. */
export const groupStale = (error: ApiError) =>
  error.status === 404 || (error.status === 409 && error.code === 'version_conflict')

/** Var olan gruba yazmanın hedefi; `version` okunan `rowVersion`'dır. */
export interface GroupTarget {
  groupId: string
  version: number
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export async function fetchGroupPage(
  client: KampusClient,
  query: GroupListQuery,
  signal?: AbortSignal,
): Promise<ListPage<LanguageGroup>> {
  const body = await runRequest(() =>
    client.GET('/api/v1/groups', { params: { query }, ...(signal ? { signal } : {}) }),
  )
  return { rows: body.data, ...body.meta }
}

/** Süzgeçle bütün gruplar (CSV, birleştirme kaynağı); sayfa sayfa çekilir. */
export function fetchAllGroups(
  client: KampusClient,
  query: Omit<GroupListQuery, 'page' | 'pageSize'>,
  signal?: AbortSignal,
): Promise<LanguageGroup[]> {
  return fetchAllPages<GroupListQuery, LanguageGroup>(
    (pageQuery, pageSignal) => fetchGroupPage(client, pageQuery, pageSignal),
    query,
    signal,
  )
}

export function createGroupRequest(
  client: KampusClient,
  body: CreateGroupBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/groups', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function updateGroupRequest(
  client: KampusClient,
  input: GroupTarget & { body: UpdateGroupBody },
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/groups/{groupId}', {
    params: { path: { groupId: input.groupId }, header: versioned(headers) },
    body: input.body,
  })
}

export function openGroupRequest(
  client: KampusClient,
  input: GroupTarget,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/groups/{groupId}/open', {
    params: { path: { groupId: input.groupId }, header: versioned(headers) },
    body: {},
  })
}

export function cancelGroupRequest(
  client: KampusClient,
  input: GroupTarget & { body: CancelGroupBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/groups/{groupId}/cancel', {
    params: { path: { groupId: input.groupId }, header: versioned(headers) },
    body: input.body,
  })
}

/** Birleştirme hedefe yazılır: `version` hedefin, `body.sourceVersion` kaynağın sürümüdür. */
export function mergeGroupRequest(
  client: KampusClient,
  input: GroupTarget & { body: MergeGroupBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/groups/{groupId}/merge', {
    params: { path: { groupId: input.groupId }, header: versioned(headers) },
    body: input.body,
  })
}

const target = (input: GroupTarget) => input.version

export const createGroupCommand = {
  request: createGroupRequest,
  invalidates: GROUP_INVALIDATES,
  messages: GROUP_MESSAGES,
} as const
export const updateGroupCommand = {
  request: updateGroupRequest,
  version: target,
  invalidates: GROUP_INVALIDATES,
  refreshOn: groupStale,
  messages: GROUP_MESSAGES,
} as const
export const openGroupCommand = {
  request: openGroupRequest,
  version: target,
  invalidates: GROUP_INVALIDATES,
  refreshOn: groupStale,
  messages: GROUP_MESSAGES,
} as const
export const cancelGroupCommand = {
  request: cancelGroupRequest,
  version: target,
  invalidates: GROUP_INVALIDATES,
  refreshOn: groupStale,
  messages: GROUP_MESSAGES,
} as const
export const mergeGroupCommand = {
  request: mergeGroupRequest,
  version: target,
  invalidates: GROUP_INVALIDATES,
  refreshOn: groupStale,
  messages: GROUP_MESSAGES,
} as const
