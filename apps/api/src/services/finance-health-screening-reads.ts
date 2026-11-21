import type { HealthAccessReason } from '@kampus/school-core/lib/finance-health-access.ts'
import {
  measurementView,
  thresholdExceeded,
} from '@kampus/school-core/lib/finance-health-screenings.ts'

import {
  listPublishedResultsForStudents,
  loadHealthScreeningNotificationStates,
  loadHealthScreeningResults,
} from '../db/finance-health-screenings.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import {
  classNames,
  RESULTS,
  resultHealthOf,
  rosterOf,
  SESSIONS,
  sessionOf,
  sessionViews,
  studentNames,
  type HealthScreeningDeps,
} from './finance-health-screenings.ts'
import { recordHealthRead } from './finance-health-access.ts'
import { readScope } from './read-scope.ts'

/**
 * Okul sağlığı taramasının sağlık değeri dönen okumaları (DOM-FIN-153; K-515). Ölçüm ve not dönen
 * her okuma buradadır ve aynı transaction'da ortak `recordHealthRead` ile denetime düşer (dönen
 * alanların adları; değer yok); denetim yazılamazsa yanıt dönmez. Personel okuması rotadan gelen
 * erişim gerekçesiyle kaydedilir (DOM-FIN-156, ON-164); veli kendi çocuğunu gerekçesiz okur.
 */

/** Ayrıntıda dönen sağlık alanları; okuma denetimine alan adları olarak yazılır. */
const DETAIL_FIELDS = ['outcome', 'measurement', 'referralRecommended', 'note']
const GUARDIAN_FIELDS = ['outcome', 'measurement', 'referralRecommended', 'note', 'notification']

/**
 * Oturum ayrıntısı ve hızlı giriş tablosu (K-514, K-515): hedef sınıfların bugünkü etkin öğrencileri
 * ve sonucu olan (sınıf değiştirmiş olsa da) her öğrenci, sonucuyla. Okuma
 * gerekçesiyle `finance.health_screening.read` denetimine düşer.
 */
export function getHealthScreeningFor(
  ctx: ServiceContext,
  deps: HealthScreeningDeps,
  id: string,
  reason: HealthAccessReason | null,
) {
  return ctx.db.transaction(async (tx) => {
    const session = await sessionOf(tx, ctx, id)
    const [[view], roster, results] = await Promise.all([
      sessionViews(tx, ctx, [session]),
      rosterOf(tx, ctx, session.classIds),
      loadHealthScreeningResults(tx, ctx.institutionId, id),
    ])
    if (view === undefined) throw new NotFoundError()
    const byStudent = new Map(results.map((row) => [row.studentId, row]))
    const rosterIds = new Set(roster.map((row) => row.id))
    const extraIds = results.map((row) => row.studentId).filter((sid) => !rosterIds.has(sid))
    const [extraNames, notifications, names] = await Promise.all([
      studentNames(tx, ctx, extraIds),
      loadHealthScreeningNotificationStates(
        tx,
        ctx.institutionId,
        results.map((row) => row.id),
      ),
      classNames(tx, ctx, [...session.classIds, ...results.map((row) => row.classId)]),
    ])
    const rosterRows = roster.map((row) => ({
      studentId: row.id,
      studentName: typeof row.data.name === 'string' ? row.data.name : null,
      classId: typeof row.data.classId === 'string' ? row.data.classId : '',
    }))
    const extraRows = extraIds.map((studentId) => ({
      studentId,
      studentName: extraNames.get(studentId) ?? null,
      classId: byStudent.get(studentId)?.classId ?? '',
    }))
    const students = [...rosterRows, ...extraRows]
      .map((row) => {
        const result = byStudent.get(row.studentId)
        const health = result === undefined ? null : resultHealthOf(deps, ctx.institutionId, result)
        return {
          ...row,
          className: names.get(row.classId) ?? row.classId,
          inTargetClass: rosterIds.has(row.studentId),
          result:
            result === undefined || health === null
              ? null
              : {
                  id: result.id,
                  outcome: result.outcome,
                  measurement:
                    health.measurement === null ? null : measurementView(health.measurement),
                  referralRecommended: result.referralRecommended,
                  thresholdExceeded: thresholdExceeded(session.thresholds, health.measurement),
                  note: health.note,
                  notificationStatus: notifications.get(result.id) ?? null,
                  recordedByUserId: result.recordedByUserId,
                  recordedByName: result.recordedByName,
                  updatedAt: result.updatedAt,
                  version: result.version,
                },
        }
      })
      .sort(
        (a, b) =>
          a.className.localeCompare(b.className, 'tr', { numeric: true }) ||
          (a.studentName ?? '').localeCompare(b.studentName ?? '', 'tr') ||
          a.studentId.localeCompare(b.studentId),
      )
    // Oturum birden çok öğrenciyi kapsar: günlükte öğrenci yoktur, kayıt oturumdur.
    await recordHealthRead(tx, ctx, {
      action: 'finance.health_screening.read',
      entity: { type: SESSIONS, id },
      fields: results.length === 0 ? ['students'] : ['students', ...DETAIL_FIELDS],
      studentId: null,
      reason,
    })
    return { ...view, students }
  })
}

/**
 * Veli sonuçları (K-515): kapsamdaki çocukların (velayetli ve kısıtsız bağ) **yayımlanmış**
 * taramalarının sonuçları; ölçüm, BKİ, ileri değerlendirme işareti, kısa not ve bildirim durumu.
 * Eşik, yazan ve sınıf dönmez. Her dönen sonuç `finance.health_screening.guardian_read`
 * denetimine düşer.
 */
export async function listGuardianScreeningResultsFor(
  ctx: ServiceContext,
  deps: HealthScreeningDeps,
  query: { page: number; pageSize: number; studentId?: string | undefined },
) {
  // Kapsam işlemden önce okunur: tek bağlantılı sürücüde işlem içinden `ctx.db` beklemede kalır.
  const scope = await readScope(ctx)
  const children = [...scope.studentIds].filter(
    (id) => query.studentId === undefined || id === query.studentId,
  )
  return ctx.db.transaction(async (tx) => {
    const { items, total } = await listPublishedResultsForStudents(tx, ctx.institutionId, {
      page: query.page,
      pageSize: query.pageSize,
      studentIds: children,
    })
    const [names, notifications, sessions] = await Promise.all([
      studentNames(
        tx,
        ctx,
        items.map((row) => row.studentId),
      ),
      loadHealthScreeningNotificationStates(
        tx,
        ctx.institutionId,
        items.map((row) => row.id),
      ),
      sessionViews(tx, ctx, [
        ...new Map(items.map((row) => [row.session.id, row.session])).values(),
      ]),
    ])
    const performers = new Map(sessions.map((view) => [view.id, view.performer.name]))
    const data = []
    for (const row of items) {
      const health = resultHealthOf(deps, ctx.institutionId, row)
      data.push({
        id: row.id,
        sessionId: row.session.id,
        kind: row.session.kind,
        screenedOn: row.session.screenedOn,
        performerName: performers.get(row.session.id) ?? '',
        studentId: row.studentId,
        studentName: names.get(row.studentId) ?? null,
        outcome: row.outcome,
        measurement: health.measurement === null ? null : measurementView(health.measurement),
        referralRecommended: row.referralRecommended,
        note: health.note,
        notificationStatus: notifications.get(row.id) ?? null,
        publishedAt: row.session.publishedAt ?? row.session.updatedAt,
      })
      await recordHealthRead(tx, ctx, {
        action: 'finance.health_screening.guardian_read',
        entity: { type: RESULTS, id: row.id },
        fields: GUARDIAN_FIELDS,
        studentId: row.studentId,
        reason: null,
      })
    }
    return { items: data, total }
  })
}
