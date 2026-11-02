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
const COURSE = kayit('courses.test.ts', 'başka kurumun kuru 404, listede görünmez ve değişmez')
const CONSENT = kayit('consents.test.ts', 'başka kurum: kayıt ve metin 404, B değişmez')
const DUTY = kayit('coordinator-duties.test.ts', 'başka kurumun yöneticisi 404')
const GUARDIAN = kayit('student-guardians.test.ts', 'başka kurum: öğrenci ve bağ 404, B değişmez')
const YEAR = kayit('academic-years.test.ts', 'başka kurum: yılı 404, yazma B yılını değiştirmez')
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
 * Çapraz kurum testi henüz yazılmamış uçlar. Her biri aşağıda `test.todo` olarak görünür; test
 * yazılınca satır buradan tabloya taşınır. Yeni uç bu listeye eklenmez, tabloya testiyle girer.
 */
const TODO: readonly string[] = [
  'DELETE /api/v1/branches/:branchId',
  'POST /api/v1/branches/:branchId/restore',
  'POST /api/v1/classes',
  'POST /api/v1/classes/:classId/restore',
  'POST /api/v1/teachers',
  'PATCH /api/v1/teachers/:teacherId',
  'DELETE /api/v1/teachers/:teacherId',
  'POST /api/v1/teachers/:teacherId/restore',
  'POST /api/v1/absences',
  'POST /api/v1/tutor-sessions',
  'POST /api/v1/tutor-sessions/:sessionId/attendance',
  'POST /api/v1/assessment/profile',
  'POST /api/v1/assessment/profile/:recordId',
  'POST /api/v1/assessment/evaluate/preview',
  'POST /api/v1/assessment/slot',
  'POST /api/v1/announcements',
  'PATCH /api/v1/announcements/:announcementId',
  'POST /api/v1/announcements/:announcementId/withdraw',
  'POST /api/v1/announcements/:announcementId/read',
  'POST /api/v1/conversations/:conversationId/read',
  'GET /api/v1/students/:studentId/parent-accounts',
  'GET /api/v1/notifications/unread-count',
  'POST /api/v1/notifications/read-all',
  'GET /api/v1/finance/totals',
  'GET /api/v1/finance/summary',
  'POST /api/v1/payments/:paymentId/mebbis-record',
  'GET /api/v1/bank-accounts',
  'POST /api/v1/bank-accounts',
  'DELETE /api/v1/bank-accounts/:bankAccountId',
  'GET /api/v1/payment-settings',
  'PATCH /api/v1/payment-settings',
  'GET /api/v1/prospects/:prospectId/guardian-matches',
  'GET /api/v1/students/:studentId/identity',
  'POST /api/v1/prospects/:prospectId/trial-lessons',
  'POST /api/v1/questions',
  'PATCH /api/v1/questions/:questionId',
  'POST /api/v1/resources',
  'POST /api/v1/resources/:resourceId/versions/:versionId/publish',
  'POST /api/v1/resources/:resourceId/versions/:versionId/withdraw',
  'POST /api/v1/resources/:resourceId/versions/:versionId/approve',
  'POST /api/v1/resources/:resourceId/versions/:versionId/reject',
  'POST /api/v1/resources/:resourceId/versions/:versionId/reopen',
  'POST /api/v1/resources/:resourceId/versions/:versionId/archive',
  'POST /api/v1/task-assignments/:assignmentId/attempts',
  'PATCH /api/v1/task-attempts/:attemptId',
  'POST /api/v1/task-attempts/:attemptId/submit',
  'GET /api/v1/task-submissions',
  'GET /api/v1/task-submissions/:submissionId',
  'GET /api/v1/task-assignments/:assignmentId/draft',
  'PATCH /api/v1/task-assignments/:assignmentId/draft',
  'POST /api/v1/task-assignments/:assignmentId/submissions',
  'POST /api/v1/task-submissions/:submissionId/second-scores',
  'POST /api/v1/task-submissions/:submissionId/final-scores',
  'POST /api/v1/task-submissions/:submissionId/second-rating-requests',
  'POST /api/v1/task-submissions/:submissionId/appeals',
  'POST /api/v1/task-submissions/:submissionId/appeals/:appealId/decision',
  'POST /api/v1/privacy-notices',
  'GET /api/v1/privacy-notices/current',
  'GET /api/v1/consent-texts/:purpose',
  'GET /api/v1/academic-years/current',
  'POST /api/v1/academic-years/:startYear/terms',
  'PATCH /api/v1/academic-years/:startYear/terms/:termId',
  'DELETE /api/v1/academic-years/:startYear/terms/:termId',
  'POST /api/v1/academic-years/:startYear/close',
  'POST /api/v1/files',
]

const EXPECTED: Readonly<Record<string, Proof>> = { ...ROUTES, ...WORKFLOWS }

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
      const titles = testTitles(text).filter((title) => title.includes(entry.test))
      if (titles.length === 0)
        problems.push(`${key}: ${entry.file} içinde "${entry.test}" testi yok`)
      else if (!titles.some((title) => CROSS_TITLE.test(title)))
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
