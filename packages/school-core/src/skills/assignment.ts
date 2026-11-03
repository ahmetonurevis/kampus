import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import { scopeFor, type Actor } from '../lib/scope.ts'
import type { AuthorizationSource } from '../lib/authorize.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type {
  AnswerKey,
  ResourceContent,
  ResourceRecord,
  ResourceTags,
  ResourceVersion,
} from '../content/resource.ts'
import {
  answerKeyReleased,
  answerLocaleForTags,
  attemptRulesSchema,
  countedAttempt,
  deadlineSchema,
  isClosed,
  scoreAttempt,
  scoringModeFor,
  submissionWindow,
  type Answers,
  type AttemptRules,
  type Deadline,
  type ScoringItem,
  type TaskKind,
} from './scoring.ts'
import { submissionSettingsSchema, type SubmissionRow, type VersionRow } from './submission.ts'
import {
  RUBRIC_SKILLS,
  SECOND_RATING_MIN_PERCENT,
  assertRubricAssignable,
  scoreResolution,
  type RubricScoreRow,
  type RubricSkill,
  type RubricVersionRow,
} from './rubric.ts'

/**
 * Görev ataması: ayarların birleştirilmesi ve sabitlenmesi, hedef kapsamı, aynı içeriğin ayrı
 * atamaları, yeniden teslim isteğinin son tarihi ve anahtar düzeltmesinde yeniden puanlama
 * önizlemesi (ADR 0004 karar 4; DOM-KYN-032, DOM-BEC-005, 011, 041, 042, 044; IST-034).
 *
 * Satırlar: `task_assignments` (içerik sürümü, puanlama sürümü, rubrik sürümü ve ayarlar atama
 * anında sabitlenir) ve `task_assignment_targets` (sınıf/şube, dil grubu, öğrenci). Hedef
 * kimlikleri `records` kayıtlarına işaret eder; kapsamı `lib/scope.ts` ile çözülür. Fonksiyonlar
 * saftır, `now` alır ve yazılacak satırı döndürür; kimlik, görünürlük okuması ve yazma servistedir.
 */

z.config(z.locales.tr())

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)
const instant = z.iso.datetime({ error: 'Geçerli bir tarih ve saat girin.' })
const text = (max: number, required: string, min = 1) =>
  z
    .string()
    .trim()
    .min(min, required)
    .max(max, `En fazla ${max.toLocaleString('tr-TR')} karakter girebilirsiniz.`)

type Instant = Date | string
const toMs = (value: Instant) => (typeof value === 'string' ? Date.parse(value) : value.getTime())
const toIso = (ms: number) => new Date(ms).toISOString()
const DAY = 24 * 60 * 60_000

// --- Ayarlar ------------------------------------------------------------------------------

/** Dinleme hakkı (DOM-BEC-005): 1, 2 veya sınırsız (`null`); değerlendirmede varsayılan 2. */
// TODO(beceri-dinleme-alistirma): Domain alıştırmanın varsayılanını vermiyor; en muhafazakâr
// yorumla alıştırmada da 2 uygulandı. Öğretmen sınırsız seçebilir.
export const LISTENING_PLAYS_DEFAULT = 2

/**
 * Atama ayarları (ADR 0004 karar 4). Varsayılanlar F4a1 şemalarından gelir: değerlendirme, hak 1,
 * ilk deneme sayılır; geç teslim kapalı; teslim sürüm sınırı 3. `timeLimitMinutes` verilmezse
 * içeriğin süresi kullanılır. İkinci puanlama oranı (`secondRatingPercent`) yalnız öğretmen puanlı
 * görevde vardır: yüksek sonuçlu görevde varsayılan ve en az %10, diğerlerinde varsayılan 0'dır;
 * içerikle birleşirken (`resolveAssignmentSettings`) denetlenir (DOM-BEC-024).
 */
export const assignmentSettingsSchema = z
  .object({
    attempts: attemptRulesSchema.prefault({ kind: 'evaluation' }),
    deadline: deadlineSchema.prefault({}),
    timeLimitMinutes: z.number().int().min(1).max(300).nullable().optional(),
    /**
     * Dinleme hakkı; verilmezse (`undefined`) dinleme görevinde `LISTENING_PLAYS_DEFAULT`
     * (`resolveAssignmentSettings`). Verilmemiş hak seçilmiş haktan ayrı tutulur: API sayılacak
     * kaydı olmayan görevde yalnız açıkça seçilen sınırı reddeder (IST-045).
     */
    listeningPlays: z
      .union([z.literal(1), z.literal(2)])
      .nullable()
      .optional(),
    /** Dinleme dökümü görev kapanmadan gösterilmez (DOM-BEC-005); yalnız alıştırmada açılabilir. */
    showTranscript: z.boolean().default(false),
    submission: submissionSettingsSchema.nullable().default(null),
    /** Seviye tespiti, kur sonu veya sınav niteliğindeki görev (DOM-BEC-024). */
    highStakes: z.boolean().default(false),
    secondRatingPercent: z.number().int().min(0).max(100).optional(),
    rubricVersionId: identifier.nullable().default(null),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message })
    if (s.attempts.kind === 'evaluation' && s.deadline.dueAt === null) {
      issue(['deadline', 'dueAt'], 'Değerlendirme görevine son teslim tarihi girin.')
    }
    if (s.attempts.kind === 'evaluation' && s.showTranscript) {
      issue(
        ['showTranscript'],
        'Değerlendirmede döküm görev kapanmadan gösterilmez; erişilebilirlik uyarlamasını kursiyere ayrı tanımlayın.',
      )
    }
    if (s.attempts.kind === 'practice' && s.highStakes) {
      issue(['highStakes'], 'Alıştırma kur sonu veya sınav niteliğinde olamaz.')
    }
  })
export type AssignmentSettingsInput = z.input<typeof assignmentSettingsSchema>
export type AssignmentSettings = z.output<typeof assignmentSettingsSchema>

/** Atama anında sabitlenen alanlar (`task_assignments` kolonları; ADR 0004 karar 4). */
export type FixedAssignment = {
  resourceId: string
  resourceVersionId: string
  /** Puanlamanın okunduğu sürüm; başta içerik sürümüdür, yalnız `planRescore` değiştirir. */
  scoringVersionId: string
  rubricVersionId: string | null
  scoringMode: 'auto' | 'teacher'
  kind: TaskKind
  attempts: AttemptRules
  deadline: Deadline
  timeLimitMinutes: number | null
  listeningPlays: 1 | 2 | null
  showTranscript: boolean
  submission: AssignmentSettings['submission']
  highStakes: boolean
  secondRatingPercent: number
}

/** Atanan içerik: kaynak satırı ve atanacak sürüm. */
export type AssignedContent = {
  resource: Pick<ResourceRecord, 'id' | 'contentType' | 'currentVersionId'>
  version: Pick<ResourceVersion, 'id' | 'resourceId' | 'status' | 'tags' | 'content'>
}

const rule = (code: string, message: string, path: string[], kind: 'rule' | 'conflict' = 'rule') =>
  new DomainError(code, message, { kind, path })

const isRubricSkill = (skill: string | null): skill is RubricSkill =>
  skill !== null && (RUBRIC_SKILLS as readonly string[]).includes(skill)

/**
 * Dinleme görevi mi (DOM-BEC-005): birincil becerisi dinleme olan içerik ya da dinleme kaydına
 * bağlı quiz/alıştırma seti (`listeningVersionId`, IST-045). Dinleme hakkı yalnız bunlarda
 * sabitlenir; sayılacak kaydı yalnız kayda bağlı etkinlik taşır (`recordingVersionId`).
 */
export function isListeningTask(version: Pick<ResourceVersion, 'tags' | 'content'>): boolean {
  return version.tags.primarySkill === 'listening' || recordingVersionId(version.content) !== null
}

/** Quiz/alıştırma setinin bağlı dinleme kaydı sürümü; bağ yoksa ya da başka türse `null`. */
export function recordingVersionId(content: ResourceContent | null): string | null {
  if (content?.type !== 'quiz' && content?.type !== 'exercise_set') return null
  return content.listeningVersionId
}

/**
 * Kursiyer ve veli dinleme dökümünü görür mü (DOM-BEC-005): görev kapandıysa (son teslim ve geç
 * kabul geçti, `isClosed`) ya da alıştırmada öğretmen açtıysa (`showTranscript`; değerlendirmede
 * açılamaz, `assignmentSettingsSchema`). Personel dökümü hep görür; bu karar çağırana aittir.
 */
// TODO(beceri-dinleme-uyarlama): işitme engelli kursiyere değerlendirmede kişiye özel döküm açma
// (erişilebilirlik uyarlaması) atama düzeyinde değil, kursiyer düzeyinde tanımlanacak; bugün yok.
export function transcriptShown(
  assignment: Pick<FixedAssignment, 'showTranscript' | 'deadline'>,
  now: Instant,
): boolean {
  return assignment.showTranscript || isClosed(assignment.deadline, now)
}

/**
 * Ayarları içerikle birleştirip sabitler (ADR 0004 karar 4; DOM-KYN-032). Yalnız güncel yayındaki
 * sürüm atanır; otomatik puanlı görevde teslim ve rubrik, öğretmen puanlı görevde deneme hakkı ve
 * süre uygulanmaz. Yazma, konuşma ve aracılık görevi rubrikle puanlanır (DOM-BEC-020); rubrik
 * sürümü yayında olmalı ve becerisi görevinkiyle aynı olmalıdır.
 */
export function resolveAssignmentSettings(
  input: AssignedContent & {
    settings: AssignmentSettings
    rubricVersion: RubricVersionRow | null
    now: Instant
  },
): FixedAssignment {
  const { resource, version, settings, rubricVersion } = input
  const scoringMode = scoringModeFor(resource.contentType)
  if (scoringMode === null) {
    throw rule('resource_not_assignable', 'Bu içerik görev olarak atanamaz.', ['resourceVersionId'])
  }
  if (
    version.resourceId !== resource.id ||
    version.status !== 'published' ||
    resource.currentVersionId !== version.id
  ) {
    throw rule(
      'resource_version_not_assignable',
      'Yalnız içeriğin güncel yayındaki sürümü atanır.',
      ['resourceVersionId'],
      'conflict',
    )
  }
  const { dueAt } = settings.deadline
  if (dueAt !== null && toMs(dueAt) <= toMs(input.now)) {
    throw rule('due_in_past', 'Son teslim tarihi ileri bir an olmalıdır.', ['deadline', 'dueAt'])
  }
  const content: ResourceContent = version.content
  const base = {
    resourceId: resource.id,
    resourceVersionId: version.id,
    scoringVersionId: version.id,
    kind: settings.attempts.kind,
    attempts: settings.attempts,
    deadline: settings.deadline,
    showTranscript: settings.showTranscript,
    highStakes: settings.highStakes,
  }
  if (scoringMode === 'auto') {
    if (settings.submission !== null) {
      throw rule('submission_not_applicable', 'Otomatik puanlı görevde teslim ayarı olmaz.', [
        'submission',
      ])
    }
    if (settings.rubricVersionId !== null) {
      throw rule('rubric_not_applicable', 'Otomatik puanlı görev rubrikle puanlanmaz.', [
        'rubricVersionId',
      ])
    }
    if ((settings.secondRatingPercent ?? 0) > 0) {
      throw rule(
        'second_rating_not_applicable',
        'İkinci puanlama yalnız öğretmen puanlı görevdedir.',
        ['secondRatingPercent'],
      )
    }
    const contentLimit =
      content.type === 'quiz' || content.type === 'exercise_set' ? content.timeLimitMinutes : null
    return {
      ...base,
      rubricVersionId: null,
      scoringMode,
      timeLimitMinutes:
        settings.timeLimitMinutes === undefined ? contentLimit : settings.timeLimitMinutes,
      listeningPlays: isListeningTask(version)
        ? settings.listeningPlays === undefined
          ? LISTENING_PLAYS_DEFAULT
          : settings.listeningPlays
        : null,
      submission: null,
      secondRatingPercent: 0,
    }
  }
  if (content.type !== 'homework_template') {
    throw rule('resource_not_assignable', 'Bu içerik görev olarak atanamaz.', ['resourceVersionId'])
  }
  if (settings.submission === null) {
    throw rule('submission_settings_required', 'Teslim türünü ve sürüm sınırını seçin.', [
      'submission',
    ])
  }
  if (!content.submissionKinds.includes(settings.submission.submissionKind)) {
    throw rule('submission_kind_invalid', 'Bu teslim türü ödev şablonunda yok.', [
      'submission',
      'submissionKind',
    ])
  }
  if (
    settings.attempts.kind === 'evaluation' &&
    (settings.attempts.maxAttempts > 1 || settings.attempts.countPolicy !== 'first')
  ) {
    throw rule(
      'attempts_not_applicable',
      'Öğretmen puanlı görevde deneme hakkı yerine sürüm sınırı kullanılır.',
      ['attempts'],
    )
  }
  if (settings.timeLimitMinutes !== undefined && settings.timeLimitMinutes !== null) {
    throw rule('time_limit_not_applicable', 'Öğretmen puanlı görev süreli olmaz.', [
      'timeLimitMinutes',
    ])
  }
  const skill = version.tags.primarySkill
  const rubricRequired = content.rubricId !== null || isRubricSkill(skill)
  if (settings.rubricVersionId === null) {
    if (rubricRequired) {
      throw rule('rubric_required', 'Yazma, konuşma ve aracılık görevi rubrikle puanlanır.', [
        'rubricVersionId',
      ])
    }
  } else {
    if (rubricVersion?.id !== settings.rubricVersionId) {
      throw new DomainError('rubric_version_not_found', 'Rubrik sürümü bulunamadı.', {
        kind: 'not_found',
        path: ['rubricVersionId'],
      })
    }
    assertRubricAssignable(rubricVersion)
    if (content.rubricId !== null && rubricVersion.rubricId !== content.rubricId) {
      throw rule(
        'rubric_mismatch',
        'Ödev şablonunun rubriğinden bir sürüm seçin.',
        ['rubricVersionId'],
        'conflict',
      )
    }
    if (isRubricSkill(skill) && rubricVersion.skill !== skill) {
      throw rule('rubric_skill_mismatch', 'Rubriğin becerisi görevin becerisiyle aynı olmalıdır.', [
        'rubricVersionId',
      ])
    }
  }
  const secondRatingPercent =
    settings.secondRatingPercent ?? (settings.highStakes ? SECOND_RATING_MIN_PERCENT : 0)
  if (settings.highStakes && secondRatingPercent < SECOND_RATING_MIN_PERCENT) {
    throw rule(
      'second_rating_below_minimum',
      'Bu görevde teslimlerin en az %10’u ikinci kez puanlanır.',
      ['secondRatingPercent'],
    )
  }
  return {
    ...base,
    rubricVersionId: settings.rubricVersionId,
    scoringMode,
    timeLimitMinutes: null,
    listeningPlays: null,
    submission: settings.submission,
    secondRatingPercent,
  }
}

// --- Hedefler -----------------------------------------------------------------------------

/**
 * Hedef türü (ADR 0004 karar 4): okulda sınıf/şube, dil okulunda grup; ikisi de `classes`
 * kaydıdır. Öğrenci hedefi iki kurum türünde de vardır.
 */
// TODO(beceri-dil-grubu): Dil grubu ayrı koleksiyon olunca `group` hedefi oraya bağlanır.
export const TARGET_KINDS = {
  class: { label: 'Sınıf/şube', institutionType: 'school' },
  group: { label: 'Dil grubu', institutionType: 'language_school' },
  student: { label: 'Öğrenci', institutionType: null },
} as const
export type TargetKind = keyof typeof TARGET_KINDS

export const assignmentTargetsSchema = z
  .array(
    z.object({
      kind: z.enum(Object.keys(TARGET_KINDS) as [TargetKind, ...TargetKind[]]),
      id: identifier,
    }),
  )
  .min(1, 'En az bir sınıf, grup veya öğrenci seçin.')
  .max(100, 'En fazla 100 hedef seçilebilir.')
  .refine((list) => new Set(list.map((t) => `${t.kind}:${t.id}`)).size === list.length, {
    message: 'Aynı hedef iki kez seçilemez.',
  })
export type AssignmentTarget = z.output<typeof assignmentTargetsSchema>[number]

/** Atamayı yapabilen roller: yönetici ve öğretmen (yetki matrisi, DOM-YTK-001). */
export const ASSIGNING_ROLES = ['yonetici', 'ogretmen'] as const

/**
 * Hedefleri kapsamla doğrular ve kursiyer listesini çözer. Yönetici kurumun her sınıfına ve
 * öğrencisine atar; öğretmen yalnız ders verdiği sınıfa (içeriğin dersi varsa o derste) ve o
 * sınıfların öğrencisine atar: rehberlik görevi tek başına atama yetkisi vermez (DOM-YTK-022,
 * DOM-YTK-027 öğrenci bazında yazma vermez). Kapsam `scopeFor` ile çözülür.
 */
export function resolveTargets(input: {
  actor: Actor
  source: AuthorizationSource
  institutionType: InstitutionType
  targets: readonly AssignmentTarget[]
  /** İçeriğin dersi (`tags.subjectId`); öğretmenin o derste ders ataması olmalıdır. */
  subjectId: string | null
}): { learnerIds: string[] } {
  const { actor, source, institutionType } = input
  if (!(ASSIGNING_ROLES as readonly string[]).includes(actor.role)) {
    throw new DomainError('assignment_forbidden', 'Görev atama yetkiniz bulunmuyor.', {
      kind: 'forbidden',
    })
  }
  const scope = scopeFor(source, actor, { institutionType })
  const teacher = actor.role === 'ogretmen' ? scope.teacher : undefined
  if (actor.role === 'ogretmen' && !teacher) {
    throw new DomainError('assignment_forbidden', 'Görev atama yetkiniz bulunmuyor.', {
      kind: 'forbidden',
    })
  }
  const taught = new Set(
    teacher
      ? source.assignments
          .filter(
            (a) =>
              a.teacherId === teacher.id &&
              (input.subjectId === null || a.subjectId === input.subjectId),
          )
          .map((a) => a.classId)
      : [],
  )
  const canTarget = (classId: string) =>
    scope.classIds.has(classId) && (teacher === undefined || taught.has(classId))
  const classIds = new Set(source.classes.map((c) => c.id))
  const studentClass = new Map(source.students.map((s) => [s.id, s.classId]))
  const byClass = new Map<string, string[]>()
  for (const s of source.students) byClass.set(s.classId, [...(byClass.get(s.classId) ?? []), s.id])
  const learners = new Set<string>()
  const denied = (index: number) =>
    new DomainError(
      'target_scope_denied',
      'Yalnız ders verdiğiniz sınıflara ve öğrencilerine görev atayabilirsiniz.',
      { kind: 'forbidden', path: ['targets', String(index)] },
    )
  const missing = (index: number) =>
    new DomainError('target_not_found', 'Seçilen hedef bulunamadı.', {
      kind: 'not_found',
      path: ['targets', String(index)],
    })
  input.targets.forEach((target, index) => {
    if (target.kind === 'student') {
      const classId = studentClass.get(target.id)
      if (classId === undefined) throw missing(index)
      if (!scope.studentIds.has(target.id) || !canTarget(classId)) throw denied(index)
      learners.add(target.id)
      return
    }
    if (TARGET_KINDS[target.kind].institutionType !== institutionType) {
      throw rule(
        'target_kind_invalid',
        institutionType === 'school'
          ? 'Okulda görev sınıfa/şubeye atanır.'
          : 'Dil okulunda görev gruba atanır.',
        ['targets', String(index), 'kind'],
      )
    }
    if (!classIds.has(target.id)) throw missing(index)
    if (!canTarget(target.id)) throw denied(index)
    for (const id of byClass.get(target.id) ?? []) learners.add(id)
  })
  if (learners.size === 0) {
    throw rule('target_empty', 'Seçilen hedeflerde kursiyer yok.', ['targets'])
  }
  return { learnerIds: [...learners].sort() }
}

// --- Atama --------------------------------------------------------------------------------

/** Atama gövdesi (API ve form). */
export const assignmentInputSchema = z.object({
  resourceVersionId: identifier,
  settings: assignmentSettingsSchema.prefault({}),
  targets: assignmentTargetsSchema,
})
export type AssignmentInput = z.input<typeof assignmentInputSchema>

/** Aynı içeriğin mevcut ataması; kursiyer listesi hedeflerden çözülmüş hâlidir. */
export type ExistingAssignment = {
  id: string
  resourceId: string
  deadline: Deadline
  learnerIds: readonly string[]
  archivedAt: string | null
}

export type AssignmentPlan = {
  assignment: FixedAssignment & { createdAt: string }
  targets: AssignmentTarget[]
  learnerIds: string[]
}

/**
 * Aynı içerik farklı son tarihle ayrı atamadır (IST-034); her atama kendi sürümünü ve ayarını
 * sabitler. Açık bir atamada bulunan kursiyer aynı içeriği ikinci kez almaz: aynı son tarihte
 * mükerrer, farklı son tarihte çakışmadır (ikisi de `conflict`).
 */
// TODO(beceri-yinelenen-atama): Domain açık atamadaki kursiyere aynı içeriğin farklı son tarihle
// yeniden atanmasını ele almıyor; en muhafazakâr yorumla reddedildi (uzatma ayrı işlemdir).
export function assertNoOverlappingAssignment(input: {
  resourceId: string
  deadline: Deadline
  learnerIds: readonly string[]
  existing: readonly ExistingAssignment[]
  now: Instant
}): void {
  const learners = new Set(input.learnerIds)
  const dueKey = (deadline: Deadline) => submissionWindow(deadline).dueAt
  for (const other of input.existing) {
    if (other.resourceId !== input.resourceId || other.archivedAt !== null) continue
    if (isClosed(other.deadline, input.now)) continue
    if (!other.learnerIds.some((id) => learners.has(id))) continue
    throw dueKey(other.deadline) === dueKey(input.deadline)
      ? rule(
          'assignment_duplicate',
          'Bu içerik aynı son tarihle bu kursiyerlere zaten atanmış.',
          ['targets'],
          'conflict',
        )
      : rule(
          'assignment_overlap',
          'Bu içerik seçilen kursiyerlerden bazılarına açık bir atamada zaten verilmiş.',
          ['targets'],
          'conflict',
        )
  }
}

/**
 * Yeni atama (ADR 0004 karar 4; IST-034): gövde doğrulanır, ayarlar içerikle birleştirilip
 * sabitlenir, hedefler kapsamla çözülür ve açık atamalarla çakışma denetlenir. Başarısızlıkta hiçbir
 * satır yazılmaz. İçeriğin aktöre görünürlüğü (`content/visibility.ts`) servisin yükleme işidir.
 */
export function planAssignment(
  input: AssignedContent & {
    actor: Actor
    source: AuthorizationSource
    institutionType: InstitutionType
    rubricVersion: RubricVersionRow | null
    existing: readonly ExistingAssignment[]
    input: unknown
    now: Instant
  },
): AssignmentPlan {
  const data = assignmentInputSchema.parse(input.input)
  if (data.resourceVersionId !== input.version.id) {
    throw rule(
      'resource_version_mismatch',
      'Atanacak içerik sürümü değişti; sayfayı yenileyin.',
      ['resourceVersionId'],
      'conflict',
    )
  }
  const { learnerIds } = resolveTargets({
    actor: input.actor,
    source: input.source,
    institutionType: input.institutionType,
    targets: data.targets,
    subjectId: input.version.tags.subjectId,
  })
  const fixed = resolveAssignmentSettings({
    resource: input.resource,
    version: input.version,
    settings: data.settings,
    rubricVersion: input.rubricVersion,
    now: input.now,
  })
  assertNoOverlappingAssignment({
    resourceId: fixed.resourceId,
    deadline: fixed.deadline,
    learnerIds,
    existing: input.existing,
    now: input.now,
  })
  return {
    assignment: { ...fixed, createdAt: toIso(toMs(input.now)) },
    targets: data.targets,
    learnerIds,
  }
}

// --- Toplu atama --------------------------------------------------------------------------

/** Tek istekte açılabilecek ayrı atama sayısı (DOM-BEC-049). */
export const ASSIGNMENT_BATCH_MAX = 20

/**
 * Toplu atama gövdesi (DOM-BEC-049, IST-034): aynı içerik sürümünün her hedef grubu için ayrı
 * son tarihli ayrı ataması. Her öğe tek atamanın gövdesidir; içerik sürümü bütün öğelerde aynıdır
 * ve bir hedef iki öğede birden bulunamaz. Kökte `items` dışında alan kabul edilmez (ör. kurum
 * kimliği).
 */
export const assignmentBatchInputSchema = z
  .strictObject({
    items: z
      .array(assignmentInputSchema)
      .min(1, 'En az bir hedef seçin.')
      .max(
        ASSIGNMENT_BATCH_MAX,
        `Tek seferde en fazla ${ASSIGNMENT_BATCH_MAX} ayrı atama yapılır.`,
      ),
  })
  .superRefine((batch, ctx) => {
    const [first] = batch.items
    const seen = new Set<string>()
    batch.items.forEach((item, index) => {
      if (first !== undefined && item.resourceVersionId !== first.resourceVersionId)
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'resourceVersionId'],
          message: 'Toplu atamada bütün hedefler aynı içeriği alır.',
        })
      item.targets.forEach((target, targetIndex) => {
        const key = `${target.kind}:${target.id}`
        if (seen.has(key))
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'targets', targetIndex],
            message: 'Aynı hedef iki kez seçilemez.',
          })
        seen.add(key)
      })
    })
  })
export type AssignmentBatchInput = z.input<typeof assignmentBatchInputSchema>

/** Öğe hatasının alanı toplu gövdedeki yerine taşınır (`items.<sıra>.<alan>`). */
function inBatchItem(error: unknown, index: number): unknown {
  if (!(error instanceof DomainError)) return error
  return new DomainError(error.code, error.message, {
    kind: error.kind,
    path: ['items', String(index), ...(error.path ?? [])],
    cause: error,
  })
}

/**
 * Toplu atama planı (DOM-BEC-049, IST-034): her öğe `planAssignment` kurallarıyla planlanır; önceki
 * öğelerin kursiyerleri sonrakilerin çakışma denetimine girer, böylece aynı kursiyer aynı içeriği
 * iki öğeden birden almaz. Bir öğe reddedilirse hata o öğenin yoluyla döner ve hiçbir plan çıkmaz
 * (çağıran hepsini tek işlemde yazar). Rubrik sürümü öğenin `settings.rubricVersionId`'siyle
 * `rubricVersions`'tan okunur.
 */
export function planAssignmentBatch(
  input: AssignedContent & {
    actor: Actor
    source: AuthorizationSource
    institutionType: InstitutionType
    rubricVersions: ReadonlyMap<string, RubricVersionRow>
    existing: readonly ExistingAssignment[]
    input: unknown
    now: Instant
  },
): AssignmentPlan[] {
  const { items } = assignmentBatchInputSchema.parse(input.input)
  const plans: AssignmentPlan[] = []
  items.forEach((item, index) => {
    const planned: ExistingAssignment[] = plans.map((plan, plannedIndex) => ({
      id: `batch:${plannedIndex}`,
      resourceId: plan.assignment.resourceId,
      deadline: plan.assignment.deadline,
      learnerIds: plan.learnerIds,
      archivedAt: null,
    }))
    const rubricVersionId = item.settings.rubricVersionId
    try {
      plans.push(
        planAssignment({
          resource: input.resource,
          version: input.version,
          actor: input.actor,
          source: input.source,
          institutionType: input.institutionType,
          rubricVersion:
            rubricVersionId === null ? null : (input.rubricVersions.get(rubricVersionId) ?? null),
          existing: [...input.existing, ...planned],
          input: item,
          now: input.now,
        }),
      )
    } catch (error) {
      throw inBatchItem(error, index)
    }
  })
  return plans
}

// --- Yayım sonrası değişiklik -------------------------------------------------------------

/** Atamadan sonra değişebilen tek ayar son teslimdir; o da yalnız uzar. */
export const MUTABLE_ASSIGNMENT_FIELDS = ['deadline'] as const

/**
 * Yayımlanmış atamanın ayar değişikliği (DOM-BEC-041, 042, 045; ADR 0004 karar 4). Görev türü,
 * sayım politikası, deneme hakkı, içerik/puanlama/rubrik sürümü ve diğer ayarlar değişmez; son
 * teslim ve geç kabul yalnız ileri alınır. Otomatik puanlı değerlendirmenin cevap anahtarı
 * kursiyerlere açıldıysa (`answerKeyReleased`: teslim kapandı) son teslim ve geç kabul artık
 * uzatılamaz: 409 `answer_key_released` (anahtarı görenlerden sonra açılan teslim kopyaya açıktır).
 * Aynı tarihle gelen değişiklik reddedilmez. Anahtarı olmayan öğretmen puanlı görev ve kursiyerin
 * kendi denemesiyle anahtar açan alıştırma bu kurala girmez. Puanlama sürümü yalnız `planRescore` ile değişir.
 */
// TODO(beceri-atama-duzenleme): Domain son teslimin değişmesini ele almıyor; en muhafazakâr yorumla
// yalnız uzatma kabul edildi (kısaltma kursiyerin planını bozar).
export function planAssignmentChange(input: {
  assignment: Pick<FixedAssignment, 'kind' | 'deadline' | 'scoringMode'>
  patch: unknown
  now: Instant
}): { deadline: Deadline } {
  const patch = z.record(z.string(), z.unknown()).parse(input.patch)
  for (const key of Object.keys(patch)) {
    if ((MUTABLE_ASSIGNMENT_FIELDS as readonly string[]).includes(key)) continue
    throw rule(
      'assignment_setting_frozen',
      key === 'attempts' || key === 'kind'
        ? 'Görev türü ve sayım politikası yayımdan sonra değişmez.'
        : 'Bu ayar atamadan sonra değişmez.',
      [key],
      'conflict',
    )
  }
  if (!('deadline' in patch)) return { deadline: input.assignment.deadline }
  const next = deadlineSchema.parse(patch.deadline)
  if (input.assignment.kind === 'evaluation' && next.dueAt === null) {
    throw rule('deadline_shortened', 'Değerlendirme görevinin son teslim tarihi kaldırılamaz.', [
      'deadline',
      'dueAt',
    ])
  }
  const before = submissionWindow(input.assignment.deadline)
  const after = submissionWindow(next)
  const changed = after.dueAt !== before.dueAt || after.closesAt !== before.closesAt
  if (
    changed &&
    input.assignment.kind === 'evaluation' &&
    input.assignment.scoringMode === 'auto' &&
    answerKeyReleased({
      kind: input.assignment.kind,
      deadline: input.assignment.deadline,
      attemptCompleted: false,
      now: input.now,
    })
  ) {
    throw rule(
      'answer_key_released',
      'Cevap anahtarı öğrencilere açıldı; son teslim tarihi artık uzatılamaz.',
      ['deadline'],
      'conflict',
    )
  }
  const earlier = (a: string | null, b: string | null) =>
    b === null ? a !== null : a !== null && toMs(a) < toMs(b)
  if (earlier(after.dueAt, before.dueAt) || earlier(after.closesAt, before.closesAt)) {
    throw rule('deadline_shortened', 'Son teslim ve geç kabul süresi yalnız uzatılabilir.', [
      'deadline',
    ])
  }
  return { deadline: next }
}

// --- Yeniden teslim isteği ----------------------------------------------------------------

/** Yeniden teslim isteğinin son tarihi için üst sınır (gün). */
// TODO(beceri-yeniden-teslim-suresi): Domain süreyi vermiyor; en muhafazakâr yorumla en çok 14
// gün ve geç kabulsüz seçildi.
export const RESUBMISSION_MAX_DAYS = 14

/** Yeniden teslim isteği: puanlanan sürüm ve kendi son tarihi (DOM-BEC-040). */
export const resubmissionRequestSchema = z.object({
  versionNumber: z.number().int().min(1),
  dueAt: instant,
})

/** `task_submissions` satırının yeniden teslim kolonları. */
export type ResubmittableSubmission = SubmissionRow & { resubmissionDueAt: string | null }

/**
 * Öğretmen "yeniden teslim iste" der (DOM-BEC-040): yalnız puanı kesinleşen son sürüm için, ileri
 * ve en çok 14 gün sonraki kendi son tarihiyle. Yeni sürüm sınıra sayılmaz (`versionAllowance`).
 */
export function planResubmissionRequest(input: {
  submission: ResubmittableSubmission
  versions: readonly VersionRow[]
  scores: readonly RubricScoreRow[]
  secondRatingRequested: boolean
  input: unknown
  now: Instant
}): Pick<ResubmittableSubmission, 'resubmissionRequestedForVersion' | 'resubmissionDueAt'> {
  const data = resubmissionRequestSchema.parse(input.input)
  const latest = input.versions.reduce<VersionRow | null>(
    (best, v) => (best === null || v.number > best.number ? v : best),
    null,
  )
  if (latest === null || latest.number !== data.versionNumber) {
    throw rule(
      'version_not_latest',
      'Yeniden teslim yalnız son sürüm için istenir.',
      ['versionNumber'],
      'conflict',
    )
  }
  const resolution = scoreResolution({
    scores: input.scores.filter((s) => s.submissionVersionId === latest.id),
    secondRatingRequested: input.secondRatingRequested,
  })
  if (resolution.status !== 'settled') {
    throw rule(
      'resubmission_not_graded',
      'Yeniden teslim, puanı kesinleşen sürüm için istenir.',
      ['versionNumber'],
      'conflict',
    )
  }
  if (input.submission.resubmissionRequestedForVersion === latest.number) {
    throw rule(
      'resubmission_exists',
      'Bu sürüm için yeniden teslim zaten istendi.',
      ['versionNumber'],
      'conflict',
    )
  }
  const due = toMs(data.dueAt)
  const now = toMs(input.now)
  if (due <= now || due > now + RESUBMISSION_MAX_DAYS * DAY) {
    throw rule(
      'resubmission_due_invalid',
      'Yeniden teslim tarihi önümüzdeki 14 gün içinde olmalı.',
      ['dueAt'],
    )
  }
  return { resubmissionRequestedForVersion: latest.number, resubmissionDueAt: toIso(due) }
}

/** Bir yeniden teslim turu: istenen (puanlanan) sürüm ve turun kendi son tarihi (DOM-BEC-040). */
export type ResubmissionRound = { versionNumber: number; dueAt: string }

/**
 * Sürümün tabi olduğu son teslim (DOM-BEC-040, 044; IST-047): yeniden teslim istenen sürümden
 * sonraki sürüm, kendisinden önceki en son isteğin son tarihine (geç kabulsüz), istek yoksa
 * atamanınkine bağlıdır. Her tur kendi tarihiyle okunur: v1 için istenip v2 gönderildikten sonra
 * v2 için yeni istek gelse de v2 ilk turun tarihine bağlı kalır (geç bayrağı sonradan değişmez).
 * `resubmissionRounds` verilmezse yalnız son istek bilinir ve önceki turların sürümleri atamanın
 * son tarihiyle okunur. Yeni sürüm için `versionNumber` son sürümün bir fazlasıdır.
 * `planSubmissionVersion`, `planDraftSave` ve `versionIsLate` bunu alır.
 */
export function deadlineForVersion(
  assignmentDeadline: Deadline,
  submission:
    | (Pick<ResubmittableSubmission, 'resubmissionRequestedForVersion' | 'resubmissionDueAt'> & {
        resubmissionRounds?: readonly ResubmissionRound[]
      })
    | null,
  versionNumber: number,
): Deadline {
  const rounds: readonly ResubmissionRound[] =
    submission?.resubmissionRounds ??
    (submission?.resubmissionRequestedForVersion != null && submission.resubmissionDueAt != null
      ? [
          {
            versionNumber: submission.resubmissionRequestedForVersion,
            dueAt: submission.resubmissionDueAt,
          },
        ]
      : [])
  const governing = rounds.reduce<ResubmissionRound | null>(
    (best, round) =>
      round.versionNumber < versionNumber &&
      (best === null || round.versionNumber > best.versionNumber)
        ? round
        : best,
    null,
  )
  return governing === null ? assignmentDeadline : { dueAt: governing.dueAt, lateAcceptanceDays: 0 }
}

// --- Puanlama maddeleri -------------------------------------------------------------------

/** Puanlanan sorunun sürümü (`content.type === 'question'`). */
export type QuestionVersionRef = {
  id: string
  tags: Pick<ResourceTags, 'cefrLevel' | 'primarySkill' | 'skills' | 'subskill'> &
    Partial<Pick<ResourceTags, 'outcomes'>>
  content: ResourceContent
  answerKey: AnswerKey | null
}

/**
 * Quiz/alıştırma setinin satırlarından puanlama maddeleri (`ScoringItem`). Karşılaştırma dili
 * (`locale`) quizin veya sorunun etiketlerinden çıkar: biri İngilizce beceri içeriğiyse `en`
 * (DOM-BEC-010, `answerLocaleForTags`). Eksik soru, anahtarsız soru `not_found`/`rule` reddidir.
 */
export function scoringItemsFor(input: {
  parentTags: Pick<ResourceTags, 'cefrLevel' | 'primarySkill' | 'skills'> &
    Partial<Pick<ResourceTags, 'outcomes'>>
  items: readonly { questionVersionId: string; points: number }[]
  questions: ReadonlyMap<string, QuestionVersionRef>
}): ScoringItem[] {
  const parentLocale = answerLocaleForTags(input.parentTags)
  return input.items.map((item) => {
    const question = input.questions.get(item.questionVersionId)
    if (!question || question.content.type !== 'question') {
      throw new DomainError('question_version_not_found', 'Soru bulunamadı.', {
        kind: 'not_found',
        path: ['items', item.questionVersionId],
      })
    }
    if (question.answerKey === null) {
      throw rule('answer_key_missing', 'Sorunun cevap anahtarı yok.', [
        'items',
        item.questionVersionId,
      ])
    }
    const locale =
      parentLocale === 'en' || answerLocaleForTags(question.tags) === 'en' ? 'en' : 'tr'
    return {
      questionVersionId: item.questionVersionId,
      points: item.points,
      question: question.content.question,
      answerKey: question.answerKey,
      locale,
      subskill: question.tags.subskill,
      // Not defteri kırılımı (DOM-BEC-048): soru etiketlenmemişse setin becerisi ve kazanımları.
      skill: question.tags.primarySkill ?? input.parentTags.primarySkill,
      outcomes:
        (question.tags.outcomes ?? []).length > 0
          ? (question.tags.outcomes ?? [])
          : (input.parentTags.outcomes ?? []),
    }
  })
}

// --- Yeniden puanlama ---------------------------------------------------------------------

/** Yeniden puanlama gövdesi: yeni puanlama sürümü ve gerekçe (DOM-BEC-011, DOM-KYN-033). */
export const rescoreInputSchema = z.object({
  scoringVersionId: identifier,
  reason: text(1000, 'Düzeltme gerekçesini yazın.', 10),
})

/** Kursiyerin tamamlanmış denemeleri; `locked`: not defterine aktarılmış veya karara girmiş. */
export type RescoreLearner = {
  // kvkk: K
  learnerId: string
  attempts: readonly { id: string; completedAt: string; answers: Answers }[]
  locked: boolean
}

export type RescoreChange = {
  learnerId: string
  beforePercent: number
  afterPercent: number
  beforeEarned: number
  afterEarned: number
  /** 100'lük puan farkı (`after − before`). */
  delta: number
  /** Aktarılmış/karara girmiş sonuç kendiliğinden değişmez; öğretmen fark listesinden onaylar. */
  locked: boolean
}

export type RescorePreview = {
  affectedCount: number
  lockedCount: number
  unchangedCount: number
  changes: RescoreChange[]
}

/** Puanlama sürümünü değiştirmek için gereken bağlam. */
export type RescoreContext = {
  assignment: Pick<FixedAssignment, 'resourceId' | 'scoringVersionId' | 'scoringMode' | 'attempts'>
  /** Mevcut puanlama sürümünün içeriği: bağlı okuma parçası ve dinleme kaydı buradan okunur. */
  currentContent: ResourceContent | null
  nextVersion: Pick<ResourceVersion, 'id' | 'resourceId' | 'status' | 'content'>
  /** Mevcut puanlama sürümünün maddeleri. */
  before: readonly ScoringItem[]
  /**
   * Yeni sürümün maddeleri. Servis yeni sorunun kimliğini cevaplardaki eski soru sürümüne eşler;
   * böylece aynı cevaplar yeni anahtarla okunur.
   */
  after: readonly ScoringItem[]
  learners: readonly RescoreLearner[]
}

/** Quiz/alıştırma setinin bağlı okuma parçası ve dinleme kaydı sürümleri; başka türde boş. */
function activityLinks(content: ResourceContent | null): string {
  if (content?.type !== 'quiz' && content?.type !== 'exercise_set') return '|'
  return `${content.passageVersionId ?? ''}|${content.listeningVersionId ?? ''}`
}

/**
 * Yeniden puanlanabilir mi (DOM-KYN-033): otomatik puanlı görev, aynı içeriğin yayındaki başka
 * sürümü, aynı sorular ve aynı bağlı okuma parçası/dinleme kaydı (IST-042, IST-045). Bağ değişirse
 * cevaplar başka metin ya da kayıt için verilmiş olurdu; dinleme hakkı ve kayıt erişimi atamanın
 * sabitlenen sürümünden, deneme ayrıntısı puanlama sürümünden okunduğundan ikisi ayrışırdı.
 */
function assertRescorable(context: RescoreContext): void {
  const { assignment, nextVersion, before, after } = context
  if (assignment.scoringMode !== 'auto') {
    throw rule('rescore_not_applicable', 'Yalnız otomatik puanlı görev yeniden puanlanır.', [
      'scoringVersionId',
    ])
  }
  if (
    nextVersion.resourceId !== assignment.resourceId ||
    nextVersion.status !== 'published' ||
    nextVersion.id === assignment.scoringVersionId
  ) {
    throw rule(
      'rescore_version_invalid',
      'Aynı içeriğin yayındaki yeni sürümünü seçin.',
      ['scoringVersionId'],
      'conflict',
    )
  }
  const shape = (items: readonly ScoringItem[]) =>
    items
      .map((i) => `${i.questionVersionId}:${i.question.questionType}`)
      .sort()
      .join('|')
  if (shape(before) !== shape(after)) {
    throw rule(
      'rescore_incompatible',
      'Yeni sürümün soruları mevcut cevaplarla eşleşmiyor; yeni atama açın.',
      ['scoringVersionId'],
    )
  }
  if (activityLinks(context.currentContent) !== activityLinks(nextVersion.content)) {
    throw rule(
      'rescore_incompatible',
      'Yeni sürümün okuma parçası ya da dinleme kaydı değişmiş; yeni atama açın.',
      ['scoringVersionId'],
    )
  }
}

/**
 * Anahtar düzeltmesinin önizlemesi (DOM-BEC-011, DOM-KYN-033; ADR 0004 açık soru 2a): her
 * kursiyerin sayılan denemesi eski ve yeni anahtarla hesaplanır; puanı değişenler ve fark
 * listelenir. Aktarılmış veya karara girmiş sonuçlar `locked` işaretlenir. Saftır; hiçbir şey
 * yazmaz. Alıştırma sayılan sonuç üretmediği için önizlemede yer almaz.
 */
export function previewRescore(context: RescoreContext): RescorePreview {
  assertRescorable(context)
  const rules = context.assignment.attempts
  const counted = (items: readonly ScoringItem[], learner: RescoreLearner) =>
    countedAttempt(
      rules,
      learner.attempts.map((a) => ({
        id: a.id,
        completedAt: a.completedAt,
        score: scoreAttempt(items, a.answers),
      })),
    )
  const changes: RescoreChange[] = []
  let unchangedCount = 0
  for (const learner of context.learners) {
    const before = counted(context.before, learner)
    const after = counted(context.after, learner)
    if (before === null || after === null) continue
    if (before.score.ratio === after.score.ratio) {
      unchangedCount += 1
      continue
    }
    changes.push({
      learnerId: learner.learnerId,
      beforePercent: before.score.percent,
      afterPercent: after.score.percent,
      beforeEarned: before.score.earned,
      afterEarned: after.score.earned,
      delta: after.score.percent - before.score.percent,
      locked: learner.locked,
    })
  }
  changes.sort((a, b) => (a.learnerId < b.learnerId ? -1 : a.learnerId > b.learnerId ? 1 : 0))
  return {
    affectedCount: changes.length,
    lockedCount: changes.filter((c) => c.locked).length,
    unchangedCount,
    changes,
  }
}

/**
 * Yeniden puanlama işlemi (DOM-KYN-033): öğretmen veya yönetici gerekçeyle başlatır, son onayda
 * önizleme güncel verilerle yeniden hesaplanır. Döndürülen `scoringVersionId` atamaya yazılır;
 * eski ve yeni sürüm denetim kaydına, gerekçe bildirime gider.
 */
export function planRescore(context: RescoreContext & { input: unknown; now: Instant }): {
  scoringVersionId: string
  previousScoringVersionId: string
  reason: string
  rescoredAt: string
  preview: RescorePreview
} {
  const data = rescoreInputSchema.parse(context.input)
  if (data.scoringVersionId !== context.nextVersion.id) {
    throw rule(
      'rescore_version_invalid',
      'Aynı içeriğin yayındaki yeni sürümünü seçin.',
      ['scoringVersionId'],
      'conflict',
    )
  }
  return {
    scoringVersionId: data.scoringVersionId,
    previousScoringVersionId: context.assignment.scoringVersionId,
    reason: data.reason,
    rescoredAt: toIso(toMs(context.now)),
    preview: previewRescore(context),
  }
}
