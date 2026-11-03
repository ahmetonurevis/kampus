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
  // Ders planlama: yeniden denemede ikinci ders açılmaz (routes/lessons.ts; DOM-YTK-069).
  'POST /api/v1/lessons',
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
  // Aydınlatma/rıza metni yayımı ve açık rıza (routes/privacy.ts; DOM-YTK-056, -057, -060).
  'POST /api/v1/privacy-notices',
  'POST /api/v1/consents',
  // Eğitim yılı oluşturma (routes/academic-years.ts; DOM-YTK-063).
  'POST /api/v1/academic-years',
  // Veli–öğrenci bağı kurma (routes/student-guardians.ts; DOM-ILT-070…075).
  'POST /api/v1/students/{studentId}/guardians',
  // Kur oluşturma (routes/courses.ts; DOM-DIL-005).
  'POST /api/v1/courses',
  // Grup planlama (routes/language-groups.ts; IST-077, DOM-DIL-008).
  'POST /api/v1/groups',
  // Ödev verme ve teslim: yeniden denemede ikinci ödev ya da teslim açılmaz (routes/homework.ts;
  // DOM-AKD-070, DOM-AKD-072).
  'POST /api/v1/homework',
  'POST /api/v1/homework/{homeworkId}/submissions',
  // Quiz hazırlama, deneme başlatma ve gönderim: yeniden denemede ikinci quiz açılmaz, ağ
  // yinelemesi ilk yanıtı alır (routes/quizzes.ts; DOM-AKD-075, DOM-AKD-077).
  'POST /api/v1/quizzes',
  'POST /api/v1/quizzes/{quizId}/attempt',
  'POST /api/v1/quizzes/{quizId}/attempt/submit',
  // İzin formu açma ve veli kararı: yeniden denemede ikinci form ya da karar satırı açılmaz
  // (routes/permission-forms.ts; DOM-ILT-036, DOM-ILT-037).
  'POST /api/v1/permission-forms',
  'POST /api/v1/permission-forms/{formId}/decisions',
  // Personel daveti: yeniden denemede ikinci hesap, üyelik ya da parola bağlantısı açılmaz
  // (routes/institution-members.ts; DOM-YTK-070).
  'POST /api/v1/institution-members/invitations',
]
