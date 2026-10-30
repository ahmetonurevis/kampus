import type { State } from '../data/seed.ts'
import type { CollectionName, ModuleKey } from './collection-modules.ts'

/**
 * Komut → modül ve komut → koleksiyon tabloları. API bir işlemi çalıştırmadan önce hangi modülün
 * açık olması gerektiğini ve kurumdan hangi koleksiyonları yükleyeceğini buradan okur; kendi
 * kopyasını tutmaz (ADR 0001 karar 6). Web ve mobil aynı tabloyu menü/eylem görünürlüğü için
 * kullanabilir.
 *
 * - `module`: işlem bu modül kapalıyken reddedilir (DOM-YTK-040); `null` çekirdek kayıttır.
 * - `collections`: işlemin okuduğu ve yazabileceği kayıt koleksiyonları; kapsam ve yetki için
 *   gereken kaynak koleksiyonları dahildir. Core denetim listesi (`audit`) listede yoktur; API onu
 *   boş verir ve kendi denetim kaydını yazar.
 * - `scalars`: dizi olmayan State alanları (kurum ayarından gelir).
 *
 * Testler her komutun başarılı yolunu, yalnız listedeki anahtarları açan bir State görünümüyle
 * çalıştırarak tablonun eksiksiz olduğunu doğrular (`tests/commands.test.ts`).
 */

export type ScalarKey = Extract<keyof State, 'modules' | 'academicYear'>
export type CommandSpec = {
  readonly module: ModuleKey | null
  readonly collections: readonly CollectionName[]
  readonly scalars: readonly ScalarKey[]
}

/** Kapsam (`scopeFor`) ve yetki (`authorize`) kaynağı; `lib/scope.ts` SCOPE_SOURCE_COLLECTIONS. */
const SCOPE = ['students', 'teachers', 'classes', 'assignments', 'clubs'] as const
/** Oturum aktörü ve iş akışı kapsamı veliyi de okur (`sessionActor`). */
const SESSION = [...SCOPE, 'parents'] as const
// Ders/etkinlik/etüt çakışma denetimi (`lib/tutor-conflicts.ts`).
const CONFLICTS = ['schedule', 'appointments', 'tutorSessions', 'schoolEvents'] as const

const spec = (
  module: ModuleKey | null,
  collections: readonly CollectionName[],
  scalars: readonly ScalarKey[] = ['modules'],
): CommandSpec => ({ module, collections: [...new Set(collections)], scalars })
/** İş akışı ve otomasyon komutu her zaman bir modüle bağlıdır. */
export type ModuleCommandSpec = CommandSpec & { readonly module: ModuleKey }
const workflow = (
  module: ModuleKey,
  extra: readonly CollectionName[],
  scalars?: ScalarKey[],
): ModuleCommandSpec => ({ ...spec(module, [...SESSION, ...extra], scalars), module })

/** Okul iş akışı komutları (`runWorkflow`). */
export const WORKFLOW_COMMANDS = {
  goal: workflow('goals', ['studentGoals', 'mockExams', 'mockResults']),
  'goal-review': workflow('goals', ['studentGoals']),
  'goal-step': workflow('goals', ['studentGoals']),
  'goal-step-done': workflow('goals', ['studentGoals']),
  'goal-suggest': workflow('goals', ['studentGoals', 'mockResults', 'subjects']),
  'goal-comment': workflow('goals', ['studentGoals']),
  'goal-close': workflow('goals', ['studentGoals']),
  guidance: workflow('guidance', ['guidanceCases']),
  'guidance-note': workflow('guidance', ['guidanceCases']),
  exam: workflow('exams', ['mockExams']),
  'exam-result': workflow('exams', ['mockExams', 'mockResults']),
  'exam-import': workflow('exams', ['mockExams', 'mockResults']),
  renewal: workflow(
    'renewal',
    ['branches', 'contracts', 'invoices', 'renewals'],
    ['modules', 'academicYear'],
  ),
  'renewal-activate': workflow(
    'renewal',
    [
      'branches',
      'renewals',
      'enrollmentHistory',
      'guidanceCases',
      'studyTasks',
      'clubMemberships',
      'transportRoutes',
      'transportAssignments',
      'tutorSessions',
    ],
    ['modules', 'academicYear'],
  ),
  lesson: workflow('planning', ['branches', 'subjects', ...CONFLICTS]),
  substitute: workflow('planning', ['branches', 'subjects', ...CONFLICTS]),
  'lesson-cancel': workflow('planning', ['schedule']),
  'study-task': workflow('study', ['studyTasks']),
  'study-complete': workflow('study', ['studyTasks']),
  'study-review': workflow('study', ['studyTasks']),
  event: workflow('calendar', ['branches', ...CONFLICTS]),
  consent: workflow('calendar', ['schoolEvents', 'eventConsents']),
  'event-cancel': workflow('calendar', ['schoolEvents']),
  route: workflow('transport', ['branches', 'transportRoutes', 'transportAssignments']),
  'route-archive': workflow('transport', ['transportRoutes', 'transportAssignments']),
  'transport-assign': workflow('transport', ['transportRoutes', 'transportAssignments']),
  'transport-remove': workflow('transport', ['transportRoutes', 'transportAssignments']),
  meal: workflow('meals', ['branches', 'mealMenus']),
  club: workflow('clubs', ['branches']),
  'club-enroll': workflow('clubs', ['clubMemberships']),
  'club-leave': workflow('clubs', ['clubMemberships']),
  'club-attendance': workflow('clubs', ['clubMemberships', 'clubAttendance']),
  achievement: workflow('clubs', ['clubMemberships', 'socialAchievements']),
  'club-archive': workflow('clubs', ['clubMemberships']),
} as const satisfies Record<string, ModuleCommandSpec>
export type WorkflowCommand = keyof typeof WORKFLOW_COMMANDS

const OPTICAL = ['mockExams', 'mockResults', 'opticalProfiles', 'opticalEvaluations'] as const
/** Optik değerlendirme ve otomatik etüt komutları (`runAssessment`). */
export const ASSESSMENT_COMMANDS = {
  profile: workflow('optical', ['mockExams', 'opticalProfiles', 'subjects']),
  evaluate: workflow('optical', [...OPTICAL]),
  plan: workflow('tutoring', [...OPTICAL, 'branches', 'availability', ...CONFLICTS]),
  slot: workflow('tutoring', ['availability', ...CONFLICTS]),
  'slot-remove': workflow('tutoring', ['availability']),
  cancel: workflow('tutoring', ['tutorSessions']),
  attendance: workflow('tutoring', ['tutorSessions']),
} as const satisfies Record<string, ModuleCommandSpec>
export type AssessmentCommand = keyof typeof ASSESSMENT_COMMANDS

/**
 * Temel yazma işlemleri; anahtarlar `lib/authorize.ts` eylem adlarıdır. Yetki kaynağı (`SCOPE`)
 * her işleme eklidir.
 */
export const OPERATION_COMMANDS = {
  'invoice.pay': spec('finance', [...SCOPE, 'invoices']),
  // Ödeme sağlayıcısı bağlanınca okuyacağı koleksiyonlar; şimdilik işlem çağırmaz (authorize.ts).
  'invoice.payOnline': spec('finance', [...SCOPE, 'invoices']),
  'attendance.record': spec('academic', [...SCOPE, 'attendance']),
  'grade.record': spec('academic', [...SCOPE, 'grades', 'quizzes', 'quizAttempts']),
  'grade.update': spec('academic', [...SCOPE, 'grades']),
  'record.archive': spec(null, [
    ...SCOPE,
    'branches',
    'contracts',
    'guidanceCases',
    'homework',
    'submissions',
    'questions',
    'prospects',
    'renewals',
    'studyTasks',
    'availability',
    'mealMenus',
    'clubMemberships',
    'transportRoutes',
    'transportAssignments',
    ...CONFLICTS,
  ]),
  'record.restore': spec(null, [...SCOPE, 'branches']),
  // İletişim (`lib/communication.ts`); alıcı çözümü kampüs listesini de okur.
  'announcement.publish': spec('communication', [...SCOPE, 'branches', 'announcements']),
  'announcement.revise': spec('communication', [...SCOPE, 'announcements']),
  'announcement.withdraw': spec('communication', [...SCOPE, 'announcements']),
  'announcement.read': spec('communication', [...SCOPE, 'announcements']),
  // Mesajlar ayrı kayıtlardır (ADR 0005). API bu komutlarda koleksiyonları kısmi yükler: yalnız
  // hedef yazışma, aynı öğrencinin yazışmaları ve yalnız okunmamış karşı taraf mesajları
  // (`services/communication.ts`); mesaj gönderimi var olan mesajları hiç yüklemez.
  'conversation.start': spec('communication', [...SCOPE, 'conversations', 'conversationMessages']),
  'message.send': spec('communication', [...SCOPE, 'conversations', 'conversationMessages']),
  'message.read': spec('communication', [...SCOPE, 'conversations', 'conversationMessages']),
  'conversation.access': spec('communication', [...SCOPE, 'conversations']),
} as const satisfies Record<string, CommandSpec>
export type OperationCommand = keyof typeof OPERATION_COMMANDS

export type Command = WorkflowCommand | AssessmentCommand | OperationCommand

const WORKFLOW_TABLE: Readonly<Record<string, CommandSpec>> = WORKFLOW_COMMANDS
const ASSESSMENT_TABLE: Readonly<Record<string, CommandSpec>> = ASSESSMENT_COMMANDS
const OPERATION_TABLE: Readonly<Record<string, CommandSpec>> = OPERATION_COMMANDS

/** Komut adı dışarıdan gelir; `toString` gibi yerleşik özellikler komut sayılmaz. */
export function isWorkflowCommand(name: string): name is WorkflowCommand {
  return Object.hasOwn(WORKFLOW_TABLE, name)
}
export function isAssessmentCommand(name: string): name is AssessmentCommand {
  return Object.hasOwn(ASSESSMENT_TABLE, name)
}
export function isOperationCommand(name: string): name is OperationCommand {
  return Object.hasOwn(OPERATION_TABLE, name)
}

/**
 * Komutun tanımı; bilinmeyen komut `undefined`. İş akışı ve otomasyon komutları ayrı
 * yürütücülerdedir; aynı adın (`attendance`) iki anlamı olmaması için yürütücü verilir.
 */
export function commandSpec(
  runner: 'workflow' | 'assessment' | 'operation',
  name: string,
): CommandSpec | undefined {
  const table =
    runner === 'workflow'
      ? WORKFLOW_TABLE
      : runner === 'assessment'
        ? ASSESSMENT_TABLE
        : OPERATION_TABLE
  return Object.hasOwn(table, name) ? table[name] : undefined
}
