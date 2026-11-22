import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import { WORKFLOW_ROUTES } from '../src/routes/workflows.schemas.ts'
import { buildTestApp, createTestDatabase } from './support/app.ts'

/**
 * Rota → çapraz kurum testi envanteri (IST-002; DOM-YTK-001, DOM-YTK-011). Her uç için A kurumunun
 * oturumu B kurumunun verisine ulaşamaz: kayıt kimliği alan uçta okuma ve yazma 404 döner ve B
 * satırı değişmez; listede, sayımda ve özette B kaydı yoktur; gövdedeki `institutionId` ya da B
 * kaydına işaret eden kimlik etkisizdir. Kural 404'tür, 403 değil: varlık sızmaz.
 *
 * Envanter uygulamanın rotalarından okunur (`app.routeModules()`, `module-inventory.test.ts` ile
 * aynı kaynak). Her `method + url` tabloda dört sınıftan birindedir:
 *
 * - `kayıt`: yol kimliği kurum kaydıdır; testte B kaydına A'dan okuma ya da yazma 404, B değişmez.
 * - `liste`: kimlik almaz, kurumun verisini döner (liste, sayım, özet, güncel kayıt); B kaydı yok.
 * - `gövde`: kimliksiz oluşturma; gövdedeki `institutionId` ya da B kaydının kimliği etkisiz.
 * - `yok`: kurum kaydı almaz ve dönmez (gerekçesiyle).
 *
 * İlk üç sınıfta satır testi gösterir: dosya (`apps/api/test/` altında) ve test adının bir parçası.
 * Denetim metinseldir: dosyada adı o parçayı içeren ve çapraz kurum senaryosunu anan (`başka
 * kurum`, `kurumlar arası`, `institutionId` …) bir test bulunur; dosyada uç yolu (yol kimlikleri
 * herhangi bir değerle) ya da satırdaki `marker` geçer. Yeni uç sınıflandırılmazsa, satır eski
 * kalırsa ya da gösterilen test silinirse bu dosya kırılır.
 */

type Kind = 'kayıt' | 'liste' | 'gövde'
type Proof =
  { kind: Kind; file: string; test: string; marker?: string } | { kind: 'yok'; reason: string }

const proof =
  (kind: Kind) =>
  (file: string, name: string, marker?: string): Proof => ({
    kind,
    file,
    test: name,
    ...(marker === undefined ? {} : { marker }),
  })
const kayit = proof('kayıt')
const liste = proof('liste')
const govde = proof('gövde')
const yok = (reason: string): Proof => ({ kind: 'yok', reason })

/** Yol kimliği kurum kaydı olmayan parametreler (koleksiyon adı, modül anahtarı, KVKK amacı). */
const NON_RECORD_PARAMS = new Set(['collection', 'moduleKey', 'purpose'])

// --- Sık gösterilen testler ------------------------------------------------------------------
const COLLECTIONS = kayit(
  'collections.test.ts',
  'başka kurumun kaydı listede yok, tekil istekte 404',
)
const BRANCH_PATCH = kayit('school-management.test.ts', 'başka kurumun kampüsü 404 ve B değişmez')
const CONVERSATION = kayit('communication.test.ts', 'kurumlar arası 404: başka kurumun yazışması')
const GROUP = kayit('language-groups.test.ts', 'başka kurumun grubu 404, listede görünmez')
const GROUP_COMMAND = (verb: string) =>
  kayit('language-groups.test.ts', 'başka kurumun grubu açılmaz ve birleştirilmez', `'${verb}'`)
const PROGRESSION = 'başka kurumun kaydı, kararı, grubu ve öğrencisi 404, B değişmez'
const CERTIFICATE = 'başka kurumun belgesi, kararı ve grubu 404, listede yok, B değişmez'
const PLACEMENT = kayit('cefr.test.ts', 'başka kurumun oturumu ve öğrencisi 404, B değişmez')
const PLACEMENT_COMMAND = (verb: string) =>
  kayit('cefr.test.ts', 'başka kurumun oturumu ve öğrencisi 404, B değişmez', `'${verb}'`)
const COURSE = kayit('courses.test.ts', 'başka kurumun kuru 404, listede görünmez ve değişmez')
const CONSENT = kayit('consents.test.ts', 'başka kurum: kayıt ve metin 404, B değişmez')
const DUTY = kayit('coordinator-duties.test.ts', 'başka kurumun yöneticisi 404')
const GUARDIAN = kayit('student-guardians.test.ts', 'başka kurum: öğrenci ve bağ 404, B değişmez')
const HEALTH_PROFILE = kayit(
  'health-profiles-routes.test.ts',
  'başka kurum: öğrenci 404, B değişmez',
)
const YEAR = kayit('academic-years.test.ts', 'başka kurum: yılı 404, yazma B yılını değiştirmez')
const LESSON_READ = kayit('lessons.test.ts', 'başka kurumun dersi listede yok ve 404')
const LESSON_WRITE = kayit(
  'lessons.test.ts',
  'başka kurumun dersi düzenleme, yedek ve iptalde olmayan dersle aynı 404',
)
const HOMEWORK = kayit(
  'homework.test.ts',
  'başka kurumun ödevi ve teslimi olmayan kimlikle aynı 404, B değişmez',
)
const QUIZ = kayit('quizzes.test.ts', 'başka kurumun quizi olmayan kimlikle aynı 404, B değişmez')
const PERMISSION_FORM = kayit(
  'permission-forms.test.ts',
  'başka kurumun formu olmayan kimlikle aynı 404, B değişmez',
)
const RESOURCE_READ = kayit('resources.test.ts', 'başka kurumun kaynağı 404 ve listede yok')
const RESOURCE_WRITE = kayit(
  'resource-commands.test.ts',
  'başka kurumun ve okunamayan kaynağın yazma uçları 404',
)
const RUBRIC = kayit('rubrics.test.ts', 'başka kurumun rubriği okuma ve yazmada 404')
const ASSIGNMENT = kayit('task-assignments.test.ts', 'kurumlar arası: B kurumunun atamasına')
const EXTRA_TIME = kayit('task-extra-times.test.ts', 'atamayı görmeyen öğretmen ve başka kurum 404')
const EXTRA_TIME_COMMAND = (marker: string) =>
  kayit('task-extra-times.test.ts', 'atamayı görmeyen öğretmen ve başka kurum 404', marker)
const GRADING = kayit('task-grading.test.ts', 'atamayı görmeyen öğretmen ve başka kurum 404')
const tutoring = (marker: string) =>
  kayit('assessment.test.ts', 'başka kurumun uygunluğu ve etüdü 404, B değişmez', marker)
const plan = (marker: string) =>
  kayit('assessment.test.ts', 'başka kurumun sınavıyla plan 404', marker)
const PROSPECT = kayit(
  'prospects.test.ts',
  'başka kurumun ve olmayan aday sürüm ne olursa olsun 404',
)
const TARIFF = kayit('fee-tariffs.test.ts', 'başka kurumun tarifesi 404; öteki kurum değişmez')
const PAYMENT = kayit('payments.test.ts', 'başka kurumun öğrencisi ve tahsilatı 404')
const WITHDRAWAL = kayit('withdrawals.test.ts', 'başka kurumun öğrencisi ve ayrılışı 404')

/** Oğuzhan'ın ve Onur'un uçları (iş akışı köprüsü aşağıda core komut tablosundan türetilir). */
const ROUTES: Readonly<Record<string, Proof>> = {
  // --- Kimlik, oturum, ayar -----------------------------------------------------------------
  'GET /api/v1/auth/*': yok('Better Auth oturum okuması; kişinin kendi oturumu'),
  // Kurum seçimi üyelikle sınırlıdır: üyesi olmadığı kuruma geçiş reddedilir.
  'POST /api/v1/auth/*': govde(
    'scope.test.ts',
    'üyesi olmadığı kuruma geçiş reddedilir',
    '/api/v1/auth/organization/set-active',
  ),
  'GET /api/v1/health': yok('sağlık denetimi, oturumsuz'),
  'GET /api/v1/me': yok('oturum sahibinin kendi kişi ve üyelik bilgisi; kurum oturumdan'),
  'GET /api/v1/memberships': liste('scope.test.ts', 'A oturumu B kurumunun üyelerini görmez'),
  'GET /api/v1/institution-members': liste(
    'institution-members.test.ts',
    'başka kurumun üyeleri listede yok',
  ),
  'GET /api/v1/institution-members/invitations': liste(
    'staff-accounts.test.ts',
    'başka kurumun daveti listede yok',
  ),
  'POST /api/v1/institution-members/invitations': govde(
    'staff-accounts.test.ts',
    'başka kurumun öğretmen kaydı 404',
  ),
  'GET /api/v1/institution-members/guardian-invitations': liste(
    'guardian-invitations.test.ts',
    'başka kurumun veli daveti listede yok',
  ),
  'POST /api/v1/institution-members/guardian-invitations/:invitationId/cancel': kayit(
    'guardian-invitations.test.ts',
    'başka kurumun veli davetini iptal edemez',
  ),
  'POST /api/v1/institution-members/guardian-invitations': govde(
    'guardian-invitations.test.ts',
    'başka kurumun öğrencisi ya da veli kaydı 404',
  ),
  'POST /api/v1/institution-members/imports': govde(
    'staff-import.test.ts',
    'başka kurumun üyesi ve öğretmen kaydı bu kurumu etkilemez',
  ),
  'POST /api/v1/institution-members/invitations/:invitationId/cancel': kayit(
    'staff-accounts.test.ts',
    'başka kurumun davetini iptal edemez',
  ),
  'POST /api/v1/institution-members/:membershipId/role': kayit(
    'staff-accounts.test.ts',
    '401, 403, başka kurum 404, 400 ve kayıt değişmez',
  ),
  'POST /api/v1/institution-members/:membershipId/deactivate': kayit(
    'staff-accounts.test.ts',
    '401, 403, başka kurum 404, kendi hesabı ve son yönetici 422',
  ),
  'POST /api/v1/institution-members/:membershipId/reactivate': kayit(
    'staff-accounts.test.ts',
    'geri alma başka kurumda 404',
  ),
  'GET /api/v1/coordinator-duties': DUTY,
  'GET /api/v1/coordinator-duties/:dutyId': DUTY,
  'POST /api/v1/coordinator-duties': govde(
    'coordinator-duties.test.ts',
    'başka kurumun üyeliği 404',
  ),
  'DELETE /api/v1/coordinator-duties/:dutyId': DUTY,
  'GET /api/v1/audit-events': liste('audit-events.test.ts', 'başka kurumun kayıtları listede yok'),
  'GET /api/v1/modules': liste(
    'institution-modules.test.ts',
    'gövdedeki institutionId etkisizdir; başka kurum değişmez',
  ),
  'PATCH /api/v1/modules/:moduleKey': govde(
    'institution-modules.test.ts',
    'gövdedeki institutionId etkisizdir; başka kurum değişmez',
    'toggle(',
  ),
  'GET /api/v1/dashboard': liste('dashboard.test.ts', 'başka kurumun kaydı özete girmez'),
  'GET /api/v1/class-metrics': liste(
    'management-metrics.test.ts',
    'başka kurumun verisi iki ucun toplamına girmez',
  ),
  'GET /api/v1/teacher-metrics': liste(
    'management-metrics.test.ts',
    'başka kurumun verisi iki ucun toplamına girmez',
  ),

  // --- Genel koleksiyon okuması ---------------------------------------------------------------
  'GET /api/v1/collections/:collection': COLLECTIONS,
  'GET /api/v1/collections/:collection/counts': liste(
    'collection-dates.test.ts',
    'başka kurum sayılmaz',
  ),
  'GET /api/v1/collections/:collection/:id': COLLECTIONS,

  // --- Akademik -------------------------------------------------------------------------------
  'POST /api/v1/classes/:classId/attendance': kayit(
    'platform-commands.test.ts',
    'başka kurumun sınıfı 404 ve B değişmez',
  ),
  'POST /api/v1/grades': govde('grades.test.ts', 'gövdedeki institutionId etkisiz'),
  'PATCH /api/v1/grades/:gradeId': kayit(
    'grades.test.ts',
    'başka kurumun notu 404 ve B değişmez',
    'correct(',
  ),

  // --- Kampüs, sınıf, kadro -------------------------------------------------------------------
  'POST /api/v1/branches': govde(
    'school-management.test.ts',
    'yönetici kampüs oluşturur 201 + Location; gövdedeki institutionId etkisiz',
    "create('branches'",
  ),
  'PATCH /api/v1/branches/:branchId': BRANCH_PATCH,
  'PATCH /api/v1/classes/:classId': kayit(
    'school-management.test.ts',
    'düzenleme ders atamalarının kimliğini korur; başka kurum 404',
  ),
  'DELETE /api/v1/classes/:classId': kayit(
    'platform-commands.test.ts',
    'bilinmeyen sorgu 400; başka kurumun kaydı 404 ve B değişmez',
  ),

  // --- Etüt ve optik --------------------------------------------------------------------------
  'POST /api/v1/tutor-sessions/:sessionId/cancel': kayit(
    'platform-commands.test.ts',
    'başka kurumun etüdü 404 ve B değişmez',
  ),
  'POST /api/v1/assessment/evaluate': govde(
    'assessment.test.ts',
    'olmayan profil 404; başka kurumun profili 404 ve B değişmez',
    '/evaluate',
  ),
  'POST /api/v1/assessment/plan': plan('${BASE}/plan`'),
  'POST /api/v1/assessment/plan/preview': plan('${BASE}/plan/preview`'),
  'POST /api/v1/assessment/slot-remove/:recordId': tutoring('${BASE}/slot-remove/'),
  'POST /api/v1/assessment/cancel/:recordId': tutoring('${BASE}/cancel/'),
  'POST /api/v1/assessment/attendance/:recordId': tutoring('${BASE}/attendance/'),

  // --- İletişim -------------------------------------------------------------------------------
  'GET /api/v1/conversations': CONVERSATION,
  'GET /api/v1/conversations/:conversationId/messages': CONVERSATION,
  'POST /api/v1/conversations': CONVERSATION,
  'POST /api/v1/conversations/:conversationId/messages': kayit(
    'communication.test.ts',
    'kurumlar arası 404: başka kurumun yazışması',
    'message(',
  ),
  'POST /api/v1/conversations/:conversationId/access': CONVERSATION,
  'POST /api/v1/parents/:parentId/reveal-contact': kayit(
    'parent-contact.test.ts',
    'başka kurumun velisi 404',
    'reveal(',
  ),
  // Veli yalnız kendi çocuğu için talep açar: B'nin öğrencisi de başka çocuk gibi 403'tür (varlık
  // sızmaz; olmayan öğrenciyle aynı yanıt).
  'POST /api/v1/requests': govde('requests.test.ts', 'başka kurumun öğrencisi 403'),
  'PATCH /api/v1/requests/:requestId': kayit(
    'requests.test.ts',
    'başka kurumun talebi 404; o talep değişmez',
  ),
  'POST /api/v1/absences/:absenceId/documents': kayit(
    'absence-approval.test.ts',
    'veli belgeyi sonradan ekler; If-Match zorunlu, başka kurum 404',
  ),
  'POST /api/v1/absences/:absenceId/approve': kayit(
    'absence-approval.test.ts',
    'başka kurum 404 ve değişmez',
  ),
  'POST /api/v1/absences/:absenceId/reject': kayit(
    'absence-approval.test.ts',
    'başka kurum 404 ve değişmez',
  ),
  'GET /api/v1/notification-preferences': yok(
    'oturum sahibinin kendi tercihi; kayıt kullanıcı ve kurum çiftine bağlı, kurum oturumdan',
  ),
  'PATCH /api/v1/notification-preferences': yok(
    'oturum sahibinin kendi tercihi; kayıt kullanıcı ve kurum çiftine bağlı, kurum oturumdan',
  ),
  'GET /api/v1/notifications': kayit('notifications.test.ts', 'başka kurumun bildirimi 404'),
  'POST /api/v1/notifications/:notificationId/read': kayit(
    'notifications.test.ts',
    'başka kurumun bildirimi 404',
  ),
  'GET /api/v1/appointments/slots': liste(
    'appointment-slots.test.ts',
    'olmayan öğrenci 404; kurum sınırı korunur',
  ),
  'POST /api/v1/appointments': govde('appointments.test.ts', 'başka kurumun öğrencisi 403'),
  'PATCH /api/v1/appointments/:appointmentId': kayit(
    'appointments.test.ts',
    'olmayan ve başka kurumun randevusu 404',
  ),

  // --- Kayıt ve finans (Onur) -----------------------------------------------------------------
  'GET /api/v1/fee-tariffs': TARIFF,
  'GET /api/v1/fee-tariffs/:tariffId': TARIFF,
  'POST /api/v1/fee-tariffs': govde('fee-tariffs.test.ts', 'serbest kalem adı ve institutionId'),
  'PATCH /api/v1/fee-tariffs/:tariffId': TARIFF,
  'POST /api/v1/fee-tariffs/:tariffId/publish': kayit(
    'fee-tariffs.test.ts',
    'başka kurumun tarifesi 404; öteki kurum değişmez',
    'publish(',
  ),
  'GET /api/v1/finance/exports': liste(
    'finance-exports.test.ts',
    'başka kurumun satırı dosyada ve toplamda yok',
  ),
  'GET /api/v1/payments': PAYMENT,
  'GET /api/v1/payments/:paymentId': PAYMENT,
  'POST /api/v1/payments': govde('payments.test.ts', 'gövdedeki institutionId reddedilir'),
  'POST /api/v1/payments/:paymentId/reverse': kayit(
    'payments.test.ts',
    'başka kurumun öğrencisi ve tahsilatı 404',
    'reverse(',
  ),
  'POST /api/v1/students/:studentId/withdrawal-quote': kayit(
    'withdrawals.test.ts',
    'başka kurumun öğrencisi ve ayrılışı 404',
    'quote(',
  ),
  'POST /api/v1/students/:studentId/withdraw': kayit(
    'withdrawals.test.ts',
    'başka kurumun öğrencisi ve ayrılışı 404',
    'withdraw(',
  ),
  'GET /api/v1/withdrawals': WITHDRAWAL,
  'GET /api/v1/withdrawals/:withdrawalId': WITHDRAWAL,
  'POST /api/v1/withdrawals/:withdrawalId/pay-refund': kayit(
    'withdrawals.test.ts',
    'başka kurumun öğrencisi ve ayrılışı 404',
    'payRefund(',
  ),
  'POST /api/v1/prospects': govde('prospects.test.ts', 'gövdedeki institutionId reddedilir'),
  'PATCH /api/v1/prospects/:prospectId': PROSPECT,
  'POST /api/v1/prospects/:prospectId/notes': kayit(
    'prospects.test.ts',
    'başka kurumun ve olmayan aday sürüm ne olursa olsun 404',
    'note(',
  ),
  'POST /api/v1/prospects/:prospectId/meetings': kayit(
    'prospects.test.ts',
    'başka kurumun ve olmayan aday sürüm ne olursa olsun 404',
    'meeting(',
  ),
  'POST /api/v1/prospects/:prospectId/enroll': kayit(
    'prospects.test.ts',
    'başka kurumun adayı ve sınıfı 404',
  ),

  // --- Öğrenme --------------------------------------------------------------------------------
  'POST /api/v1/questions/:questionId/answers': kayit(
    'questions.test.ts',
    'başka kurumun sorusu 404',
    'answer(',
  ),
  'GET /api/v1/resources': RESOURCE_READ,
  'GET /api/v1/resources/:resourceId': RESOURCE_READ,
  'GET /api/v1/resources/:resourceId/versions/:versionId': RESOURCE_READ,
  'PATCH /api/v1/resources/:resourceId/versions/:versionId': RESOURCE_WRITE,
  'POST /api/v1/resources/:resourceId/versions': RESOURCE_WRITE,
  'POST /api/v1/resources/:resourceId/versions/:versionId/submit': RESOURCE_WRITE,
  'POST /api/v1/resources/:resourceId/versions/:versionId/report': kayit(
    'resource-commands.test.ts',
    'başka kurumun ve okunamayan kaynağın yazma uçları 404',
    '/report`',
  ),
  'POST /api/v1/resources/:resourceId/remove': RESOURCE_WRITE,
  'POST /api/v1/resources/:resourceId/share': RESOURCE_WRITE,
  'POST /api/v1/resources/:resourceId/copy': RESOURCE_WRITE,
  // Kazanım kataloğu (DOM-KYN-011): kurum kazanımı kurum kapsamlı, platform satırı kurumsuz.
  'GET /api/v1/learning-outcomes': liste('learning-outcomes.test.ts', 'başka kurum yok'),
  'POST /api/v1/learning-outcomes': govde('learning-outcomes.test.ts', 'başka kurumda serbest'),
  'POST /api/v1/learning-outcomes/:code/archive': kayit(
    'learning-outcomes.test.ts',
    'başka kurumun ve platformun kodu 404',
  ),
  'GET /api/v1/rubrics': RUBRIC,
  'GET /api/v1/rubrics/:rubricId': RUBRIC,
  'GET /api/v1/rubric-versions/:versionId': kayit(
    'rubrics.test.ts',
    'başka kurumun ve olmayan sürüm 404',
    '/rubric-versions/',
  ),
  'POST /api/v1/rubrics': govde('rubrics.test.ts', 'gövdedeki institutionId etkisiz'),
  'POST /api/v1/rubrics/:rubricId/versions': RUBRIC,
  'PATCH /api/v1/rubrics/:rubricId/versions/:versionId': RUBRIC,
  'POST /api/v1/rubrics/:rubricId/versions/:versionId/publish': RUBRIC,
  'POST /api/v1/rubrics/:rubricId/versions/:versionId/archive': RUBRIC,
  'GET /api/v1/task-assignments': ASSIGNMENT,
  'GET /api/v1/task-assignments/:assignmentId': ASSIGNMENT,
  'POST /api/v1/task-assignments': ASSIGNMENT,
  'PATCH /api/v1/task-assignments/:assignmentId': kayit(
    'task-assignments.test.ts',
    'kurumlar arası: B kurumunun atamasına',
    'change(',
  ),
  'GET /api/v1/task-attempts': kayit(
    'task-attempts.test.ts',
    'hedeflenmeyen öğrenci ve başka kurum 404',
  ),
  'GET /api/v1/task-attempts/:attemptId': kayit(
    'task-attempts.test.ts',
    'hedeflenmeyen öğrenci ve başka kurum 404',
  ),
  'GET /api/v1/task-assignments/:assignmentId/extra-times': EXTRA_TIME,
  'POST /api/v1/task-assignments/:assignmentId/extra-times': EXTRA_TIME,
  'PATCH /api/v1/task-assignments/:assignmentId/extra-times/:learnerId':
    EXTRA_TIME_COMMAND('change('),
  'DELETE /api/v1/task-assignments/:assignmentId/extra-times/:learnerId':
    EXTRA_TIME_COMMAND('remove('),
  'GET /api/v1/task-submissions/grading-queue': GRADING,
  'GET /api/v1/task-appeals': GRADING,
  'POST /api/v1/task-submissions/:submissionId/scores': GRADING,
  'POST /api/v1/task-submissions/:submissionId/resubmission-requests': GRADING,
  'POST /api/v1/task-assignments/:assignmentId/second-rating-sample': kayit(
    'task-grading.test.ts',
    'rol × kapsam, başka kurum 404',
    'drawSample(',
  ),

  // --- KVKK -----------------------------------------------------------------------------------
  'GET /api/v1/privacy-notices': CONSENT,
  'POST /api/v1/privacy-notices/:noticeId/acknowledge': CONSENT,
  'GET /api/v1/consents': CONSENT,
  'GET /api/v1/consents/status': kayit(
    'consents.test.ts',
    'başka kurum: kayıt ve metin 404, B değişmez',
    'status(',
  ),
  'POST /api/v1/consents': kayit(
    'consents.test.ts',
    'başka kurum: kayıt ve metin 404, B değişmez',
    'give(',
  ),
  'POST /api/v1/consents/:consentId/withdraw': kayit(
    'consents.test.ts',
    'başka kurum: kayıt ve metin 404, B değişmez',
    'withdraw(',
  ),

  // --- Eğitim yılı ----------------------------------------------------------------------------
  'GET /api/v1/academic-years': YEAR,
  'GET /api/v1/academic-years/:startYear': YEAR,
  'POST /api/v1/academic-years': govde('academic-years.test.ts', 'gövdede institutionId'),
  'PATCH /api/v1/academic-years/:startYear': YEAR,
  'POST /api/v1/academic-years/:startYear/activate': kayit(
    'academic-years.test.ts',
    'başka kurum: yılı 404, yazma B yılını değiştirmez',
    '/activate',
  ),

  // --- Velayet bağı ---------------------------------------------------------------------------
  'GET /api/v1/students/:studentId/guardians': GUARDIAN,
  'POST /api/v1/students/:studentId/guardians': GUARDIAN,
  'PATCH /api/v1/students/:studentId/guardians/:linkId': GUARDIAN,
  'DELETE /api/v1/students/:studentId/guardians/:linkId': GUARDIAN,
  'GET /api/v1/students/:studentId/health-profile': HEALTH_PROFILE,
  'PATCH /api/v1/students/:studentId/health-profile': HEALTH_PROFILE,

  // --- Kur programı ---------------------------------------------------------------------------
  'GET /api/v1/courses': COURSE,
  'GET /api/v1/courses/:courseId': COURSE,
  'POST /api/v1/courses': govde('courses.test.ts', 'gövdede institutionId'),
  'PATCH /api/v1/courses/:courseId': COURSE,
  'POST /api/v1/courses/:courseId/activate': kayit(
    'courses.test.ts',
    'başka kurumun kuru 404, listede görünmez ve değişmez',
    "'activate'",
  ),
  'DELETE /api/v1/courses/:courseId': kayit(
    'courses.test.ts',
    'başka kurumun kuru 404, listede görünmez ve değişmez',
    'archive(',
  ),
  'POST /api/v1/courses/:courseId/record-e-ozel': kayit(
    'courses.test.ts',
    'başka kurumun kuru 404, listede görünmez ve değişmez',
    "'record-e-ozel'",
  ),

  // --- Kur grupları (yalnız dil okulu; okulda her uç 404, `module-inventory.test.ts`) ---------
  'GET /api/v1/groups': GROUP,
  'GET /api/v1/groups/:groupId': GROUP,
  'GET /api/v1/groups/:groupId/waitlist': GROUP,
  'POST /api/v1/groups': GROUP,
  'PATCH /api/v1/groups/:groupId': GROUP,
  'POST /api/v1/groups/:groupId/open': GROUP_COMMAND('open'),
  'POST /api/v1/groups/:groupId/cancel': kayit(
    'language-groups.test.ts',
    'başka kurumun grubu 404, listede görünmez ve değişmez',
    "'cancel'",
  ),
  'POST /api/v1/groups/:groupId/merge': GROUP_COMMAND('merge'),

  // --- Seviye tespiti ve CEFR profili (yalnız dil okulu; OG-054) ------------------------------
  'GET /api/v1/placement-sessions': PLACEMENT,
  'GET /api/v1/placement-sessions/:sessionId': PLACEMENT,
  'GET /api/v1/placement-sessions/:sessionId/form': kayit(
    'cefr.test.ts',
    'tespit formu: sorular anahtarsız; başka kurumun oturumu 404',
    'other.cookies.admin',
  ),
  'POST /api/v1/placement-sessions': PLACEMENT,
  'POST /api/v1/placement-sessions/:sessionId/score': PLACEMENT_COMMAND('score'),
  'POST /api/v1/placement-sessions/:sessionId/complete': PLACEMENT_COMMAND('complete'),
  'POST /api/v1/placement-sessions/:sessionId/decide': PLACEMENT_COMMAND('decide'),
  'GET /api/v1/students/:studentId/cefr-profile': kayit(
    'cefr.test.ts',
    'başka kurumun oturumu ve öğrencisi 404',
    'cefr-profile',
  ),

  // --- Kur sonu değerlendirme ve geçiş kararı (OG-086; IST-062, DOM-DIL-070) ------------------
  'POST /api/v1/course-assessments': govde('progression.test.ts', PROGRESSION),
  'POST /api/v1/progression-decisions': govde('progression.test.ts', PROGRESSION),
  'POST /api/v1/progression-decisions/:decisionId/approve': kayit(
    'progression.test.ts',
    PROGRESSION,
    "'approve'",
  ),
  'POST /api/v1/progression-decisions/:decisionId/reject': kayit(
    'progression.test.ts',
    PROGRESSION,
    "'reject'",
  ),
  'GET /api/v1/groups/:groupId/progression': kayit('progression.test.ts', PROGRESSION),
  'GET /api/v1/students/:studentId/progression-decisions': kayit(
    'progression.test.ts',
    PROGRESSION,
  ),

  // --- Kurum başarı belgesi ve MEBBİS izi (OG-088; IST-081, DOM-DIL-080, 082) -----------------
  'POST /api/v1/course-certificates': govde('certificates.test.ts', CERTIFICATE),
  'POST /api/v1/course-certificates/:certificateId/cancel': kayit(
    'certificates.test.ts',
    CERTIFICATE,
  ),
  'GET /api/v1/course-certificates': liste('certificates.test.ts', CERTIFICATE),
  'GET /api/v1/course-certificates/:certificateId': kayit('certificates.test.ts', CERTIFICATE),
  'GET /api/v1/groups/:groupId/mebbis-certificates': kayit('certificates.test.ts', CERTIFICATE),
  'POST /api/v1/progression-decisions/:decisionId/mebbis-record': kayit(
    'certificates.test.ts',
    CERTIFICATE,
  ),
  // Sabah kararı 85: kimliksiz ve modülsüz; kurum oturumdan gelmez, kod kurumlar arası tekildir.
  'GET /api/v1/certificate-verifications/:code': yok(
    'kimliksiz belge doğrulama; oturum ve kurum okumaz, yalnız baş harf ve kur döner',
  ),

  // --- Beceri ilerleme panosu (OG-080; IST-057, DOM-BEC-035) -----------------------------------
  'GET /api/v1/students/:studentId/skill-progress': kayit(
    'skill-progress.test.ts',
    'kapsam dışı, olmayan ve başka kurum 404',
    'skill-progress',
  ),

  // --- Beceri ve CEFR raporu (OG-100; IST-118, DOM-BEC-037) -----------------------------------
  'GET /api/v1/reports/skills': liste(
    'skill-reports.test.ts',
    'başka kurumun grubu, kursiyeri ve sonucu görünmez',
    'reports/skills',
  ),

  // --- İçerikten toplu atama ve sonuç özeti (OG-089; IST-034, DOM-BEC-049, 036) ---------------
  'POST /api/v1/task-assignments/batches': govde(
    'content-assignments.test.ts',
    'başka kurumun içeriği 404 ve o kurumda atama yazılmaz; öğedeki kurum kimliği etkisiz',
  ),
  'GET /api/v1/resources/:resourceId/assignment-results': kayit(
    'content-assignments.test.ts',
    'başka kurumun içeriği 404',
    'assignment-results',
  ),

  // --- Ünite alıştırma seti (OG-085; IST-056, DOM-BEC-047, 048) --------------------------------
  'POST /api/v1/task-attempts/:attemptId/checks': kayit(
    'practice-sets.test.ts',
    'başkasının ve başka kurumun denemesi',
    '/checks',
  ),
  'GET /api/v1/practice-gradebook': liste(
    'practice-sets.test.ts',
    'başka kurumun alıştırma sonuçları',
    'practice-gradebook',
  ),

  // --- Ders programı ---------------------------------------------------------------------------
  'GET /api/v1/lessons': LESSON_READ,
  'GET /api/v1/lessons/:lessonId': LESSON_READ,
  'POST /api/v1/lessons': govde('lessons.test.ts', 'bilinmeyen alan (institutionId) 400'),
  'PATCH /api/v1/lessons/:lessonId': LESSON_WRITE,
  'POST /api/v1/lessons/:lessonId/substitute': LESSON_WRITE,
  'POST /api/v1/lessons/:lessonId/cancel': LESSON_WRITE,

  // --- Ödev -----------------------------------------------------------------------------------
  'GET /api/v1/homework': HOMEWORK,
  'GET /api/v1/homework/:homeworkId': HOMEWORK,
  'POST /api/v1/homework': govde('homework.test.ts', 'gövdedeki institutionId 400'),
  'PATCH /api/v1/homework/:homeworkId': HOMEWORK,
  'DELETE /api/v1/homework/:homeworkId': HOMEWORK,
  'POST /api/v1/homework/:homeworkId/submissions': HOMEWORK,
  'POST /api/v1/homework/:homeworkId/submissions/:submissionId/grade': HOMEWORK,

  // --- Video izleme ilerlemesi ----------------------------------------------------------------
  'POST /api/v1/videos/:videoId/progress': kayit(
    'video-progress.test.ts',
    'DOM-KYN-005: düzeyi dışındaki, olmayan ve başka kurumun videosu 404, kayıt değişmez',
  ),

  // --- Quiz -----------------------------------------------------------------------------------
  'GET /api/v1/quizzes': QUIZ,
  'GET /api/v1/quizzes/:quizId': QUIZ,
  'POST /api/v1/quizzes': govde('quizzes.test.ts', 'gövdedeki institutionId 400'),
  'PATCH /api/v1/quizzes/:quizId': QUIZ,
  'DELETE /api/v1/quizzes/:quizId': QUIZ,
  'POST /api/v1/quizzes/:quizId/attempt': QUIZ,
  'POST /api/v1/quizzes/:quizId/attempt/submit': QUIZ,
  // --- İzin formu -----------------------------------------------------------------------------
  'GET /api/v1/permission-forms': PERMISSION_FORM,
  'GET /api/v1/permission-forms/:formId': PERMISSION_FORM,
  'POST /api/v1/permission-forms': govde('permission-forms.test.ts', 'gövdedeki institutionId 400'),
  'PATCH /api/v1/permission-forms/:formId': PERMISSION_FORM,
  'POST /api/v1/permission-forms/:formId/close': PERMISSION_FORM,
  'POST /api/v1/permission-forms/:formId/cancel': kayit(
    'permission-form-changes.test.ts',
    'başka kurumun formu 404 ve hiçbir kayıt değişmez',
  ),
  'DELETE /api/v1/permission-forms/:formId': PERMISSION_FORM,
  'POST /api/v1/permission-forms/:formId/decisions': PERMISSION_FORM,

  // --- Dosya ----------------------------------------------------------------------------------
  'GET /api/v1/files/:fileId': kayit('files.test.ts', 'başka kurum ve başkası 404'),
  'GET /api/v1/files/:fileId/url': kayit('files.test.ts', 'başka kurum ve başkası 404'),
  'GET /api/v1/files/download': yok(
    'imzalı kısa ömürlü bağlantı; dosya ve kurum imzalı belirteçtedir, istek kimlik taşımaz',
  ),
}

/**
 * İş akışı köprüsü: her komut ayrı rotadır (`module-inventory.test.ts` ile aynı türetme). Kayıt
 * alan komutlar B kaydına 404, oluşturanlar gövdedeki B kimliği ve `institutionId` için
 * `cross-institution-workflows.test.ts`'te komut komut sınanır; o dosya kendi tablolarının
 * köprünün bütün komutlarını kapsadığını ayrıca doğrular.
 */
const WORKFLOWS: Readonly<Record<string, Proof>> = Object.fromEntries(
  Object.entries(WORKFLOW_ROUTES).flatMap(([command, { record }]) => [
    ...(record === 'required'
      ? []
      : [
          [
            `POST /api/v1/workflows/${command}`,
            govde(
              'cross-institution-workflows.test.ts',
              'gövdedeki institutionId ve başka kurumun kimliği etkisiz',
              'workflows/${command}',
            ),
          ],
        ]),
    ...(record === 'none'
      ? []
      : [
          [
            `POST /api/v1/workflows/${command}/:recordId`,
            kayit(
              'cross-institution-workflows.test.ts',
              'başka kurumun kaydı 404, If-Match B sürümüyle de 404',
              'workflows/${command}/${id}',
            ),
          ],
        ]),
  ]),
)

/**
 * Tablo kalıbıyla yazılmış `cross-institution-*.test.ts` satırları (`support/cross-institution.ts`
 * koşucusu ya da aynı kalıp): test adı uç anahtarını taşır, dosyada anahtar tırnaklı geçer.
 */
const tableCase =
  (file: string) =>
  (kind: 'kayıt' | 'gövde', key: string): [string, Proof] => [
    key,
    proof(kind)(
      file,
      kind === 'kayıt'
        ? 'başka kurumun kaydı olmayan kayıtla aynı 404'
        : 'gövdedeki başka kurum kimliği ve institutionId etkisiz',
      `'${key}'`,
    ),
  ]
const platform = tableCase('cross-institution-platform.test.ts')
const learning = tableCase('cross-institution-learning.test.ts')
const access = tableCase('cross-institution-access.test.ts')
const finance = tableCase('cross-institution-finance.test.ts')
const PLATFORM: Readonly<Record<string, Proof>> = Object.fromEntries([
  platform('kayıt', 'DELETE /api/v1/branches/:branchId'),
  platform('kayıt', 'POST /api/v1/branches/:branchId/restore'),
  platform('gövde', 'POST /api/v1/classes'),
  platform('kayıt', 'POST /api/v1/classes/:classId/restore'),
  platform('gövde', 'POST /api/v1/teachers'),
  platform('kayıt', 'PATCH /api/v1/teachers/:teacherId'),
  platform('kayıt', 'DELETE /api/v1/teachers/:teacherId'),
  platform('kayıt', 'POST /api/v1/teachers/:teacherId/restore'),
  platform('gövde', 'POST /api/v1/tutor-sessions'),
  platform('kayıt', 'POST /api/v1/tutor-sessions/:sessionId/attendance'),
  platform('kayıt', 'POST /api/v1/assessment/profile/:recordId'),
  platform('gövde', 'POST /api/v1/assessment/profile'),
  platform('gövde', 'POST /api/v1/assessment/evaluate/preview'),
  platform('gövde', 'POST /api/v1/assessment/slot'),
  platform('gövde', 'POST /api/v1/announcements'),
  platform('kayıt', 'PATCH /api/v1/announcements/:announcementId'),
  platform('kayıt', 'POST /api/v1/announcements/:announcementId/withdraw'),
  platform('kayıt', 'POST /api/v1/announcements/:announcementId/read'),
  platform('kayıt', 'POST /api/v1/conversations/:conversationId/read'),
  platform('kayıt', 'GET /api/v1/students/:studentId/parent-accounts'),
  platform('gövde', 'POST /api/v1/absences'),
  platform('gövde', 'POST /api/v1/questions'),
  platform('kayıt', 'PATCH /api/v1/questions/:questionId'),
])

/** `cross-institution-learning.test.ts`: içerik geçişleri, deneme, teslim, puan ve itiraz. */
const LEARNING: Readonly<Record<string, Proof>> = Object.fromEntries([
  learning('gövde', 'POST /api/v1/resources'),
  learning('kayıt', 'POST /api/v1/resources/:resourceId/versions/:versionId/publish'),
  learning('kayıt', 'POST /api/v1/resources/:resourceId/versions/:versionId/withdraw'),
  learning('kayıt', 'POST /api/v1/resources/:resourceId/versions/:versionId/approve'),
  learning('kayıt', 'POST /api/v1/resources/:resourceId/versions/:versionId/reject'),
  learning('kayıt', 'POST /api/v1/resources/:resourceId/versions/:versionId/reopen'),
  learning('kayıt', 'POST /api/v1/resources/:resourceId/versions/:versionId/archive'),
  learning('kayıt', 'POST /api/v1/task-assignments/:assignmentId/attempts'),
  learning('kayıt', 'PATCH /api/v1/task-attempts/:attemptId'),
  learning('kayıt', 'POST /api/v1/task-attempts/:attemptId/submit'),
  learning('kayıt', 'GET /api/v1/task-submissions'),
  learning('kayıt', 'GET /api/v1/task-submissions/:submissionId'),
  learning('kayıt', 'GET /api/v1/task-assignments/:assignmentId/draft'),
  learning('kayıt', 'PATCH /api/v1/task-assignments/:assignmentId/draft'),
  learning('kayıt', 'POST /api/v1/task-assignments/:assignmentId/draft/submit'),
  learning('kayıt', 'POST /api/v1/task-assignments/:assignmentId/submissions'),
  learning('kayıt', 'POST /api/v1/task-submissions/:submissionId/second-scores'),
  learning('kayıt', 'POST /api/v1/task-submissions/:submissionId/final-scores'),
  learning('kayıt', 'POST /api/v1/task-submissions/:submissionId/second-rating-requests'),
  learning('kayıt', 'POST /api/v1/task-submissions/:submissionId/appeals'),
  learning('kayıt', 'POST /api/v1/task-submissions/:submissionId/appeals/:appealId/decision'),
])

/**
 * `cross-institution-access.test.ts`: KVKK metinleri, eğitim yılı, dosya yükleme ve bildirim
 * sayımı. Dönem uçları tablo koşucusuyla, kimliksiz uçlar ayrı testlerle (B'nin metni, yılı,
 * kotası ve bildirimi A'nın yanıtına girmez; A'nın yazması B'yi değiştirmez).
 */
const ACCESS: Readonly<Record<string, Proof>> = {
  'POST /api/v1/privacy-notices': govde(
    'cross-institution-access.test.ts',
    'POST /api/v1/privacy-notices: gövdedeki institutionId etkisiz',
  ),
  'GET /api/v1/privacy-notices/current': liste(
    'cross-institution-access.test.ts',
    'GET /api/v1/privacy-notices/current: başka kurumun metni görünmez',
  ),
  'GET /api/v1/consent-texts': liste(
    'cross-institution-access.test.ts',
    'GET /api/v1/consent-texts: başka kurumun rıza metni listede yok',
  ),
  'GET /api/v1/consent-texts/:purpose': liste(
    'cross-institution-access.test.ts',
    'GET /api/v1/consent-texts/:purpose: başka kurumun rıza metni',
  ),
  'GET /api/v1/academic-years/current': liste(
    'cross-institution-access.test.ts',
    'GET /api/v1/academic-years/current: başka kurumun etkin yılı',
  ),
  'POST /api/v1/files': govde(
    'cross-institution-access.test.ts',
    'POST /api/v1/files: çok parçalı gövdedeki institutionId etkisiz',
  ),
  'GET /api/v1/notifications/unread-count': liste(
    'cross-institution-access.test.ts',
    'GET /api/v1/notifications/unread-count: başka kurumun bildirimi',
  ),
  'POST /api/v1/notifications/read-all': liste(
    'cross-institution-access.test.ts',
    'POST /api/v1/notifications/read-all: başka kurumun bildirimi',
  ),
  ...Object.fromEntries([
    access('kayıt', 'POST /api/v1/academic-years/:startYear/terms'),
    access('kayıt', 'PATCH /api/v1/academic-years/:startYear/terms/:termId'),
    access('kayıt', 'DELETE /api/v1/academic-years/:startYear/terms/:termId'),
    access('kayıt', 'POST /api/v1/academic-years/:startYear/close'),
  ]),
}

/**
 * `cross-institution-finance.test.ts` (Onur'un uçları; test dosyası Oğuzhan'ın alanında, kaynağa
 * dokunmaz): MEBBİS işareti, banka hesabı, tahsilat ayarı, muhasebe toplamları, aday veli
 * eşleşmesi, öğrenci kimlik özeti ve deneme dersi.
 */
const FINANCE: Readonly<Record<string, Proof>> = {
  // Onur: sözleşme onayı (ON-028, #28); kanıt Onur'un `finance-contracts.test.ts` dosyasındadır.
  ...Object.fromEntries(
    (
      [
        ['POST /api/v1/finance/contracts/:contractId/signatory', '/signatory'],
        ['POST /api/v1/finance/contracts/:contractId/approve', '/approve'],
        ['POST /api/v1/finance/contracts/:contractId/amendments', '/amendments'],
        ['POST /api/v1/finance/contracts/:contractId/cancel-amendment', '/cancel-amendment'],
      ] as const
    ).map(([key, marker]) => [
      key,
      kayit(
        'finance-contracts.test.ts',
        'başka kurumun sözleşmesi olmayan kimlikle aynı 404',
        marker,
      ),
    ]),
  ),
  'GET /api/v1/finance/totals': liste(
    'cross-institution-finance.test.ts',
    'GET /api/v1/finance/totals, /finance/summary ve /finance/overview: başka kurumun tahsilatı',
  ),
  'GET /api/v1/finance/summary': liste(
    'cross-institution-finance.test.ts',
    'GET /api/v1/finance/totals, /finance/summary ve /finance/overview: başka kurumun tahsilatı',
  ),
  'GET /api/v1/finance/scholarship-programs': liste(
    'cross-institution-finance.test.ts',
    'GET ve POST /api/v1/finance/scholarship-programs, GET /finance/scholarship-awards: başka kurumun bursu',
  ),
  'POST /api/v1/finance/scholarship-programs': govde(
    'cross-institution-finance.test.ts',
    'GET ve POST /api/v1/finance/scholarship-programs, GET /finance/scholarship-awards: başka kurumun bursu',
  ),
  'GET /api/v1/finance/scholarship-awards': liste(
    'cross-institution-finance.test.ts',
    'GET ve POST /api/v1/finance/scholarship-programs, GET /finance/scholarship-awards: başka kurumun bursu',
  ),
  'GET /api/v1/finance/overview': liste(
    'cross-institution-finance.test.ts',
    'GET /api/v1/finance/totals, /finance/summary ve /finance/overview: başka kurumun tahsilatı',
  ),
  'GET /api/v1/bank-accounts': liste(
    'cross-institution-finance.test.ts',
    'GET /api/v1/bank-accounts ve POST /bank-accounts: başka kurumun hesabı',
  ),
  'POST /api/v1/bank-accounts': govde(
    'cross-institution-finance.test.ts',
    'GET /api/v1/bank-accounts ve POST /bank-accounts: başka kurumun hesabı',
  ),
  'GET /api/v1/finance/export-profile': liste(
    'cross-institution-finance.test.ts',
    'GET ve PATCH /api/v1/finance/export-profile: başka kurumun profili',
  ),
  'PATCH /api/v1/finance/export-profile': govde(
    'cross-institution-finance.test.ts',
    'GET ve PATCH /api/v1/finance/export-profile: başka kurumun profili',
  ),
  'GET /api/v1/payment-settings': liste(
    'cross-institution-finance.test.ts',
    'GET ve PATCH /api/v1/payment-settings: başka kurumun ayarı',
  ),
  'PATCH /api/v1/payment-settings': govde(
    'cross-institution-finance.test.ts',
    'GET ve PATCH /api/v1/payment-settings: başka kurumun ayarı',
  ),
  ...Object.fromEntries([
    finance('kayıt', 'POST /api/v1/payments/:paymentId/mebbis-record'),
    finance('kayıt', 'DELETE /api/v1/bank-accounts/:bankAccountId'),
    finance('kayıt', 'GET /api/v1/prospects/:prospectId/guardian-matches'),
    finance('kayıt', 'GET /api/v1/students/:studentId/identity'),
    finance('kayıt', 'POST /api/v1/prospects/:prospectId/trial-lessons'),
    finance('kayıt', 'POST /api/v1/prospects/:prospectId/trial-result'),
    finance('kayıt', 'POST /api/v1/prospects/:prospectId/stage-revert'),
    finance('kayıt', 'POST /api/v1/prospects/:prospectId/marketing-consent'),
    finance('kayıt', 'PATCH /api/v1/prospects/:prospectId/details'),
    finance('kayıt', 'GET /api/v1/finance/students/:studentId/balance'),
    finance('kayıt', 'GET /api/v1/finance/students/:studentId/statement'),
    finance('kayıt', 'POST /api/v1/finance/scholarship-programs/:programId/notify'),
    finance('kayıt', 'POST /api/v1/finance/scholarship-awards/:awardId/mebbis-record'),
  ]),
  // Kayıt yenileme (IST-100): kaynak ve testi Onur'un `finance-renewals.test.ts`'indedir.
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/renewals', 'BASE, a.admin'],
        ['kayıt', 'POST /api/v1/finance/renewals/quote', '/quote'],
        ['gövde', 'POST /api/v1/finance/renewals', 'institutionId: b.id'],
        ['liste', 'GET /api/v1/finance/renewals/price-indexes', 'INDEXES, a.admin'],
        ['gövde', 'POST /api/v1/finance/renewals/price-indexes', 'INDEXES, a.admin, { ...INDEX'],
        ['kayıt', 'PATCH /api/v1/finance/renewals/price-indexes/:academicYear', '/2028'],
        ['kayıt', 'GET /api/v1/finance/renewals/:renewalId', '`${BASE}/${id}`'],
        ['kayıt', 'POST /api/v1/finance/renewals/:renewalId/activate', '/activate'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-renewals.test.ts',
        'başka kurumun yenilemesi okuma ve geçişte 404, B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: finans uçları (ON-113, ON-140; #54 izni)
  'POST /api/v1/finance/invoices/:invoiceId/remind': kayit(
    'installment-reminders.test.ts',
    'başka kurumun taksiti olmayan kimlikle aynı 404, B değişmez',
  ),
  'GET /api/v1/prospects/loss-breakdown': liste(
    'prospects.test.ts',
    'başka kurumun vazgeçen adayı kırılımda görünmez',
  ),
  'GET /api/v1/finance/reconciliation': liste(
    'finance-reconciliation.test.ts',
    'başka kurumun öğrencisi ve tutarı raporda ve dosyada yok',
  ),
  'GET /api/v1/finance/reconciliation/export': liste(
    'finance-reconciliation.test.ts',
    'başka kurumun öğrencisi ve tutarı raporda ve dosyada yok',
  ),
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/renewals/candidates', 'listOf(), a.admin'],
        ['gövde', 'POST /api/v1/finance/renewals/bulk-preview', 'PREVIEW, a.admin'],
        ['gövde', 'POST /api/v1/finance/renewals/bulk-plan', 'PLAN, a.admin'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-renewal-bulk.test.ts',
        'başka kurumun öğrencisi listede yok, önizleme ve onayda not_found',
        marker,
      ),
    ]),
  ),
  'GET /api/v1/prospects/funnel': liste(
    'enrollment-funnel.test.ts',
    'başka kurumun adayı huniye girmez',
  ),
  'GET /api/v1/prospects/season-watch': liste(
    'prospect-season-watch.test.ts',
    'başka kurumun adayı, dersi ve adları nöbete girmez',
  ),
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/packages', 'get(PACKAGES, a.admin)'],
        ['gövde', 'POST /api/v1/finance/packages', "name: 'Yeni', institutionId: b.id"],
        ['kayıt', 'GET /api/v1/finance/packages/:packageId', 'get(bPackage, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/packages/:packageId', "send('PATCH', bPackage"],
        ['kayıt', 'DELETE /api/v1/finance/packages/:packageId', "send('DELETE', bPackage"],
        ['gövde', 'POST /api/v1/finance/package-sales/quote', 'a.quote, institutionId: b.id'],
        ['gövde', 'POST /api/v1/finance/package-sales', 'a.sale, institutionId: b.id'],
        ['liste', 'GET /api/v1/finance/package-sales', 'get(SALES, a.admin)'],
        ['kayıt', 'GET /api/v1/finance/package-sales/:saleId', 'get(bSaleUrl, a.admin)'],
        ['kayıt', 'POST /api/v1/finance/package-sales/:saleId/extend', '`${bSaleUrl}/extend`'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-packages.test.ts',
        'başka kurumun paketi ve satışı 404, B değişmez',
        marker,
      ),
    ]),
  ),
  'GET /api/v1/finance/day-closings/:closingDate': kayit(
    'finance-day-closings.test.ts',
    'başka kurumun gün sonu görünmez',
  ),
  'POST /api/v1/finance/day-closings/:closingDate/close': kayit(
    'finance-day-closings.test.ts',
    'başka kurumun gün sonu görünmez',
  ),
  'POST /api/v1/finance/day-closings/:closingDate/reopen': kayit(
    'finance-day-closings.test.ts',
    'başka kurumun gün sonu görünmez',
  ),
  'GET /api/v1/finance/referral-rewards': liste(
    'finance-referrals.test.ts',
    'DOM-FIN-024: başka kurumun hakkı listede yok',
  ),
  'GET /api/v1/finance/e-ozel/items': liste(
    'finance-e-ozel.test.ts',
    'IST-085 başka kurum: B kaydı',
  ),
  'GET /api/v1/finance/e-ozel/export': liste(
    'finance-e-ozel.test.ts',
    'IST-085 başka kurum: B kaydı',
  ),
  'POST /api/v1/finance/e-ozel/items/:kind/:sourceId/record': kayit(
    'finance-e-ozel.test.ts',
    'IST-085 başka kurum: B kaydı',
    '/record',
  ),
  'GET /api/v1/finance/e-ozel/learners/:studentId/identity': kayit(
    'finance-e-ozel.test.ts',
    'IST-085 başka kurum: tam kimlik',
  ),
  'POST /api/v1/prospects/student-imports': govde(
    'enrollment-import.test.ts',
    'başka kurumun sınıfı, velisi ve kimliği bu kurumu etkilemez',
  ),
  // Onur: e-Okul öğrenci listesi aktarımı (ON-062, IST-134; DOM-KAY-042).
  'POST /api/v1/prospects/eokul-student-imports': govde(
    'enrollment-eokul-import.test.ts',
    'başka kurumun öğrencisi, sınıfı ve kimliği bu kurumu etkilemez',
  ),
  'POST /api/v1/finance/installment-imports': govde(
    'finance-installment-import.test.ts',
    'başka kurumun öğrencisi ve sözleşmesi bu kurumu etkilemez',
  ),
  'POST /api/v1/finance/package-sales/:saleId/set-used-hours': kayit(
    'finance-packages.test.ts',
    'başka kurumun satışında kullanılan saat 404, B değişmez',
    'usedUrl(bSale.id)',
  ),
  'GET /api/v1/prospects/students/:studentId/enrollment-certificate': kayit(
    'enrollment-certificates.test.ts',
    'DOM-KAY-027: başka kurumun öğrencisi 404, denetim yazılmaz; olmayan öğrenci 404',
    "get(url('cert-other'), a.cookie)",
  ),
  'GET /api/v1/finance/students/:studentId/enrollment-certificate': kayit(
    'enrollment-certificates.test.ts',
    'K-32, DOM-KAY-027: başka kurumun öğrencisi aile ucunda 404, B denetimi yazılmaz',
    "get(familyUrl('cert-other'), parent.cookie)",
  ),
  'GET /api/v1/finance/course-offers': liste(
    'finance-course-offers.test.ts',
    'DOM-YTK-001: başka kurumun kursiyeri listede yok, studentId ile 404',
  ),
  // Onur: paket saat bakiyesi ve raporu (ON-074, IST-114).
  'GET /api/v1/finance/students/:studentId/package-balance': kayit(
    'finance-package-report.test.ts',
    'IST-002: başka kurumun satışı bakiyeye ve rapora girmez',
    'get(balanceUrl(randomUUID()), a.admin)',
  ),
  'GET /api/v1/finance/package-report': liste(
    'finance-package-report.test.ts',
    'IST-002: başka kurumun satışı bakiyeye ve rapora girmez',
  ),
  // Onur: ödeyicisi olunan çocuklar (ON-313, K-04).
  'GET /api/v1/finance/payer-children': liste(
    'finance-payer-children.test.ts',
    'başka kurumun öğrencisi listede yok, finans okuması 404',
  ),
  // Onur: yetişkin kursiyerin sözleşmeleri (ON-068, IST-082).
  'GET /api/v1/finance/students/:studentId/contracts': kayit(
    'contract-self-service.test.ts',
    'DOM-FIN-059: başka kurumun kursiyeri 404, B kurumunun sözleşmesi değişmez',
    'get(url(B_ONLY), await a.learner(ADULT))',
  ),
  // Onur: açılış nöbeti (ON-095, DOM-FIN-061).
  'GET /api/v1/finance/opening-watch': liste(
    'finance-opening-watch.test.ts',
    'başka kurumun taksiti, sözleşmesi ve iadesi açılış nöbetinde yok',
    'URL_BASE',
  ),
  // Onur: kurumsal müşteri ve toplu fatura (ON-100, IST-089).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/corporate-customers', 'get(CUSTOMERS, a.admin)'],
        [
          'gövde',
          'POST /api/v1/finance/corporate-customers',
          "call('POST', CUSTOMERS, a.admin, intruder)",
        ],
        ['kayıt', 'GET /api/v1/finance/corporate-customers/:customerId', 'get(bCustomer, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/corporate-customers/:customerId',
          "call('PATCH', bCustomer",
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/corporate-customers/:customerId',
          "call('DELETE', bCustomer",
        ],
        [
          'kayıt',
          'GET /api/v1/finance/corporate-customers/:customerId/employees',
          '`${bCustomer}/employees`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/corporate-customers/:customerId/employees',
          'link(a, b.customerId',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/corporate-customers/:customerId/employees/:linkId/end',
          '`${bCustomer}/employees/${String(bLink.id)}/end`',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/corporate-customers/:customerId/billable',
          '`${bCustomer}/billable?${PERIOD}`',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/corporate-customers/:customerId/attendance-report',
          '`${bCustomer}/attendance-report`',
        ],
        ['liste', 'GET /api/v1/finance/corporate-invoices', 'get(INVOICES, a.admin)'],
        ['gövde', 'POST /api/v1/finance/corporate-invoices', 'issue(a.admin, b.customerId)'],
        ['kayıt', 'GET /api/v1/finance/corporate-invoices/:invoiceId', 'get(bInvoiceUrl, a.admin)'],
        [
          'kayıt',
          'POST /api/v1/finance/corporate-invoices/:invoiceId/cancel',
          '`${bInvoiceUrl}/cancel`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-corporate.test.ts',
        'başka kurumun şirketi, bağı ve faturası 404',
        marker,
      ),
    ]),
  ),
  // Onur: gelir ve nakit akışı tahmini (ON-246, ON-247; DOM-FIN-063).
  'GET /api/v1/finance/forecasts/revenue': liste(
    'finance-forecasts.test.ts',
    'başka kurumun taksiti, sözleşmesi, adayı ve iadesi tahminde yok',
    'REVENUE',
  ),
  'GET /api/v1/finance/forecasts/cash-flow': liste(
    'finance-forecasts.test.ts',
    'başka kurumun taksiti, sözleşmesi, adayı ve iadesi tahminde yok',
    'CASH_FLOW',
  ),
  // Onur: gelir senaryo analizi (ON-248; DOM-FIN-067).
  'POST /api/v1/finance/forecasts/scenarios': liste(
    'finance-forecasts.test.ts',
    'başka kurumun taksiti, sözleşmesi, adayı ve iadesi tahminde yok',
    'SCENARIOS',
  ),
  // Onur: bütçe ve maliyet merkezi (ON-241, ON-242; DOM-FIN-062).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/cost-centers', 'ids(CENTERS)'],
        ['gövde', 'POST /api/v1/finance/cost-centers', 'parentId: b.campus.id'],
        ['kayıt', 'PATCH /api/v1/finance/cost-centers/:costCenterId', "call('PATCH', bCenter"],
        ['liste', 'GET /api/v1/finance/budget-items', 'ids(ITEMS)'],
        ['gövde', 'POST /api/v1/finance/budget-items', 'institutionId: b.id'],
        ['kayıt', 'PATCH /api/v1/finance/budget-items/:itemId', "call('PATCH', bItem"],
        ['liste', 'GET /api/v1/finance/budget-periods', 'ids(PERIODS)'],
        ['gövde', 'POST /api/v1/finance/budget-periods', "name: 'Sızma'"],
        ['kayıt', 'GET /api/v1/finance/budget-periods/:periodId', 'get(bPeriod, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/budget-periods/:periodId', "call('PATCH', bPeriod"],
        ['kayıt', 'POST /api/v1/finance/budget-periods/:periodId/open', '`${bPeriod}/open`'],
        ['kayıt', 'POST /api/v1/finance/budget-periods/:periodId/close', '`${bPeriod}/close`'],
        ['kayıt', 'GET /api/v1/finance/budget-periods/:periodId/lines', 'get(`${bPeriod}/lines`'],
        [
          'kayıt',
          'POST /api/v1/finance/budget-periods/:periodId/lines',
          "call('POST', `${bPeriod}/lines`",
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/budget-periods/:periodId/lines/:lineId',
          "call('PATCH', bLineUrl",
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/budget-periods/:periodId/lines/:lineId',
          "call('DELETE', bLineUrl",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-budget.test.ts',
        'başka kurumun merkezi, kalemi, dönemi ve satırı 404',
        marker,
      ),
    ]),
  ),
  // Onur: yönetim kurulu raporu (ON-251, DOM-FIN-064).
  'GET /api/v1/finance/board-report': liste(
    'finance-board-report.test.ts',
    'başka kurumun kayıtları raporda sayılmaz',
    'URL_BASE',
  ),
  // Onur: bütçe–gerçekleşen (ON-244; DOM-FIN-066).
  'GET /api/v1/finance/budget-periods/:periodId/actuals': kayit(
    'finance-budget-actuals.test.ts',
    'başka kurumun dönemi 404, taksiti ve tahsilatı raporda yok',
    "send('GET', b.url, a.cookie)",
  ),
  // Onur: öğrenci başı maliyet ve kampüs konsolidasyonu (ON-249, ON-250; DOM-FIN-065).
  ...Object.fromEntries(
    ['GET /api/v1/finance/cost-per-student', 'GET /api/v1/finance/campus-consolidation'].map(
      (key) => [
        key,
        liste(
          'finance-cost-reports.test.ts',
          'DOM-FIN-065: başka kurumun dönemi 404; başka kurumun satırı ve öğrencisi raporda yok',
          'query(b)',
        ),
      ],
    ),
  ),
  // Onur: burs fonu (ON-259; DOM-FIN-068).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/scholarship-funds', 'get(FUNDS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/scholarship-funds', "call('POST', FUNDS, a.admin"],
        ['kayıt', 'GET /api/v1/finance/scholarship-funds/:fundId/report', '`${bUrl}/report`'],
        [
          'kayıt',
          'POST /api/v1/finance/scholarship-funds/:fundId/donations',
          'donate(a.admin, bFund.id)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/scholarship-funds/:fundId/allocations',
          'allocate(a.admin, bFund.id',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/scholarship-funds/:fundId/donations/:donationId/cancel',
          '`${bUrl}/donations/${String(bDonation.id)}/cancel`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/scholarship-funds/:fundId/allocations/:allocationId/cancel',
          '`${bUrl}/allocations/${String(bAllocation.id)}/cancel`',
        ],
        ['kayıt', 'POST /api/v1/finance/scholarship-funds/:fundId/close', '`${bUrl}/close`'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-scholarship-funds.test.ts',
        'başka kurumun fonu, bağışı, ataması ve bursu 404',
        marker,
      ),
    ]),
  ),
  // Onur: banka hareketi eşleştirme (ON-099, IST-115; DOM-FIN-069).
  ...Object.fromEntries(
    (
      [
        ['gövde', 'POST /api/v1/finance/bank-statement-imports', 'institutionId: b.id'],
        ['liste', 'GET /api/v1/finance/bank-transactions', "send('GET', LIST, a.adminCookie)"],
        [
          'kayıt',
          'GET /api/v1/finance/bank-transactions/:transactionId/suggestions',
          '`${url}/suggestions`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/bank-transactions/:transactionId/match',
          'match(a.adminCookie, bRow.id',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/bank-transactions/:transactionId/ignore',
          'ignore(a.adminCookie, bRow.id',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/bank-transactions/:transactionId/restore',
          'restore(a.adminCookie, bRow.id',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-bank-matching.test.ts',
        'başka kurumun hareketi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: tedarikçi (ON-221; DOM-FIN-070).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/suppliers', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/suppliers', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/suppliers/:supplierId', 'get(bUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/suppliers/:supplierId', "call('PATCH', bUrl, a.admin"],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-suppliers.test.ts',
        'başka kurumun tedarikçisi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: satın alma talebi (ON-222; DOM-FIN-071).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/purchase-requests', 'get(REQUESTS, a.admin)'],
        [
          'liste',
          'GET /api/v1/finance/purchase-requests/options',
          '`${REQUESTS}/options`, a.admin',
        ],
        ['gövde', 'POST /api/v1/finance/purchase-requests', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/purchase-requests/:requestId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/purchase-requests/:requestId',
          "call('PATCH', bUrl, a.admin",
        ],
        ...(['submit', 'approve', 'reject', 'cancel'] as const).map(
          (verb) =>
            [
              'kayıt',
              `POST /api/v1/finance/purchase-requests/:requestId/${verb}`,
              'act(a.admin, bRequest, verb',
            ] as const,
        ),
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-purchase-requests.test.ts',
        'başka kurumun talebi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: talep formunun bütçe durumu (ON-245; DOM-FIN-071, K-148).
  'GET /api/v1/finance/purchase-requests/budget-status': liste(
    'finance-purchase-requests.test.ts',
    'başka kurum sızmaz (K-148)',
    'budgetItemId: b.expense.id',
  ),
  // Onur: satın alma teklifi ve siparişi (ON-224, ON-225; DOM-FIN-072, DOM-FIN-073).
  ...Object.fromEntries(
    (
      [
        [
          'kayıt',
          'GET /api/v1/finance/purchase-requests/:requestId/quotes',
          'get(bQuotes, a.admin)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/purchase-requests/:requestId/quotes',
          "call('POST', bQuotes, a.admin",
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/purchase-requests/:requestId/quotes/:quoteId',
          "call('PATCH', bQuote, a.admin",
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/purchase-requests/:requestId/quotes/:quoteId',
          "call('DELETE', bQuote, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/purchase-requests/:requestId/quotes/:quoteId/select',
          '`${bQuote}/select`, a.admin',
        ],
        ['liste', 'GET /api/v1/finance/purchase-orders', 'get(ORDERS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/purchase-orders', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/purchase-orders/:orderId', 'get(bUrl, a.admin)'],
        ['kayıt', 'POST /api/v1/finance/purchase-orders/:orderId/send', '`${bUrl}/send`, a.admin'],
        [
          'kayıt',
          'POST /api/v1/finance/purchase-orders/:orderId/cancel',
          '`${bUrl}/cancel`, a.admin',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-purchase-orders.test.ts',
        'başka kurumun teklifi ve siparişi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: mal kabul (ON-226; DOM-FIN-074).
  'GET /api/v1/finance/purchase-orders/:orderId/receipts': kayit(
    'finance-purchase-receipts.test.ts',
    'başka kurumun siparişi ve kabulü 404 ve B değişmez',
    'get(receiptsUrl(b), a.admin)',
  ),
  'POST /api/v1/finance/purchase-orders/:orderId/receipts': kayit(
    'finance-purchase-receipts.test.ts',
    'başka kurumun siparişi ve kabulü 404 ve B değişmez',
    'receive(a.admin, b,',
  ),
  'POST /api/v1/finance/purchase-orders/:orderId/receipts/:receiptId/cancel': kayit(
    'finance-purchase-receipts.test.ts',
    'başka kurumun siparişi ve kabulü 404 ve B değişmez',
    'cancel(a.admin, b, bReceipt)',
  ),
  // Onur: satın alma raporu (ON-227; DOM-FIN-075).
  'GET /api/v1/finance/purchase-report': liste(
    'finance-purchase-report.test.ts',
    'DOM-FIN-075: başka kurumun dönemi 404; başka kurumun siparişi raporda yok',
    'periodId=${String(b.period.id)}',
  ),
  // Onur: tedarikçi carisi ve ödeme planı (ON-143; DOM-FIN-076).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/supplier-invoices', 'get(INVOICES, a.admin)'],
        ['gövde', 'POST /api/v1/finance/supplier-invoices', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/supplier-invoices/:invoiceId', 'get(bUrl, a.admin)'],
        ['kayıt', 'POST /api/v1/finance/supplier-invoices/:invoiceId/plan', '`${bUrl}/plan`'],
        [
          'kayıt',
          'POST /api/v1/finance/supplier-invoices/:invoiceId/cancel',
          '`${bUrl}/cancel`, a.admin',
        ],
        ['liste', 'GET /api/v1/finance/supplier-payments', 'get(PAYMENTS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/supplier-payments', 'payBody(a as Tenant, bInstallment)'],
        [
          'kayıt',
          'POST /api/v1/finance/supplier-payments/:paymentId/cancel',
          '`${PAYMENTS}/${String(bPayment.id)}/cancel`',
        ],
        [
          'gövde',
          'POST /api/v1/finance/supplier-payments/instruction-file',
          'paymentIds: [bPayment.id]',
        ],
        ['liste', 'GET /api/v1/finance/supplier-ledger', 'get(LEDGER, a.admin)'],
        [
          'kayıt',
          'GET /api/v1/finance/supplier-ledger/:supplierId',
          '`${LEDGER}/${String(b.alpha.id)}`, a.admin',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-supplier-ledger.test.ts',
        'başka kurumun faturası, ödemesi ve carisi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: demirbaş kaydı (ON-235; DOM-FIN-085).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/fixed-assets', 'listOf(a.admin)'],
        ['liste', 'GET /api/v1/finance/fixed-assets/receipt-items', 'get(RECEIPT_ITEMS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/fixed-assets', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/fixed-assets/:assetId', 'get(bUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/fixed-assets/:assetId', "call('PATCH', bUrl, a.admin"],
        ['kayıt', 'POST /api/v1/finance/fixed-assets/:assetId/scrap', '`${bUrl}/scrap`'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-fixed-assets.test.ts',
        'başka kurumun demirbaşı 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: demirbaş zimmeti (ON-236; DOM-FIN-086).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/fixed-asset-assignments', 'listOf(a.admin)'],
        [
          'kayıt',
          'GET /api/v1/finance/fixed-asset-assignments/:assignmentId',
          'get(bUrl, a.admin)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/fixed-assets/:assetId/assignments',
          'assign(a.admin, bAsset, ROOM)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/fixed-asset-assignments/:assignmentId/return',
          '`${bUrl}/return`',
        ],
        ['liste', 'GET /api/v1/finance/fixed-asset-assignees', 'assigneesOf(a.admin)'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-fixed-asset-assignments.test.ts',
        'başka kurumun demirbaşı ve zimmeti 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: demirbaş sayımı (ON-237; DOM-FIN-087).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/fixed-asset-counts', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/fixed-asset-counts', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/fixed-asset-counts/:countId', 'get(bUrl, a.admin)'],
        ['kayıt', 'GET /api/v1/finance/fixed-asset-counts/:countId/items', '`${bUrl}/items`'],
        ['kayıt', 'POST /api/v1/finance/fixed-asset-counts/:countId/scans', 'scan(a.admin, bCount'],
        [
          'kayıt',
          'POST /api/v1/finance/fixed-asset-counts/:countId/complete',
          "finish(a.admin, bCount, 'complete')",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/fixed-asset-counts/:countId/cancel',
          "finish(a.admin, bCount, 'cancel')",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/fixed-asset-counts/:countId/items/:itemId/relocate',
          'relocate(a.admin, bCount, bItem)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/fixed-asset-counts/:countId/items/:itemId/undo-scan',
          'undoScan(a.admin, bCount, bItem)',
        ],
        ['liste', 'GET /api/v1/finance/fixed-asset-places', 'get(PLACES, a.admin)'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-fixed-asset-counts.test.ts',
        'başka kurumun sayımı ve satırı 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: amortisman ön hesabı (ON-238; DOM-FIN-088).
  'GET /api/v1/finance/fixed-assets/depreciation-report': liste(
    'finance-fixed-asset-depreciation.test.ts',
    'DOM-FIN-088: başka kurumun demirbaşı raporda ve CSV dosyasında yok',
    'get(`${REPORT}?year=2026`, a.admin)',
  ),
  // Onur: stok kartı, depo ve hareket (ON-228, ON-229; DOM-FIN-077, DOM-FIN-078).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/stock-items', 'listOf(ITEMS)'],
        ['liste', 'GET /api/v1/finance/stock-items/critical', 'listOf(CRITICAL)'],
        ['gövde', 'POST /api/v1/finance/stock-items', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/stock-items/:itemId', 'get(bItemUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/stock-items/:itemId', 'patchB(bItemUrl, b.paper.version)'],
        ['liste', 'GET /api/v1/finance/stock-warehouses', 'listOf(WAREHOUSES)'],
        [
          'gövde',
          'POST /api/v1/finance/stock-warehouses',
          "'Sızma deposu', campusId: 'b1', institutionId: b.id",
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/stock-warehouses/:warehouseId',
          'patchB(bWarehouseUrl, b.main.version)',
        ],
        ['liste', 'GET /api/v1/finance/stock-movements', 'listOf(MOVEMENTS)'],
        ['gövde', 'POST /api/v1/finance/stock-entries', 'itemId: b.paper.id, institutionId: b.id'],
        [
          'gövde',
          'POST /api/v1/finance/stock-issues',
          'issue(a.admin, a, { warehouseId: b.main.id })',
        ],
        ['gövde', 'POST /api/v1/finance/stock-transfers', '{ toWarehouseId: b.main.id }'],
        [
          'kayıt',
          'POST /api/v1/finance/stock-movements/:movementId/cancel',
          'cancel(a.admin, bEntry)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-inventory.test.ts',
        'başka kurumun kartı, deposu ve hareketi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: materyal seti dağıtımı (ON-232; DOM-FIN-080).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/material-sets', 'listOf()'],
        ['gövde', 'POST /api/v1/finance/material-sets', 'stockItemId: b.book.id, quantity: 1'],
        ['kayıt', 'GET /api/v1/finance/material-sets/:setId', 'get(bSetUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/material-sets/:setId', "call('PATCH', bSetUrl, a.admin"],
        ['kayıt', 'GET /api/v1/finance/material-sets/:setId/students', '`${bSetUrl}/students`'],
        ['kayıt', 'POST /api/v1/finance/material-sets/:setId/deliveries', 'key(), b.set.id'],
        [
          'kayıt',
          'GET /api/v1/finance/material-recipients',
          '`${RECIPIENTS}?studentId=${outsider}`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/material-deliveries/:deliveryId/cancel',
          'cancel(a.admin, bDelivery)',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/material-deliveries/:deliveryId',
          '`${DELIVERIES}/${String(bDelivery.id)}`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/material-deliveries/:deliveryId/signature',
          'sign(a.admin, bDelivery)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-material-sets.test.ts',
        'başka kurumun seti ve teslimi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: stok sayımı (ON-231; DOM-FIN-081).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/stock-counts', 'listOf()'],
        ['gövde', 'POST /api/v1/finance/stock-counts', '{ institutionId: b.id }'],
        ['kayıt', 'GET /api/v1/finance/stock-counts/:countId', 'get(bCountUrl, a.admin)'],
        ['kayıt', 'POST /api/v1/finance/stock-counts/:countId/scans', 'scan(a.admin, bCount'],
        [
          'kayıt',
          'POST /api/v1/finance/stock-counts/:countId/quantities',
          'setQuantity(a.admin, bCount',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/stock-counts/:countId/complete',
          'complete(a.admin, bCount)',
        ],
        ['kayıt', 'POST /api/v1/finance/stock-counts/:countId/cancel', 'cancel(a.admin, bCount)'],
        ['kayıt', 'GET /api/v1/finance/stock-counts/:countId/entries', '`${bCountUrl}/entries`'],
        [
          'kayıt',
          'POST /api/v1/finance/stock-counts/:countId/entries/:entryId/undo',
          'undo(a.admin, bCount',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)('finance-stock-counts.test.ts', 'başka kurumun sayımı 404 ve B değişmez', marker),
    ]),
  ),
  // Onur: laboratuvar kimyasal envanteri (ON-234; DOM-FIN-090).
  ...Object.fromEntries(
    (
      [
        [
          'kayıt',
          'POST /api/v1/finance/stock-items/:itemId/chemical-profile',
          'mark(a.admin, b.paper)',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/stock-items/:itemId/chemical-profile',
          "call('PATCH', profileUrl(b.acid), a.admin",
        ],
        ['liste', 'GET /api/v1/finance/chemical-lots', '`${LOTS}?itemId=${String(b.acid.id)}`'],
        [
          'liste',
          'GET /api/v1/finance/chemical-inventory',
          '`${REPORT}?warehouseId=${String(b.lab.id)}`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-chemicals.test.ts',
        'başka kurumun kartı kimyasal işaretlenmez ve düzeltilmez',
        marker,
      ),
    ]),
  ),
  // Onur: sarf malzeme talebi (ON-233; DOM-FIN-091).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/supply-requests', 'listOf(a.admin)'],
        ['liste', 'GET /api/v1/finance/supply-requests/stock-items', 'get(CARDS, a.teacher)'],
        ['gövde', 'POST /api/v1/finance/supply-requests', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/supply-requests/:requestId', 'get(bUrl, a.admin)'],
        ['kayıt', 'POST /api/v1/finance/supply-requests/:requestId/approve', "'approve'"],
        ['kayıt', 'POST /api/v1/finance/supply-requests/:requestId/reject', "'reject'"],
        ['kayıt', 'POST /api/v1/finance/supply-requests/:requestId/cancel', "'cancel'"],
        [
          'kayıt',
          'POST /api/v1/finance/supply-requests/:requestId/fulfill',
          'fulfill(a.admin, a, bRequest)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/supply-requests/:requestId/convert',
          'convert(a.admin, a, bRequest)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-supply-requests.test.ts',
        'başka kurumun talebi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: arıza ve bakım talebi (ON-239; DOM-FIN-089).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/maintenance-requests', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/maintenance-requests', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/maintenance-requests/:requestId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'POST /api/v1/finance/maintenance-requests/:requestId/assign',
          "['assign', toStaff(bStaff)]",
        ],
        ['kayıt', 'POST /api/v1/finance/maintenance-requests/:requestId/start', "['start', {}]"],
        [
          'kayıt',
          'POST /api/v1/finance/maintenance-requests/:requestId/resolve',
          "['resolve', RESOLVE]",
        ],
        ['kayıt', 'POST /api/v1/finance/maintenance-requests/:requestId/close', "['close', {}]"],
        [
          'kayıt',
          'POST /api/v1/finance/maintenance-requests/:requestId/cancel',
          "['cancel', { reason: 'Başka kurum' }]",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-maintenance-requests.test.ts',
        'başka kurumun talebi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: kampanya kodu ve huni kırılımı (ON-134; DOM-KAY-041). Envanter tablosunda Onur
  // bloklarının sonuna (ör. tedarikçi bloğunun yanına) eklenir; kanıt `prospect-campaigns.test.ts`.
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/prospects/campaign-codes', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/prospects/campaign-codes', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/prospects/campaign-codes/:campaignId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/prospects/campaign-codes/:campaignId',
          "call('PATCH', bUrl, a.admin",
        ],
        [
          'kayıt',
          'DELETE /api/v1/prospects/campaign-codes/:campaignId',
          "call('DELETE', bUrl, a.admin",
        ],
        ['liste', 'GET /api/v1/prospects/funnel/campaigns', 'get(FUNNEL, a.admin)'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'prospect-campaigns.test.ts',
        'başka kurumun kampanyası 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: tedarikçi faturası üçlü eşleştirmesi (ON-277; DOM-FIN-095).
  ...Object.fromEntries(
    (
      [
        [
          'kayıt',
          'POST /api/v1/finance/supplier-invoices/:invoiceId/approve-match',
          'approve(a.admin, bInvoice)',
        ],
        ['liste', 'GET /api/v1/finance/supplier-invoice-matches', 'get(MATCHES, a.admin)'],
        [
          'kayıt',
          'GET /api/v1/finance/purchase-orders/:orderId/invoice-matching',
          '`${ORDERS}/${String(b.order.id)}/invoice-matching`, a.admin',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-invoice-matching.test.ts',
        'başka kurumun faturası ve siparişi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: kademeli onay ayarı ve taslağa geri çekme (ON-223; DOM-FIN-071, K-260…K-263).
  ...Object.fromEntries(
    (
      [
        [
          'liste',
          'GET /api/v1/finance/purchase-approval-settings',
          'get(SETTINGS, a.adminA.cookie)',
        ],
        [
          'gövde',
          'PATCH /api/v1/finance/purchase-approval-settings',
          'approverUserId: bFounder.id',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-purchase-approvals.test.ts',
        'başka kurumun ayarı ve kişisi etkisiz; B değişmez',
        marker,
      ),
    ]),
  ),
  ...Object.fromEntries(
    (
      [
        [
          'kayıt',
          'POST /api/v1/finance/purchase-requests/:requestId/withdraw',
          "'withdraw', 'approve', 'reject'",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-purchase-approvals.test.ts',
        'başka kurumun talebi geri çekilemez (404) ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: burs kesme ve geri isteme (ON-283; DOM-FIN-025).
  ...Object.fromEntries(
    (
      [
        ['kayıt', 'POST /api/v1/finance/scholarship-awards/:awardId/end-quote', 'quote(foreign'],
        [
          'kayıt',
          'POST /api/v1/finance/scholarship-awards/:awardId/terminate',
          "end(foreign, 'terminate'",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/scholarship-awards/:awardId/revoke',
          "end(foreign, 'revoke'",
        ],
        [
          'kayıt',
          'GET /api/v1/finance/scholarship-awards/:awardId/ends',
          '`${AWARDS}/${a.awardId}/ends`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)('finance-scholarship-revocation.test.ts', 'başka kurumun ataması 404', marker),
    ]),
  ),
  // Onur: periyodik bakım planı (ON-240; DOM-FIN-092).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/maintenance-plans', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/maintenance-plans', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/maintenance-plans/:planId', 'get(bUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/maintenance-plans/:planId', "call('PATCH', bUrl, a.admin"],
        [
          'kayıt',
          'DELETE /api/v1/finance/maintenance-plans/:planId',
          "call('DELETE', bUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/maintenance-plans/:planId/inspections',
          'inspect(a.admin, bPlan',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/maintenance-plans/:planId/inspections/:inspectionId/cancel',
          'cancel(a.admin, bPlan, bInspection',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/maintenance-plans/:planId/inspections/:inspectionId/maintenance-request',
          'openRequest(a.admin, bPlan, bInspection)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-maintenance-plans.test.ts',
        'başka kurumun planı 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: bütçe hazırlama ve onay (ON-243; DOM-FIN-093).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/budget-draft-options', 'get(OPTIONS, a.admin)'],
        [
          'kayıt',
          'POST /api/v1/finance/cost-centers/:costCenterId/budget-owner',
          'assign(a, b.unit.id',
        ],
        ['liste', 'GET /api/v1/finance/budget-drafts', 'get(DRAFTS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/budget-drafts', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/budget-drafts/:draftId', 'get(bUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/budget-drafts/:draftId', 'write(a.admin, bSubmitted'],
        [
          'kayıt',
          'GET /api/v1/finance/budget-drafts/:draftId/comparison',
          'get(`${bUrl}/comparison`, a.admin)',
        ],
        ['kayıt', 'POST /api/v1/finance/budget-drafts/:draftId/submit', "['submit', {}]"],
        ['kayıt', 'POST /api/v1/finance/budget-drafts/:draftId/approve', "['approve', {}]"],
        [
          'kayıt',
          'POST /api/v1/finance/budget-drafts/:draftId/request-revision',
          "['request-revision', { reason: 'Sızma denemesi' }]",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/budget-drafts/:draftId/reject',
          "['reject', { reason: 'Sızma denemesi' }]",
        ],
        ['kayıt', 'POST /api/v1/finance/budget-drafts/:draftId/reopen', "['reopen', {}]"],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-budget-drafts.test.ts',
        'başka kurumun taslağı, merkezi ve dönemi 404',
        marker,
      ),
    ]),
  ),
  // Onur: ücretsiz okutma (ON-284; DOM-FIN-026).
  ...Object.fromEntries(
    (
      [
        [
          'liste',
          'GET /api/v1/finance/free-tuition/rounds',
          "send('GET', `${BASE}/rounds`, a.cookie)",
        ],
        [
          'gövde',
          'POST /api/v1/finance/free-tuition/rounds',
          'createRound(a.cookie, { ...ROUND, institutionId: b.id })',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/free-tuition/rounds/:roundId/confirm-quota',
          'confirm(a.cookie, b.roundId, 3)',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/free-tuition/rounds/:roundId/applications',
          '`${BASE}/rounds/${b.roundId}/applications`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/free-tuition/rounds/:roundId/applications',
          'apply(a.cookie, b.roundId)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/free-tuition/applications/:applicationId/documents',
          '`${BASE}/applications/${b.applicationId}/documents`',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/free-tuition/rounds/:roundId/board-meetings',
          '`${BASE}/rounds/${b.roundId}/board-meetings`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/free-tuition/rounds/:roundId/board-meetings',
          'board(a.cookie, b.roundId, decision(b.applicationId))',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/free-tuition/board-meetings/:meetingId',
          '`${BASE}/board-meetings/${b.meetingId}`',
        ],
        [
          'liste',
          'GET /api/v1/finance/free-tuition/awards',
          "send('GET', `${BASE}/awards`, a.cookie)",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/free-tuition/awards/:awardId/mebbis-record',
          '`${BASE}/awards/${b.award.id}/mebbis-record`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/free-tuition/awards/:awardId/pay-refund',
          '`${BASE}/awards/${b.award.id}/pay-refund`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-free-tuition.test.ts',
        'DOM-FIN-026: başka kurumun dönemi, adayı, toplantısı ve hakkı 404',
        marker,
      ),
    ]),
  ),
  // Onur: iade faturası ve iptal isteği (ON-266; DOM-FIN-096).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/refund-invoices', "call('GET', URL, a.admin)"],
        [
          'gövde',
          'POST /api/v1/finance/refund-invoices',
          'create({ ...a, withdrawalId: b.withdrawalId })',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/refund-invoices/:refundInvoiceId',
          '`${URL}/${String(bDoc.id)}`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/refund-invoices/:refundInvoiceId/ready',
          "step(a.admin, bDoc, 'ready')",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/refund-invoices/:refundInvoiceId/complete',
          "step(a.admin, bDoc, 'complete'",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/refund-invoices/:refundInvoiceId/discard',
          "step(a.admin, bDoc, 'discard'",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-refund-invoices.test.ts',
        'DOM-FIN-096: başka kurumun ayrılışı ve belgesi 404; B değişmez, A listesinde B yok',
        marker,
      ),
    ]),
  ),
  // Onur: bordro parametreleri (ON-197; DOM-FIN-100).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/payroll-parameters', 'yearOf(a.admin, 2026)'],
        [
          'liste',
          'GET /api/v1/finance/payroll-parameters/effective',
          "effectiveOn(a.admin, '2026-05-01')",
        ],
        ['gövde', 'POST /api/v1/finance/payroll-parameters', 'institutionId: b.id'],
        ['kayıt', 'PATCH /api/v1/finance/payroll-parameters/:setId', "call('PATCH', bUrl, a.admin"],
        [
          'kayıt',
          'DELETE /api/v1/finance/payroll-parameters/:setId',
          "call('DELETE', bUrl, a.admin",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-payroll-parameters.test.ts',
        'başka kurumun seti 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: bağış kampanyası, bağışçı ve makbuz (ON-258; DOM-FIN-097).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/donation-campaigns', 'get(CAMPAIGNS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/donation-campaigns', 'bankAccountId: b.bankAccountId'],
        ['kayıt', 'GET /api/v1/finance/donation-campaigns/:campaignId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/donation-campaigns/:campaignId',
          "call('PATCH', bUrl, a.admin",
        ],
        ['kayıt', 'POST /api/v1/finance/donation-campaigns/:campaignId/open', '`${bUrl}/open`'],
        [
          'kayıt',
          'POST /api/v1/finance/donation-campaigns/:campaignId/close',
          "transition(a.admin, bCampaign, 'close')",
        ],
        [
          'kayıt',
          'GET /api/v1/finance/donation-campaigns/:campaignId/donations',
          '`${bUrl}/donations`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/donation-campaigns/:campaignId/donations',
          'donate(a.admin, bCampaign.id)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/donations/:donationId/cancel',
          'cancel(a.admin, bDonation)',
        ],
        ['kayıt', 'GET /api/v1/finance/donations/:donationId/receipt', '/receipt`, a.admin)'],
        ['liste', 'GET /api/v1/finance/donors', 'get(DONORS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/donors', "call('POST', DONORS, a.admin"],
        ['kayıt', 'PATCH /api/v1/finance/donors/:donorId', '`${DONORS}/${String(bDonor.id)}`'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-donations.test.ts',
        'başka kurumun kampanyası, bağışı ve bağışçısı 404',
        marker,
      ),
    ]),
  ),
  'GET /api/v1/finance/donation-settings': liste(
    'finance-donations.test.ts',
    'başka kurumun kampanyası, bağışı ve bağışçısı 404',
    'get(SETTINGS, a.admin)',
  ),
  'PATCH /api/v1/finance/donation-settings': govde(
    'finance-donations.test.ts',
    'başka kurumun kampanyası, bağışı ve bağışçısı 404',
  ),
  // Onur: paydaş ve sponsor kaydı (ON-262; DOM-FIN-102).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/stakeholders', 'listOf(a.admin, STAKEHOLDERS)'],
        ['gövde', 'POST /api/v1/finance/stakeholders', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/stakeholders/:stakeholderId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/stakeholders/:stakeholderId',
          "call('PATCH', bUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/stakeholders/:stakeholderId/agreements',
          'open(a.admin, bStakeholder)',
        ],
        ['liste', 'GET /api/v1/finance/stakeholder-agreements', 'listOf(a.admin, AGREEMENTS)'],
        [
          'kayıt',
          'GET /api/v1/finance/stakeholder-agreements/:agreementId',
          'get(bAgreementUrl, a.admin)',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/stakeholder-agreements/:agreementId',
          "call('PATCH', bAgreementUrl, a.admin",
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/stakeholder-agreements/:agreementId',
          "call('DELETE', bAgreementUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/stakeholder-agreements/:agreementId/activate',
          'activate(a.admin, bAgreement)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/stakeholder-agreements/:agreementId/terminate',
          'terminate(a.admin, bAgreement',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-stakeholders.test.ts',
        'başka kurumun paydaşı ve anlaşması 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: personel ücret tanımı (ON-194; DOM-FIN-099).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/pay-rate-staff', 'staffListOf(a.admin)'],
        [
          'kayıt',
          'GET /api/v1/finance/pay-rate-staff/:membershipId',
          '`${STAFF}/${bStaff}`, a.admin',
        ],
        ['gövde', 'POST /api/v1/finance/pay-rates', 'institutionId: b.id'],
        ['kayıt', 'POST /api/v1/finance/pay-rates/:rateId/end', '`${bUrl}/end`'],
        ['kayıt', 'POST /api/v1/finance/pay-rates/:rateId/cancel', '`${bUrl}/cancel`'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-pay-rates.test.ts',
        'başka kurumun personeli ve tanımı 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: gezi ve etkinlik ücreti (ON-142; DOM-FIN-098).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/paid-activities', "send('GET', BASE, a.cookie)"],
        ['gövde', 'POST /api/v1/finance/paid-activities', '{ ...EARLY, institutionId: b.id }'],
        [
          'kayıt',
          'GET /api/v1/finance/paid-activities/:activityId',
          "send('GET', `${BASE}/${bActivity.id}`, a.cookie)",
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/paid-activities/:activityId',
          "send('PATCH', `${BASE}/${bActivity.id}`, a.cookie",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/paid-activities/:activityId/cancel',
          '`${BASE}/${bActivity.id}/cancel`',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/paid-activities/:activityId/participants',
          '`${BASE}/${bActivity.id}/participants`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/paid-activities/:activityId/participants',
          'join(a.cookie, bActivity.id)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/paid-activity-participants/:participantId/cancel',
          'cancelParticipant(a.cookie, bParticipant)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/paid-activity-participants/:participantId/pay-refund',
          '`${PARTICIPANTS}/${bParticipant.id}/pay-refund`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-paid-activities.test.ts',
        'DOM-FIN-098: başka kurumun etkinliği ve katılımı 404',
        marker,
      ),
    ]),
  ),
  // Onur: mezun belge talebi (ON-260; DOM-KAY-044). Kanıt `enrollment-alumni-documents.test.ts`.
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/prospects/alumni-document-requests', 'get(BASE, a.admin)'],
        ['liste', 'GET /api/v1/prospects/alumni-document-students', '`${STUDENTS}?q=B Öğrenci`'],
        ['liste', 'GET /api/v1/prospects/alumni-document-fees', 'get(FEES, b.admin)'],
        ['liste', 'PATCH /api/v1/prospects/alumni-document-fees', "call('PATCH', FEES, a.admin"],
        ['gövde', 'POST /api/v1/prospects/alumni-document-requests', 'institutionId: b.id'],
        [
          'kayıt',
          'GET /api/v1/prospects/alumni-document-requests/:requestId',
          'get(bUrl, a.admin)',
        ],
        [
          'kayıt',
          'GET /api/v1/prospects/alumni-document-requests/:requestId/document',
          '`${bUrl}/document`',
        ],
        ['kayıt', 'POST /api/v1/prospects/alumni-document-requests/:requestId/start', 'start: {}'],
        ['kayıt', 'POST /api/v1/prospects/alumni-document-requests/:requestId/ready', 'ready: {}'],
        [
          'kayıt',
          'POST /api/v1/prospects/alumni-document-requests/:requestId/deliver',
          "deliver: { identityCheckNote: 'Kimlik görüldü' }",
        ],
        [
          'kayıt',
          'POST /api/v1/prospects/alumni-document-requests/:requestId/reject',
          "reject: { reason: 'Başka kurum talebi' }",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'enrollment-alumni-documents.test.ts',
        'başka kurumun talebi ve öğrencisi 404, listede yok, B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: etkinlik bileti ve oturma (ON-159; DOM-FIN-103).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/ticketed-events', 'get(EVENTS, a.admin)'],
        [
          'gövde',
          'POST /api/v1/finance/ticketed-events',
          'createEvent(a.admin, { ...SEATED, institutionId: b.id })',
        ],
        ['kayıt', 'GET /api/v1/finance/ticketed-events/:eventId', 'get(bUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/ticketed-events/:eventId', "call('PATCH', bUrl, a.admin"],
        [
          'kayıt',
          'DELETE /api/v1/finance/ticketed-events/:eventId',
          "call('DELETE', bUrl, a.admin",
        ],
        [
          'kayıt',
          'GET /api/v1/finance/ticketed-events/:eventId/tickets',
          'get(`${bUrl}/tickets`, a.admin)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/ticketed-events/:eventId/tickets',
          'allocate(a.admin, bEvent',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/ticketed-events/:eventId/check-in',
          'checkIn(a.admin, bEvent, bTicket.code)',
        ],
        ['kayıt', 'POST /api/v1/finance/event-tickets/:ticketId/pay', 'pay(a.admin, bTicket)'],
        [
          'kayıt',
          'POST /api/v1/finance/event-tickets/:ticketId/cancel',
          'cancel(a.admin, bTicket)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/event-tickets/:ticketId/refund',
          'refund(a.admin, bTicket)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/event-tickets/:ticketId/undo-check-in',
          'undo(a.admin, bTicket)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-event-tickets.test.ts',
        'DOM-FIN-103: başka kurumun etkinliği, bileti ve kodu 404',
        marker,
      ),
    ]),
  ),
  // Onur: avans ve kesintiler (ON-199; DOM-FIN-101).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/staff-deductions', 'staffOf(a.admin)'],
        ['kayıt', 'GET /api/v1/finance/staff-deductions/:membershipId', 'detail(a.admin, bStaff)'],
        [
          'kayıt',
          'POST /api/v1/finance/staff-deductions/:membershipId/month-preview',
          'preview(a.admin, bStaff',
        ],
        ['gövde', 'POST /api/v1/finance/staff-advances', 'giveAdvance(a.admin, advance(bStaff))'],
        [
          'kayıt',
          'POST /api/v1/finance/staff-advances/:advanceId/close',
          '`${ADVANCES}/${String(bAdvance.id)}/close`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/staff-advances/:advanceId/cancel',
          '`${ADVANCES}/${String(bAdvance.id)}/cancel`',
        ],
        [
          'gövde',
          'POST /api/v1/finance/staff-garnishments',
          'addGarnishment(a.admin, garnishment(bStaff))',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/staff-garnishments/:garnishmentId',
          '`${GARNISHMENTS}/${String(bIcra.id)}`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/staff-garnishments/:garnishmentId/close',
          '`${GARNISHMENTS}/${String(bIcra.id)}/close`',
        ],
        [
          'gövde',
          'POST /api/v1/finance/staff-pension-enrollments',
          'enroll(a.admin, pension(bStaff))',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/staff-pension-enrollments/:enrollmentId/pause',
          '`${PENSIONS}/${String(bBes.id)}/pause`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/staff-pension-enrollments/:enrollmentId/opt-out',
          '`${PENSIONS}/${String(bBes.id)}/opt-out`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-staff-deductions.test.ts',
        'başka kurumun personeli ve kayıtları 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: aday belgeleri (ON-263; DOM-KAY-043). Kanıt `prospect-documents.test.ts`.
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/prospects/document-types', 'get(TYPES, a.admin)'],
        ['gövde', 'POST /api/v1/prospects/document-types', 'institutionId: b.id'],
        [
          'kayıt',
          'PATCH /api/v1/prospects/document-types/:typeId',
          "call('PATCH', `${TYPES}/${String(bType.id)}`, a.admin",
        ],
        [
          'kayıt',
          'DELETE /api/v1/prospects/document-types/:typeId',
          "call('DELETE', `${TYPES}/${String(bType.id)}`, a.admin",
        ],
        ['liste', 'GET /api/v1/prospects/document-gaps', 'get(GAPS, a.admin)'],
        ['kayıt', 'GET /api/v1/prospects/:prospectId/documents', "get(docs('pb1'), a.admin)"],
        [
          'kayıt',
          'POST /api/v1/prospects/:prospectId/documents',
          "call('POST', docs('pb1'), a.front",
        ],
        [
          'kayıt',
          'POST /api/v1/prospects/:prospectId/documents/:documentId/review',
          '`${bUrl}/review`',
        ],
        [
          'kayıt',
          'GET /api/v1/prospects/:prospectId/documents/:documentId/url',
          'get(`${bUrl}/url`, a.admin)',
        ],
        [
          'kayıt',
          'POST /api/v1/prospects/:prospectId/document-consent',
          "call('POST', consent('pb1'), a.front",
        ],
        [
          'kayıt',
          'POST /api/v1/prospects/:prospectId/document-consent/withdraw',
          "`${consent('pb1')}/withdraw`",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'prospect-documents.test.ts',
        'başka kurumun adayı, belgesi, türü ve rızası 404, B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: kayıt belgeleri (ON-344; DOM-KAY-045). Kanıt `enrollment-documents.test.ts`.
  'GET /api/v1/prospects/enrollment-documents': liste(
    'enrollment-documents.test.ts',
    'DOM-KAY-045: yetki, modül ve kurum kapsamı; başka kurumun öğrencisi 404, listede yok',
    'listRows(other.admin)',
  ),
  'GET /api/v1/prospects/students/:studentId/enrollment-documents': kayit(
    'enrollment-documents.test.ts',
    'DOM-KAY-045: yetki, modül ve kurum kapsamı; başka kurumun öğrencisi 404, listede yok',
    'get(studentDocs(studentId), other.admin)',
  ),
  // Onur: kıdem hesaplayıcısında ücret önerisi ve bordro parametresi (ON-341; DOM-FIN-094).
  ...Object.fromEntries(
    (
      [
        ['gövde', 'POST /api/v1/finance/severance-estimates', 'membershipId: bTeacher.id'],
        ['kayıt', 'GET /api/v1/finance/severance-pay-suggestion', 'membershipId=${bTeacher.id}'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-severance.test.ts',
        'kurumlar arası: başka kurumun personeli ve personel olmayan üyelik 404',
        marker,
      ),
    ]),
  ),
  // Onur: personel çalışma ve hizmet belgesi (ON-175; DOM-FIN-106).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/staff-certificates', 'listOf(a.admin)'],
        ['liste', 'GET /api/v1/finance/staff-certificate-staff', 'get(STAFF, a.admin)'],
        ['gövde', 'POST /api/v1/finance/staff-certificates', 'institutionId: b.id'],
        [
          'kayıt',
          'GET /api/v1/finance/staff-certificates/:certificateId/document',
          '`${bUrl}/document`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/staff-certificates/:certificateId/cancel',
          '`${bUrl}/cancel`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-staff-certificates.test.ts',
        'başka kurumun personeli ve belgesi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: bordro programına aktarım (ON-202; DOM-FIN-105).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/payroll-exports/preview', 'ok(await preview(a.admin))'],
        ['liste', 'POST /api/v1/finance/payroll-exports', 'aFile.body.includes(b.selin)'],
        ['liste', 'GET /api/v1/finance/payroll-exports', '(await get(EXPORTS, a.admin))'],
        ['gövde', 'POST /api/v1/finance/payroll-lesson-hours', 'institutionId: b.id'],
        [
          'kayıt',
          'PATCH /api/v1/finance/payroll-lesson-hours/:entryId',
          "call('PATCH', bUrl, a.admin",
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/payroll-lesson-hours/:entryId',
          "call('DELETE', bUrl, a.admin",
        ],
        ['liste', 'GET /api/v1/finance/payroll-export-profile', 'ok(await get(PROFILE, a.admin))'],
        [
          'gövde',
          'PATCH /api/v1/finance/payroll-export-profile',
          'profile: null, institutionId: b.id',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-payroll-exports.test.ts',
        'başka kurumun ek ders saati ve dosyası 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: personel maliyeti (ON-204; DOM-FIN-104).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/staff-costs', "reportOf(a.admin, '?people=true')"],
        ['liste', 'GET /api/v1/finance/staff-cost-staff', 'staffListOf(a.admin)'],
        [
          'kayıt',
          'GET /api/v1/finance/staff-cost-staff/:membershipId',
          '`${STAFF}/${bStaff}`, a.admin',
        ],
        ['gövde', 'POST /api/v1/finance/staff-cost-allocations', 'institutionId: b.id'],
        [
          'kayıt',
          'POST /api/v1/finance/staff-cost-allocations/:allocationId/cancel',
          'cancel(a.admin, bAllocation',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-staff-costs.test.ts',
        'başka kurumun personeli, ataması ve merkezi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: personel sağlık raporu (ON-185; DOM-FIN-110).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/medical-reports', 'listOf(a.admin)'],
        ['liste', 'GET /api/v1/finance/medical-report-summary', 'summaryOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/medical-reports', 'institutionId: b.id'],
        ['kayıt', 'PATCH /api/v1/finance/medical-reports/:reportId', "call('PATCH', bUrl, a.admin"],
        ['kayıt', 'POST /api/v1/finance/medical-reports/:reportId/cancel', '`${bUrl}/cancel`'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-medical-reports.test.ts',
        'başka kurumun personeli ve raporu 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: bordro onayı ve dönem kilidi (ON-200; DOM-FIN-108).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/payroll-periods', 'yearOf(a.admin)'],
        [
          'kayıt',
          'POST /api/v1/finance/payroll-periods/:month/approve',
          "approved(a.admin, '2026-08')",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/payroll-periods/:month/reopen',
          "reopen(a.admin, '2026-08'",
        ],
        [
          'kayıt',
          'GET /api/v1/finance/payroll-periods/:month/adjustments',
          "listAdjustments(a.admin, '2026-08')",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/payroll-periods/:month/adjustments',
          "createAdjustment(a.admin, '2026-08'",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/payroll-adjustments/:adjustmentId/cancel',
          'cancelAdjustment(a.admin, bItem)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-payroll-periods.test.ts',
        'başka kurumun dönemi ve düzeltmesi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: personel izin türleri ve hak ediş (ON-181; DOM-FIN-109).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/leave-types', 'typesOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/leave-types', "label: 'Alfa izni'"],
        [
          'kayıt',
          'PATCH /api/v1/finance/leave-types/:code',
          'patchType(a.admin, String(bType.code)',
        ],
        ['liste', 'GET /api/v1/finance/leave-staff', 'staffListOf(a.admin)'],
        ['kayıt', 'GET /api/v1/finance/leave-staff/:membershipId', '`${STAFF}/${bStaff}`, a.admin'],
        ['gövde', 'POST /api/v1/finance/leave-profiles', 'openProfile(a.admin, {'],
        [
          'kayıt',
          'PATCH /api/v1/finance/leave-profiles/:membershipId',
          'patchProfile(a.admin, bStaff',
        ],
        ['gövde', 'POST /api/v1/finance/leave-records', 'institutionId: b.id'],
        [
          'kayıt',
          'POST /api/v1/finance/leave-records/:recordId/cancel',
          'cancelRecord(a.admin, bRecord',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-staff-leave.test.ts',
        'başka kurumun personeli, profili, türü ve kaydı 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: SGK bildirge hazırlık listesi (ON-203; DOM-FIN-107).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/sgk-preparation', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/sgk-missing-days', 'institutionId: b.id'],
        [
          'kayıt',
          'DELETE /api/v1/finance/sgk-missing-days/:entryId',
          '`${MISSING}/${String(bEntry.id)}`',
        ],
        [
          'gövde',
          'POST /api/v1/finance/sgk-employment-dates',
          'addDates(a.admin, { membershipId: bStaff',
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/sgk-employment-dates/:entryId',
          '`${DATES}/${String(bDates.id)}`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-sgk-preparation.test.ts',
        'DOM-FIN-107: başka kurumun personeli ve satırı 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: öğretmen çalışma onayı (ON-174; DOM-FIN-114).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/work-permit-teachers', 'teachersOf(a.admin)'],
        ['liste', 'GET /api/v1/finance/work-permits', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/work-permits', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/work-permits/:permitId', 'get(bUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/work-permits/:permitId', "call('PATCH', bUrl, a.admin"],
        ['kayıt', 'POST /api/v1/finance/work-permits/:permitId/apply', "bPermit, 'apply'"],
        [
          'kayıt',
          'POST /api/v1/finance/work-permits/:permitId/approve',
          'approve(a.admin, bPermit)',
        ],
        ['kayıt', 'POST /api/v1/finance/work-permits/:permitId/reject', "bPermit, 'reject'"],
        ['kayıt', 'POST /api/v1/finance/work-permits/:permitId/cancel', "bPermit, 'cancel'"],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-work-permits.test.ts',
        'başka kurumun öğretmeni ve kaydı 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: gezi planı ve onay dosyası (ON-155; DOM-FIN-111).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/trip-plans', 'get(URL, a.admin)'],
        ['liste', 'GET /api/v1/finance/trip-plan-options', 'get(OPTIONS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/trip-plans', 'membershipId: bLead'],
        ['kayıt', 'GET /api/v1/finance/trip-plans/:planId', 'get(urlOf(bPlan), a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/trip-plans/:planId', 'patch(a.admin, bPlan'],
        ['kayıt', 'POST /api/v1/finance/trip-plans/:planId/submit', 'step(a.admin, bPlan, verb'],
        ['kayıt', 'POST /api/v1/finance/trip-plans/:planId/approve', 'step(a.admin, bPlan, verb'],
        ['kayıt', 'POST /api/v1/finance/trip-plans/:planId/reject', 'step(a.admin, bPlan, verb'],
        [
          'kayıt',
          'POST /api/v1/finance/trip-plans/:planId/authority-notice',
          'step(a.admin, bPlan, verb',
        ],
        ['kayıt', 'POST /api/v1/finance/trip-plans/:planId/complete', 'step(a.admin, bPlan, verb'],
        ['kayıt', 'POST /api/v1/finance/trip-plans/:planId/cancel', 'step(a.admin, bPlan, verb'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)('finance-trip-plans.test.ts', 'DOM-FIN-111: başka kurumun planı 404', marker),
    ]),
  ),
  // Onur: personel özlük belgeleri (ON-173; DOM-FIN-113).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/staff-document-types', 'get(TYPES, a.admin)'],
        ['gövde', 'PATCH /api/v1/finance/staff-document-types', "call('PATCH', TYPES, a.admin"],
        ['liste', 'GET /api/v1/finance/staff-document-alerts', 'get(ALERTS, a.admin)'],
        ['liste', 'GET /api/v1/finance/staff-documents', 'listOf(a.admin, DOCS)'],
        ['gövde', 'POST /api/v1/finance/staff-documents', 'institutionId: b.id'],
        [
          'kayıt',
          'GET /api/v1/finance/staff-documents/:documentId/file-url',
          '/file-url`, a.admin',
        ],
        ['liste', 'GET /api/v1/finance/staff-document-staff', 'listOf(a.admin, STAFF)'],
        [
          'kayıt',
          'GET /api/v1/finance/staff-document-staff/:membershipId',
          '`${STAFF}/${bStaff}`, a.admin',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-staff-documents.test.ts',
        'başka kurumun personeli ve belgesi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: gezi katılımcı yönetimi (ON-156; DOM-FIN-112).
  ...Object.fromEntries(
    (
      [
        [
          'kayıt',
          'POST /api/v1/finance/paid-activities/:activityId/participants/bulk',
          "bulk(a.cookie, bActivity.id, ['c1'])",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/paid-activities/:activityId/consents/sync',
          'sync(a.cookie, bActivity.id)',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/paid-activities/:activityId/roster',
          'roster(a.cookie, bActivity.id)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/paid-activity-participants/:participantId/consent',
          'grant(a.cookie, bParticipant)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/paid-activity-participants/:participantId/consent-withdraw',
          'withdraw(a.cookie, bParticipant)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-paid-activity-waitlist.test.ts',
        'DOM-FIN-112: başka kurumun etkinliği ve katılımı yeni uçlarda 404, B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: bordro hesabı (ON-198; DOM-FIN-115).
  ...Object.fromEntries(
    (
      [
        ['kayıt', 'GET /api/v1/finance/payroll-calculations/:month', 'rowsOf(aPreview).length, 0'],
        [
          'kayıt',
          'GET /api/v1/finance/payroll-runs/:month',
          'get(`${RUNS}/2026-01`, a.admin), 404',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/payroll-runs/:month/calculate',
          "save(a.admin, '2026-01', null), 422",
        ],
        [
          'liste',
          'GET /api/v1/finance/payroll-tax-carryovers',
          '(await get(`${CARRYOVERS}?year=2026`, a.admin)',
        ],
        ['gövde', 'POST /api/v1/finance/payroll-tax-carryovers', 'institutionId: b.id'],
        [
          'kayıt',
          'DELETE /api/v1/finance/payroll-tax-carryovers/:carryoverId',
          '`${CARRYOVERS}/${String(bCarryover.id)}`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-payroll-runs.test.ts',
        'DOM-FIN-115: başka kurumun personeli, hesabı ve devri 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: ücret hesap pusulası (ON-201; DOM-FIN-119).
  ...Object.fromEntries(
    (
      [
        [
          'kayıt',
          'GET /api/v1/finance/payroll-runs/:month/payslips',
          "get(slipsUrl('2026-01', bStaff), a.admin), 404",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-payroll-payslips.test.ts',
        'DOM-FIN-119: başka kurumun hesabı ve personeli 404, B değişmez; gövde/sorgudaki institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: İK raporları (ON-192; DOM-FIN-117).
  ...Object.fromEntries(
    ([['liste', 'GET /api/v1/finance/hr-reports', 'get(PERIOD, a.admin)']] as const).map(
      ([kind, key, marker]) => [
        key,
        proof(kind)(
          'finance-hr-reports.test.ts',
          'başka kurumun personeli ve kaydı raporda yok',
          marker,
        ),
      ],
    ),
  ),
  // Onur: ek ders çizelgesi onayı (ON-196; DOM-FIN-120).
  ...Object.fromEntries(
    (
      [
        ['kayıt', 'GET /api/v1/finance/lesson-hour-sheets/:month', 'ok(await sheetOf(a.admin))'],
        [
          'kayıt',
          'POST /api/v1/finance/lesson-hour-sheets/:month/submit',
          'ok(await submit(a.admin))',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/lesson-hour-sheets/:month/confirmations',
          'confirm(a.admin, b.selin)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/lesson-hour-sheets/:month/approve',
          'approve(a.admin, ready.entriesHash)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/lesson-hour-sheets/:month/reopen',
          "reopen(a.admin, 'Kurum A yeniden açtı')",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-lesson-hour-approvals.test.ts',
        'başka kurumun çizelgesi ve personeli görünmez, işlenmez ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: izin talebi ve onayı (ON-182; DOM-FIN-116).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/leave-requests', 'listOf(a.admin)'],
        [
          'kayıt',
          'GET /api/v1/finance/leave-requests/preview',
          '`${REQUESTS}/preview?membershipId=${bStaff}',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/leave-requests/:requestId',
          '`${REQUESTS}/${String(bRequest.id)}`',
        ],
        ['gövde', 'POST /api/v1/finance/leave-requests', 'institutionId: b.id'],
        [
          'kayıt',
          'POST /api/v1/finance/leave-requests/:requestId/approve',
          'approveReq(a.admin, bRequest)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/leave-requests/:requestId/reject',
          'rejectReq(a.admin, bRequest)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/leave-requests/:requestId/cancel',
          'cancelReq(a.admin, bRequest)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/leave-requests/:requestId/assign-substitutes',
          'substitutes(a.admin, bRequest',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-leave-requests.test.ts',
        'DOM-FIN-116: başka kurumun talebi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: işten ayrılış süreci (ON-180; DOM-FIN-118).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/staff-separations', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/staff-separations', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/staff-separations/:separationId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/staff-separations/:separationId',
          "call('PATCH', bUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/staff-separations/:separationId/mark-step',
          '`${bUrl}/mark-step`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/staff-separations/:separationId/complete',
          '`${bUrl}/complete`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/staff-separations/:separationId/cancel',
          '`${bUrl}/cancel`',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/staff-separations/:separationId/document',
          '`${bUrl}/document`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-staff-separations.test.ts',
        'başka kurumun personeli ve dosyası 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: özlük verisi saklama ve imha (ON-176; DOM-FIN-122).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/staff-retention-policies', 'get(POLICY, a.admin)'],
        [
          'gövde',
          'PATCH /api/v1/finance/staff-retention-policies',
          "call('PATCH', POLICY, a.admin",
        ],
        ['liste', 'GET /api/v1/finance/staff-retention-candidates', 'listOf(a.admin, CANDIDATES)'],
        ['liste', 'GET /api/v1/finance/staff-data-destructions', 'listOf(a.admin, DESTRUCTIONS)'],
        ['gövde', 'POST /api/v1/finance/staff-data-destructions', 'institutionId: b.id'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)('finance-staff-retention.test.ts', 'başka kurum 404 ve B değişmez', marker),
    ]),
  ),
  // Onur: iş teklifi ve işe başlama listesi (ON-179; DOM-FIN-121).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/staff-onboarding-settings', 'get(SETTINGS, a.admin)'],
        [
          'gövde',
          'PATCH /api/v1/finance/staff-onboarding-settings',
          "call('PATCH', SETTINGS, a.admin",
        ],
        ['liste', 'GET /api/v1/finance/staff-onboarding-staff', 'get(STAFF, a.admin)'],
        ['liste', 'GET /api/v1/finance/job-offers', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/job-offers', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/job-offers/:offerId', 'get(bUrl, a.admin)'],
        ['kayıt', 'GET /api/v1/finance/job-offers/:offerId/letter', '/letter`, a.admin'],
        ['kayıt', 'PATCH /api/v1/finance/job-offers/:offerId', "call('PATCH', bUrl, a.admin"],
        ['kayıt', 'POST /api/v1/finance/job-offers/:offerId/send', 'act(a.admin, bOffer, verb'],
        ['kayıt', 'POST /api/v1/finance/job-offers/:offerId/accept', 'act(a.admin, bOffer, verb'],
        ['kayıt', 'POST /api/v1/finance/job-offers/:offerId/reject', 'act(a.admin, bOffer, verb'],
        ['kayıt', 'POST /api/v1/finance/job-offers/:offerId/withdraw', 'act(a.admin, bOffer, verb'],
        [
          'kayıt',
          'POST /api/v1/finance/job-offers/:offerId/link-account',
          'act(a.admin, bOffer, verb',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/job-offers/:offerId/steps/:stepId',
          'stepUrl(bOffer, bStep),',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/job-offers/:offerId/steps/:stepId/complete',
          'complete(a.admin, bOffer, bStep)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/job-offers/:offerId/steps/:stepId/reopen',
          "stepUrl(bOffer, bStep, 'reopen')",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-staff-onboarding.test.ts',
        'DOM-FIN-121: başka kurumun teklifi ve personeli 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: ayrılıştan kalan gezi katılımları (ON-347; DOM-FIN-112, K-419).
  ...Object.fromEntries(
    (
      [
        [
          'liste',
          'GET /api/v1/finance/paid-activity-participants/withdrawn-leftovers',
          "call('GET', LEFTOVERS, t.cookie)",
        ],
        [
          'gövde',
          'POST /api/v1/finance/paid-activity-participants/withdrawn-leftovers/cancel',
          'participantIds: [legacyConsent, otherLegacy]',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'withdrawal-waitlist.test.ts',
        'K-419: ayrılıştan kalan katılımlar listelenir ve yönetici onayıyla parasız iptal edilir; başka kurum 404',
        marker,
      ),
    ]),
  ),
  // Onur: izin takvimi ve çakışma uyarısı (ON-183; DOM-FIN-123).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/leave-calendar', 'get(NOVEMBER, a.admin)'],
        ['liste', 'GET /api/v1/finance/leave-calendar-settings', 'get(SETTINGS, a.admin)'],
        ['gövde', 'PATCH /api/v1/finance/leave-calendar-settings', 'institutionId: b.id'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-leave-calendar.test.ts',
        'başka kurumun izinleri takvimde yok; ayar kurumlar arası ayrı',
        marker,
      ),
    ]),
  ),
  // Onur: performans dönemi (ON-211; DOM-FIN-124, K-429).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/performance-periods', "call('GET', PERIODS, a.admin)"],
        ['gövde', 'POST /api/v1/finance/performance-periods', 'institutionId: b.id'],
        [
          'kayıt',
          'POST /api/v1/finance/performance-periods/:periodId/status',
          'advance(a.admin, pb',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/performance-periods/:periodId/reviews',
          'reviewsOf(a.admin, pb)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/performance-periods/:periodId/reviews',
          'addReview(a.admin, pb',
        ],
        ['kayıt', 'PATCH /api/v1/finance/performance-reviews/:reviewId', 'patch(a.admin, review'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-performance.test.ts',
        'DOM-FIN-124: başka kurumun dönemi ve kaydı 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: politika belgesi okundu onayı (ON-190; DOM-FIN-127).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/policy-documents', 'list(DOCS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/policy-documents', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/policy-documents/:documentId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'GET /api/v1/finance/policy-documents/:documentId/staff',
          'get(`${bUrl}/staff`, a.admin)',
        ],
        ['liste', 'GET /api/v1/finance/policy-acknowledgement-staff', 'list(STAFF, a.admin)'],
        ['gövde', 'POST /api/v1/finance/policy-acknowledgements', 'institutionId: b.id'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-policy-acknowledgements.test.ts',
        'DOM-FIN-127: başka kurumun belgesi ve personeli 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: kadro planı ve açık pozisyon (ON-188; DOM-FIN-126).
  ...Object.fromEntries(
    (
      [
        ['kayıt', 'GET /api/v1/finance/staffing-plans/:academicYear', "call('GET', PLAN, a.admin)"],
        [
          'kayıt',
          'PATCH /api/v1/finance/staffing-plans/:academicYear',
          'institutionId: b.id }, 1)',
        ],
        ['gövde', 'POST /api/v1/finance/staffing-positions', 'hours: 5, institutionId: b.id'],
        [
          'kayıt',
          'PATCH /api/v1/finance/staffing-positions/:positionId',
          'patchPosition(a.admin, position.id',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-staffing-plans.test.ts',
        'başka kurumun pozisyonu ve teklifi 404/422, B değişmez; gövdedeki kurum etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: mesleki gelişim kataloğu (ON-214; DOM-FIN-125).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/professional-development', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/professional-development', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/professional-development/:programId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/professional-development/:programId',
          "call('PATCH', bUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/professional-development/:programId/status',
          'setStatus(a.admin, bProgram',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/professional-development/:programId/enrollments',
          '/enrollments`, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/professional-development/:programId/enrollments',
          'enroll(a.admin, bProgram',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/professional-development/:programId/enrollments/:enrollmentId',
          'mark(a.admin, bProgram, bEnrollment',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-professional-development.test.ts',
        'DOM-FIN-125: başka kurumun eğitimi ve personeli 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: öz değerlendirme (ON-210; DOM-FIN-131, K-450).
  ...Object.fromEntries(
    (
      [
        [
          'kayıt',
          'GET /api/v1/finance/performance-periods/:periodId/self-evaluation',
          'overview(a.admin, pb)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/performance-periods/:periodId/self-evaluation-template',
          'createTemplate(a.admin, pb)',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/self-evaluation-templates/:templateId',
          'editTemplate(a.admin, template)',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/performance-periods/:periodId/self-evaluations',
          'tracking(a.admin, pb)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/performance-periods/:periodId/self-evaluations',
          'respond(a.admin, pb, selin)',
        ],
        ['kayıt', 'GET /api/v1/finance/self-evaluations/:responseId', 'read(a.admin, response)'],
        ['kayıt', 'PATCH /api/v1/finance/self-evaluations/:responseId', 'patch(a.admin, response'],
        [
          'kayıt',
          'POST /api/v1/finance/self-evaluations/:responseId/submit',
          'submit(a.admin, response)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/self-evaluations/:responseId/reopen',
          'reopen(a.admin, response',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-self-evaluations.test.ts',
        'DOM-FIN-131: başka kurumun dönemi, şablonu ve yanıtı 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: organizasyon şeması (ON-187; DOM-FIN-129).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/org-chart', 'chartOf(a.admin)'],
        ['liste', 'GET /api/v1/finance/org-vacancies', 'listOf(a.admin, VACANCIES)'],
        ['gövde', 'POST /api/v1/finance/org-units', 'institutionId: b.id'],
        ['kayıt', 'PATCH /api/v1/finance/org-units/:unitId', 'patchUnit(a.admin, bUnit'],
        ['gövde', 'POST /api/v1/finance/org-positions', 'unitId: bUnit.id'],
        [
          'kayıt',
          'PATCH /api/v1/finance/org-positions/:positionId',
          'patchPosition(a.admin, bPosition',
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/org-positions/:positionId',
          'removePosition(a.admin, bPosition)',
        ],
        ['liste', 'GET /api/v1/finance/org-assignments', 'listOf(a.admin, ASSIGNMENTS)'],
        ['gövde', 'POST /api/v1/finance/org-assignments', 'positionId: bPosition.id'],
        [
          'kayıt',
          'PATCH /api/v1/finance/org-assignments/:assignmentId',
          'patchAssignment(a.admin, bAssignment',
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/org-assignments/:assignmentId',
          'removeAssignment(a.admin, bAssignment)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-org-chart.test.ts',
        'DOM-FIN-129: başka kurumun birimi, pozisyonu, ataması ve personeli 404/422, B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: iş ilanı ve başvuru havuzu (ON-177; DOM-FIN-128).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/job-postings', 'get(POSTINGS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/job-postings', '...postingBody, institutionId: b.id'],
        [
          'kayıt',
          'GET /api/v1/finance/job-postings/:postingId',
          'get(`${POSTINGS}/${String(bPosting.id)}`, a.admin)',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/job-postings/:postingId',
          "versioned('PATCH', bPostingUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/job-postings/:postingId/status',
          '`${bPostingUrl}/status`, a.admin',
        ],
        ['liste', 'GET /api/v1/finance/job-applications', 'get(APPLICATIONS, a.admin)'],
        [
          'gövde',
          'POST /api/v1/finance/job-applications',
          'post(APPLICATIONS, a.admin, applicationBody(bPosting.id))',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/job-applications/:applicationId',
          'get(`${APPLICATIONS}/${String(bApplication.id)}`, a.admin)',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/job-applications/:applicationId',
          "versioned('PATCH', bApplicationUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/job-applications/:applicationId/stage',
          '`${bApplicationUrl}/stage`',
        ],
        ['liste', 'GET /api/v1/finance/job-application-retention', 'get(RETENTION, a.admin)'],
        [
          'gövde',
          'POST /api/v1/finance/job-application-anonymizations',
          'applicationIds: [bApplication.id]',
        ],
        ['liste', 'GET /api/v1/finance/job-application-settings', 'get(SETTINGS, a.admin)'],
        [
          'gövde',
          'PATCH /api/v1/finance/job-application-settings',
          'retentionMonths: 6, institutionId: b.id',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-job-postings.test.ts',
        'DOM-FIN-128: başka kurumun ilanı ve başvurusu 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: zümre toplantısı tutanağı (ON-217; DOM-FIN-132).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/department-meetings', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/department-meetings', 'institutionId: b.id'],
        ['liste', 'GET /api/v1/finance/department-meeting-subjects', 'get(SUBJECTS_URL, a.admin)'],
        [
          'liste',
          'GET /api/v1/finance/department-meeting-decisions',
          'listOf(a.admin, `${DECISIONS_URL}?overdue=true`)',
        ],
        ['kayıt', 'GET /api/v1/finance/department-meetings/:meetingId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/department-meetings/:meetingId',
          'patch(a.admin, bMeeting',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/department-meetings/:meetingId/finalize',
          'finalize(a.admin, bMeeting',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/department-meetings/:meetingId/decisions',
          'decide(a.admin, bMeeting',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/department-meetings/:meetingId/decisions/:decisionId',
          'editDecision(a.admin, bMeeting, bDecision',
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/department-meetings/:meetingId/decisions/:decisionId',
          'removeDecision(a.admin, bMeeting, bDecision',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/department-meetings/:meetingId/decisions/:decisionId/follow-up',
          'followUp(a.admin, bMeeting, bDecision',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-department-meetings.test.ts',
        'DOM-FIN-132: başka kurumun tutanağı ve personeli 404/422, B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: ders gözlem formu (ON-206; DOM-FIN-130, K-447).
  ...Object.fromEntries(
    (
      [
        [
          'liste',
          'GET /api/v1/finance/lesson-observation-templates',
          "call('GET', TEMPLATES, a.admin)",
        ],
        ['gövde', 'POST /api/v1/finance/lesson-observation-templates', 'institutionId: b.id'],
        [
          'kayıt',
          'PATCH /api/v1/finance/lesson-observation-templates/:templateId',
          "call('PATCH', formUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/lesson-observation-templates/:templateId/versions',
          '`${formUrl}/versions`, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/lesson-observation-templates/:templateId/archive',
          '`${formUrl}/archive`, a.admin',
        ],
        ['liste', 'GET /api/v1/finance/lesson-observations', "call('GET', OBSERVATIONS, a.admin)"],
        ['gövde', 'POST /api/v1/finance/lesson-observations', 'institutionId: b.id,'],
        [
          'kayıt',
          'GET /api/v1/finance/lesson-observations/:observationId',
          '`${OBSERVATIONS}/${String(rowB.id)}`, a.admin',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/lesson-observations/:observationId',
          'patch(a.admin, rowB',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/lesson-observations/:observationId/complete',
          'complete(a.admin, rowB)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/lesson-observations/:observationId/archive',
          'archive(a.admin, rowB)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-lesson-observations.test.ts',
        'DOM-FIN-130: başka kurumun formu ve gözlemi 404 ve değişmez; gövdedeki institutionId 400',
        marker,
      ),
    ]),
  ),
  // Onur: gözlem sonrası görüşme ve gelişim hedefi (ON-209; DOM-FIN-133, K-456).
  ...Object.fromEntries(
    (
      [
        [
          'kayıt',
          'GET /api/v1/finance/lesson-observations/:observationId/debrief',
          "call('GET', debriefUrl(setB.observation), a.admin)",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/lesson-observations/:observationId/debrief',
          'openDebrief(a.admin, setB.observation',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/observation-debriefs/:debriefId',
          'patchDebrief(a.admin, debriefB',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/observation-debriefs/:debriefId/finalize',
          'finalize(a.admin, debriefB)',
        ],
        ['liste', 'GET /api/v1/finance/development-goals', "call('GET', GOALS, a.admin)"],
        ['gövde', 'POST /api/v1/finance/development-goals', 'institutionId: b.id,'],
        [
          'kayıt',
          'GET /api/v1/finance/development-goals/:goalId',
          '`${GOALS}/${String(goalB.id)}`, a.admin',
        ],
        ['kayıt', 'PATCH /api/v1/finance/development-goals/:goalId', 'patchGoal(a.admin, goalB'],
        [
          'kayıt',
          'POST /api/v1/finance/development-goals/:goalId/follow-ups',
          'followUp(a.admin, goalB',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-observation-debriefs.test.ts',
        'DOM-FIN-133: başka kurumun görüşmesi ve hedefi 404 ve değişmez; gövdedeki institutionId 400',
        marker,
      ),
    ]),
  ),
  // Onur: çok kaynaklı geri bildirim (ON-212; DOM-FIN-134, K-459).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/staff-feedback-settings', 'settings(a.admin)'],
        [
          'gövde',
          'PATCH /api/v1/finance/staff-feedback-settings',
          'peerAnonymityThreshold: 4, institutionId: b.id',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/performance-periods/:periodId/staff-feedback',
          'overview(a.admin, pb)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/performance-periods/:periodId/staff-feedback-template',
          'createTemplate(a.admin, pb)',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/staff-feedback-templates/:templateId',
          'editTemplate(a.admin, template)',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/performance-periods/:periodId/staff-feedback-subjects',
          'subjects(a.admin, pb)',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/performance-periods/:periodId/staff-feedback-assignments',
          'assignments(a.admin, pb)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/performance-periods/:periodId/staff-feedback-assignments',
          'assign(a.admin, pb, selin',
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/staff-feedback-assignments/:assignmentId',
          'remove(a.admin, assignment)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/staff-feedback-assignments/:assignmentId/response',
          'respond(a.admin, assignment',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/staff-feedback-assignments/:assignmentId/withdraw',
          'withdraw(a.admin, done',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/performance-periods/:periodId/staff-feedback-results/:membershipId',
          'result(a.admin, pb, selin)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-staff-feedback.test.ts',
        'DOM-FIN-134: başka kurumun dönemi, şablonu, ataması ve sonucu 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: performans raporu (ON-220; DOM-FIN-137, K-468).
  ...Object.fromEntries(
    (
      [
        [
          'kayıt',
          'GET /api/v1/finance/performance-periods/:periodId/report-summary',
          'summary(b.admin, p)',
        ],
        ['kayıt', 'GET /api/v1/finance/performance-periods/:periodId/reports', 'rows(b.admin, p)'],
        [
          'kayıt',
          'GET /api/v1/finance/performance-reviews/:reviewId/report',
          'report(b.admin, review)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/performance-reviews/:reviewId/report/finalize',
          'finalize(b.admin, review)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/performance-reviews/:reviewId/report/acknowledge',
          'acknowledge(b.admin, review)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-performance-reports.test.ts',
        'DOM-FIN-137: başka kurumun dönemi ve raporu 404; A değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: yeni öğretmen mentorluğu (ON-219; DOM-FIN-136, K-465).
  ...Object.fromEntries(
    (
      [
        [
          'liste',
          'GET /api/v1/finance/teacher-mentorship-settings',
          "call('GET', SETTINGS, a.admin)",
        ],
        [
          'gövde',
          'PATCH /api/v1/finance/teacher-mentorship-settings',
          "call('PATCH', SETTINGS, a.admin, {",
        ],
        [
          'liste',
          'GET /api/v1/finance/teacher-mentorship-summary',
          "call('GET', SUMMARY, a.admin)",
        ],
        [
          'liste',
          'GET /api/v1/finance/teacher-mentorship-onboarding-options',
          "call('GET', ONBOARDING, a.admin)",
        ],
        ['liste', 'GET /api/v1/finance/teacher-mentorships', "call('GET', MENTORSHIPS, a.admin)"],
        ['gövde', 'POST /api/v1/finance/teacher-mentorships', 'institutionId: b.id,'],
        [
          'kayıt',
          'GET /api/v1/finance/teacher-mentorships/:mentorshipId',
          '`${MENTORSHIPS}/${String(rowB.id)}`, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/teacher-mentorships/:mentorshipId/meetings',
          'meet(a.admin, withMeeting)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/teacher-mentorships/:mentorshipId/meetings/:meetingId/archive',
          'archiveB, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/teacher-mentorships/:mentorshipId/checklist/:itemId/complete',
          'tick(a.admin, withMeeting, itemB)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/teacher-mentorships/:mentorshipId/checklist/:itemId/reopen',
          "tick(a.admin, withMeeting, itemB, 'reopen')",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/teacher-mentorships/:mentorshipId/complete',
          'finish(a.admin, withMeeting)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/teacher-mentorships/:mentorshipId/end',
          'endEarly(a.admin, withMeeting',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-teacher-mentorships.test.ts',
        'DOM-FIN-136: başka kurumun eşleşmesi, görüşmesi ve maddesi 404 ve değişmez; gövdedeki institutionId 400',
        marker,
      ),
    ]),
  ),
  // Onur: kurul ve zümre toplantısı gündem şablonu (ON-218; DOM-FIN-135).
  ...Object.fromEntries(
    (
      [
        [
          'liste',
          'GET /api/v1/finance/department-meeting-templates',
          'listOf(a.admin, TEMPLATES_URL)',
        ],
        ['gövde', 'POST /api/v1/finance/department-meeting-templates', 'institutionId: b.id'],
        [
          'kayıt',
          'PATCH /api/v1/finance/department-meeting-templates/:templateId',
          'editTemplate(a.admin, bTemplate',
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/department-meeting-templates/:templateId',
          'archiveTemplate(a.admin, bTemplate',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-department-meetings.test.ts',
        'DOM-FIN-135: başka kurumun şablonu ve sınıfı 404/422, B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: personel özlük kartı (ON-172; DOM-FIN-140).
  ...Object.fromEntries(
    (
      [
        [
          'liste',
          'GET /api/v1/finance/personnel-files',
          'listA.data.some((row) => row.membershipId === bStaff)',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/personnel-files/:membershipId',
          'get(`${FILES}/${bStaff}`, a.admin)',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/personnel-files/:membershipId/national-id',
          'get(`${FILES}/${bStaff}/national-id`, a.admin)',
        ],
        ['gövde', 'POST /api/v1/finance/personnel-files', 'institutionId: b.id'],
        [
          'kayıt',
          'PATCH /api/v1/finance/personnel-files/:membershipId',
          'patchCard(a.admin, bStaff',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-personnel-files.test.ts',
        'başka kurumun personeli ve kartı 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: ders gözlem planı (ON-207; DOM-FIN-139, K-474).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/observation-plans', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/observation-plans', 'institutionId: b.id,'],
        [
          'kayıt',
          'GET /api/v1/finance/observation-plans/:planId',
          '`${PLANS}/${String(rowB.id)}`, a.admin',
        ],
        ['kayıt', 'PATCH /api/v1/finance/observation-plans/:planId', 'patch(a.admin, rowB'],
        [
          'kayıt',
          'POST /api/v1/finance/observation-plans/:planId/postpone',
          "command(a.admin, rowB, 'postpone'",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/observation-plans/:planId/cancel',
          "command(a.admin, rowB, 'cancel'",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/observation-plans/:planId/start',
          "command(a.admin, rowB, 'start')",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-observation-plans.test.ts',
        'DOM-FIN-139: başka kurumun planı 404 ve değişmez; gövdedeki institutionId 400; liste ayrık',
        marker,
      ),
    ]),
  ),
  // Onur: ziyaretçi kaydı (ON-166; DOM-FIN-141).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/visitors', 'get(VISITORS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/visitors', 'visitorBody({ institutionId: b.id })'],
        ['kayıt', 'GET /api/v1/finance/visitors/:visitorId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'POST /api/v1/finance/visitors/:visitorId/check-out',
          '`${bUrl}/check-out`, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/visitors/:visitorId/badge-release',
          '`${bUrl}/badge-release`',
        ],
        ['liste', 'GET /api/v1/finance/visitor-summary', 'get(SUMMARY, a.admin)'],
        ['liste', 'GET /api/v1/finance/visitor-hosts', 'get(`${HOSTS}?pageSize=100`, a.admin)'],
        ['liste', 'GET /api/v1/finance/visitor-retention', 'get(RETENTION, a.admin)'],
        ['gövde', 'POST /api/v1/finance/visitor-anonymizations', 'visitorIds: [bVisitor.id]'],
        ['liste', 'GET /api/v1/finance/visitor-settings', 'get(SETTINGS, a.admin)'],
        [
          'gövde',
          'PATCH /api/v1/finance/visitor-settings',
          'retentionDays: 10, institutionId: b.id',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-visitors.test.ts',
        'DOM-FIN-141: başka kurumun ziyaret kaydı 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: aday mülakatı ve değerlendirme (ON-178; DOM-FIN-138).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/interview-templates', '(await get(TEMPLATES, a.admin))'],
        ['gövde', 'POST /api/v1/finance/interview-templates', '...TEMPLATE, institutionId: b.id'],
        [
          'kayıt',
          'PATCH /api/v1/finance/interview-templates/:templateId',
          "versioned('PATCH', bFormUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/interview-templates/:templateId/versions',
          '`${bFormUrl}/versions`, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/interview-templates/:templateId/archive',
          '`${bFormUrl}/archive`, a.admin',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/job-applications/:applicationId/interviews',
          'get(interviewsUrl(bApp), a.admin)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/job-applications/:applicationId/interviews',
          'plan(a.admin, bApp, {',
        ],
        ['liste', 'GET /api/v1/finance/candidate-interviews/assigned', 'get(ASSIGNED, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/candidate-interviews/:interviewId',
          "versioned('PATCH', bInterviewUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/candidate-interviews/:interviewId/complete',
          'complete(a.admin, bInterview)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/candidate-interviews/:interviewId/cancel',
          '`${bInterviewUrl}/cancel`, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/candidate-interviews/:interviewId/evaluation',
          'evaluate(a.admin, bInterview, {',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-candidate-interviews.test.ts',
        'DOM-FIN-138: başka kurumun başvurusu, mülakatı ve formu 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: personel memnuniyet anketi (ON-191; DOM-FIN-143, K-484…K-486).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/staff-surveys', 'list(a.admin)'],
        ['gövde', 'POST /api/v1/finance/staff-surveys', 'institutionId: b.id'],
        ['liste', 'GET /api/v1/finance/staff-surveys/assigned', 'assigned(aTeacher.cookie)'],
        ['kayıt', 'GET /api/v1/finance/staff-surveys/:surveyId', 'detail(a.admin, bDraft)'],
        ['kayıt', 'PATCH /api/v1/finance/staff-surveys/:surveyId', 'patch(a.admin, bDraft'],
        ['kayıt', 'DELETE /api/v1/finance/staff-surveys/:surveyId', 'archive(a.admin, bDraft)'],
        [
          'kayıt',
          'POST /api/v1/finance/staff-surveys/:surveyId/publish',
          'publish(a.admin, bDraft)',
        ],
        ['kayıt', 'POST /api/v1/finance/staff-surveys/:surveyId/copy', 'copy(a.admin, bLive)'],
        ['kayıt', 'GET /api/v1/finance/staff-surveys/:surveyId/results', 'results(a.admin, bLive)'],
        [
          'kayıt',
          'POST /api/v1/finance/staff-surveys/:surveyId/responses',
          'respond(aTeacher.cookie, bLive',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-staff-surveys.test.ts',
        'DOM-FIN-143: başka kurumun anketi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: kaza ve yaralanma tutanağı (ON-162; DOM-FIN-146).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/incidents', 'get(INCIDENTS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/incidents', 'reportBody(a, { institutionId: b.id })'],
        ['kayıt', 'GET /api/v1/finance/incidents/:incidentId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/incidents/:incidentId',
          "versioned('PATCH', bUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/incidents/:incidentId/finalize',
          'finalize(bReport.id, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/incidents/:incidentId/notifications',
          'notify(a, bReport.id)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/incidents/:incidentId/addenda',
          '`${bUrl}/addenda`, a.admin',
        ],
        ['liste', 'GET /api/v1/finance/incident-staff', 'get(`${STAFF}?pageSize=100`, a.admin)'],
        ['liste', 'GET /api/v1/finance/incident-summaries', 'get(SUMMARIES, a.mother)'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-incidents.test.ts',
        'DOM-FIN-146: başka kurumun tutanağı 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: kayıp eşya (ON-171; DOM-FIN-145).
  ...Object.fromEntries(
    (
      [
        [
          'liste',
          'GET /api/v1/finance/lost-items',
          '(await get(ITEMS, a.admin)).json().meta.total',
        ],
        ['gövde', 'POST /api/v1/finance/lost-items', 'itemBody({ institutionId: b.id })'],
        ['kayıt', 'GET /api/v1/finance/lost-items/:itemId', 'get(bUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/lost-items/:itemId', "'PATCH', bUrl, a.admin"],
        ['kayıt', 'POST /api/v1/finance/lost-items/:itemId/photos', '`${bUrl}/photos`, a.admin'],
        [
          'kayıt',
          'DELETE /api/v1/finance/lost-items/:itemId/photos/:fileId',
          '`${bUrl}/photos/${randomUUID()}`',
        ],
        ['kayıt', 'POST /api/v1/finance/lost-items/:itemId/handover', '`${bUrl}/handover`'],
        ['liste', 'GET /api/v1/finance/lost-item-summary', 'get(SUMMARY, a.admin)'],
        [
          'liste',
          'GET /api/v1/finance/lost-item-finders',
          'get(`${FINDERS}?pageSize=100`, a.admin)',
        ],
        [
          'liste',
          'GET /api/v1/finance/lost-item-recipients',
          'get(`${RECIPIENTS}?studentId=s1`, a.admin)',
        ],
        [
          'liste',
          'GET /api/v1/finance/lost-item-reports',
          '(await get(REPORTS, a.admin)).json().meta.total',
        ],
        ['gövde', 'POST /api/v1/finance/lost-item-reports', 'post(REPORTS, aParent, reportBody)'],
        [
          'kayıt',
          'POST /api/v1/finance/lost-item-reports/:reportId/match',
          '`${reportUrl(bReport.id)}/match`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/lost-item-reports/:reportId/unmatch',
          '`${reportUrl(bReport.id)}/unmatch`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/lost-item-reports/:reportId/close',
          '`${reportUrl(bReport.id)}/close`',
        ],
        ['liste', 'GET /api/v1/finance/lost-item-gallery', 'get(GALLERY, aParent)'],
        ['liste', 'GET /api/v1/finance/lost-item-retention', 'get(RETENTION, a.admin)'],
        ['gövde', 'POST /api/v1/finance/lost-item-disposals', 'itemIds: [bItem.id]'],
        ['liste', 'GET /api/v1/finance/lost-item-settings', 'get(SETTINGS, a.admin)'],
        [
          'gövde',
          'PATCH /api/v1/finance/lost-item-settings',
          'retentionDays: 10, institutionId: b.id',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-lost-items.test.ts',
        'DOM-FIN-145: başka kurumun eşyası ve bildirimi 404, B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: mesleki gelişim saati, belge ve sertifika (ON-215; DOM-FIN-144).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/professional-development-hours', 'listOf(a.admin, HOURS)'],
        [
          'kayıt',
          'GET /api/v1/finance/professional-development-targets/:academicYear',
          '`${TARGETS}/2026`, a.admin',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/professional-development-targets/:academicYear',
          'institutionId: b.id',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/professional-development/:programId/enrollments/:enrollmentId/document',
          'attach(a, bProgram, bEnrollment',
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/professional-development/:programId/enrollments/:enrollmentId/document',
          '`${enrollmentUrl(bProgram, bEnrollment)}/document`',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/professional-development/:programId/enrollments/:enrollmentId/document/url',
          '/document/url`, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/professional-development/:programId/enrollments/:enrollmentId/certificate',
          'link(a.admin, bProgram, bEnrollment',
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/professional-development/:programId/enrollments/:enrollmentId/certificate',
          '`${enrollmentUrl(bProgram, bEnrollment)}/certificate`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-professional-development-hours.test.ts',
        'DOM-FIN-144: başka kurumun katılımı, belgesi ve hedefi 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: servis güzergâhı (ON-098; DOM-FIN-142).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/transport/my', 'get(MY, aParent)'],
        ['liste', 'GET /api/v1/finance/transport/vehicles', 'get(VEHICLES, a.admin)'],
        ['gövde', 'POST /api/v1/finance/transport/vehicles', 'institutionId: b.id'],
        ['kayıt', 'PATCH /api/v1/finance/transport/vehicles/:vehicleId', 'patch(bVehicleUrl'],
        ['kayıt', 'DELETE /api/v1/finance/transport/vehicles/:vehicleId', 'remove(bVehicleUrl'],
        ['liste', 'GET /api/v1/finance/transport/routes', 'get(ROUTES, a.admin)'],
        ['gövde', 'POST /api/v1/finance/transport/routes', 'routeBody(bSetup.vehicle.id)'],
        ['kayıt', 'GET /api/v1/finance/transport/routes/:routeId', 'get(bRouteUrl'],
        ['kayıt', 'PATCH /api/v1/finance/transport/routes/:routeId', 'patch(bRouteUrl'],
        ['kayıt', 'DELETE /api/v1/finance/transport/routes/:routeId', 'remove(bRouteUrl'],
        [
          'kayıt',
          'POST /api/v1/finance/transport/routes/:routeId/assignments',
          'assignUrl(bSetup.route.id)',
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/transport/assignments/:assignmentId',
          '`${BASE}/assignments/${String(bAssignment.id)}`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-transport.test.ts',
        'başka kurumun aracı, güzergâhı ve ataması 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: kulüp ve kulüp yoklaması (ON-098; DOM-FIN-142).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/clubs/my', 'get(MY, aParent)'],
        ['liste', 'GET /api/v1/finance/clubs', 'get(BASE, a.admin)'],
        ['gövde', 'POST /api/v1/finance/clubs', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/clubs/:clubId', 'get(bUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/clubs/:clubId', 'patch(bUrl'],
        ['kayıt', 'DELETE /api/v1/finance/clubs/:clubId', 'remove(bUrl'],
        ['kayıt', 'POST /api/v1/finance/clubs/:clubId/members', '`${bUrl}/members`'],
        [
          'kayıt',
          'DELETE /api/v1/finance/clubs/:clubId/members/:memberId',
          '`${bUrl}/members/${bMember.id}`',
        ],
        ['kayıt', 'POST /api/v1/finance/clubs/:clubId/sessions', '`${bUrl}/sessions`'],
        [
          'kayıt',
          'GET /api/v1/finance/clubs/:clubId/sessions/:sessionId',
          '`${bUrl}/sessions/${String(bSession.id)}`',
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/clubs/:clubId/sessions/:sessionId',
          '`${bUrl}/sessions/${String(bSession.id)}`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-clubs.test.ts',
        'başka kurumun kulübü, üyeliği ve oturumu 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: servis listesi (ON-148; DOM-FIN-148).
  'GET /api/v1/finance/transport/routes/:routeId/roster': kayit(
    'finance-transport-roster.test.ts',
    'DOM-FIN-148: başka kurumun ya da arşivli güzergâhı 404',
    'get(rosterUrl(route.id), a.admin)',
  ),
  // Onur: servis seferi ve biniş-iniş (ON-145; DOM-FIN-149).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/transport/trips/my', 'get(MY, aParent)'],
        ['liste', 'GET /api/v1/finance/transport/trips', 'get(TRIPS, a.admin)'],
        ['kayıt', 'GET /api/v1/finance/transport/trips/:tripId', 'get(bTripUrl, a.admin)'],
        [
          'kayıt',
          'POST /api/v1/finance/transport/routes/:routeId/trips',
          'startUrl(bSetup.route.id), a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/transport/trips/:tripId/marks',
          'markUrl(bTrip.id), a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/transport/trips/:tripId/close',
          'closeTripAs(a.admin, bTrip.id',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-transport-trips.test.ts',
        'DOM-FIN-149: başka kurumun seferi ve işareti 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: servis aracı ve personeli belgeleri (ON-147; DOM-FIN-147).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/transport/documents', 'listOf(a.admin)'],
        ['gövde', 'POST /api/v1/finance/transport/documents', 'institutionId: b.id'],
        [
          'kayıt',
          'GET /api/v1/finance/transport/documents/:documentId/file-url',
          '`${DOCS}/${String(bDoc.id)}/file-url`',
        ],
        ['liste', 'GET /api/v1/finance/transport/document-alerts', 'get(ALERTS, a.admin)'],
        ['liste', 'GET /api/v1/finance/transport/document-settings', 'get(SETTINGS, a.admin)'],
        [
          'gövde',
          'PATCH /api/v1/finance/transport/document-settings',
          'warningDays: 20, institutionId: b.id',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-transport-documents.test.ts',
        'DOM-FIN-147: başka kurumun aracı ve belgesi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: kulüp tercihi ve kontenjanlı dağıtım (ON-169; DOM-FIN-150).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/club-selection/my', 'get(MY, aParent)'],
        ['liste', 'GET /api/v1/finance/club-selection/periods', 'get(PERIODS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/club-selection/periods', 'institutionId: b.id'],
        ['kayıt', 'GET /api/v1/finance/club-selection/periods/:periodId', 'get(bUrl, a.admin)'],
        ['kayıt', 'PATCH /api/v1/finance/club-selection/periods/:periodId', 'patch(bUrl'],
        ['kayıt', 'DELETE /api/v1/finance/club-selection/periods/:periodId', 'remove(bUrl'],
        [
          'kayıt',
          'POST /api/v1/finance/club-selection/periods/:periodId/preferences',
          '`${bUrl}/preferences`',
        ],
        ['kayıt', 'POST /api/v1/finance/club-selection/periods/:periodId/draw', '`${bUrl}/draw`'],
        [
          'kayıt',
          'GET /api/v1/finance/club-selection/periods/:periodId/allocation',
          '`${bUrl}/allocation`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/club-selection/periods/:periodId/confirm',
          '`${bUrl}/confirm`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-club-selection.test.ts',
        'başka kurumun tercih dönemi 404 ve B değişmez',
        marker,
      ),
    ]),
  ),
  // Onur: revir ve ilaç onayı (ON-101; DOM-FIN-151).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/infirmary/visits', 'get(VISITS, a.admin)'],
        ['gövde', 'POST /api/v1/finance/infirmary/visits', 'visitBody({ institutionId: b.id })'],
        ['kayıt', 'GET /api/v1/finance/infirmary/visits/:visitId', 'get(bVisitUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/infirmary/visits/:visitId',
          "versioned('PATCH', bVisitUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/infirmary/visits/:visitId/discharge',
          'discharge(bVisit.id, a.admin',
        ],
        ['liste', 'GET /api/v1/finance/infirmary/visit-states', 'get(STATES, a.admin)'],
        ['liste', 'GET /api/v1/finance/infirmary/my-visits', 'get(MY_VISITS, a.mother)'],
        ['liste', 'GET /api/v1/finance/infirmary/medication-consents', 'get(CONSENTS, a.admin)'],
        [
          'gövde',
          'POST /api/v1/finance/infirmary/medication-consents',
          'consentBody({ institutionId: b.id })',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/infirmary/medication-consents/:consentId',
          'get(bConsentUrl, a.admin)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/infirmary/medication-consents/:consentId/approve',
          'approve(bConsent.id, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/infirmary/medication-consents/:consentId/reject',
          '`${bConsentUrl}/reject`, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/infirmary/medication-consents/:consentId/withdraw',
          '`${bConsentUrl}/withdraw`, a.mother',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/infirmary/medication-consents/:consentId/administrations',
          'administer(a, bConsent.id',
        ],
        ['liste', 'GET /api/v1/finance/infirmary/medication-schedule', 'get(SCHEDULE, a.admin)'],
        ['liste', 'GET /api/v1/finance/infirmary/staff', 'get(`${STAFF}?pageSize=100`, a.admin)'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-infirmary.test.ts',
        'DOM-FIN-151: başka kurumun ziyareti ve talebi 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: sağlık verisi erişim günlüğü (ON-164; DOM-FIN-156).
  'GET /api/v1/finance/health-access-logs': liste(
    'finance-health-access.test.ts',
    'DOM-FIN-156: başka kurumun günlüğü görünmez; başka kurumun kaydı gerekçeyle de 404 ve günlüğe düşmez',
    'get(LOGS, a.admin)',
  ),
  // Onur: gezi günü yoklaması ve acil kart (ON-157; DOM-FIN-154).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/trip-days/my', 'get(MY, a.mother)'],
        [
          'kayıt',
          'GET /api/v1/finance/trip-plans/:planId/day',
          'get(dayUrl(bSetup.planId), a.admin)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/trip-plans/:planId/day/groups',
          'groupsUrl(bSetup.planId), a.admin',
        ],
        [
          'kayıt',
          'PATCH /api/v1/finance/trip-plans/:planId/day/groups/:groupId',
          "'PATCH', groupUrl(bSetup.planId, bSetup.bus), a.admin",
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/trip-plans/:planId/day/groups/:groupId',
          "'DELETE', groupUrl(bSetup.planId, bSetup.bus), a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/trip-plans/:planId/day/assignments',
          'assignUrl(bSetup.planId), a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/trip-plans/:planId/day/groups/:groupId/checks',
          'checksUrl(bSetup.planId, bSetup.bus), a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/trip-plans/:planId/day/checks/:checkId/marks',
          'checkUrl(bSetup.planId, bCheck.id)}/marks`, a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/trip-plans/:planId/day/checks/:checkId/complete',
          'checkUrl(bSetup.planId, bCheck.id)}/complete`',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/trip-plans/:planId/day/checks/:checkId/proceed',
          'checkUrl(bSetup.planId, bCheck.id)}/proceed`',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/trip-plans/:planId/day/groups/:groupId/emergency-card',
          'card(cardUrl(bSetup.planId, bSetup.bus), a.admin)',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-trip-day.test.ts',
        'DOM-FIN-154: başka kurumun planı, grubu ve turu 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: ilaç çizelgesi, atlama ve düzeltme (ON-161; DOM-FIN-152).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/infirmary/medication-chart', 'chartOf(a.admin)'],
        [
          'kayıt',
          'POST /api/v1/finance/infirmary/medication-consents/:consentId/skips',
          'skip(a, bConsent.id, {}, a.admin)',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/infirmary/medication-administrations/:administrationId/corrections',
          'administrationUrl(bAdministration?.id), a.admin',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/infirmary/medication-skips/:skipId/corrections',
          'skipUrl(bSkip.id), a.admin',
        ],
        ['liste', 'GET /api/v1/finance/infirmary/my-medication-doses', 'get(MY_DOSES, a.mother)'],
        ['liste', 'GET /api/v1/finance/infirmary/medication-settings', 'get(SETTINGS, a.admin)'],
        [
          'gövde',
          'PATCH /api/v1/finance/infirmary/medication-settings',
          'lateToleranceMinutes: 50, institutionId: b.id',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-infirmary-schedule.test.ts',
        'DOM-FIN-152: başka kurumun talebi, uygulaması ve atlaması 404 ve B değişmez; listede yok',
        marker,
      ),
    ]),
  ),
  // Onur: okul sağlığı taramaları (ON-163; DOM-FIN-153).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/health-screenings', 'get(SCREENINGS, a.admin)'],
        [
          'gövde',
          'POST /api/v1/finance/health-screenings',
          'screeningBody({ institutionId: b.id })',
        ],
        ['kayıt', 'GET /api/v1/finance/health-screenings/:sessionId', 'detailOf(bUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/health-screenings/:sessionId',
          "versioned('PATCH', bUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/health-screenings/:sessionId/results',
          'record(a, bScreening.id',
        ],
        [
          'kayıt',
          'POST /api/v1/finance/health-screenings/:sessionId/publish',
          'publish(bScreening.id, a.admin',
        ],
        [
          'kayıt',
          'GET /api/v1/finance/health-screenings/:sessionId/report',
          '`${bUrl}/report`, a.admin',
        ],
        [
          'liste',
          'GET /api/v1/finance/health-screening-staff',
          'get(`${STAFF}?pageSize=100`, a.admin)',
        ],
        ['liste', 'GET /api/v1/finance/health-screening-classes', 'get(CLASSES, a.admin)'],
        ['liste', 'GET /api/v1/finance/health-screening-results', 'get(MY_RESULTS, a.mother)'],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-health-screenings.test.ts',
        'DOM-FIN-153: başka kurumun taraması 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: acil durum özeti (ON-165; DOM-FIN-155).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/emergency-summaries', 'get(BASE, a.admin)'],
        ['gövde', 'POST /api/v1/finance/emergency-summaries', 'create(a, { institutionId: b.id })'],
        ['kayıt', 'GET /api/v1/finance/emergency-summaries/:summaryId', 'detail(bUrl, a.admin)'],
        [
          'kayıt',
          'PATCH /api/v1/finance/emergency-summaries/:summaryId',
          "versioned('PATCH', bUrl, a.admin",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/emergency-summaries/:summaryId/approve',
          "versioned('POST', `${bUrl}/approve`, a.admin",
        ],
        [
          'kayıt',
          'DELETE /api/v1/finance/emergency-summaries/:summaryId',
          "versioned('DELETE', bUrl, a.admin",
        ],
        ['liste', 'GET /api/v1/finance/emergency-summaries/classes', 'get(CLASSES, a.admin)'],
        [
          'kayıt',
          'GET /api/v1/finance/emergency-summaries/classes/:classId',
          "get(classUrl('9-A'), a.admin)",
        ],
        [
          'kayıt',
          'GET /api/v1/finance/emergency-summaries/students/:studentId',
          "get(studentUrl('s-1'), a.admin)",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/emergency-summaries/students/:studentId/contacts/:position/reveal',
          "call('POST', revealUrl('s-1', 1), a.admin)",
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-emergency-summaries.test.ts',
        'DOM-FIN-155: başka kurumun özeti 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
  // Onur: erken çıkış ve izinli ayrılış (ON-168; DOM-FIN-161).
  ...Object.fromEntries(
    (
      [
        ['liste', 'GET /api/v1/finance/early-dismissals', 'get(BASE, a.admin)'],
        ['gövde', 'POST /api/v1/finance/early-dismissals', 'institutionId: b.id'],
        ['liste', 'GET /api/v1/finance/early-dismissal-summary', 'get(SUMMARY, a.admin)'],
        ['kayıt', 'GET /api/v1/finance/early-dismissal-pickup-options', 'studentId=s-9'],
        [
          'liste',
          'GET /api/v1/finance/early-dismissal-attendance-effects',
          'get(EFFECTS, a.admin)',
        ],
        ['liste', 'GET /api/v1/finance/my-early-dismissals', 'get(MY, a.mother)'],
        ['kayıt', 'GET /api/v1/finance/early-dismissals/:dismissalId', 'get(bUrl, a.admin)'],
        [
          'kayıt',
          'POST /api/v1/finance/early-dismissals/:dismissalId/approve',
          "for (const verb of ['approve', 'cancel'])",
        ],
        ['kayıt', 'POST /api/v1/finance/early-dismissals/:dismissalId/reject', '`${bUrl}/reject`'],
        [
          'kayıt',
          'POST /api/v1/finance/early-dismissals/:dismissalId/cancel',
          "for (const verb of ['approve', 'cancel'])",
        ],
        [
          'kayıt',
          'POST /api/v1/finance/early-dismissals/:dismissalId/release',
          '`${bUrl}/release`',
        ],
      ] as const
    ).map(([kind, key, marker]) => [
      key,
      proof(kind)(
        'finance-early-dismissals.test.ts',
        'DOM-FIN-161: başka kurumun talebi 404 ve B değişmez; listede yok; institutionId etkisiz',
        marker,
      ),
    ]),
  ),
}

/**
 * Çapraz kurum testi henüz yazılmamış uçlar: boştur (OG-034'te bütün uçlar sınıflandı). Geçici
 * olarak eklenen uç `test.todo` olarak görünür ve gerekçesi satır yorumunda yazılır; yeni uç bu
 * listeye eklenmez, tabloya testiyle girer.
 */
const TODO: readonly string[] = []

const EXPECTED: Readonly<Record<string, Proof>> = {
  ...ROUTES,
  ...WORKFLOWS,
  ...PLATFORM,
  ...LEARNING,
  ...ACCESS,
  ...FINANCE,
}

/** Çapraz kurum senaryosunu anan test adı. */
const CROSS_TITLE =
  /başka kurum|kurumlar arası|kurum sınırı|institutionId|kurum kimliği|üyesi olmadığı kurum|B kurum/i

const TEST_DIR = new URL('./', import.meta.url)
const sources = new Map<string, string>()
function source(file: string): string {
  let text = sources.get(file)
  if (text === undefined) {
    text = readFileSync(new URL(file, TEST_DIR), 'utf8')
    sources.set(file, text)
  }
  return text
}

/** Dosyadaki `test(…)` adları (tek satırlık dize ya da şablon). */
function testTitles(text: string): string[] {
  return [...text.matchAll(/\btest(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(
    (match) => match[2] ?? '',
  )
}

/** Uç yolu, `/api/v1/` öneki olmadan; yol kimlikleri herhangi bir değerle eşleşir. */
function pathPattern(url: string): RegExp {
  const path = url.replace(/^\/api\/v1\//, '')
  const parts = path
    .split('/')
    .map((part) =>
      part.startsWith(':') ? '[^/\\s\'"`?]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
  return new RegExp(parts.join('/'))
}

const recordParams = (url: string) =>
  [...url.matchAll(/:(\w+)/g)]
    .map((match) => match[1] ?? '')
    .filter((name) => !NON_RECORD_PARAMS.has(name))

describe('IST-002: rota → çapraz kurum testi envanteri (DOM-YTK-001, DOM-YTK-011)', () => {
  let close: () => Promise<void>
  let app: App

  before(async () => {
    const database = await createTestDatabase()
    close = database.close
    app = await buildTestApp(database.db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  const routeKeys = () => app.routeModules().map((route) => `${route.method} ${route.url}`)

  test('IST-002: her uç ya çapraz kurum testini gösterir ya da gerekçeli olarak kurum kaydı almaz', () => {
    const keys = routeKeys()
    assert.ok(keys.length > 150, `envanter beklenenden kısa: ${keys.length}`)
    const problems: string[] = []
    for (const key of keys)
      if (!Object.hasOwn(EXPECTED, key) && !TODO.includes(key))
        problems.push(`${key}: envanterde yok (çapraz kurum testini ya da gerekçesini ekle)`)
    const listed = [...Object.keys(EXPECTED), ...TODO]
    assert.equal(new Set(listed).size, listed.length, 'bir uç iki kez listede')
    for (const key of listed)
      if (!keys.includes(key)) problems.push(`${key}: tabloda var, uygulamada yok`)
    assert.deepEqual(problems, [])
  })

  test('IST-002: kayıt kimliği alan uç kayıt sınıfındadır (liste ya da gövde sayılmaz)', () => {
    const problems: string[] = []
    for (const [key, entry] of Object.entries(EXPECTED)) {
      const url = key.slice(key.indexOf(' ') + 1)
      const hasRecord = recordParams(url).length > 0
      if (entry.kind === 'yok') continue
      if (hasRecord && entry.kind !== 'kayıt')
        problems.push(`${key}: yol kimliği var, sınıf ${entry.kind}`)
    }
    assert.deepEqual(problems, [])
  })

  test('IST-002: gösterilen dosyada çapraz kurum testi ve uç yolu bulunur', () => {
    const problems: string[] = []
    for (const [key, entry] of Object.entries(EXPECTED)) {
      if (entry.kind === 'yok') {
        if (entry.reason.trim().length < 10) problems.push(`${key}: gerekçe kısa`)
        continue
      }
      let text: string
      try {
        text = source(entry.file)
      } catch {
        problems.push(`${key}: ${entry.file} bulunamadı`)
        continue
      }
      // Tablo kalıbıyla üretilen testlerde ad şablondur; parça dosyadaki ad metnindedir.
      const titles = testTitles(text).filter((title) => title.includes(entry.test))
      const templated = titles.length === 0 && text.includes(`'${entry.test}`)
      if (titles.length === 0 && !templated)
        problems.push(`${key}: ${entry.file} içinde "${entry.test}" testi yok`)
      else if (![...titles, ...(templated ? [entry.test] : [])].some((t) => CROSS_TITLE.test(t)))
        problems.push(`${key}: "${entry.test}" testi çapraz kurum senaryosunu anmıyor`)
      const url = key.slice(key.indexOf(' ') + 1)
      const found =
        entry.marker === undefined ? pathPattern(url).test(text) : text.includes(entry.marker)
      if (!found)
        problems.push(`${key}: ${entry.file} içinde ${entry.marker ?? pathPattern(url).source} yok`)
    }
    assert.deepEqual(problems, [])
  })

  for (const key of TODO) test.todo(`IST-002: ${key} çapraz kurum testi`)
})
