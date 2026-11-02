import type { State } from '../data/seed.ts'
import {
  accessDecision,
  publishDecision,
  publisherDecision,
  readDecision,
  sendDecision,
  startDecision,
  type CommunicationDenial,
} from './communication-access.ts'
import { moduleAvailableFor, type InstitutionType } from '../modules/collection-modules.ts'
import {
  type ONUR_OPERATION_COMMANDS,
  OPERATION_COMMANDS,
  type OperationCommand,
} from '../modules/commands.ts'
import { PLATFORM_WRITE_ACTION_ROLES, type PlatformWriteTargets } from '../platform/authorize.ts'
import type { Session } from './domain.ts'
import { DomainError, type DomainErrorKind } from './errors.ts'
import { dayKey } from './format.ts'
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

/**
 * Eylem başına yetkinin dayandığı hedef bilgisi; kimlikler istemciden gelse de kapsamla denetlenir.
 * İki kaynağın birleşimi: Oğuzhan'ın eylemleri `platform/authorize.ts` (`PlatformWriteTargets`),
 * kayıt ve finans eylemleri aşağıdaki `// Onur: kayıt ve finans` bloğu.
 */
export type WriteTargets = PlatformWriteTargets & OnurWriteTargets

// Onur: kayıt ve finans
type OnurWriteTargets = {
  'invoice.pay': { studentId: string }
  'payment.reverse': Record<string, never>
  'tariff.manage': Record<string, never>
  'student.withdraw': Record<string, never>
  'invoice.payOnline': { studentId: string }
  // Aday/CRM (`lib/prospects.ts`): kurum kapsamlıdır, hedef kaydı yetkiyi değiştirmez.
  'prospect.create': Record<string, never>
  'prospect.stage': Record<string, never>
  'prospect.note': Record<string, never>
  'prospect.meeting': Record<string, never>
  'prospect.trial': Record<string, never>
  // Kesin kayıt (`enrollProspect`, `lib/enrollment.ts`); işlem yetkiyi kendisi denetlemez, çağıran
  // önce `requireAuthorized` çalıştırır.
  'prospect.enroll': Record<string, never>
}
// Onur: kayıt ve finans sonu

/** Soru yetkisinin dayandığı taraflar (DOM-ILT-090…092). */
export type QuestionParties = {
  studentId: string
  teacherId: string
  subjectId: string
  answeredAt?: string | null
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

// Onur: kayıt ve finans
/** Kayıt ve finans eylemlerinin rol matrisi; anahtarlar `ONUR_OPERATION_COMMANDS` ile aynıdır. */
export const ONUR_WRITE_ACTION_ROLES = {
  // Tahsilat kaydı (taksiti "ödendi" işaretler) yalnız yönetici ve ön büroda; veli ve öğrenci
  // tahsilat kaydedemez, öğretmenin finans erişimi yoktur (DOM-FIN-052, yetki matrisi).
  'invoice.pay': ['yonetici', 'onburo'],
  // Tahsilat iptali yöneticidedir; onay ile kayıt aynı kişide toplanmaz (DOM-FIN-033, DOM-FIN-052).
  'payment.reverse': ['yonetici'],
  // Tarife yöneticidedir, ön büro yalnız görür (DOM-FIN-052).
  'tariff.manage': ['yonetici'],
  // Ayrılış onayı ve iade yöneticidedir (DOM-FIN-052, IST-110).
  'student.withdraw': ['yonetici'],
  // Çevrim içi ödeme: veli yalnız bağlı çocuğunun taksiti için başlatır (DOM-FIN-052, DOM-YTK-025).
  'invoice.payOnline': ['veli'],
  // Aday ve tanışma görüşmesi kurum genelinde yönetici ve ön büronundur; öğretmen, öğrenci ve
  // veli aday kaydına erişmez (yetki matrisi "Aday, tanışma görüşmesi", DOM-YTK-021).
  'prospect.create': ['yonetici', 'onburo'],
  'prospect.stage': ['yonetici', 'onburo'],
  'prospect.note': ['yonetici', 'onburo'],
  'prospect.meeting': ['yonetici', 'onburo'],
  'prospect.trial': ['yonetici', 'onburo'],
  // Kesin kayıt (aday → öğrenci, sözleşme ve taksit) yönetici ve ön büronundur (DOM-KAY-011).
  'prospect.enroll': ['yonetici', 'onburo'],
} as const satisfies Record<keyof typeof ONUR_OPERATION_COMMANDS, readonly Actor['role'][]>
// Onur: kayıt ve finans sonu

/**
 * Matrisin bu eylemlerdeki varsayılanı (rapor ve testler için; kapsam kuralları aşağıda). İki
 * kaynağın birleşimi: Oğuzhan'ın eylemleri `platform/authorize.ts` (`PLATFORM_WRITE_ACTION_ROLES`),
 * kayıt ve finans eylemleri yukarıdaki Onur bloğu; bir eylem yalnız bir kaynakta bulunur
 * (`tests/authorize.test.ts`).
 */
export const WRITE_ACTION_ROLES = {
  ...PLATFORM_WRITE_ACTION_ROLES,
  ...ONUR_WRITE_ACTION_ROLES,
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
const fromCommunication = (denial: CommunicationDenial | null): WriteDecision =>
  denial ? deny(denial.code, denial.message, denial.rule, denial.kind ?? 'forbidden') : ALLOWED
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
 * Aktör bu eylemi bu hedefte yapabilir mi. Önce modül (DOM-YTK-040) ve kurum türü (DOM-YTK-012),
 * sonra rol (matris), sonra
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
  // Kurum türünde bulunmayan işlem her rol için yok sayılır (404); rol denetiminden önce gelir ki
  // yetkisiz rol 403 ile işlemin varlığını öğrenmesin (DOM-YTK-012).
  if (action === 'prospect.trial' && institutionType !== 'language_school')
    return deny('trial_lesson_unavailable', 'İlgili kayıt bulunamadı.', 'DOM-DIL-030', 'not_found')
  if (action.startsWith('course.') && institutionType !== 'language_school')
    return deny(
      'module_unavailable_for_type',
      'İlgili kayıt bulunamadı.',
      'DOM-DIL-005',
      'not_found',
    )
  if (action.startsWith('group.') && institutionType !== 'language_school')
    return deny(
      'module_unavailable_for_type',
      'İlgili kayıt bulunamadı.',
      'DOM-DIL-008',
      'not_found',
    )
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
    case 'payment.reverse':
    case 'tariff.manage':
    case 'student.withdraw':
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
    case 'branch.save':
    case 'teacher.save':
    case 'class.save':
      return ALLOWED
    case 'announcement.publish':
      return fromCommunication(
        publishDecision(scope, request.target.target, request.target.category),
      )
    case 'announcement.revise':
    case 'announcement.withdraw':
      return fromCommunication(publisherDecision(scope, request.target.announcement))
    case 'announcement.read':
      return ALLOWED
    case 'conversation.start':
      return fromCommunication(startDecision(scope, source, request.target))
    case 'message.send':
      return fromCommunication(
        sendDecision(
          scope,
          source,
          request.target.userId,
          request.target.conversation,
          request.target.parentUserIds,
        ),
      )
    case 'message.read':
      return fromCommunication(
        readDecision(scope, request.target.userId, request.target.conversation),
      )
    case 'conversation.access':
      return fromCommunication(accessDecision(request.target.reason, request.target.conversation))
    case 'request.open':
    case 'absence.notify':
    case 'appointment.book':
      // Veli yalnız bağlı çocuğu için bildirir (DOM-YTK-025, DOM-ILT-053).
      return scope.studentIds.has(request.target.studentId)
        ? ALLOWED
        : deny('student_scope_denied', 'Bu öğrenci için işlem yetkiniz bulunmuyor.', 'DOM-YTK-025')
    case 'appointment.slots':
      // Okumadır: başka velinin çocuğu veya kurumda olmayan öğrenci olmayan kayıtla aynı 404'tür,
      // öğrencinin varlığı sızdırılmaz (DOM-ILT-105). Talepteki 403'ten farkı budur.
      return scope.studentIds.has(request.target.studentId)
        ? ALLOWED
        : deny('student_not_found', 'Öğrenci bulunamadı.', 'DOM-ILT-105', 'not_found')
    case 'request.update':
    case 'appointment.update':
      return ALLOWED
    case 'question.ask': {
      // Öğrenci yalnız kendisi için ve kendi sınıfının o dersine atanmış öğretmene sorar
      // (DOM-ILT-090, DOM-ILT-011). Ders veya öğretmen kapsam dışıysa ret aynı iletiyle döner;
      // dersin ya da öğretmenin kurumda var olup olmadığı belli edilmez.
      const { studentId, subjectId, teacherId } = request.target
      if (studentId === undefined || !scope.studentIds.has(studentId))
        return deny(
          'student_scope_denied',
          'Bu öğrenci için işlem yetkiniz bulunmuyor.',
          'DOM-ILT-090',
        )
      const classId = classOf(studentId)
      const assigned = source.assignments.some(
        (a) =>
          a.classId === classId &&
          a.subjectId === subjectId &&
          (teacherId === undefined || a.teacherId === teacherId),
      )
      return assigned
        ? ALLOWED
        : deny(
            'question_scope_denied',
            'Yalnız kendi sınıfınızın bu dersine giren öğretmene soru gönderebilirsiniz.',
            'DOM-ILT-090',
          )
    }
    case 'question.answer': {
      // Yanıt sorunun atandığı öğretmenindir (DOM-ILT-092). Başka öğretmen soruyu okuyamadığı için
      // ret 404'tür: soru kimliğinin varlığı sızdırılmaz.
      const question = request.target.question
      if (question === undefined) return ALLOWED
      if (!teacher || question.teacherId !== teacher.id)
        return deny('question_not_found', 'Soru bulunamadı.', 'DOM-ILT-092', 'not_found')
      // Ek yanıt yalnız sınıfın o dersine hâlâ atanmış öğretmenindir: yanıtlanmış soru taşınmaz,
      // sınıftan alınan öğretmen eski sorusunu okur ama öğrenciye yazmayı sürdüremez. Soruyu
      // okuyabildiği için ret 403'tür.
      if (question.answeredAt && !teaches(classOf(question.studentId), question.subjectId))
        return deny(
          'question_teacher_reassigned',
          'Bu sınıfın dersine artık girmediğiniz için ek yanıt yazamazsınız.',
          'DOM-ILT-092',
        )
      return ALLOWED
    }
    case 'question.withdraw': {
      // Öğrenci yalnız kendi sorusunu geri çeker (DOM-ILT-091); başkasınınki 404.
      const question = request.target.question
      if (question === undefined) return ALLOWED
      return scope.studentIds.has(question.studentId)
        ? ALLOWED
        : deny('question_not_found', 'Soru bulunamadı.', 'DOM-ILT-091', 'not_found')
    }
    // Deneme dersinin kurum türü (yalnız dil okulu, DOM-DIL-030) `authorize` içinde rolden önce
    // denetlenir.
    case 'prospect.create':
    case 'prospect.stage':
    case 'prospect.note':
    case 'prospect.meeting':
    case 'prospect.trial':
    case 'prospect.enroll':
    case 'notification.read':
    case 'notification.read_all':
      return ALLOWED
    // Rıza ve gösterim kararı veri sahibine göre `lib/consents.ts` ve `lib/privacy-notices.ts`
    // içindedir (DOM-YTK-056…062); burada yalnız rol denetlenir.
    case 'notice.publish':
    case 'notice.acknowledge':
    case 'consent.give':
    case 'consent.withdraw':
      return ALLOWED
    // Eğitim yılı kurum geneli bilgidir; okuma alanları rolle `academicYearView`'da daralır.
    case 'academicYear.read':
    case 'academicYear.manage':
      return ALLOWED
    // Veli bağı: öğrencinin varlığı ve velinin kendi bağı serviste denetlenir (kapsam dışı 404);
    // okuma alanları `lib/guardianship.ts` `guardianLinksView`'da daralır (DOM-ILT-073).
    case 'guardian.read':
    case 'guardian.manage':
      return ALLOWED
    // Kur kurum geneli katalogdur; koordinatörün seviye kapsamı `lib/courses.ts`
    // `assertCourseManager`'da, öğrenci/veli daraltması `courseView`'dadır (DOM-DIL-005).
    case 'course.read':
    case 'course.manage':
    case 'course.eozel':
      return ALLOWED
    // Grup satır kapsamı `lib/language-groups.ts` `canReadGroup`'ta, koordinatörün seviye kapsamı
    // `assertCourseManager`'da, öğrenci/veli daraltması `groupView`'dadır (IST-077).
    case 'group.read':
    case 'group.manage':
    case 'group.waitlist':
      return ALLOWED
    case 'consent.read':
    case 'consent.status': {
      // Kapsam dışı öğrenci olmayan kayıtla aynı 404'tür; öğrencinin varlığı sızdırılmaz
      // (DOM-YTK-057). Öğretmen yalnız ders verdiği sınıfların öğrencisini görür (DOM-YTK-022).
      const { studentId } = request.target
      if (studentId === undefined || scope.studentIds.has(studentId)) return ALLOWED
      return deny('consent_student_not_found', 'Öğrenci bulunamadı.', 'DOM-YTK-057', 'not_found')
    }
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
