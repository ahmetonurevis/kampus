import type { Participant } from '@kampus/school-core/lib/communication.ts'
import { recordVideoProgress } from '@kampus/school-core/lib/video-progress.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { CollectionName } from '../db/collections.ts'
import { loadRecordsByIds } from '../db/records.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment } from './commands.ts'
import { listMembershipLinks } from './memberships.ts'
import { runCommand, type IdempotencyRequest, type LoadScope } from './operation-runner.ts'

/**
 * Video izleme ilerlemesi servisi (IST-041; docs/domain/kaynak-platformu.md DOM-KYN-005). İlerleme
 * `videoProgress` koleksiyonundadır; anahtar `<öğrenci>:<video>`'dur. Kural, rol ve kapsam core'dadır
 * (`lib/video-progress.ts`, `requireAuthorized`); burada yalnız gereken kayıtların yüklenmesi ve
 * tek transaction vardır.
 *
 * Oynatıcı bu ucu 15 sn'de bir çağırır, bu yüzden işlem dar yüklenir: kurumun bütün öğrenci ve
 * sınıfları yerine öğrencinin kendi kaydı ve sınıfı, hedef video ve öğrencinin o videodaki satırı.
 * Kapsam kaynağının yüklenmeyen koleksiyonları boştur; öğrenci kapsamı (kendi düzeyi) yalnız
 * kendi öğrenci ve sınıf kaydıyla çözülür. Denetim satırı yalnız kaydın ilk yazımında bırakılır
 * (`auditPolicy: 'firstWriteOnly'`): her 15 sn'lik konum güncellemesi denetim değeri taşımaz, kaydın
 * açılışı taşır.
 */

const NONE: LoadScope = { ids: [] }
const SPEC = OPERATION_COMMANDS['video.progress']

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** Oturumun tek öğrenci bağlantısı; yoksa veya birden çoksa `null` (core 403 verir). */
async function linkedStudent(
  ctx: ServiceContext,
): Promise<{ studentId: string; classId: string | null } | null> {
  const links = await listMembershipLinks(ctx.db, ctx.institutionId, ctx.actor.membershipId)
  const ids = links.filter((link) => link.kind === 'student').map((link) => link.recordId)
  const [studentId] = ids
  if (ids.length !== 1 || studentId === undefined) return null
  const [row] = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [studentId])
  return { studentId, classId: text(row?.data.classId) }
}

/**
 * Öğrencinin kendi ilerlemesini yazar (core `recordVideoProgress`): ilk istek kaydı açar,
 * sonrakiler günceller; yüzde geri gitmez, son konum yeni değerdir. Aynı istek tekrarlanınca kayıt
 * değişmez. Yanıt her zaman 200'dür (upsert).
 */
export async function recordVideoProgressCommand(
  ctx: ServiceContext,
  videoId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  const student = await linkedStudent(ctx)
  const progressKey = student ? `${student.studentId}:${videoId}` : null
  const loadScope: Partial<Record<CollectionName, LoadScope>> = {
    students: student ? { ids: [student.studentId] } : NONE,
    classes: student?.classId ? { ids: [student.classId] } : NONE,
    teachers: NONE,
    assignments: NONE,
    clubs: NONE,
    mockExams: NONE,
    videos: { ids: [videoId] },
    videoProgress: progressKey ? { ids: [progressKey] } : NONE,
  }
  return runCommand(
    ctx,
    {
      action: 'video.progress',
      collections: SPEC.collections,
      loadScope,
      auditPolicy: 'firstWriteOnly',
      entity: { type: 'videoProgress', id: progressKey ?? videoId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        return {
          scalars,
          run: (state) => recordVideoProgress(state, by, videoId, input, { institutionType }),
        }
      },
    },
    ({ result }) => ({
      statusCode: 200,
      body: {
        data: {
          videoId: result.record.videoId,
          progress: result.record.progress,
          positionSeconds: result.record.positionSeconds ?? 0,
          durationSeconds: result.record.durationSeconds ?? 1,
        },
      },
    }),
    idempotency,
  )
}
