// Okul iş akışı ekranlarının saf hesapları: hangi koleksiyonlar okunur, okunan kayıtlardan core
// `State` nasıl kurulur, satır/CSV/form önizlemesi nasıl türetilir. Sunum metinleri ve kapsam
// kuralları core `workflow-presentation.ts`'tedir; burada ikinci kopya yazılmaz.
import type { State } from '@kampus/school-core/data/seed.ts'
import type { Session as CoreSession } from '@kampus/school-core/lib/domain.ts'
import { dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  changeFormValue,
  readFormValue,
  type FormValues,
  type WorkflowField,
  type WorkflowRow,
} from '@kampus/school-core/lib/workflow-presentation.ts'
import {
  COLLECTION_NAMES,
  type CollectionName,
} from '@kampus/school-core/modules/collection-modules.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'

/**
 * Modülün sunumunun okuduğu koleksiyonlar; ilki ana koleksiyondur (okunamazsa sayfa hata
 * gösterir). Optik ve etüt kendi ekranlarındadır (W7b).
 */
export const MODULE_SOURCES = {
  goals: ['studentGoals', 'mockExams', 'mockResults', 'subjects'],
  guidance: ['guidanceCases'],
  exams: ['mockExams', 'mockResults', 'subjects', 'opticalProfiles', 'opticalEvaluations'],
  renewal: ['renewals', 'branches'],
  planning: ['schedule', 'subjects', 'branches'],
  study: ['studyTasks', 'subjects'],
  calendar: ['schoolEvents', 'eventConsents', 'branches'],
  transport: ['transportRoutes', 'transportAssignments', 'branches'],
  meals: ['mealMenus', 'branches'],
  clubs: ['clubs', 'clubMemberships', 'clubAttendance', 'socialAchievements', 'branches'],
} as const satisfies Record<string, readonly CollectionName[]>

export type WorkflowModuleKey = keyof typeof MODULE_SOURCES

/** Kapsam kaynakları (`workflowScope`): öğretmen ataması ve kulüp sorumluluğu kurum dışı rollerde. */
const SCOPE_SOURCES = ['students', 'teachers', 'classes'] as const satisfies CollectionName[]
const MEMBER_SCOPE_SOURCES = ['assignments', 'clubs'] as const satisfies CollectionName[]

export type WorkflowSource = { collection: CollectionName; primary: boolean }

export function isWorkflowModuleKey(key: string): key is WorkflowModuleKey {
  return Object.hasOwn(MODULE_SOURCES, key)
}

/** Okunacak koleksiyonlar (tekrarsız, ana koleksiyon ilk sırada). */
export function workflowSources(module: WorkflowModuleKey, role: Role): WorkflowSource[] {
  const institution = role === 'yonetici' || role === 'onburo'
  const names = new Set<CollectionName>([
    ...MODULE_SOURCES[module],
    ...SCOPE_SOURCES,
    ...(institution ? [] : MEMBER_SCOPE_SOURCES),
  ])
  const [primary] = MODULE_SOURCES[module]
  return [...names].map((collection) => ({ collection, primary: collection === primary }))
}

export type WorkflowContext = {
  modules: Readonly<Record<string, boolean>>
  academicYear: number | null
}

/**
 * Okunan kayıtlardan core `State`: okunmayan koleksiyonlar boştur. `createSeed` içe aktarılmaz
 * (paket boyutu); sunum işlevleri yalnız kendi modülünün ve kapsam kaynaklarının dizilerini okur.
 */
export function buildWorkflowState(
  records: Partial<Record<CollectionName, readonly unknown[]>>,
  context: WorkflowContext,
): State {
  const collections = Object.fromEntries(
    COLLECTION_NAMES.map((name) => [name, records[name] ?? []]),
  )
  // Koleksiyon dizileri sunucudan core tipinde gelir (aynı Zod şemaları); kalan alanlar sabit.
  return {
    ...collections,
    version: 3,
    createdAt: '',
    preferences: {},
    modules: { ...context.modules },
    ...(context.academicYear === null ? {} : { academicYear: context.academicYear }),
  } as unknown as State
}

/** Kayıt kimliği → sürüm (If-Match). Sunucu sürümü komutun koleksiyonlarındaki kimlikle eşler. */
export function versionMap(rows: readonly { id: string; version: number }[]): Map<string, number> {
  return new Map(rows.map((row) => [row.id, row.version]))
}

type SessionLike = {
  role: Role
  links: readonly { kind: 'student' | 'child' | 'teacher'; recordId: string }[]
}

/** Core oturumu: veli için seçili çocuk (`?cocuk=`), aktör bağlantıları `/me`'den. */
export function coreSession(session: SessionLike, childId: string): CoreSession {
  return {
    role: session.role,
    links: session.links,
    ...(session.role === 'veli' && childId ? { childId } : {}),
  }
}

/** Tablo ve CSV satırı: core satırının düz metin alanları (kayıt kaynağı taşınmaz). */
export type WorkflowTableRow = {
  id: string
  kind: string
  title: string
  subtitle: string
  body: string
  status: string
  date: string
}

export function workflowTableRow(row: WorkflowRow): WorkflowTableRow {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? '',
    subtitle: row.subtitle,
    body: row.body,
    status: row.status,
    date: row.date ?? '',
  }
}

/** Liste alt metni (Vue): rol kapsamını söyler. */
export function workflowScopeLabel(role: Role): string {
  if (role === 'veli') return 'Seçili çocuğunuzun kayıtları'
  if (role === 'ogretmen') return 'Görev kapsamınızdaki kayıtlar'
  return 'Okul iş akışları'
}

/** `datetime-local` değeri (Europe/Istanbul); ISO değilse olduğu gibi döner. */
export function localDateTime(value: unknown): string {
  if (typeof value !== 'string') return ''
  if (!Number.isFinite(Date.parse(value)) || /^[0-9-]+T\d{2}:\d{2}$/.test(value)) return value
  return `${dayKey(value)}T${timeLabel(value)}`
}

/** Formun başlangıç değerleri: tarih-saat alanları `datetime-local` biçimine çevrilir. */
export function formDefaults(
  fields: (values: FormValues) => readonly WorkflowField[],
  initial: FormValues,
): FormValues {
  const values: FormValues = structuredClone(initial)
  for (const field of fields(values))
    if (field.type === 'datetime') values[field.key] = localDateTime(values[field.key])
  return values
}

/**
 * Bir alan değişince core'un sıfırladığı bağımlı alanlar (`changeFormValue`: düzey → dersler,
 * kampüs → sınıf, güzergâh → durak…). Değişen alanın kendisi dönmez.
 */
export function dependentResets(
  values: FormValues,
  key: string,
  value: unknown,
): [string, unknown][] {
  const next = changeFormValue(values, key, value)
  return Object.keys(next)
    .filter((name) => name !== key && name !== 'marks' && next[name] !== values[name])
    .map((name) => [name, next[name]])
}

export type PreviewLine = { key: string; label: string; value: string }

/** "Kaydetmeden önce kontrol edin" satırları (Vue önizlemesi). */
export function formPreview(fields: readonly WorkflowField[], values: FormValues): PreviewLine[] {
  return fields.map((field) => {
    const value = readFormValue(values, field.key)
    const options = field.options ?? []
    let text: string
    if (field.type === 'select')
      text = options.find((o) => o.value === String(value ?? ''))?.label || 'Seçilmedi'
    else if (field.type === 'multi')
      text = options
        .filter((o) => Array.isArray(value) && value.includes(o.value))
        .map((o) => o.label)
        .join(', ')
    else if (field.type === 'checkbox') text = value ? 'Evet' : 'Hayır'
    else if (field.type === 'datetime' && typeof value === 'string') text = value.replace('T', ' ')
    else text = value === undefined || value === null ? '' : String(value)
    return { key: field.key, label: field.label, value: text || '—' }
  })
}
