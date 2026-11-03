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
const PLACEMENT = kayit('cefr.test.ts', 'başka kurumun oturumu ve öğrencisi 404, B değişmez')
const PLACEMENT_COMMAND = (verb: string) =>
  kayit('cefr.test.ts', 'başka kurumun oturumu ve öğrencisi 404, B değişmez', `'${verb}'`)
const COURSE = kayit('courses.test.ts', 'başka kurumun kuru 404, listede görünmez ve değişmez')
const CONSENT = kayit('consents.test.ts', 'başka kurum: kayıt ve metin 404, B değişmez')
const DUTY = kayit('coordinator-duties.test.ts', 'başka kurumun yöneticisi 404')
const GUARDIAN = kayit('student-guardians.test.ts', 'başka kurum: öğrenci ve bağ 404, B değişmez')
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
  'GET /api/v1/task-submissions/grading-queue': GRADING,
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

  // --- Beceri ilerleme panosu (OG-080; IST-057, DOM-BEC-035) -----------------------------------
  'GET /api/v1/students/:studentId/skill-progress': kayit(
    'skill-progress.test.ts',
    'kapsam dışı, olmayan ve başka kurum 404',
    'skill-progress',
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
