import { deadlineForVersion } from '@kampus/school-core/skills/assignment.ts'
import {
  extendedRecordingRetention,
  recordingPeriodEnd,
  recordingRetentionUntil,
  type DayRange,
} from '@kampus/school-core/skills/recording.ts'
import type { SubmissionFile, VersionRow } from '@kampus/school-core/skills/submission.ts'

import { loadAcademicYears } from '../db/academic-years.ts'
import type { Database } from '../db/client.ts'
import { extendFileRetention, loadFilesByIds, type StoredFile } from '../db/files.ts'
import { loadGroups, loadMembershipsOfStudents } from '../db/language-groups.ts'
import type { StoredAssignment, StoredSubmission } from '../db/skills.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { attachFile, FileRejectedError, isScanRejected } from './files.ts'
import { getInstitutionModules } from './modules.ts'

/**
 * Beceri görevinde dosyalı (el yazısı) ve sesli (konuşma kaydı) teslimin dosya tarafı (OG-048;
 * IST-051, IST-126; ADR 0003 karar 5, 9, 13; docs/domain/beceri-gelisimi.md DOM-BEC-046,
 * 050…054). Kural core `skills/submission.ts` ve `skills/recording.ts`'tedir; burada dosya
 * satırlarının okunması, sürüme bağlanması, saklama sonunun girdileri ve yanıt görünümü vardır.
 *
 * Dosya, sürüm yazıldığı transaction'da sürüme bağlanır (`attached_type =
 * 'task_submission_version'`, `attached_id` = sürüm). Dosya adı ve içerik loglanmaz, denetime
 * yalnız alan adları düşer.
 */

export const SUBMISSION_VERSION_ATTACHMENT = 'task_submission_version'

/** Gövdedeki dosya kimlikleri (sıra korunur). */
export function bodyFileIds(
  body:
    | { submissionKind: 'text' }
    | { submissionKind: 'file'; fileIds: readonly string[] }
    | {
        submissionKind: 'audio'
        recordingFileId: string
      },
): string[] {
  switch (body.submissionKind) {
    case 'text':
      return []
    case 'file':
      return [...body.fileIds]
    case 'audio':
      return [body.recordingFileId]
    default:
      return body satisfies never
  }
}

/**
 * Kursiyerin teslimde kullanabileceği dosyalar (core `SubmissionFile`): aynı kurumda, kendi
 * yüklediği, silinmemiş ve reddedilmemiş. Başkasının ya da olmayan dosyası listede yoktur; core
 * bunu `submission_file_not_found` ile reddeder, API genel 404 döner (varlığı sızmaz); kendi
 * taramada reddedilmiş dosyası 422 `file_rejected` (Sabah kararı 42, yol `fileIds.<sıra>`). Hazır
 * olmayan, başka kayda bağlı ya da saklama sonu gelmiş (rıza geri çekilince imhaya işaretlenen)
 * dosyayı bağlama satır kilidi altında reddeder (`attachFile`, 422 `file_unavailable`). Süre milisaniyeden
 * saniyeye çevrilir; ölçülmemiş süre `null` kalır (core `recording_not_measured`).
 */
export async function usableFiles(
  tx: Database,
  ctx: ServiceContext,
  fileIds: readonly string[],
): Promise<SubmissionFile[]> {
  const rows = await loadFilesByIds(tx, ctx.institutionId, fileIds)
  // Kursiyerin kendi taramada reddedilmiş dosyası ayrı kodla döner (Sabah kararı 42); başkasınınki
  // listede olmadığından genel 404 kalır.
  const rejected = fileIds.findIndex((id) =>
    rows.some(
      (row) => row.id === id && row.uploadedByUserId === ctx.actor.userId && isScanRejected(row),
    ),
  )
  if (rejected >= 0) throw new FileRejectedError(['fileIds', rejected])
  return rows
    .filter(
      (row) =>
        row.uploadedByUserId === ctx.actor.userId &&
        row.status !== 'deleted' &&
        row.status !== 'rejected',
    )
    .map((row) => ({
      id: row.id,
      purpose: row.purpose,
      contentType: row.contentType,
      byteSize: row.byteSize,
      durationSeconds: row.durationMs === null ? null : row.durationMs / 1000,
    }))
}

/**
 * Saklamanın başladığı dönem sonu (DOM-BEC-052; core `recordingPeriodEnd`): `school`'da kurumun
 * ders yılları, `language_school`'da kursiyerin iptal edilmemiş kur grupları; `on` gününü içeren
 * dönem (bağlamada şimdi, yeniden hesaplamada sürümün gönderildiği an).
 */
export async function recordingPeriodEndFor(
  tx: Database,
  ctx: ServiceContext,
  learnerId: string,
  on: Date | string = ctx.now,
): Promise<string> {
  const institution = await getInstitutionModules(tx, ctx.institutionId)
  const institutionType = institution?.type ?? 'school'
  let academicYears: DayRange[] = []
  let groups: DayRange[] = []
  if (institutionType === 'school') {
    academicYears = (await loadAcademicYears(tx, ctx.institutionId)).map((year) => ({
      startDate: year.startDate,
      endDate: year.endDate,
    }))
  } else {
    const memberships = await loadMembershipsOfStudents(tx, ctx.institutionId, [learnerId])
    const groupIds = new Set(memberships.map((member) => member.groupId))
    if (groupIds.size > 0)
      groups = (await loadGroups(tx, ctx.institutionId))
        .filter((group) => groupIds.has(group.id) && group.cancelledAt === null)
        .map((group) => ({ startDate: group.startDate, endDate: group.endDate }))
  }
  return recordingPeriodEnd({ institutionType, on, academicYears, groups })
}

/**
 * Sürümün dosyalarını sürüme bağlar (karar 5). Konuşma kaydında saklama sonu core
 * `recordingRetentionUntil` ile bağlama anında hesaplanır (karar 13, DOM-BEC-052): dönem sonu ve
 * sürümün puanlama/itiraz kapanışı. Bağlama rızayı yeniden denetler (403 `consent_required`); hata
 * transaction'ı geri alır, sürüm de yazılmaz.
 */
export async function attachVersionFiles(
  tx: Database,
  ctx: ServiceContext,
  input: {
    assignment: StoredAssignment
    submission: StoredSubmission | null
    version: VersionRow
    learnerId: string
    recording: { periodEndDate: string; holidays: readonly string[] } | null
  },
): Promise<void> {
  const { version, recording } = input
  const retentionUntil =
    recording === null
      ? null
      : new Date(
          recordingRetentionUntil({
            periodEndDate: recording.periodEndDate,
            deadline: deadlineForVersion(
              input.assignment.deadline,
              input.submission,
              version.number,
            ),
            submittedAt: version.submittedAt,
            holidays: recording.holidays,
          }),
        )
  for (const fileId of version.fileIds)
    await attachFile(tx, ctx, {
      fileId,
      attachedType: SUBMISSION_VERSION_ATTACHMENT,
      attachedId: version.id,
      dataSubjectId: input.learnerId,
      retentionUntil,
    })
}

/**
 * Sürümün konuşma kaydının saklama sonunu bilinen olay anlarıyla yeniden hesaplar ve yalnız ileri
 * alır (DOM-BEC-052, DOM-BEC-025; core `recordingRetentionUntil`, `extendedRecordingRetention`):
 * sonuç duyurusu (puanın kesinleşmesi), itiraz açılışı ve itiraz kararı. Olayı yazan işlemin
 * transaction'ında çağrılır; işlem geri alınırsa saklama sonu da değişmez. Gelmiş saklama sonu (rıza
 * geri çekme işareti) ve silinmiş dosya değişmez. Dönem sonu sürümün gönderildiği günün dönemidir.
 */
export async function extendVersionRecordingRetention(
  tx: Database,
  ctx: ServiceContext,
  input: {
    assignment: StoredAssignment
    submission: StoredSubmission
    version: VersionRow
    announcedAt?: string | null
    appealFiledAt?: string | null
    appealDecidedAt?: string | null
    holidays: readonly string[]
  },
): Promise<void> {
  const { version } = input
  if (version.fileIds.length === 0) return
  const recordings = (await loadFilesByIds(tx, ctx.institutionId, version.fileIds)).filter(
    (row) =>
      row.purpose === 'speaking_recording' &&
      row.status !== 'deleted' &&
      row.attachedType === SUBMISSION_VERSION_ATTACHMENT &&
      row.attachedId === version.id,
  )
  if (recordings.length === 0) return
  const computed = recordingRetentionUntil({
    periodEndDate: await recordingPeriodEndFor(
      tx,
      ctx,
      input.submission.learnerId,
      version.submittedAt,
    ),
    deadline: deadlineForVersion(input.assignment.deadline, input.submission, version.number),
    submittedAt: version.submittedAt,
    announcedAt: input.announcedAt ?? null,
    appealFiledAt: input.appealFiledAt ?? null,
    appealDecidedAt: input.appealDecidedAt ?? null,
    holidays: input.holidays,
  })
  for (const row of recordings) {
    const next = extendedRecordingRetention({
      current: row.retentionUntil,
      computed,
      now: ctx.now,
    })
    // Satır sürümü tutmazsa (eşzamanlı imha) değişiklik yapılmaz; imha zaten saklamayı bitirdi.
    if (next !== null)
      await extendFileRetention(tx, ctx.institutionId, row, new Date(next), ctx.now)
  }
}

export type VersionFileStatus = 'processing' | 'ready' | 'deleted'

/**
 * Sürüm dosyasının yanıt görünümü: tür, boyut, süre ve durum. Özgün ad (K) dönmez. İmha edilen ya
 * da reddedilen dosya `deleted` görünür; süresi kalır (DOM-BEC-052).
 */
export function versionFileView(row: StoredFile) {
  const status: VersionFileStatus =
    row.status === 'ready'
      ? 'ready'
      : row.status === 'deleted' || row.status === 'rejected'
        ? 'deleted'
        : 'processing'
  return {
    id: row.id,
    // Sürüme yalnız bu iki amaç bağlanır (`defineFileAttachment`).
    purpose:
      row.purpose === 'speaking_recording'
        ? ('speaking_recording' as const)
        : ('submission' as const),
    contentType: row.contentType,
    byteSize: row.byteSize,
    durationMs: row.durationMs,
    status,
  }
}

/** Sürümlerin dosya satırları (tek sorgu), kimliğe göre. */
export async function loadVersionFiles(
  db: Database,
  institutionId: string,
  versions: readonly VersionRow[],
): Promise<ReadonlyMap<string, StoredFile>> {
  const rows = await loadFilesByIds(
    db,
    institutionId,
    versions.flatMap((version) => version.fileIds),
  )
  return new Map(rows.map((row) => [row.id, row]))
}
