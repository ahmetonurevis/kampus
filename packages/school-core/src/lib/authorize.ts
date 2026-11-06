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
  // Burs programı ve MEBBİS işareti (DOM-FIN-025).
  'scholarship.manage': Record<string, never>
  // Ek hizmet aboneliği (DOM-FIN-003): kurum geneli; hedef kaydı yetkiyi değiştirmez.
  'studentService.manage': Record<string, never>
  // Sözleşme onayı (IST-092): veli yalnız bağlı çocuğunda; ödeyici kuralı `lib/contract-approval.ts`.
  'contract.sign': Record<string, never>
  'contract.approve': { studentId: string }
  'contract.amend': Record<string, never>
  'student.withdraw': Record<string, never>
  'invoice.payOnline': { studentId: string }
  // Aday/CRM (`lib/prospects.ts`): kurum kapsamlıdır, hedef kaydı yetkiyi değiştirmez.
  'prospect.create': Record<string, never>
  'prospect.stage': Record<string, never>
  // Yanlışlıkla ileri alınan aşamanın yönetici tarafından geri alınması (DOM-KAY-030).
  'prospect.stageRevert': Record<string, never>
  // Adayın kanal bazlı ticari ileti onayını verme ve geri alma (DOM-KAY-004).
  'prospect.consent': Record<string, never>
  // Aday bilgisi düzeltme (KVKK md. 11 düzeltme hakkı, DOM-KAY-003).
  'prospect.update': Record<string, never>
  'prospect.note': Record<string, never>
  'prospect.meeting': Record<string, never>
  'prospect.trial': Record<string, never>
  // Deneme dersi sonucu (DOM-DIL-031): hedef, deneme dersinin grubudur; öğretmen kendi grubunda yazar.
  'prospect.trialResult': { classId: string }
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
  // Burs onayı yöneticidedir (DOM-FIN-052).
  'scholarship.manage': ['yonetici'],
  // Ek hizmete yazılma ve çıkış velinin talebiyle işlenir; veli ve öğrenci yalnız okur (DOM-FIN-052).
  'studentService.manage': ['yonetici', 'onburo'],
  // İmza yetkilisini (kurucu/temsilci) kurumu bağlayan yönetici işler; ön büro sözleşme hazırlar ve
  // ıslak imzayı işler, veli ödeyiciyse kendisi onaylar (DOM-FIN-052, IST-092).
  'contract.sign': ['yonetici'],
  'contract.approve': ['yonetici', 'onburo', 'veli'],
  'contract.amend': ['yonetici', 'onburo'],
  // Ayrılış onayı ve iade yöneticidedir (DOM-FIN-052, IST-110).
  'student.withdraw': ['yonetici'],
  // Çevrim içi ödeme: veli yalnız bağlı çocuğunun taksiti için başlatır (DOM-FIN-052, DOM-YTK-025).
  'invoice.payOnline': ['veli'],
  // Aday ve tanışma görüşmesi kurum genelinde yönetici ve ön büronundur; öğretmen, öğrenci ve
  // veli aday kaydına erişmez (yetki matrisi "Aday, tanışma görüşmesi", DOM-YTK-021).
  'prospect.create': ['yonetici', 'onburo'],
  'prospect.stage': ['yonetici', 'onburo'],
  // Aşamayı geri alma geri dönüş yasağının istisnasıdır; yalnız yönetici, gerekçeyle (DOM-KAY-030).
  'prospect.stageRevert': ['yonetici'],
  // Onayı adayın talebiyle ön büro ve yönetici işler; ret hakkı geciktirilemez (DOM-KAY-004).
  'prospect.consent': ['yonetici', 'onburo'],
  // Düzeltme talebini ön büro ve yönetici işler; öğretmen aday verisini düzeltmez (DOM-KAY-003).
  'prospect.update': ['yonetici', 'onburo'],
  'prospect.note': ['yonetici', 'onburo'],
  'prospect.meeting': ['yonetici', 'onburo'],
  'prospect.trial': ['yonetici', 'onburo'],
  // Deneme sonucunu dersin öğretmeni yazar; satış hunisi ile akademik karar karışmaz (DOM-DIL-031).
  'prospect.trialResult': ['ogretmen'],
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
  if (
    (action === 'prospect.trial' || action === 'prospect.trialResult') &&
    institutionType !== 'language_school'
  )
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
  // Sınıf rehber öğretmeni (`classes.teacherId`) olduğu sınıflar ve onların öğrencileri.
  const homeroom = (classId: string | undefined) =>
    !!teacher &&
    classId !== undefined &&
    source.classes.some((c) => c.id === classId && c.teacherId === teacher.id)
  const homeroomTargets = (target: {
    classIds: readonly string[]
    studentIds: readonly string[]
  }) => target.classIds.every(homeroom) && target.studentIds.every((id) => homeroom(classOf(id)))
  switch (request.action) {
    case 'invoice.pay':
    case 'payment.reverse':
    case 'tariff.manage':
    case 'scholarship.manage':
    case 'studentService.manage':
    case 'student.withdraw':
    case 'contract.sign':
    case 'contract.amend':
      return ALLOWED
    case 'contract.approve':
      // Kapsam dışı öğrencinin sözleşmesi yok sayılır; varlığı sızmaz (DOM-YTK-025, DOM-FIN-052).
      return actor.role !== 'veli' || scope.studentIds.has(request.target.studentId)
        ? ALLOWED
        : deny('contract_not_found', 'Sözleşme bulunamadı.', 'DOM-YTK-025', 'not_found')
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
    case 'absence.attach':
    case 'absence.approve':
    case 'absence.reject': {
      // Bildirim kaydı üzerinde işlem: kapsam dışı (başka velinin çocuğu) bildirim olmayan
      // kayıtla aynı 404'tür, varlığı sızdırılmaz (DOM-ILT-053).
      const { studentId } = request.target
      return studentId !== undefined && scope.studentIds.has(studentId)
        ? ALLOWED
        : deny('absence_not_found', 'Bildirim bulunamadı.', 'DOM-ILT-053', 'not_found')
    }
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
    case 'homework.assign': {
      // Öğretmen yalnız derse girdiği sınıf ve branşa ödev verir; yönetici her sınıfa
      // (DOM-AKD-070, DOM-YTK-022).
      if (actor.role === 'yonetici') return ALLOWED
      const { classId, subjectId } = request.target
      return teaches(classId, subjectId)
        ? ALLOWED
        : deny(
            'homework_scope_denied',
            'Yalnız derse girdiğiniz sınıf ve branşa ödev verebilirsiniz.',
            'DOM-AKD-070',
          )
    }
    case 'homework.update':
    case 'homework.archive':
    case 'homework.grade': {
      // Ödevin öğretmeni ya da yönetici (DOM-AKD-071, -073). Ödevi okuyabilen başka öğretmen
      // (aynı sınıfa giren) 403 alır; okuyamayan için ret 404'tür, ödevin varlığı sızdırılmaz.
      const homework = request.target.homework
      if (homework === undefined || actor.role === 'yonetici') return ALLOWED
      if (teacher && homework.teacherId === teacher.id) return ALLOWED
      return scope.classIds.has(homework.classId)
        ? deny('homework_not_owner', 'Bu ödevin öğretmeni değilsiniz.', 'DOM-AKD-071')
        : deny('homework_not_found', 'Ödev bulunamadı.', 'DOM-AKD-071', 'not_found')
    }
    case 'homework.submit': {
      // Öğrenci yalnız kendisi için ve kendi sınıfının ödevini teslim eder (DOM-AKD-072); başka
      // sınıfın ödevi olmayan ödevle aynı 404'tür.
      const { studentId, homework } = request.target
      if (studentId === undefined || !scope.studentIds.has(studentId))
        return deny(
          'student_scope_denied',
          'Bu öğrenci için işlem yetkiniz bulunmuyor.',
          'DOM-AKD-072',
        )
      if (homework === undefined) return ALLOWED
      return classOf(studentId) === homework.classId
        ? ALLOWED
        : deny('homework_not_found', 'Ödev bulunamadı.', 'DOM-AKD-072', 'not_found')
    }
    // Deneme dersi sonucu yalnız dersin grubunun öğretmenindir; kapsam dışı grup, denemesi olmayan
    // aday gibi 404'tür (adayın varlığı sızmaz, DOM-DIL-031).
    case 'prospect.trialResult':
      return scope.classIds.has(request.target.classId)
        ? ALLOWED
        : deny('prospect_not_found', 'Aday bulunamadı.', 'DOM-DIL-031', 'not_found')
    case 'permissionForm.create':
      // Yönetici her sınıf ve öğrenciye; öğretmen yalnız rehberi olduğu sınıflara ve onların
      // öğrencilerine izin formu açar (DOM-ILT-036).
      return actor.role === 'yonetici' || homeroomTargets(request.target)
        ? ALLOWED
        : deny(
            'permission_form_scope_denied',
            'Yalnız rehberi olduğunuz sınıflara izin formu açabilirsiniz.',
            'DOM-ILT-036',
          )
    case 'permissionForm.update':
    case 'permissionForm.close':
    case 'permissionForm.cancel':
    case 'permissionForm.archive': {
      // Formun öğretmeni ya da yönetici (DOM-ILT-038). Formu gören başka öğretmen 403 alır;
      // görmeyen için ret 404'tür, formun varlığı sızdırılmaz.
      const form = request.target.form
      const targets =
        request.action === 'permissionForm.update' ? request.target.targets : undefined
      if (form === undefined || actor.role === 'yonetici') return ALLOWED
      if (teacher && form.teacherId === teacher.id)
        return targets === undefined || homeroomTargets(targets)
          ? ALLOWED
          : deny(
              'permission_form_scope_denied',
              'Yalnız rehberi olduğunuz sınıflara izin formu açabilirsiniz.',
              'DOM-ILT-036',
            )
      const sees =
        form.classIds.some((id) => scope.classIds.has(id)) ||
        form.studentIds.some((id) => scope.studentIds.has(id))
      return sees
        ? deny('permission_form_not_owner', 'Bu izin formunu siz açmadınız.', 'DOM-ILT-038')
        : deny('permission_form_not_found', 'İzin formu bulunamadı.', 'DOM-ILT-038', 'not_found')
    }
    case 'permissionForm.decide': {
      // Veli yalnız velayetli ve kısıtsız bağlı çocuğu, öğrenci yalnız kendisi için karar verir;
      // başka çocuk ve formun hedefinde olmayan öğrenci yokmuş gibi 404'tür (DOM-ILT-037).
      const { studentId, form } = request.target
      if (!scope.studentIds.has(studentId))
        return deny('student_not_found', 'Öğrenci bulunamadı.', 'DOM-ILT-037', 'not_found')
      if (form === undefined || form.studentIds.includes(studentId)) return ALLOWED
      return deny('permission_form_not_found', 'İzin formu bulunamadı.', 'DOM-ILT-037', 'not_found')
    }
    case 'video.progress': {
      // Öğrenci yalnız kendisi için ve okuma kapsamındaki (kendi düzeyinin) videoya yazar
      // (DOM-KYN-005); kapsam dışı video olmayan videoyla aynı 404'tür.
      const { studentId, video } = request.target
      if (studentId === undefined || !scope.studentIds.has(studentId))
        return deny(
          'student_scope_denied',
          'Bu öğrenci için işlem yetkiniz bulunmuyor.',
          'DOM-KYN-005',
        )
      return video !== undefined && scope.canRead('videos', video)
        ? ALLOWED
        : deny('video_not_found', 'Video bulunamadı.', 'DOM-KYN-005', 'not_found')
    }
    // Deneme dersinin kurum türü (yalnız dil okulu, DOM-DIL-030) `authorize` içinde rolden önce
    // denetlenir.
    case 'prospect.create':
    case 'prospect.stage':
    case 'prospect.stageRevert':
    case 'prospect.consent':
    case 'prospect.update':
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
    // okuma alanları `lib/guardianship.ts` `guardianLinksView`'da daralır (DOM-ILT-073). Veli
    // davetinde öğrenci ve veli kaydının varlığı ve bağ kuralı işlemdedir (DOM-YTK-071).
    case 'guardian.read':
    case 'guardian.manage':
    case 'guardian.invite':
    case 'guardian.invite_list':
    case 'guardian.invite_cancel':
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
    case 'quiz.create': {
      // Öğretmen yalnız derse girdiği sınıf ve branşa quiz hazırlar; yönetici her sınıfa
      // (DOM-AKD-075, DOM-YTK-022).
      if (actor.role === 'yonetici') return ALLOWED
      const { classId, subjectId } = request.target
      return teaches(classId, subjectId)
        ? ALLOWED
        : deny(
            'quiz_scope_denied',
            'Yalnız derse girdiğiniz sınıf ve branşa quiz hazırlayabilirsiniz.',
            'DOM-AKD-075',
          )
    }
    case 'quiz.update':
    case 'quiz.archive': {
      // Yönetici ya da sınıfın o dersine atanmış öğretmen (DOM-AKD-076). Quizi okuyabilen başka
      // öğretmen (aynı sınıfa giren ya da dersten alınmış eski öğretmen) 403 alır; okuyamayan için
      // ret 404'tür, quizin varlığı sızdırılmaz.
      const quiz = request.target.quiz
      if (quiz === undefined || actor.role === 'yonetici') return ALLOWED
      if (teaches(quiz.classId, quiz.subjectId)) return ALLOWED
      return scope.classIds.has(quiz.classId) || (!!teacher && quiz.teacherId === teacher.id)
        ? deny('quiz_not_owner', 'Bu quizin dersine girmiyorsunuz.', 'DOM-AKD-076')
        : deny('quiz_not_found', 'Quiz bulunamadı.', 'DOM-AKD-076', 'not_found')
    }
    case 'quiz.start':
    case 'quiz.submit': {
      // Öğrenci yalnız kendisi için ve kendi sınıfının quizini çözer (DOM-AKD-077); başka sınıfın
      // quizi olmayan quizle aynı 404'tür.
      const { studentId, quiz } = request.target
      if (studentId === undefined || !scope.studentIds.has(studentId))
        return deny(
          'student_scope_denied',
          'Bu öğrenci için işlem yetkiniz bulunmuyor.',
          'DOM-AKD-077',
        )
      if (quiz === undefined) return ALLOWED
      return classOf(studentId) === quiz.classId
        ? ALLOWED
        : deny('quiz_not_found', 'Quiz bulunamadı.', 'DOM-AKD-077', 'not_found')
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
