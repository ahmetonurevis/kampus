// İçerikten toplu atama ve içeriğe bağlı sonuç özetinin saf modeli (OG-089; IST-034, DOM-BEC-049,
// DOM-BEC-036). Kural ve hesap sunucudadır (core `assignmentBatchInputSchema`, `planAssignmentBatch`,
// `tallyOutcomes`); burada yalnız form doğrulaması, gövde kurulumu, hata yolu eşlemesi ve sunum var.
import { z } from 'zod'
import type {
  ContentAssignmentResults,
  TaskAssignmentBatchBody,
} from '@kampus/react-shared/use-content-assignments.ts'
import { ASSIGNMENT_BATCH_MAX, TARGET_KINDS } from '@kampus/school-core/skills/assignment.ts'
import { istanbulLocalToUtc, TASK_KINDS } from '@kampus/school-core/skills/scoring.ts'
import {
  assignmentBody,
  assignmentFormSchema,
  checkAssignmentSettings,
  dateTimeLabel,
  defaultAssignment,
  dueAtIssue,
  formFieldFor,
  LEARNER_FALLBACK,
  TASK_TYPE_OPTIONS,
  type AssignmentFormOutput,
  type TargetNames,
  type TaskType,
} from '../tasks/task-model.ts'

// --- Atanabilirlik -------------------------------------------------------------------------

/** İçerik türünün görev türü; atanamayan türde (okuma parçası, dosya…) `null`. */
export function contentTaskType(contentType: string): TaskType | null {
  return TASK_TYPE_OPTIONS.find((option) => option.value === contentType)?.value ?? null
}

/** Görev atayabilen roller (DOM-YTK-022); sunucu kapsamı ayrıca uygular. */
const ASSIGNING_ROLES: readonly string[] = ['yonetici', 'ogretmen']

/**
 * İçerik ayrıntısında "Ata" düğmesi görünür mü: atayan rol, atanabilir tür ve güncel yayındaki
 * sürüm (DOM-KYN-032: yalnız güncel yayındaki sürüm atanır). Son söz sunucudadır.
 */
export function canAssignContent(input: {
  role: string
  contentType: string
  currentVersionId: string | null
  /** Güncel sürümün durumu; arşivli/kaldırılmış sürüm atanmaz. */
  currentStatus: string | null
}): boolean {
  return (
    ASSIGNING_ROLES.includes(input.role) &&
    contentTaskType(input.contentType) !== null &&
    input.currentVersionId !== null &&
    input.currentStatus === 'published'
  )
}

/** Sonuç özetini görebilen roller (DOM-BEC-036: yalnız personel, yönetici ve öğretmen). */
export const canSeeContentResults = (role: string) => ASSIGNING_ROLES.includes(role)

// --- Form ----------------------------------------------------------------------------------

export type TargetKind = keyof typeof TARGET_KINDS
const TARGET_KIND_VALUES = Object.keys(TARGET_KINDS) as [TargetKind, ...TargetKind[]]

/** Kurum türünün grup hedefi: okulda sınıf/şube, dil okulunda grup. */
export const groupKindFor = (institutionType: string): 'class' | 'group' =>
  institutionType === 'language_school' ? 'group' : 'class'

/** Hedef türü seçenekleri: kurumun grup türü ve öğrenci. */
export function targetKindOptions(institutionType: string) {
  const group = groupKindFor(institutionType)
  return [
    { value: group, label: group === 'group' ? 'Grup' : 'Sınıf' },
    { value: 'student' as const, label: 'Öğrenci' },
  ]
}

const settings = assignmentFormSchema.shape

export const contentAssignFormSchema = z
  .object({
    taskType: settings.taskType,
    kind: settings.kind,
    maxAttempts: settings.maxAttempts,
    countPolicy: settings.countPolicy,
    maxVersions: settings.maxVersions,
    minWords: settings.minWords,
    maxWords: settings.maxWords,
    rubricVersionId: settings.rubricVersionId,
    listeningPlays: settings.listeningPlays,
    lateAcceptanceDays: settings.lateAcceptanceDays,
    rows: z
      .array(z.object({ kind: z.enum(TARGET_KIND_VALUES), id: z.string(), dueAt: z.string() }))
      .min(1, 'En az bir hedef ekleyin.')
      .max(
        ASSIGNMENT_BATCH_MAX,
        `Tek seferde en fazla ${ASSIGNMENT_BATCH_MAX} hedef satırı eklenir.`,
      ),
  })
  .superRefine((value, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: 'custom', path, message })
    const seen = new Set<string>()
    value.rows.forEach((row, index) => {
      if (row.id === '') issue(['rows', index, 'id'], 'Bir hedef seçin.')
      else {
        const key = `${row.kind}:${row.id}`
        // DOM-BEC-049: bir hedef iki kez seçilemez.
        if (seen.has(key)) issue(['rows', index, 'id'], 'Bu hedef zaten seçildi.')
        seen.add(key)
      }
      const due = dueAtIssue(row.dueAt, value.kind)
      if (due !== null) issue(['rows', index, 'dueAt'], due)
    })
    checkAssignmentSettings(value, (path, message) => issue([path], message))
  })
export type ContentAssignFormValues = z.input<typeof contentAssignFormSchema>
export type ContentAssignFormOutput = z.output<typeof contentAssignFormSchema>
export type TargetRowValues = ContentAssignFormValues['rows'][number]

export const emptyTargetRow = (kind: TargetKind): TargetRowValues => ({ kind, id: '', dueAt: '' })

/** Başlangıç değerleri: içerik türünün görev türü ve kurumun grup türünde boş bir satır. */
export function contentAssignDefaults(
  taskType: TaskType,
  institutionType: string,
): ContentAssignFormValues {
  const { kind, maxAttempts, countPolicy, maxVersions, minWords, maxWords } = defaultAssignment
  const { rubricVersionId, listeningPlays, lateAcceptanceDays } = defaultAssignment
  return {
    taskType,
    kind,
    maxAttempts,
    countPolicy,
    maxVersions,
    minWords,
    maxWords,
    rubricVersionId,
    listeningPlays,
    lateAcceptanceDays,
    rows: [emptyTargetRow(groupKindFor(institutionType))],
  }
}

export type BatchPlan = {
  body: TaskAssignmentBatchBody
  /** Her öğedeki hedeflerin form satır sırası (`rowsOfItem[öğe][hedef]`); hata eşlemesi için. */
  rowsOfItem: number[][]
}

/**
 * Form değerinden toplu atama gövdesi (DOM-BEC-049). Aynı son tarihli satırlar tek atamada
 * birleşir (sunucuda bir son tarih = bir atama); her öğe tek atamanın gövdesiyle kurulur, ayarlar
 * bütün öğelerde aynıdır. Son tarih Europe/Istanbul duvar saatinden UTC ISO'ya çevrilir.
 */
export function batchBody(
  values: ContentAssignFormOutput,
  resourceVersionId: string,
  listening = false,
): BatchPlan {
  type Group = { local: string; rows: number[]; targets: { kind: TargetKind; id: string }[] }
  const groups = new Map<string, Group>()
  values.rows.forEach((row, index) => {
    const local = row.dueAt.trim()
    const key = local === '' ? '' : (istanbulLocalToUtc(local) ?? local)
    const group = groups.get(key) ?? { local, rows: [], targets: [] }
    group.rows.push(index)
    group.targets.push({ kind: row.kind, id: row.id })
    groups.set(key, group)
  })
  const items: TaskAssignmentBatchBody['items'] = []
  const rowsOfItem: number[][] = []
  for (const { local, rows, targets } of groups.values()) {
    const single: AssignmentFormOutput = {
      ...values,
      resourceId: '',
      targets: [],
      dueAt: local,
    }
    const item = assignmentBody(single, resourceVersionId, 'class', listening)
    items.push({ ...item, targets })
    rowsOfItem.push(rows)
  }
  return { body: { items }, rowsOfItem }
}

/**
 * Sunucu hata yolunu (`items.<öğe>.…`) form alanına çevirir: hedef hatası ilgili satırın hedef
 * alanına, son tarih hatası satırın son tarihine, ayar hataları ortak ayar alanına düşer. Satırı
 * bulunamayan yol form düzeyi hatadır.
 */
export function batchFieldFor(path: string, rowsOfItem: readonly (readonly number[])[]): string {
  const [first, itemText, ...rest] = path.split('.')
  if (first === 'rows' && itemText !== undefined) return path
  if (first !== 'items' || itemText === undefined || !/^\d+$/.test(itemText)) return 'root.server'
  const rows = rowsOfItem[Number(itemText)]
  if (rows === undefined || rows.length === 0) return 'root.server'
  const [head, second, third] = rest
  if (head === 'targets') {
    const row = second !== undefined && /^\d+$/.test(second) ? rows[Number(second)] : rows[0]
    return row === undefined ? `rows.${rows[0]}.id` : `rows.${row}.id`
  }
  if (head === 'settings' && second === 'deadline' && third === 'dueAt')
    return `rows.${rows[0]}.dueAt`
  const field = formFieldFor(rest.join('.'))
  return field === 'resourceId' || field === 'targets' || field === 'dueAt' ? 'root.server' : field
}

// --- Sonuç özeti ---------------------------------------------------------------------------

/** Yüzde ortalaması Türkçe biçimde (`%72,5`); puan yoksa "—". */
export function averageLabel(value: number | null): string {
  if (value === null) return '—'
  return `%${value.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`
}

export interface ResultRow extends Record<string, unknown> {
  id: string
  title: string
  kind: string
  target: string
  dueAt: string
  learners: number
  completed: string
  average: string
}

type ResultAssignment = ContentAssignmentResults['assignments'][number]

function targetLabel(target: ResultAssignment['targets'][number], names: TargetNames): string {
  return target.kind === 'student' ? LEARNER_FALLBACK : names.className(target.id)
}

/** Tamamlayan / kursiyer ("3/24"). */
const completedLabel = (tally: { completed: number; learners: number }) =>
  `${tally.completed}/${tally.learners}`

/**
 * Özet tablosunun satırları: atama ve hedef başına bir satır (DOM-BEC-036). Sıra sunucunun
 * döndürdüğü sıradır (en yeni atama önce).
 */
export function resultRows(results: ContentAssignmentResults, names: TargetNames): ResultRow[] {
  return results.assignments.flatMap((assignment) =>
    assignment.targets.map((target) => ({
      id: `${assignment.assignmentId}:${target.kind}:${target.id}`,
      title: assignment.title,
      kind: TASK_KINDS[assignment.kind].label,
      target: targetLabel(target, names),
      dueAt: dateTimeLabel(assignment.deadline.dueAt),
      learners: target.learners,
      completed: completedLabel(target),
      average: averageLabel(target.averagePercent),
    })),
  )
}

/** Bütün atamaların toplamının tek satırlık metni. */
export function resultTotalsLabel(results: ContentAssignmentResults): string {
  const { totals } = results
  const count = results.assignments.length
  return `${count} atama · ${totals.learners} kursiyer · ${totals.completed} tamamlayan · ortalama ${averageLabel(totals.averagePercent)}`
}

/** Özet tablosunun liste parametre öneki; panel kapanınca silinir (bir sonraki içeriğe taşınmaz). */
export const RESULT_LIST_PREFIX = 'sn-'
export const RESULT_LIST_PARAMS: readonly string[] = [
  `${RESULT_LIST_PREFIX}sayfa`,
  `${RESULT_LIST_PREFIX}sirala`,
]
