import { ASSESSMENT_ROUTES } from '../../src/routes/assessment.schemas.ts'
import { WORKFLOW_ROUTES } from '../../src/routes/workflows.schemas.ts'

/**
 * Idempotency-Key başlığı zorunlu olan Oğuzhan'ın uçları (OpenAPI envanteri,
 * `commands.test.ts`). Kayıt ve finans uçları (aday, tahsilat, banka hesabı, ayrılış ve iade)
 * `commands.test.ts`'teki `// Onur: kayıt ve finans` bloğundadır; bir uç iki listede bulunamaz.
 */
export const PLATFORM_IDEMPOTENT_ENDPOINTS: string[] = [
  ...Object.entries(WORKFLOW_ROUTES)
    .filter(([, route]) => route.idempotency === 'required')
    .map(([command]) => `POST /api/v1/workflows/${command}`),
  // Optik değerlendirme ve etüt köprüsü (routes/assessment.ts).
  ...Object.entries(ASSESSMENT_ROUTES)
    .filter(([, route]) => route.idempotency === 'required')
    .map(([command]) => `POST /api/v1/assessment/${command}`),
  'POST /api/v1/grades',
  // İletişim (routes/communication.ts): oluşturma ve mesaj gönderimi.
  'POST /api/v1/announcements',
  'POST /api/v1/conversations',
  'POST /api/v1/conversations/{conversationId}/messages',
  // Veli talebi ve izin/mazeret bildirimi (routes/requests.ts; DOM-ILT-053, DOM-ILT-080).
  'POST /api/v1/requests',
  'POST /api/v1/absences',
  // Randevu talebi (routes/appointments.ts; DOM-ILT-100, DOM-ILT-101).
  'POST /api/v1/appointments',
  // Öğretmenime Sor: soru gönderme (routes/questions.ts; DOM-ILT-090).
  'POST /api/v1/questions',
  // Kurum modül ayarı (routes/modules.ts).
  'PATCH /api/v1/modules/{moduleKey}',
  // Kampüs, öğretmen ve sınıf oluşturma (yeniden denemede ikinci kayıt açılmaz).
  'POST /api/v1/branches',
  'POST /api/v1/teachers',
  'POST /api/v1/classes',
  // Görev atama: sınıfa toplu dağıtım (routes/task-assignments.ts; IST-034).
  'POST /api/v1/task-assignments',
  // Görev denemesi başlatma ve teslimi (routes/task-attempts.ts; DOM-BEC-042, 043).
  'POST /api/v1/task-assignments/{assignmentId}/attempts',
  'POST /api/v1/task-attempts/{attemptId}/submit',
  // Yazma görevi teslimi: yeni değişmez sürüm (routes/task-submissions.ts; DOM-BEC-040).
  'POST /api/v1/task-assignments/{assignmentId}/submissions',
  // Öğretmen puanı ve yeniden teslim isteği (routes/task-submissions.ts; DOM-BEC-021, 040).
  'POST /api/v1/task-submissions/{submissionId}/scores',
  'POST /api/v1/task-submissions/{submissionId}/resubmission-requests',
  // İkinci puanlama: örneklem, elle istek ve ikinci puan (DOM-BEC-024); itiraz ve kararı
  // (DOM-BEC-025). Yeniden denemede ikinci satır yazılmaz.
  'POST /api/v1/task-submissions/{submissionId}/second-scores',
  // Uyuşmazlıkta koordinatörün son puanı (DOM-BEC-024, DOM-YTK-027).
  'POST /api/v1/task-submissions/{submissionId}/final-scores',
  // Zümre başkanı / akademik koordinatör görevi (routes/coordinator-duties.ts; DOM-YTK-027).
  'POST /api/v1/coordinator-duties',
  'POST /api/v1/task-submissions/{submissionId}/second-rating-requests',
  'POST /api/v1/task-assignments/{assignmentId}/second-rating-sample',
  'POST /api/v1/task-submissions/{submissionId}/appeals',
  'POST /api/v1/task-submissions/{submissionId}/appeals/{appealId}/decision',
  // Dosya yükleme: yeniden denemede ikinci nesne ve satır açılmaz (routes/files.ts; ADR 0003).
  'POST /api/v1/files',
]
