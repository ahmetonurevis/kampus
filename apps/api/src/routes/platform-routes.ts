import type { FastifyInstance } from 'fastify'

import type { DiskStorage } from '../storage/disk.ts'
// İçe aktarma sırası eski `app.ts` sırasıdır: şema modüllerinin değerlendirme sırası OpenAPI
// `components.schemas` sırasını belirler.
import { registerCollectionRoutes } from './collections.ts'
import { registerAssessmentRoutes } from './assessment.ts'
import { registerCommandRoutes } from './commands.ts'
import { registerCommunicationRoutes } from './communication.ts'
import { registerDashboardRoutes } from './dashboard.ts'
import { registerFileRoutes } from './files.ts'
import { registerHealthRoutes } from './health.ts'
import { registerMeRoutes } from './me.ts'
import { registerAuditEventRoutes } from './audit-events.ts'
import { registerCoordinatorDutyRoutes } from './coordinator-duties.ts'
import { registerInstitutionMemberRoutes } from './institution-members.ts'
import { registerMembershipRoutes } from './memberships.ts'
import { registerModuleRoutes } from './modules.ts'
import { registerResourceCommandRoutes } from './resource-commands.ts'
import { registerQuestionRoutes } from './questions.ts'
import { registerNotificationRoutes } from './notifications.ts'
import { registerPrivacyRoutes } from './privacy.ts'
import { registerRequestRoutes } from './requests.ts'
import { registerAppointmentRoutes } from './appointments.ts'
import { registerParentRoutes } from './parents.ts'
import { registerResourceRoutes } from './resources.ts'
import { registerRubricRoutes } from './rubrics.ts'
import { registerTaskAssignmentRoutes } from './task-assignments.ts'
import { registerTaskAttemptRoutes } from './task-attempts.ts'
import { registerTaskSubmissionRoutes } from './task-submissions.ts'
import { registerAcademicYearRoutes } from './academic-years.ts'
import { registerStudentGuardianRoutes } from './student-guardians.ts'
import { registerCourseRoutes } from './courses.ts'
import { registerLanguageGroupRoutes } from './language-groups.ts'

/**
 * Platform rota kayıtları: Onur'un kayıt ve finans uçları dışındaki her uç. Kayıt `app.ts`
 * `buildApp` içinde iki adımdır ve Onur'un `// Onur: kayıt ve finans` bloğu ikisinin arasındadır;
 * kayıt sırası OpenAPI belgesindeki yol sırasını belirler (`openapi:check`), bu yüzden korunur.
 * Bir kayıt fonksiyonu iki kaynakta bulunamaz (`test/platform-routes.test.ts`). Yeni platform ucu
 * `PLATFORM_LATE_ROUTES` sonuna eklenir.
 */

type RouteRegistrar = (app: FastifyInstance) => void

/** Onur bloğundan önce kaydedilen uçlar. */
export const PLATFORM_ROUTES = [
  registerHealthRoutes,
  registerMeRoutes,
  registerMembershipRoutes,
  registerInstitutionMemberRoutes,
  registerCoordinatorDutyRoutes,
  registerAuditEventRoutes,
  registerModuleRoutes,
  registerCollectionRoutes,
  registerDashboardRoutes,
  registerCommandRoutes,
  registerAssessmentRoutes,
  // Komut uçlarından sonra: ham gövde süsü (`commandInput`) orada tanımlanır.
  registerCommunicationRoutes,
  registerParentRoutes,
  registerRequestRoutes,
  registerNotificationRoutes,
  registerAppointmentRoutes,
] as const satisfies readonly RouteRegistrar[]

/** Onur bloğundan sonra kaydedilen uçlar; dosya uçları depoyu da alır ve en sondadır. */
export const PLATFORM_LATE_ROUTES = [
  registerQuestionRoutes,
  registerResourceRoutes,
  registerResourceCommandRoutes,
  registerRubricRoutes,
  registerTaskAssignmentRoutes,
  registerTaskAttemptRoutes,
  registerTaskSubmissionRoutes,
  registerPrivacyRoutes,
  registerAcademicYearRoutes,
  registerStudentGuardianRoutes,
  registerCourseRoutes,
  registerLanguageGroupRoutes,
] as const satisfies readonly RouteRegistrar[]

/** Onur bloğundan önceki platform uçlarını kaydeder. */
export function registerPlatformRoutes(app: FastifyInstance) {
  for (const register of PLATFORM_ROUTES) register(app)
}

/** Onur bloğundan sonraki platform uçlarını ve dosya uçlarını kaydeder. */
export function registerPlatformLateRoutes(app: FastifyInstance, storage: DiskStorage) {
  for (const register of PLATFORM_LATE_ROUTES) register(app)
  registerFileRoutes(app, storage)
}
