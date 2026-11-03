import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import {
  COLLECTION_MODULES,
  INSTITUTION_TYPES,
  MODULE_KEYS,
  moduleAvailableFor,
  type InstitutionType,
} from '@kampus/school-core/modules/collection-modules.ts'
import { WORKFLOW_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { WORKFLOW_ROUTES } from '../src/routes/workflows.schemas.ts'
import { READABLE_COLLECTIONS } from '../src/services/collection-access.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  nextIp,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { DAY, rows, SAMPLE } from './support/commands-harness.ts'

/**
 * Rota → modül envanteri (IST-009; DOM-YTK-040): kurum modülü kapatınca menü, doğrudan adres ve
 * ilgili API uçları kapanır, kapalı modülün ucu 403 `module_disabled` döner. Her uç ya bir modüle
 * bağlıdır (`preValidation`'da `requireModule`) ya da aşağıdaki modülsüz listede gerekçesiyle
 * durur. Yeni uç bu tabloya girmezse test kırılır.
 *
 * Envanter uygulamanın kendisinden okunur (`app.routeModules()`; `plugins/modules.ts` her rota
 * kaydında `preValidation`'daki modül denetimlerini toplar). Modül eklentisinden önce kaydedilen
 * belge uçları (`/api/docs`, `/api/v1/openapi.json`; yalnız geliştirme) envantere girmez.
 */

type Expected = readonly string[] | 'collection'

/** Modülsüz uçlar ve gerekçeleri. Kapatılamaz: kimlik, çekirdek kayıt, KVKK, ayar. */
const MODULELESS: Readonly<Record<string, string>> = {
  // Better Auth kimlik uçları: giriş, çıkış ve oturum modülden bağımsızdır.
  'GET /api/v1/auth/*': 'kimlik',
  'POST /api/v1/auth/*': 'kimlik',
  'GET /api/v1/health': 'sağlık denetimi, oturumsuz',
  // Oturum, rol ve etkin modül haritası; istemci menüyü ve route korumasını bundan kurar.
  'GET /api/v1/me': 'oturum',
  // Üyelik ve kadro çekirdek kayıtlardır (öğrenci, öğretmen, veli koleksiyonları her zaman açık).
  'GET /api/v1/memberships': 'çekirdek üyelik',
  'GET /api/v1/institution-members': 'çekirdek üyelik',
  // Personel hesabı yönetimi kapatılamaz: kurumun yönetimsiz kalmaması için (DOM-YTK-070).
  'GET /api/v1/institution-members/invitations': 'personel hesabı',
  'POST /api/v1/institution-members/invitations': 'personel hesabı',
  'POST /api/v1/institution-members/imports': 'personel hesabı',
  'POST /api/v1/institution-members/invitations/:invitationId/cancel': 'personel hesabı',
  'POST /api/v1/institution-members/:membershipId/role': 'personel hesabı',
  'POST /api/v1/institution-members/:membershipId/deactivate': 'personel hesabı',
  'POST /api/v1/institution-members/:membershipId/reactivate': 'personel hesabı',
  // Zümre başkanı / koordinatör görevi personel yönetimidir; görevin kullanıldığı uç (son puan)
  // kendi modülünü ister (DOM-YTK-027).
  'GET /api/v1/coordinator-duties': 'personel görevi',
  'GET /api/v1/coordinator-duties/:dutyId': 'personel görevi',
  'POST /api/v1/coordinator-duties': 'personel görevi',
  'DELETE /api/v1/coordinator-duties/:dutyId': 'personel görevi',
  // Denetim kaydı her zaman açıktır (`audit` koleksiyonu; DOM-YTK-053).
  'GET /api/v1/audit-events': 'denetim kaydı',
  // Modül yönetimi: kapalı modül buradan açılır (DOM-YTK-040, -042).
  'GET /api/v1/modules': 'modül yönetimi',
  'PATCH /api/v1/modules/:moduleKey': 'modül yönetimi',
  // Pano birden çok modülü okur: kapalı modülün bölümü `null` döner, hiç hesaplanmaz
  // (`services/dashboard.ts`; `dashboard.test.ts`).
  'GET /api/v1/dashboard': 'bölüm başına modül süzgeci',
  // Kampüs, sınıf ve kadro çekirdek kayıtlardır (her zaman açık koleksiyonlar).
  'POST /api/v1/branches': 'çekirdek kayıt',
  'PATCH /api/v1/branches/:branchId': 'çekirdek kayıt',
  'DELETE /api/v1/branches/:branchId': 'çekirdek kayıt',
  'POST /api/v1/branches/:branchId/restore': 'çekirdek kayıt',
  'POST /api/v1/classes': 'çekirdek kayıt',
  'PATCH /api/v1/classes/:classId': 'çekirdek kayıt',
  'DELETE /api/v1/classes/:classId': 'çekirdek kayıt',
  'POST /api/v1/classes/:classId/restore': 'çekirdek kayıt',
  'POST /api/v1/teachers': 'çekirdek kayıt',
  'PATCH /api/v1/teachers/:teacherId': 'çekirdek kayıt',
  'DELETE /api/v1/teachers/:teacherId': 'çekirdek kayıt',
  'POST /api/v1/teachers/:teacherId/restore': 'çekirdek kayıt',
  // KVKK aydınlatma ve açık rıza modülden bağımsız her zaman açıktır (DOM-YTK-056 … -061).
  'GET /api/v1/privacy-notices': 'KVKK',
  'POST /api/v1/privacy-notices': 'KVKK',
  'GET /api/v1/privacy-notices/current': 'KVKK',
  'POST /api/v1/privacy-notices/:noticeId/acknowledge': 'KVKK',
  'GET /api/v1/consent-texts/:purpose': 'KVKK',
  'GET /api/v1/consents': 'KVKK',
  'GET /api/v1/consents/status': 'KVKK',
  'POST /api/v1/consents': 'KVKK',
  'POST /api/v1/consents/:consentId/withdraw': 'KVKK',
  // Eğitim yılı ve dönem kurum takvimidir; kayıt, finans ve akademik modüllerin ortak dayanağı.
  'GET /api/v1/academic-years': 'kurum takvimi',
  'GET /api/v1/academic-years/current': 'kurum takvimi',
  'GET /api/v1/academic-years/:startYear': 'kurum takvimi',
  'POST /api/v1/academic-years': 'kurum takvimi',
  'PATCH /api/v1/academic-years/:startYear': 'kurum takvimi',
  'POST /api/v1/academic-years/:startYear/terms': 'kurum takvimi',
  'PATCH /api/v1/academic-years/:startYear/terms/:termId': 'kurum takvimi',
  'DELETE /api/v1/academic-years/:startYear/terms/:termId': 'kurum takvimi',
  'POST /api/v1/academic-years/:startYear/activate': 'kurum takvimi',
  'POST /api/v1/academic-years/:startYear/close': 'kurum takvimi',
  // Öğrenci–veli velayet bağı çekirdek kayıttır (öğrenci ve veli koleksiyonları her zaman açık).
  'GET /api/v1/students/:studentId/guardians': 'çekirdek kayıt',
  'POST /api/v1/students/:studentId/guardians': 'çekirdek kayıt',
  'PATCH /api/v1/students/:studentId/guardians/:linkId': 'çekirdek kayıt',
  'DELETE /api/v1/students/:studentId/guardians/:linkId': 'çekirdek kayıt',
  // Dosyanın modülü amacından gelir ve serviste denetlenir (yükleme, bilgi ve bağlantı; kurum
  // belgesi modülsüz; `files.test.ts`). İndirme imzalı kısa ömürlü bağlantıdır, oturum istemez.
  'POST /api/v1/files': 'dosya amacına göre serviste',
  'GET /api/v1/files/:fileId': 'dosya amacına göre serviste',
  'GET /api/v1/files/:fileId/url': 'dosya amacına göre serviste',
  'GET /api/v1/files/download': 'imzalı bağlantı',
}

/**
 * Kurum türüne bağlı uçlar: modül denetimi taşımaz, kurum türü uymazsa rol denetiminden önce 404
 * döner (bulunmaz gibi; DOM-YTK-012). Kur programı (DOM-DIL-005) ve kur grupları (`/groups*`,
 * DOM-DIL-008), seviye tespiti ve CEFR profili (IST-058, IST-060) yalnız dil okulundadır. Bir dil okulu modülüne bağlanması ayrı karardır; o zamana
 * dek modül kapatma bu uçları etkilemez.
 */
const INSTITUTION_TYPE_ROUTES: Readonly<Record<string, InstitutionType>> = {
  'GET /api/v1/courses': 'language_school',
  'GET /api/v1/courses/:courseId': 'language_school',
  'POST /api/v1/courses': 'language_school',
  'PATCH /api/v1/courses/:courseId': 'language_school',
  'POST /api/v1/courses/:courseId/activate': 'language_school',
  'DELETE /api/v1/courses/:courseId': 'language_school',
  'POST /api/v1/courses/:courseId/record-e-ozel': 'language_school',
  'GET /api/v1/groups': 'language_school',
  'GET /api/v1/groups/:groupId': 'language_school',
  'GET /api/v1/groups/:groupId/waitlist': 'language_school',
  'POST /api/v1/groups': 'language_school',
  'PATCH /api/v1/groups/:groupId': 'language_school',
  'POST /api/v1/groups/:groupId/open': 'language_school',
  'POST /api/v1/groups/:groupId/cancel': 'language_school',
  'POST /api/v1/groups/:groupId/merge': 'language_school',
  // Seviye tespiti ve CEFR profili (OG-054; IST-058, IST-060; DOM-DIL-010).
  'GET /api/v1/placement-sessions': 'language_school',
  'GET /api/v1/placement-sessions/:sessionId': 'language_school',
  'GET /api/v1/placement-sessions/:sessionId/form': 'language_school',
  'POST /api/v1/placement-sessions': 'language_school',
  'POST /api/v1/placement-sessions/:sessionId/score': 'language_school',
  'POST /api/v1/placement-sessions/:sessionId/complete': 'language_school',
  'POST /api/v1/placement-sessions/:sessionId/decide': 'language_school',
  'GET /api/v1/students/:studentId/cefr-profile': 'language_school',
}

/** Oğuzhan'ın modüle bağlı uçları (iş akışı köprüsü core komut kaydından aşağıda türetilir). */
const PLATFORM_MODULES: Readonly<Record<string, Expected>> = {
  // Genel koleksiyon okuması: modül koleksiyon adından (`COLLECTION_MODULES`).
  'GET /api/v1/collections/:collection': 'collection',
  'GET /api/v1/collections/:collection/counts': 'collection',
  'GET /api/v1/collections/:collection/:id': 'collection',
  // Akademik yazma (yoklama, not, izin/mazeret).
  'POST /api/v1/classes/:classId/attendance': ['academic'],
  // Kampüs ve kadro ekranı toplu ölçüleri (IST-010): not ortalaması ve soru süresi uyumu.
  'GET /api/v1/class-metrics': ['academic'],
  'GET /api/v1/teacher-metrics': ['learning'],
  'POST /api/v1/grades': ['academic'],
  'PATCH /api/v1/grades/:gradeId': ['academic'],
  'POST /api/v1/absences': ['academic'],
  'POST /api/v1/absences/:absenceId/documents': ['academic'],
  'POST /api/v1/absences/:absenceId/approve': ['academic'],
  'POST /api/v1/absences/:absenceId/reject': ['academic'],
  // Etüt.
  'POST /api/v1/tutor-sessions': ['tutoring'],
  'POST /api/v1/tutor-sessions/:sessionId/cancel': ['tutoring'],
  'POST /api/v1/tutor-sessions/:sessionId/attendance': ['tutoring'],
  // Optik değerlendirme ve otomatik etüt köprüsü.
  'POST /api/v1/assessment/profile': ['optical'],
  'POST /api/v1/assessment/profile/:recordId': ['optical'],
  'POST /api/v1/assessment/evaluate': ['optical'],
  'POST /api/v1/assessment/evaluate/preview': ['optical'],
  'POST /api/v1/assessment/plan': ['tutoring'],
  'POST /api/v1/assessment/plan/preview': ['tutoring'],
  'POST /api/v1/assessment/slot': ['tutoring'],
  'POST /api/v1/assessment/slot-remove/:recordId': ['tutoring'],
  'POST /api/v1/assessment/cancel/:recordId': ['tutoring'],
  'POST /api/v1/assessment/attendance/:recordId': ['tutoring'],
  // İletişim: duyuru, yazışma, veli iletişimi, talep, bildirim, randevu.
  'POST /api/v1/announcements': ['communication'],
  'PATCH /api/v1/announcements/:announcementId': ['communication'],
  'POST /api/v1/announcements/:announcementId/withdraw': ['communication'],
  'POST /api/v1/announcements/:announcementId/read': ['communication'],
  'GET /api/v1/conversations': ['communication'],
  'GET /api/v1/conversations/:conversationId/messages': ['communication'],
  'POST /api/v1/conversations': ['communication'],
  'POST /api/v1/conversations/:conversationId/messages': ['communication'],
  'POST /api/v1/conversations/:conversationId/read': ['communication'],
  'POST /api/v1/conversations/:conversationId/access': ['communication'],
  'GET /api/v1/students/:studentId/parent-accounts': ['communication'],
  'POST /api/v1/parents/:parentId/reveal-contact': ['communication'],
  'POST /api/v1/requests': ['communication'],
  'PATCH /api/v1/requests/:requestId': ['communication'],
  'GET /api/v1/notifications': ['communication'],
  'GET /api/v1/notifications/unread-count': ['communication'],
  'POST /api/v1/notifications/read-all': ['communication'],
  'POST /api/v1/notifications/:notificationId/read': ['communication'],
  'GET /api/v1/appointments/slots': ['communication'],
  'POST /api/v1/appointments': ['communication'],
  'PATCH /api/v1/appointments/:appointmentId': ['communication'],
  // Ders programı ve yedek görevlendirme (IST-094; DOM-YTK-068, -069). Okuma ayrıca koleksiyonun
  // modülünü (`academic`) core okuma kuralıyla ister.
  'GET /api/v1/lessons': ['planning'],
  'GET /api/v1/lessons/:lessonId': ['planning'],
  'POST /api/v1/lessons': ['planning'],
  'PATCH /api/v1/lessons/:lessonId': ['planning'],
  'POST /api/v1/lessons/:lessonId/substitute': ['planning'],
  'POST /api/v1/lessons/:lessonId/cancel': ['planning'],
  // Öğrenme: Öğretmenime Sor, içerik havuzu, rubrik, görev, deneme, teslim ve puanlama.
  'POST /api/v1/questions': ['learning'],
  'POST /api/v1/questions/:questionId/answers': ['learning'],
  'PATCH /api/v1/questions/:questionId': ['learning'],
  // Ödev verme, teslim ve değerlendirme (IST-095; DOM-AKD-070…074).
  'GET /api/v1/homework': ['learning'],
  'GET /api/v1/homework/:homeworkId': ['learning'],
  'POST /api/v1/homework': ['learning'],
  'PATCH /api/v1/homework/:homeworkId': ['learning'],
  'DELETE /api/v1/homework/:homeworkId': ['learning'],
  'POST /api/v1/homework/:homeworkId/submissions': ['learning'],
  'POST /api/v1/homework/:homeworkId/submissions/:submissionId/grade': ['learning'],
  'POST /api/v1/videos/:videoId/progress': ['learning'],
  // Quiz hazırlama, çözme ve sunucu puanlaması (IST-095; DOM-AKD-075…079).
  'GET /api/v1/quizzes': ['learning'],
  'GET /api/v1/quizzes/:quizId': ['learning'],
  'POST /api/v1/quizzes': ['learning'],
  'PATCH /api/v1/quizzes/:quizId': ['learning'],
  'DELETE /api/v1/quizzes/:quizId': ['learning'],
  'POST /api/v1/quizzes/:quizId/attempt': ['learning'],
  'POST /api/v1/quizzes/:quizId/attempt/submit': ['learning'],
  // İzin formu ve dijital veli onayı (IST-067; DOM-ILT-036…039).
  'GET /api/v1/permission-forms': ['communication'],
  'GET /api/v1/permission-forms/:formId': ['communication'],
  'POST /api/v1/permission-forms': ['communication'],
  'PATCH /api/v1/permission-forms/:formId': ['communication'],
  'POST /api/v1/permission-forms/:formId/close': ['communication'],
  'DELETE /api/v1/permission-forms/:formId': ['communication'],
  'POST /api/v1/permission-forms/:formId/decisions': ['communication'],
  'GET /api/v1/resources': ['learning'],
  'GET /api/v1/resources/:resourceId': ['learning'],
  'GET /api/v1/resources/:resourceId/versions/:versionId': ['learning'],
  'POST /api/v1/resources': ['learning'],
  'PATCH /api/v1/resources/:resourceId/versions/:versionId': ['learning'],
  'POST /api/v1/resources/:resourceId/versions': ['learning'],
  'POST /api/v1/resources/:resourceId/versions/:versionId/submit': ['learning'],
  'POST /api/v1/resources/:resourceId/versions/:versionId/publish': ['learning'],
  'POST /api/v1/resources/:resourceId/versions/:versionId/withdraw': ['learning'],
  'POST /api/v1/resources/:resourceId/versions/:versionId/approve': ['learning'],
  'POST /api/v1/resources/:resourceId/versions/:versionId/reject': ['learning'],
  'POST /api/v1/resources/:resourceId/versions/:versionId/reopen': ['learning'],
  'POST /api/v1/resources/:resourceId/versions/:versionId/archive': ['learning'],
  'POST /api/v1/resources/:resourceId/versions/:versionId/report': ['learning'],
  'POST /api/v1/resources/:resourceId/remove': ['learning'],
  'POST /api/v1/resources/:resourceId/share': ['learning'],
  'POST /api/v1/resources/:resourceId/copy': ['learning'],
  'GET /api/v1/learning-outcomes': ['learning'],
  'POST /api/v1/learning-outcomes': ['learning'],
  'POST /api/v1/learning-outcomes/:code/archive': ['learning'],
  'GET /api/v1/rubrics': ['learning'],
  'GET /api/v1/rubrics/:rubricId': ['learning'],
  'GET /api/v1/rubric-versions/:versionId': ['learning'],
  'POST /api/v1/rubrics': ['learning'],
  'POST /api/v1/rubrics/:rubricId/versions': ['learning'],
  'PATCH /api/v1/rubrics/:rubricId/versions/:versionId': ['learning'],
  'POST /api/v1/rubrics/:rubricId/versions/:versionId/publish': ['learning'],
  'POST /api/v1/rubrics/:rubricId/versions/:versionId/archive': ['learning'],
  'GET /api/v1/task-assignments': ['learning'],
  'GET /api/v1/task-assignments/:assignmentId': ['learning'],
  'POST /api/v1/task-assignments': ['learning'],
  'PATCH /api/v1/task-assignments/:assignmentId': ['learning'],
  'GET /api/v1/task-attempts': ['learning'],
  'GET /api/v1/task-attempts/:attemptId': ['learning'],
  'POST /api/v1/task-assignments/:assignmentId/attempts': ['learning'],
  'PATCH /api/v1/task-attempts/:attemptId': ['learning'],
  'POST /api/v1/task-attempts/:attemptId/submit': ['learning'],
  'POST /api/v1/task-attempts/:attemptId/checks': ['learning'],
  'GET /api/v1/practice-gradebook': ['learning'],
  'GET /api/v1/task-submissions': ['learning'],
  'GET /api/v1/task-submissions/grading-queue': ['learning'],
  'GET /api/v1/students/:studentId/skill-progress': ['learning'],
  'GET /api/v1/task-submissions/:submissionId': ['learning'],
  'GET /api/v1/task-assignments/:assignmentId/draft': ['learning'],
  'PATCH /api/v1/task-assignments/:assignmentId/draft': ['learning'],
  'POST /api/v1/task-assignments/:assignmentId/submissions': ['learning'],
  'POST /api/v1/task-submissions/:submissionId/scores': ['learning'],
  'POST /api/v1/task-submissions/:submissionId/resubmission-requests': ['learning'],
  'POST /api/v1/task-submissions/:submissionId/second-scores': ['learning'],
  'POST /api/v1/task-submissions/:submissionId/final-scores': ['learning'],
  'POST /api/v1/task-submissions/:submissionId/second-rating-requests': ['learning'],
  'POST /api/v1/task-assignments/:assignmentId/second-rating-sample': ['learning'],
  'POST /api/v1/task-submissions/:submissionId/appeals': ['learning'],
  'POST /api/v1/task-submissions/:submissionId/appeals/:appealId/decision': ['learning'],
}

/**
 * İş akışı köprüsü (`POST /workflows/:command`): her komut ayrı rotadır ve modülü core komut
 * kaydından (`WORKFLOW_COMMANDS[komut].module`) denetlenir; rota yanlış modülü taşırsa tablo tutmaz.
 */
const COMMAND_MODULES: Readonly<Record<string, { module: string | null }>> = WORKFLOW_COMMANDS
const WORKFLOW_MODULES: Readonly<Record<string, Expected>> = Object.fromEntries(
  Object.entries(WORKFLOW_ROUTES).flatMap(([command, { record }]) => {
    const module = COMMAND_MODULES[command]?.module ?? null
    const modules = module === null ? [] : [module]
    return [
      ...(record === 'required' ? [] : [[`POST /api/v1/workflows/${command}`, modules]]),
      ...(record === 'none' ? [] : [[`POST /api/v1/workflows/${command}/:recordId`, modules]]),
    ]
  }),
)

/**
 * Onur'un kayıt ve finans uçları (`app.ts` Onur bloğu): yol öneki alan haritasıyla aynıdır. Bu
 * uçlar tek tek listelenmez (Onur bu dosyayı düzenlemez); her biri `crm` ya da `finance`
 * modülüne bağlı olmalıdır. Modülsüz kayıt/finans ucu gerekirse Oğuzhan'a iş isteğiyle eklenir.
 */
const ONUR_PATHS = [
  /^\/api\/v1\/(fee-tariffs|finance|payments|payment-settings|bank-accounts|withdrawals|prospects)(\/|$)/,
  /^\/api\/v1\/students\/:studentId\/(withdraw|withdrawal-quote|identity)$/,
]
const ONUR_MODULES = new Set(['crm', 'finance'])
const isOnurRoute = (url: string) => ONUR_PATHS.some((pattern) => pattern.test(url))

/**
 * Bilinen eksikler: modüle bağlı olması gerekip henüz `requireModule` taşımayan uçlar. Boş
 * kalmalıdır; yeni satır yalnız ayrı görevle kapatılacak bilinen açık içindir.
 */
const TODO: readonly string[] = []

const EXPECTED: Readonly<Record<string, Expected>> = { ...PLATFORM_MODULES, ...WORKFLOW_MODULES }

describe('IST-009: rota → modül envanteri (DOM-YTK-040)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  const routeKey = (route: { method: string; url: string }) => `${route.method} ${route.url}`
  const inventory = () =>
    app.routeModules().map((route) => ({
      ...route,
      key: routeKey(route),
      dynamic: route.modules.some((module) => typeof module !== 'string'),
      keys: route.modules.filter((module): module is string => typeof module === 'string'),
    }))

  test('IST-009: her uç ya bir modüle bağlı ya da gerekçeli modülsüz listede', () => {
    const routes = inventory()
    assert.ok(routes.length > 150, `envanter beklenenden kısa: ${routes.length}`)
    const keys = routes.map((route) => route.key)
    assert.equal(new Set(keys).size, keys.length, 'yinelenen rota')

    const problems: string[] = []
    for (const route of routes) {
      const guarded = route.modules.length > 0
      if (Object.hasOwn(MODULELESS, route.key)) {
        if (guarded) problems.push(`${route.key}: modülsüz listede ama modül denetimi var`)
        continue
      }
      if (Object.hasOwn(INSTITUTION_TYPE_ROUTES, route.key)) {
        if (guarded) problems.push(`${route.key}: kurum türüne bağlı ama modül denetimi var`)
        continue
      }
      if (TODO.includes(route.key)) {
        if (guarded) problems.push(`${route.key}: TODO listesinde ama artık korumalı; satırı sil`)
        continue
      }
      if (isOnurRoute(route.url)) {
        if (!guarded || route.dynamic || !route.keys.every((key) => ONUR_MODULES.has(key)))
          problems.push(`${route.key}: kayıt/finans ucu crm ya da finance modülüne bağlı değil`)
        continue
      }
      const expected = EXPECTED[route.key]
      if (expected === undefined) {
        problems.push(`${route.key}: envanterde yok (modülünü ya da modülsüz gerekçesini ekle)`)
        continue
      }
      const actual: Expected = route.dynamic ? 'collection' : route.keys
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        problems.push(
          `${route.key}: modül ${JSON.stringify(actual)}, beklenen ${JSON.stringify(expected)}`,
        )
    }
    // Tablodaki her satır gerçek bir uca karşılık gelir (eski satır kalmaz).
    const listed = [
      ...Object.keys(MODULELESS),
      ...Object.keys(INSTITUTION_TYPE_ROUTES),
      ...Object.keys(EXPECTED),
      ...TODO,
    ]
    assert.equal(new Set(listed).size, listed.length, 'bir uç iki sınıfta')
    for (const key of listed)
      if (!keys.includes(key)) problems.push(`${key}: tabloda var, uygulamada yok`)
    assert.deepEqual(problems, [])
  })

  test('IST-009: envanterdeki modül anahtarları core modül kaydındadır', () => {
    const known = new Set<string>(MODULE_KEYS)
    for (const route of inventory())
      for (const key of route.keys) assert.ok(known.has(key), `${route.key}: bilinmeyen ${key}`)
    for (const expected of Object.values(EXPECTED))
      if (expected !== 'collection') assert.ok(expected.length > 0)
  })

  // --- Davranış: kapalı modül 403, yeniden açılınca geçer ----------------------------------

  /** Modülün açılabildiği tür: okul önce (okula özgü modüller), değilse dil okulu. */
  const typeFor = (module: string): InstitutionType =>
    INSTITUTION_TYPES.find((type) => moduleAvailableFor(module, type)) ?? 'school'

  const sample = (url: string) => url.replace(/:\w+/g, 'test-yok')

  /** Gövdesiz istek: modül denetimi gövde ve sorgu doğrulamasından önce koşar. */
  function hit(method: string, url: string, cookie: string) {
    return app.inject({
      method: method as 'GET',
      url,
      remoteAddress: nextIp(),
      headers: { cookie, origin: TEST_ORIGIN },
    })
  }

  async function version(cookie: string): Promise<number> {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/modules',
      remoteAddress: nextIp(),
      headers: { cookie },
    })
    assert.equal(response.statusCode, 200, response.body)
    return response.json<{ data: { version: number } }>().data.version
  }

  /** Modülü gerçek ayar ucuyla açar ya da kapatır. */
  async function toggle(cookie: string, module: string, enabled: boolean) {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/modules/${module}`,
      remoteAddress: nextIp(),
      headers: {
        cookie,
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        'if-match': `"${await version(cookie)}"`,
        'idempotency-key': randomUUID(),
      },
      payload: JSON.stringify({ enabled }),
    })
    assert.equal(response.statusCode, 200, response.body)
  }

  /** Modüle bağlı istek örnekleri: statik uçlar ve modülün koleksiyonları. */
  function requestsFor(module: string): { method: string; url: string }[] {
    const routes = inventory()
      .filter((route) => route.keys.includes(module))
      .map((route) => ({ method: route.method, url: sample(route.url) }))
    // Genel okumaya açık koleksiyonlar; bildirim ve yazışma koleksiyonları kendi uçlarındadır.
    const collections = READABLE_COLLECTIONS.filter(
      (name) => COLLECTION_MODULES[name] === module,
    ).flatMap((name) => [
      { method: 'GET', url: `/api/v1/collections/${name}` },
      { method: 'GET', url: `/api/v1/collections/${name}/counts` },
      { method: 'GET', url: `/api/v1/collections/${name}/test-yok` },
    ])
    return [...routes, ...collections]
  }

  for (const module of MODULE_KEYS) {
    test(`IST-009: ${module} kapalıyken bütün uçları 403 module_disabled, açılınca geçer`, async () => {
      const institution = await createInstitution(app, { type: typeFor(module) })
      const cookie = await signInAs(app, institution.admin)
      const requests = requestsFor(module)
      assert.ok(requests.length > 0, `${module}: modüle bağlı uç yok`)

      await toggle(cookie, module, false)
      for (const request of requests) {
        const response = await hit(request.method, request.url, cookie)
        assert.equal(response.statusCode, 403, `${request.method} ${request.url}: ${response.body}`)
        assert.equal(response.json<{ code: string }>().code, 'module_disabled', request.url)
      }

      await toggle(cookie, module, true)
      for (const request of requests) {
        const response = await hit(request.method, request.url, cookie)
        const code = response.statusCode === 403 ? response.json<{ code: string }>().code : null
        assert.notEqual(code, 'module_disabled', `${request.method} ${request.url}`)
      }
    })
  }

  test('IST-009: kurum türüne bağlı uçlar başka türde rol denetiminden önce 404, modül kapatmaktan etkilenmez', async () => {
    for (const type of INSTITUTION_TYPES) {
      const all = Object.fromEntries(MODULE_KEYS.map((key) => [key, false]))
      const institution = await createInstitution(app, { type, enabledModules: all })
      const admin = await signInAs(app, institution.admin)
      const student = await signInAs(app, await createMember(app, institution.id, 'ogrenci'))
      for (const [key, owner] of Object.entries(INSTITUTION_TYPE_ROUTES)) {
        const [method, url] = key.split(' ') as [string, string]
        for (const cookie of [admin, student]) {
          const response = await hit(method, sample(url), cookie)
          if (type === owner) {
            const code = response.statusCode === 403 ? response.json<{ code: string }>().code : null
            assert.notEqual(code, 'module_disabled', `${type} ${key}`)
          } else assert.equal(response.statusCode, 404, `${type} ${key}: ${response.body}`)
        }
      }
    }
  })

  // --- Gerçek gövdeli örnekler --------------------------------------------------------------

  async function seeded(enabledModules: Record<string, boolean> = {}) {
    const institution = await createInstitution(app, { enabledModules })
    await insertMissingRecords(db, institution.id, rows(SAMPLE), FIXED_NOW)
    return { id: institution.id, cookie: await signInAs(app, institution.admin) }
  }

  function send(method: 'GET' | 'POST', url: string, cookie: string, body?: unknown) {
    return app.inject({
      method,
      url,
      remoteAddress: nextIp(),
      headers: {
        cookie,
        origin: TEST_ORIGIN,
        ...(body === undefined
          ? {}
          : { 'content-type': 'application/json', 'idempotency-key': randomUUID() }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }

  test('IST-009: okuma örneği: görev listesi learning kapalıyken 403, açılınca 200', async () => {
    const tenant = await seeded({ learning: false })
    const url = '/api/v1/task-assignments?page=1&pageSize=20'
    const denied = await send('GET', url, tenant.cookie)
    assert.equal(denied.statusCode, 403, denied.body)
    assert.equal(denied.json().code, 'module_disabled')
    await toggle(tenant.cookie, 'learning', true)
    const allowed = await send('GET', url, tenant.cookie)
    assert.equal(allowed.statusCode, 200, allowed.body)
  })

  test('IST-009: yazma örneği: duyuru communication kapalıyken 403 ve kayıt yazılmaz, açılınca 201', async () => {
    const tenant = await seeded({ communication: false })
    const body = {
      title: 'Veli toplantısı',
      text: 'Perşembe 18.00’de 7-A veli toplantısı yapılacaktır.',
      category: 'Akademik',
      target: { classIds: ['c1'], roles: ['veli'] },
    }
    const denied = await send('POST', '/api/v1/announcements', tenant.cookie, body)
    assert.equal(denied.statusCode, 403, denied.body)
    assert.equal(denied.json().code, 'module_disabled')
    assert.equal((await loadRecords(db, tenant.id, ['announcements'])).length, 0)
    await toggle(tenant.cookie, 'communication', true)
    const created = await send('POST', '/api/v1/announcements', tenant.cookie, body)
    assert.equal(created.statusCode, 201, created.body)
    assert.equal((await loadRecords(db, tenant.id, ['announcements'])).length, 1)
  })

  test('IST-009: iş akışı köprüsü komutun modülünü denetler: yemek kapalıyken 403, kulüp açık', async () => {
    const tenant = await seeded({ meals: false })
    const meal = { branchId: 'b1', date: DAY, title: 'Öğle menüsü', allergens: 'Gluten' }
    const before = (await loadRecords(db, tenant.id, ['mealMenus'])).length
    const denied = await send('POST', '/api/v1/workflows/meal', tenant.cookie, meal)
    assert.equal(denied.statusCode, 403, denied.body)
    assert.equal(denied.json().code, 'module_disabled')
    assert.equal((await loadRecords(db, tenant.id, ['mealMenus'])).length, before)
    // Aynı köprüde başka modülün komutu modül denetiminden geçer (gövde doğrulamasına ulaşır).
    const other = await send('POST', '/api/v1/workflows/club', tenant.cookie, {})
    assert.equal(other.statusCode, 400, other.body)
    await toggle(tenant.cookie, 'meals', true)
    const allowed = await send('POST', '/api/v1/workflows/meal', tenant.cookie, meal)
    assert.equal(allowed.statusCode, 200, allowed.body)
    assert.equal((await loadRecords(db, tenant.id, ['mealMenus'])).length, before + 1)
  })
})
