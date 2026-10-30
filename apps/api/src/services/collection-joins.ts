import type { Scope } from '@kampus/school-core/lib/scope.ts'

import type { CollectionName, RecordData } from '../db/collections.ts'
import { loadRecords, type FieldMatch } from '../db/records.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'

/**
 * Bağlı alanlar (api-tasarimi.md §3): kaydın kimlik alanından (`studentId`, `classId`,
 * `branchId`) bağlı kaydın adı. Liste ve sayım uçlarında `q` bu alanlarda da arar, liste bu
 * alanlarla sıralar. Genel ama dar: yalnız aşağıdaki beyaz liste, tek düzey (sınıf adı kayıtta
 * sınıf yoksa öğrencinin güncel sınıfından) ve yalnız ad/numara alanı.
 *
 * Kapsam korunur: bağlı kayıt aktörün okuyabildiği (`access` + `canRead`), arşivlenmemiş ve
 * ayıklanmış kayıttır; kimlik de ana kaydın ayıklanmış biçiminden okunur. Aktörün göremediği
 * bağlı kaydın adı eşleşme ve sıra üretmez (boş değer).
 */

export const JOINED_FIELDS = ['studentName', 'studentNumber', 'className', 'branchName'] as const
export type JoinedField = (typeof JOINED_FIELDS)[number]
export type JoinedValues = Partial<Record<JoinedField, string>>

export function isJoinedField(value: string): value is JoinedField {
  return JOINED_FIELDS.some((field) => field === value)
}

const STUDENT_FIELDS: readonly JoinedField[] = ['studentName', 'studentNumber', 'className']

/** Koleksiyon → bağlı alanlar (beyaz liste). */
const JOINS: Partial<Record<CollectionName, readonly JoinedField[]>> = {
  classes: ['branchName'],
  invoices: STUDENT_FIELDS,
  grades: STUDENT_FIELDS,
  attendance: STUDENT_FIELDS,
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

/**
 * İstenen bağlı alanlar için hedef koleksiyonları bir kez yükler (aktöre görünenler, ayıklanmış)
 * ve kayıt başına değerleri veren işlevi döndürür.
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
  const byTarget = new Map<CollectionName, Map<string, RecordData>>()
  for (const row of rows) {
    if (!scope.canRead(row.collection, row.data)) continue
    let index = byTarget.get(row.collection)
    if (!index) byTarget.set(row.collection, (index = new Map()))
    index.set(row.id, scope.redact(row.collection, row.data))
  }
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
