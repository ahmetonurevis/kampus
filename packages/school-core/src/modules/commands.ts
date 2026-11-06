import {
  ASSESSMENT_COMMANDS,
  PLATFORM_OPERATION_COMMANDS,
  PLATFORM_WORKFLOW_COMMANDS,
} from '../platform/commands.ts'
import {
  CONFLICTS,
  SCOPE,
  SESSION,
  spec,
  workflow,
  type CommandSpec,
  type ModuleCommandSpec,
  type ScalarKey,
} from './command-builders.ts'

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
 * İki kaynak birleşir: Oğuzhan'ın komutları `platform/commands.ts`, kayıt ve finans komutları
 * aşağıdaki `// Onur: kayıt ve finans` blokları. Bir komut adı yalnız bir kaynakta bulunur
 * (test yakalar). Yapı taşları `command-builders.ts`'tedir.
 *
 * Testler her komutun başarılı yolunu, yalnız listedeki anahtarları açan bir State görünümüyle
 * çalıştırarak tablonun eksiksiz olduğunu doğrular (`tests/commands.test.ts`).
 */

export type { CommandSpec, ModuleCommandSpec, ScalarKey }
export { ASSESSMENT_COMMANDS }

// Onur: kayıt ve finans
/** Yenileme planlama ve sınıf geçişi komutları (`runWorkflow`). */
export const ONUR_WORKFLOW_COMMANDS = {
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
} as const satisfies Record<string, ModuleCommandSpec>

/** Tahsilat, tarife, ayrılış, aday/CRM ve kesin kayıt işlemleri. */
export const ONUR_OPERATION_COMMANDS = {
  // Sözleşme bursu senet yasağı içindir (DOM-FIN-025).
  'invoice.pay': spec('finance', [...SCOPE, 'contracts', 'invoices']),
  'payment.reverse': spec('finance', [...SCOPE, 'invoices']),
  'tariff.manage': spec('finance', [...SCOPE]),
  'scholarship.manage': spec('finance', [...SCOPE]),
  // Sözleşme onayı ve ek protokol (`lib/contract-approval.ts`, IST-092). Onay ödeyicinin adını okur ve
  // ek protokolün planını taksitlere geçirir; ek protokol planlanmış yenilemeyi denetler.
  'contract.sign': spec('finance', [...SCOPE, 'contracts']),
  'contract.approve': spec('finance', [...SESSION, 'contracts', 'invoices']),
  'contract.amend': spec('finance', [...SCOPE, 'contracts', 'invoices', 'renewals']),
  'student.withdraw': spec('finance', [
    ...SCOPE,
    'parents',
    'invoices',
    'contracts',
    'renewals',
    'transportAssignments',
    'clubMemberships',
    'tutorSessions',
  ]),
  // Kayıt dondurma (`lib/enrollment-freezes.ts`, DOM-DIL-052): öğrencinin bayrağını yazar.
  'enrollment.freezeRequest': spec('crm', [...SCOPE]),
  'enrollment.freezeDecide': spec('crm', [...SCOPE]),
  'enrollment.freezeReturn': spec('crm', [...SCOPE]),
  // Ödeme sağlayıcısı bağlanınca okuyacağı koleksiyonlar; şimdilik işlem çağırmaz (authorize.ts).
  'invoice.payOnline': spec('finance', [...SCOPE, 'invoices']),
  // Aday/CRM (`lib/prospects.ts`). Tekillik bütün adayları okur; görüşme çakışması diğer adayların
  // görüşmelerini ve ders/randevu/etüt/etkinlik kayıtlarını, deneme dersi ders programını okur.
  'prospect.create': spec('crm', [...SCOPE, 'branches', 'prospects']),
  'prospect.stage': spec('crm', [...SCOPE, 'prospects']),
  'prospect.stageRevert': spec('crm', [...SCOPE, 'prospects']),
  'prospect.consent': spec('crm', [...SCOPE, 'prospects']),
  'prospect.update': spec('crm', [...SCOPE, 'prospects']),
  'prospect.note': spec('crm', [...SCOPE, 'prospects']),
  'prospect.meeting': spec('crm', [...SCOPE, 'branches', 'prospects', ...CONFLICTS]),
  'prospect.trial': spec('crm', [...SCOPE, 'prospects', 'schedule']),
  // Deneme sonucu (DOM-DIL-031): öğretmen kapsamı SCOPE'tan, ders programını `schedule` okur.
  'prospect.trialResult': spec('crm', [...SCOPE, 'prospects', 'schedule']),
  // Kesin kayıt (`enrollProspect`, `lib/enrollment.ts`): öğrenci, veli, taksit ve sözleşmeyi yazar.
  'prospect.enroll': spec('crm', [
    ...SCOPE,
    'branches',
    'prospects',
    'parents',
    'invoices',
    'contracts',
    // Kontenjan planlanmış yenilemeleri de sayar (DOM-KAY-010).
    'renewals',
  ]),
} as const satisfies Record<string, CommandSpec>
// Onur: kayıt ve finans sonu

/** Okul iş akışı komutları (`runWorkflow`); iki kaynağın birleşimi. */
export const WORKFLOW_COMMANDS = {
  ...PLATFORM_WORKFLOW_COMMANDS,
  ...ONUR_WORKFLOW_COMMANDS,
} as const satisfies Record<string, ModuleCommandSpec>
export type WorkflowCommand = keyof typeof WORKFLOW_COMMANDS

export type AssessmentCommand = keyof typeof ASSESSMENT_COMMANDS

/** Temel yazma işlemleri; anahtarlar `lib/authorize.ts` eylem adlarıdır; iki kaynağın birleşimi. */
export const OPERATION_COMMANDS = {
  ...PLATFORM_OPERATION_COMMANDS,
  ...ONUR_OPERATION_COMMANDS,
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
