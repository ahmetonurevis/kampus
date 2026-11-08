import { sql } from 'drizzle-orm'

import {
  prospectSeasonWatch,
  seasonWatchWindow,
  type SeasonWatch,
  type SeasonWatchQuery,
} from '@kampus/school-core/lib/prospect-season-watch.ts'

import {
  loadRecordNames,
  loadSeasonLessons,
  loadSeasonProspects,
} from '../db/prospect-season-watch.ts'
import type { Database } from '../db/client.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'

/**
 * Kayıt sezonu nöbeti (`GET /api/v1/prospects/season-watch`; DOM-KAY-037, ON-077). Kurum yalnız
 * oturumdan gelir; hesap core `prospectSeasonWatch`'tadır. Adaydan yalnız nöbette okunan alanlar,
 * derslerden yalnız deneme derslerinin bağlı olduğu dersler, adlardan yalnız satırlarda geçen
 * kampüs, grup ve öğretmen okunur. Okulda deneme dersi okunmaz. Satır loglanmaz. Okumalar tek salt
 * okunur görüntüdedir: aday ile dersi arasında yazılan bir değişiklik yarım görünmez.
 */
export function getProspectSeasonWatch(
  ctx: ServiceContext,
  query: SeasonWatchQuery,
): Promise<SeasonWatch> {
  return ctx.db.transaction(async (tx) => {
    // İlk ifade olmalı: görüntü ilk sorguda sabitlenir.
    await tx.execute(sql`set transaction isolation level repeatable read read only`)
    return seasonWatch(tx, ctx.institutionId, ctx.now.toISOString(), query)
  })
}

async function seasonWatch(
  db: Database,
  institutionId: string,
  now: string,
  query: SeasonWatchQuery,
): Promise<SeasonWatch> {
  const institution = await getInstitutionModules(db, institutionId)
  if (institution === null) throw new NotFoundError()
  const prospects = await loadSeasonProspects(db, institutionId)
  const trialsEnabled = institution.type === 'language_school'
  const lessonIds = trialsEnabled
    ? prospects.flatMap((item) => (item.trialLesson ? [item.trialLesson.lessonId] : []))
    : []
  const lessons = await loadSeasonLessons(db, institutionId, lessonIds)
  const classIds = [
    ...lessons.flatMap((lesson) => (lesson.classId === null ? [] : [lesson.classId])),
    ...prospects.flatMap((item) => (item.trialLesson?.classId ? [item.trialLesson.classId] : [])),
  ]
  const [branches, classes, teachers] = [
    await loadRecordNames(
      db,
      institutionId,
      'branches',
      prospects.flatMap((item) => (item.branchId === null ? [] : [item.branchId])),
    ),
    await loadRecordNames(db, institutionId, 'classes', trialsEnabled ? classIds : []),
    await loadRecordNames(
      db,
      institutionId,
      'teachers',
      prospects.flatMap((item) => (item.meeting?.teacherId ? [item.meeting.teacherId] : [])),
    ),
  ]
  return prospectSeasonWatch({
    now,
    window: seasonWatchWindow(now, query.days),
    institutionType: institution.type,
    prospects,
    lessons,
    branches,
    classes,
    teachers,
  })
}
