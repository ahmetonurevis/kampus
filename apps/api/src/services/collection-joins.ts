import type { Scope } from '@kampus/school-core/lib/scope.ts'

import type { CollectionName, RecordData } from '../db/collections.ts'
import { loadRecords, loadRecordsByIds, type FieldMatch, type StoredRecord } from '../db/records.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'

/**
 * Bağlı alanlar (api-tasarimi.md §3): kaydın kimlik alanından (`studentId`, `classId`,
 * `branchId`) bağlı kaydın adı. Liste ve sayım uçlarında `q` bu alanlarda da arar, liste bu
 * alanlarla sıralar; liste ve tek kayıt yanıtı satır başına `studentName`, `className`,
 * `branchName` taşır. Genel ama dar: yalnız aşağıdaki beyaz liste, tek düzey (sınıf adı kayıtta
 * sınıf yoksa öğrencinin güncel sınıfından) ve yalnız ad/numara alanı.
 *
 * Kapsam korunur: bağlı kayıt aktörün okuyabildiği (`access` + `canRead`), arşivlenmemiş ve
 * ayıklanmış kayıttır; kimlik de ana kaydın ayıklanmış biçiminden okunur. Aktörün göremediği
 * bağlı kaydın adı eşleşme, sıra ve yanıt üretmez (boş değer).
 */

export const JOINED_FIELDS = ['studentName', 'studentNumber', 'className', 'branchName'] as const
export type JoinedField = (typeof JOINED_FIELDS)[number]
export type JoinedValues = Partial<Record<JoinedField, string>>

/** Yanıta giren bağlı adlar (`studentNumber` yalnız arama ve sıralamadadır). */
export const RESPONSE_JOINED_FIELDS = ['studentName', 'className', 'branchName'] as const
export type ResponseJoinedField = (typeof RESPONSE_JOINED_FIELDS)[number]
export type JoinedNames = Partial<Record<ResponseJoinedField, string>>

export function isJoinedField(value: string): value is JoinedField {
  return JOINED_FIELDS.some((field) => field === value)
}

const STUDENT_FIELDS: readonly JoinedField[] = ['studentName', 'studentNumber', 'className']
const CLASS_FIELDS: readonly JoinedField[] = ['className']
const BRANCH_FIELDS: readonly JoinedField[] = ['branchName']

/**
 * Koleksiyon → bağlı alanlar (beyaz liste). Öğrenciye bağlı kayıtlar öğrenci adı, numarası ve
 * sınıfı; sınıfa bağlı kayıtlar sınıf adı; kampüse bağlı kayıtlar kampüs adı taşır.
 */
const JOINS: Partial<Record<CollectionName, readonly JoinedField[]>> = {
  classes: BRANCH_FIELDS,
  teachers: BRANCH_FIELDS,
  students: CLASS_FIELDS,
  invoices: STUDENT_FIELDS,
  grades: STUDENT_FIELDS,
  attendance: STUDENT_FIELDS,
  absences: STUDENT_FIELDS,
  submissions: STUDENT_FIELDS,
  quizAttempts: STUDENT_FIELDS,
  contracts: STUDENT_FIELDS,
  mockResults: STUDENT_FIELDS,
  studentGoals: STUDENT_FIELDS,
  studyTasks: STUDENT_FIELDS,
  guidanceCases: STUDENT_FIELDS,
  questions: STUDENT_FIELDS,
  appointments: STUDENT_FIELDS,
  requests: STUDENT_FIELDS,
  renewals: STUDENT_FIELDS,
  enrollmentHistory: STUDENT_FIELDS,
  eventConsents: STUDENT_FIELDS,
  transportAssignments: STUDENT_FIELDS,
  clubMemberships: STUDENT_FIELDS,
  socialAchievements: STUDENT_FIELDS,
  assignments: CLASS_FIELDS,
  quizzes: CLASS_FIELDS,
  homework: CLASS_FIELDS,
  announcements: CLASS_FIELDS,
  schedule: CLASS_FIELDS,
  schoolEvents: ['className', 'branchName'],
  prospects: BRANCH_FIELDS,
  transportRoutes: BRANCH_FIELDS,
  mealMenus: BRANCH_FIELDS,
  clubs: BRANCH_FIELDS,
}

/** Bağlı kaydın koleksiyonu ve ana kayıttaki kimlik alanı (SQL arama adayı). */
const TARGET_KEYS = { students: 'studentId', classes: 'classId', branches: 'branchId' } as const
type JoinTarget = keyof typeof TARGET_KEYS

/** Bağlı alanın kaynağı: hedef koleksiyon ve okunan alan. */
const SOURCES: Record<JoinedField, { target: JoinTarget; field: string }> = {
  studentName: { target: 'students', field: 'name' },
  studentNumber: { target: 'students', field: 'number' },
  className: { target: 'classes', field: 'name' },
  branchName: { target: 'branches', field: 'name' },
}

export function joinedFieldsOf(collection: CollectionName): readonly JoinedField[] {
  return JOINS[collection] ?? []
}

export interface Joiner {
  /** Kaydın bağlı alan değerleri. */
  values(record: RecordData): JoinedValues
  /**
   * Bağlı adı `matches`'i sağlayan kayıtların kimlikleri, ana kaydın kimlik alanı başına (SQL
   * arama adayı). Sınıf adı kayıtta sınıf yoksa öğrenciden çözüldüğü için o sınıfların
   * öğrencileri `studentId` adayıdır.
   */
  relatedKeys(matches: (value: string) => boolean): FieldMatch[]
}

const text = (value: unknown) =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined

type TargetIndex = Map<CollectionName, Map<string, RecordData>>

/** Aktörün okuyabildiği bağlı kayıtlar, kapsamdan geçmiş ve ayıklanmış, hedef başına kimlikle. */
function indexTargets(scope: Scope, rows: readonly StoredRecord[]): TargetIndex {
  const byTarget: TargetIndex = new Map()
  for (const row of rows) {
    if (!scope.canRead(row.collection, row.data)) continue
    let index = byTarget.get(row.collection)
    if (!index) byTarget.set(row.collection, (index = new Map()))
    index.set(row.id, scope.redact(row.collection, row.data))
  }
  return byTarget
}

function makeJoiner(fields: readonly JoinedField[], byTarget: TargetIndex): Joiner {
  const find = (target: CollectionName, id: unknown) =>
    typeof id === 'string' ? byTarget.get(target)?.get(id) : undefined
  const keyOf = (field: JoinedField, record: RecordData): unknown => {
    switch (field) {
      case 'studentName':
      case 'studentNumber':
        return record.studentId
      case 'className':
        return typeof record.classId === 'string'
          ? record.classId
          : find('students', record.studentId)?.classId
      case 'branchName':
        return record.branchId
      default:
        return field satisfies never
    }
  }
  return {
    values(record) {
      const values: JoinedValues = {}
      for (const field of fields) {
        const source = SOURCES[field]
        const value = text(find(source.target, keyOf(field, record))?.[source.field])
        if (value !== undefined) values[field] = value
      }
      return values
    },
    relatedKeys(matches) {
      const keys: Record<(typeof TARGET_KEYS)[JoinTarget], Set<string>> = {
        studentId: new Set(),
        classId: new Set(),
        branchId: new Set(),
      }
      for (const field of fields) {
        const source = SOURCES[field]
        for (const [id, record] of byTarget.get(source.target) ?? []) {
          const value = text(record[source.field])
          if (value !== undefined && matches(value)) keys[TARGET_KEYS[source.target]].add(id)
        }
      }
      if (fields.includes('className'))
        for (const [id, student] of byTarget.get('students') ?? [])
          if (typeof student.classId === 'string' && keys.classId.has(student.classId))
            keys.studentId.add(id)
      return Object.entries(keys).map(([field, values]) => ({ field, values: [...values] }))
    },
  }
}

/**
 * İstenen bağlı alanlar için hedef koleksiyonları bir kez yükler (aktöre görünenler, ayıklanmış)
 * ve kayıt başına değerleri veren işlevi döndürür. Arama ve sıralama için: bütün hedef kayıtlar.
 */
export async function loadJoiner(
  ctx: ServiceContext,
  scope: Scope,
  fields: readonly JoinedField[],
): Promise<Joiner> {
  const targets = new Set<CollectionName>(fields.map((field) => SOURCES[field].target))
  // Sınıf adı kayıtta sınıf yoksa öğrencinin sınıfından çözülür.
  if (fields.includes('className')) targets.add('students')
  const readable = [...targets].filter((target) => scope.access(target).allowed)
  const rows = await loadRecords(ctx.db, ctx.institutionId, readable)
  return makeJoiner(fields, indexTargets(scope, rows))
}

const ids = (records: readonly RecordData[], key: string) => [
  ...new Set(records.flatMap((record) => (typeof record[key] === 'string' ? [record[key]] : []))),
]

/**
 * Yanıt sayfasının bağlı adları (`studentName`, `className`, `branchName`), `records` ile aynı
 * sırada; koleksiyonda bağlı ad tanımlı değilse `null`. Yalnız sayfadaki kayıtların kimlikleri
 * birincil anahtarla yüklenir (bütün öğrenci/sınıf listesi okunmaz). `records` ayıklanmış
 * kayıtlardır: kimlik ayıklanmış biçimden okunur; bağlı kayıt aktörün kapsamından geçmiş ve
 * ayıklanmış olmalıdır, kapsam dışı kaydın adı dönmez.
 */
export async function loadPageNames(
  ctx: ServiceContext,
  scope: Scope,
  collection: CollectionName,
  records: readonly RecordData[],
): Promise<JoinedNames[] | null> {
  const fields = joinedFieldsOf(collection).filter((field): field is ResponseJoinedField =>
    RESPONSE_JOINED_FIELDS.some((name) => name === field),
  )
  if (fields.length === 0) return null
  const load = async (target: JoinTarget, wanted: readonly string[]) =>
    scope.access(target).allowed
      ? await loadRecordsByIds(ctx.db, ctx.institutionId, target, wanted)
      : []
  const needsStudents = fields.includes('studentName') || fields.includes('className')
  const students = needsStudents ? await load('students', ids(records, 'studentId')) : []
  const studentIndex = indexTargets(scope, students).get('students') ?? new Map()
  // Sınıf adı kayıttaki `classId`'den, yoksa öğrencinin güncel sınıfından çözülür.
  const classIds = fields.includes('className')
    ? [...new Set([...ids(records, 'classId'), ...ids([...studentIndex.values()], 'classId')])]
    : []
  const [classes, branches] = await Promise.all([
    load('classes', classIds),
    fields.includes('branchName') ? load('branches', ids(records, 'branchId')) : [],
  ])
  const joiner = makeJoiner(fields, indexTargets(scope, [...students, ...classes, ...branches]))
  return records.map((record) => {
    const { studentName, className, branchName } = joiner.values(record)
    return {
      ...(studentName === undefined ? {} : { studentName }),
      ...(className === undefined ? {} : { className }),
      ...(branchName === undefined ? {} : { branchName }),
    }
  })
}
