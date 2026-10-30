import type { State } from '../data/seed.ts'
import { moduleAvailableFor, type InstitutionType } from '../modules/collection-modules.ts'
import { OPERATION_COMMANDS, type OperationCommand } from '../modules/commands.ts'
import type { Session } from './domain.ts'
import { DomainError, type DomainErrorKind } from './errors.ts'
import { dayKey } from './format.ts'
import type { ArchiveKind } from './school-management.ts'
import { scopeFor, sessionActor, type Actor, type ScopeSource } from './scope.ts'

/**
 * Yazma yetkisi (docs/domain/yetki-ve-kapsam.md). Okuma kapsamı `scopeFor` ile, temel yazma
 * işlemlerinin yetkisi burada tek tabloda çözülür; API ve web/mobil aynı kararı verir
 * (DOM-YTK-001: matriste açık izin yoksa ret). Okul iş akışı komutlarının yetkisi `runWorkflow`
 * içindedir (`mayRun` + komuta özgü kapsam).
 *
 * İşlemler (`payInvoice`, `recordAttendance`, `archiveRecord` …) yetki denetlemez; çağıran işlemden
 * önce `requireAuthorized` çalıştırır. Çevrimdışı demo aktörü `sessionActor` ile verir.
 */

/** Eylem adları komut tablosunun temel işlemleridir (`modules/commands.ts`). */
export type WriteAction = OperationCommand
export const WRITE_ACTIONS = Object.keys(OPERATION_COMMANDS) as readonly WriteAction[]

/** Eylem başına yetkinin dayandığı hedef bilgisi; kimlikler istemciden gelse de kapsamla denetlenir. */
export type WriteTargets = {
  'invoice.pay': { studentId: string }
  'invoice.payOnline': { studentId: string }
  /** `reason`: yönetici düzeltmesinin gerekçesi (DOM-AKD-035). */
  'attendance.record': { classId: string; date: string; reason?: string }
  'grade.record': { studentId: string; subjectId: string }
  /**
   * `reason`: not düzeltmesinin gerekçesi (DOM-AKD-051). `classId`: notun verildiği sınıf; yetki
   * öğrencinin güncel sınıfına değil buna göre verilir. Sınıfı saklanmamış eski notta öğrencinin
   * güncel sınıfı kullanılır.
   */
  'grade.update': { studentId: string; subjectId: string; classId?: string; reason?: string }
  'record.archive': { kind: ArchiveKind }
  'record.restore': { kind: ArchiveKind }
}

/** Yetki için gereken kaynak; not yetkisi ders atamasının dersini de okur. */
export type AuthorizationSource = Omit<ScopeSource, 'assignments'> & {
  assignments: readonly Pick<State['assignments'][number], 'classId' | 'teacherId' | 'subjectId'>[]
}
export type AuthorizeOptions = {
  institutionType?: InstitutionType
  /** İşlem anı (ISO 8601); öğretmenin aynı gün yoklama kuralı buna göre denetlenir. */
  now?: string
}

export type WriteDenial = {
  allowed: false
  code: string
  message: string
  kind: DomainErrorKind
  /** Reddin dayandığı alan kuralı; log ve test için. */
  rule: string
}
export type WriteDecision = { allowed: true } | WriteDenial

/** Matrisin bu eylemlerdeki varsayılanı (rapor ve testler için; kapsam kuralları aşağıda). */
export const WRITE_ACTION_ROLES = {
  // Tahsilat kaydı (taksiti "ödendi" işaretler) yalnız yönetici ve ön büroda; veli ve öğrenci
  // tahsilat kaydedemez, öğretmenin finans erişimi yoktur (DOM-FIN-052, yetki matrisi).
  'invoice.pay': ['yonetici', 'onburo'],
  // Çevrim içi ödeme: veli yalnız bağlı çocuğunun taksiti için başlatır (DOM-FIN-052, DOM-YTK-025).
  'invoice.payOnline': ['veli'],
  // Yoklama: öğretmen ders verdiği sınıfta aynı gün; yönetici gerekçeyle düzeltir (DOM-YTK-022,
  // DOM-AKD-035, DOM-AKD-054).
  'attendance.record': ['yonetici', 'ogretmen'],
  // Not girişi yalnız atandığı sınıf + dersin öğretmenindedir; yönetici yalnız gerekçeli düzeltme
  // yapar (yetki matrisi "Not, değerlendirme", DOM-AKD-054).
  'grade.record': ['ogretmen'],
  'grade.update': ['yonetici', 'ogretmen'],
  // Kampüs, sınıf, kadro yalnız yöneticidedir (yetki matrisi, DOM-YTK-020).
  'record.archive': ['yonetici'],
  'record.restore': ['yonetici'],
} as const satisfies Record<WriteAction, readonly Actor['role'][]>

const ROLE_TABLE: Readonly<Record<WriteAction, readonly string[]>> = WRITE_ACTION_ROLES

/**
 * Yetki tek başına yetmeyen eylemler: izinli istek de ödeme sağlayıcısının onayı gelmeden hiçbir
 * kaydı değiştirmez. Veli `invoice.payOnline` ile yalnız ödeme başlatabilir; taksiti "ödendi"
 * işaretlemek sağlayıcı onayından sonra sunucudaki tahsilat işlemine (`invoice.pay`) aittir.
 * Veliye `invoice.pay` açmak para alınmadan taksiti kapattırırdı.
 */
// TODO(payment-provider): Çevrim içi ödeme sağlayıcısı seçilince `invoice.payOnline` sağlayıcı
// oturumunu başlatan ve onay geri çağrısında tahsilatı kaydeden işleme bağlanır; o zamana kadar
// bu eylem hiçbir işlem çağırmaz.
export const PROVIDER_CONFIRMATION_ACTIONS = [
  'invoice.payOnline',
] as const satisfies readonly WriteAction[]

/** Eylem, izin verilse bile ödeme sağlayıcısı onayı bekler mi. */
export function requiresProviderConfirmation(action: WriteAction): boolean {
  return (PROVIDER_CONFIRMATION_ACTIONS as readonly WriteAction[]).includes(action)
}

const deny = (
  code: string,
  message: string,
  rule: string,
  kind: DomainErrorKind = 'forbidden',
): WriteDenial => ({ allowed: false, code, message, kind, rule })
const ALLOWED: WriteDecision = { allowed: true }
const roleDenied = (rule: string) =>
  deny('permission_denied', 'Bu işlem için yetkiniz bulunmuyor.', rule)
const hasReason = (reason: string | undefined) => (reason?.trim().length ?? 0) >= 2
const reasonRequired = (rule: string) =>
  deny('correction_reason_required', 'Düzeltme için gerekçe yazın.', rule, 'rule')

function moduleDecision(
  action: WriteAction,
  source: AuthorizationSource,
  institutionType: InstitutionType,
): WriteDecision {
  // Eylemin modülü komut tablosundadır; `null` çekirdek kayıttır, kapatılamaz (DOM-YTK-040).
  const module = OPERATION_COMMANDS[action].module
  if (module === null) return ALLOWED
  if (!moduleAvailableFor(module, institutionType))
    return deny('collection_not_found', 'İlgili kayıt bulunamadı.', 'DOM-YTK-012', 'not_found')
  // Haritada olmayan modül kapalı sayılır (varsayılan ret).
  if (source.modules[module] !== true)
    return deny('module_disabled', 'Bu modül kullanıma kapalı.', 'DOM-YTK-040')
  return ALLOWED
}

/**
 * Aktör bu eylemi bu hedefte yapabilir mi. Önce modül (DOM-YTK-040), sonra rol (matris), sonra
 * kapsam (DOM-YTK-002, -022, -025) denetlenir. Kayıt varlığı işlemin işidir; burada yalnız yetki
 * çözülür.
 */
export function authorize<A extends WriteAction>(
  actor: Actor,
  action: A,
  target: WriteTargets[A],
  source: AuthorizationSource,
  options: AuthorizeOptions = {},
): WriteDecision {
  const institutionType = options.institutionType ?? 'school'
  const moduleCheck = moduleDecision(action, source, institutionType)
  if (!moduleCheck.allowed) return moduleCheck
  if (!ROLE_TABLE[action].includes(actor.role)) return roleDenied('DOM-YTK-001')
  // Hedef tipi eyleme bağlıdır; birleşimi daraltmak için eylem adıyla ayrıştırılır.
  const request = { action, target } as WriteRequest
  return decide(actor, request, source, institutionType, options.now)
}

type WriteRequest = {
  [A in WriteAction]: { action: A; target: WriteTargets[A] }
}[WriteAction]

function decide(
  actor: Actor,
  request: WriteRequest,
  source: AuthorizationSource,
  institutionType: InstitutionType,
  now: string | undefined,
): WriteDecision {
  const scope = scopeFor(source, actor, { institutionType })
  const teacher = scope.teacher
  const teaches = (classId: string | undefined, subjectId?: string) =>
    !!teacher &&
    classId !== undefined &&
    source.assignments.some(
      (a) =>
        a.classId === classId &&
        a.teacherId === teacher.id &&
        (subjectId === undefined || a.subjectId === subjectId),
    )
  const classOf = (studentId: string) => source.students.find((s) => s.id === studentId)?.classId
  switch (request.action) {
    case 'invoice.pay':
      return ALLOWED
    case 'invoice.payOnline': {
      // Veli yalnız bağlı çocuğunun taksiti için ödeme başlatır (DOM-YTK-025, DOM-FIN-052).
      return scope.studentIds.has(request.target.studentId)
        ? ALLOWED
        : deny('student_scope_denied', 'Bu öğrenci için işlem yetkiniz bulunmuyor.', 'DOM-YTK-025')
    }
    case 'attendance.record': {
      const { classId, date, reason } = request.target
      if (actor.role === 'yonetici')
        return hasReason(reason) ? ALLOWED : reasonRequired('DOM-AKD-035')
      if (!teaches(classId))
        return deny(
          'attendance_class_forbidden',
          'Yalnızca ders verdiğiniz sınıfın yoklamasını alabilirsiniz.',
          'DOM-YTK-022',
        )
      // Öğretmen yoklamayı aynı gün alır ve düzeltir; sonraki günler yöneticidedir (DOM-AKD-035).
      if (Number.isFinite(Date.parse(date)) && dayKey(date) !== dayKey(now ?? new Date()))
        return deny(
          'attendance_correction_admin_only',
          'Geçmiş günlerin yoklamasını yalnızca yönetici gerekçeyle düzeltebilir.',
          'DOM-AKD-035',
        )
      return ALLOWED
    }
    case 'grade.record':
    case 'grade.update': {
      const { studentId, subjectId } = request.target
      const update = request.action === 'grade.update' ? request.target : undefined
      if (actor.role === 'yonetici')
        return hasReason(update?.reason) ? ALLOWED : reasonRequired('DOM-AKD-051')
      // Yeni not öğrencinin güncel sınıfında girilir; düzeltme notun verildiği sınıfın ders
      // öğretmenindedir. Sınıf değiştiren öğrencinin eski notunu yeni sınıfın öğretmeni düzeltemez.
      return teaches(update?.classId ?? classOf(studentId), subjectId)
        ? ALLOWED
        : deny(
            'grade_assignment_forbidden',
            'Yalnızca derse girdiğiniz sınıf ve branşta not girebilirsiniz.',
            'DOM-AKD-054',
          )
    }
    case 'record.archive':
    case 'record.restore':
      return ALLOWED
    default:
      return request satisfies never
  }
}

/** `authorize` reddini `DomainError` olarak fırlatır (API: forbidden 403, rule 422, not_found 404). */
export function requireAuthorized<A extends WriteAction>(
  actor: Actor,
  action: A,
  target: WriteTargets[A],
  source: AuthorizationSource,
  options?: AuthorizeOptions,
) {
  const decision = authorize(actor, action, target, source, options)
  if (!decision.allowed)
    throw new DomainError(decision.code, decision.message, { kind: decision.kind })
}

/** Çevrimdışı demo: oturumun aktörüyle (`sessionActor`) aynı karar. */
export function sessionAuthorize<A extends WriteAction>(
  state: State,
  session: Session,
  action: A,
  target: WriteTargets[A],
  options?: AuthorizeOptions,
): WriteDecision {
  return authorize(sessionActor(state, session), action, target, state, options)
}
