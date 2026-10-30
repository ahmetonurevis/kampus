import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import type { CommandHeaders, CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

// Kampüs, sınıf ve eğitim kadrosu yazma komutları (`POST|PATCH|DELETE /branches|classes|teachers`,
// `POST …/restore`; yalnız `yonetici`, core `branch.save` `class.save` `teacher.save`
// `record.archive` `record.restore`). Çekirdek kayıttır: modül denetimi yoktur.

type JsonBody<TOperation extends keyof operations> = NonNullable<
  operations[TOperation]['requestBody']
>['content']['application/json']

export type BranchBody = JsonBody<'createBranch'>
export type TeacherBody = JsonBody<'createTeacher'>
export type ClassBody = JsonBody<'createClass'>

/** Yönetilen kayıt türü (core `ArchiveKind`). */
export type ManagedKind = 'branch' | 'class' | 'teacher'

/** Oluşturma: `recordId` yok, `If-Match` gönderilmez. Düzenleme: okunan sürüm zorunludur. */
export type SaveRecordInput<TBody> =
  { recordId?: undefined; body: TBody } | { recordId: string; version: number; body: TBody }

export interface ArchiveRecordInput {
  recordId: string
  /** Bağlı kayıtların aktarılacağı kayıt; bağlı aktif kayıt yoksa verilmez. */
  replacementId?: string
}

export interface RestoreRecordInput {
  recordId: string
}

/** Başka kullanıcı kaydı değiştirdi (`If-Match` tutmadı): form güncel kayıtla yeniden yüklenir. */
export const RECORD_CHANGED_MESSAGE =
  'Kayıt başka biri tarafından değişti. Güncel kaydı yükleyip değişikliklerinizi yeniden uygulayın.'

export const MANAGEMENT_MESSAGES = {
  version_conflict: RECORD_CHANGED_MESSAGE,
} as const satisfies CommandMessages

/** Kayıt değiştiren işlemlerin dokunabildiği koleksiyonlar (sınıf/öğretmen devri, aktarımlar). */
const RELATED_COLLECTIONS = [
  'branches',
  'classes',
  'teachers',
  'assignments',
  'students',
  'schedule',
  'homework',
  'questions',
  'appointments',
] as const

const invalidates = RELATED_COLLECTIONS.map((name) => collectionKeyPrefix(name))

/** Oluşturmada `If-Match` hiç gönderilmez; düzenlemede okunan sürüm. */
const versionOf = <TBody>(input: SaveRecordInput<TBody>): number | null =>
  input.recordId === undefined ? null : input.version

const idempotencyOnly = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
})
/** Düzenleme uçlarında `If-Match` zorunludur; sürümsüz çağrı sunucuda 400 olur. */
const patchHeaders = (headers: CommandHeaders) => ({
  ...idempotencyOnly(headers),
  'if-match': headers['if-match'] ?? '',
})

export function saveBranchRequest(
  client: KampusClient,
  input: SaveRecordInput<BranchBody>,
  headers: CommandHeaders,
) {
  if (input.recordId === undefined)
    return client.POST('/api/v1/branches', {
      params: { header: idempotencyOnly(headers) },
      body: input.body,
    })
  return client.PATCH('/api/v1/branches/{branchId}', {
    params: { path: { branchId: input.recordId }, header: patchHeaders(headers) },
    body: input.body,
  })
}

export function saveTeacherRequest(
  client: KampusClient,
  input: SaveRecordInput<TeacherBody>,
  headers: CommandHeaders,
) {
  if (input.recordId === undefined)
    return client.POST('/api/v1/teachers', {
      params: { header: idempotencyOnly(headers) },
      body: input.body,
    })
  return client.PATCH('/api/v1/teachers/{teacherId}', {
    params: { path: { teacherId: input.recordId }, header: patchHeaders(headers) },
    body: input.body,
  })
}

export function saveClassRequest(
  client: KampusClient,
  input: SaveRecordInput<ClassBody>,
  headers: CommandHeaders,
) {
  if (input.recordId === undefined)
    return client.POST('/api/v1/classes', {
      params: { header: idempotencyOnly(headers) },
      body: input.body,
    })
  return client.PATCH('/api/v1/classes/{classId}', {
    params: { path: { classId: input.recordId }, header: patchHeaders(headers) },
    body: input.body,
  })
}

export async function archiveRecordRequest(
  client: KampusClient,
  kind: ManagedKind,
  { recordId, replacementId }: ArchiveRecordInput,
  headers: CommandHeaders,
) {
  const query = replacementId ? { replacementId } : {}
  const header = idempotencyOnly(headers)
  switch (kind) {
    case 'branch':
      return await client.DELETE('/api/v1/branches/{branchId}', {
        params: { path: { branchId: recordId }, query, header },
      })
    case 'class':
      return await client.DELETE('/api/v1/classes/{classId}', {
        params: { path: { classId: recordId }, query, header },
      })
    case 'teacher':
      return await client.DELETE('/api/v1/teachers/{teacherId}', {
        params: { path: { teacherId: recordId }, query, header },
      })
    default:
      return kind satisfies never
  }
}

export async function restoreRecordRequest(
  client: KampusClient,
  kind: ManagedKind,
  { recordId }: RestoreRecordInput,
  headers: CommandHeaders,
) {
  const header = idempotencyOnly(headers)
  switch (kind) {
    case 'branch':
      return await client.POST('/api/v1/branches/{branchId}/restore', {
        params: { path: { branchId: recordId }, header },
        body: {},
      })
    case 'class':
      return await client.POST('/api/v1/classes/{classId}/restore', {
        params: { path: { classId: recordId }, header },
        body: {},
      })
    case 'teacher':
      return await client.POST('/api/v1/teachers/{teacherId}/restore', {
        params: { path: { teacherId: recordId }, header },
        body: {},
      })
    default:
      return kind satisfies never
  }
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}

/**
 * Kampüs oluşturma (`POST /branches`, 201) ve düzenleme (`PATCH /branches/:id`, `If-Match`
 * zorunlu). Aktif kampüs adı tekildir (409 `branch_name_taken`). Başarıda ve çakışmada
 * ilişkili koleksiyonlar tazelenir.
 */
export function useSaveBranch(options: CommandOptions = {}) {
  return useApiCommand({
    request: saveBranchRequest,
    version: versionOf<BranchBody>,
    invalidates,
    messages: MANAGEMENT_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Öğretmen oluşturma ve düzenleme; yalnız core `teachers` kaydıdır (hesap üyeler ucundadır). */
export function useSaveTeacher(options: CommandOptions = {}) {
  return useApiCommand({
    request: saveTeacherRequest,
    version: versionOf<TeacherBody>,
    invalidates,
    messages: MANAGEMENT_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Sınıf oluşturma ve düzenleme; gövde sınıf bilgisi ile ders → öğretmen atamalarını taşır. */
export function useSaveClass(options: CommandOptions = {}) {
  return useApiCommand({
    request: saveClassRequest,
    version: versionOf<ClassBody>,
    invalidates,
    messages: MANAGEMENT_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/**
 * Arşivleme (`DELETE /{branches,classes,teachers}/:id?replacementId=`): bağlı aktif kayıtlar
 * `replacementId`'ye aktarılır; geçmiş finans, not ve yoklama korunur.
 */
export function useArchiveRecord(kind: ManagedKind, options: CommandOptions = {}) {
  return useApiCommand({
    request: (client, input: ArchiveRecordInput, headers) =>
      archiveRecordRequest(client, kind, input, headers),
    invalidates,
    messages: MANAGEMENT_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Arşivden geri alma; aktarılan görevler otomatik geri taşınmaz (core kuralı). */
export function useRestoreRecord(kind: ManagedKind, options: CommandOptions = {}) {
  return useApiCommand({
    request: (client, input: RestoreRecordInput, headers) =>
      restoreRecordRequest(client, kind, input, headers),
    invalidates,
    messages: MANAGEMENT_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/**
 * Arşiv sonucunda yeri değişen bağlı kayıtlar (koleksiyon → adet). Konu kaydın kendisi sayılmaz;
 * yalnız `update` değişikliği aktarımdır (öğrenci sınıfı, sınıf kampüsü, ders öğretmeni …).
 */
export function transferredCounts(result: {
  entity: { collection: string; id: string } | null
  records: readonly { collection: string; id: string; change: string }[]
}): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const record of result.records) {
    if (record.change !== 'update') continue
    if (record.collection === result.entity?.collection && record.id === result.entity.id) continue
    counts[record.collection] = (counts[record.collection] ?? 0) + 1
  }
  return counts
}
