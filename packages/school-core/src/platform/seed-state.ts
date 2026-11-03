import type { AttendanceCorrection } from '../lib/domain.ts'
import type { OfficialGradeFields } from '../lib/grades.ts'
import type {
  AnnouncementFields,
  ConversationFields,
  ConversationMessageFields,
} from '../lib/communication.ts'
import type {
  AbsenceApprovalStatus,
  AbsenceReasonCategory,
  RequestActor,
  RequestFields,
} from '../lib/requests.ts'
import type { AppointmentFields } from '../lib/appointments.ts'
import type { QuestionFields } from '../lib/questions.ts'
import type { HomeworkFields, SubmissionFields } from '../lib/homework.ts'
import type { NotificationReadRecord, NotificationRecord } from '../lib/notifications.ts'
import type { PermissionDecisionRecord, PermissionFormRecord } from '../lib/permission-forms.ts'
import type {
  AuditEntry,
  ClubAttendanceRecord,
  EventConsent,
  GoalComment,
  GoalStep,
  GuidanceNote,
  LessonSubstitution,
} from '../lib/school-workflows.ts'
import type { OpticalEvaluation, TutorSession } from '../lib/assessment-automation.ts'
import type { QuizAttemptFields, QuizFields } from '../lib/quiz.ts'

/**
 * `State` tipinin Oğuzhan'a ait yama alanları: örnek veride boş başlayan koleksiyonlar ile
 * işlemlerin sonradan eklediği isteğe bağlı alanlar. Kayıt ve finans alanları (öğrenci, veli,
 * fatura, sözleşme, aday, yenileme, kayıt geçmişi) `data/seed.ts`'teki Onur bloğundadır;
 * `State` ikisinin birleşimidir. `S`, örnek veri üreticisinden türetilen tiptir.
 */
export type SeedCollections =
  | 'grades'
  | 'attendance'
  | 'schedule'
  | 'requests'
  | 'questions'
  | 'homework'
  | 'submissions'
  | 'materials'
  | 'announcements'
  | 'conversations'
  | 'conversationMessages'
  | 'appointments'
  | 'guidanceCases'
  | 'mockExams'
  | 'mockResults'
  | 'studentGoals'
  | 'studyTasks'
  | 'schoolEvents'
  | 'transportRoutes'
  | 'transportAssignments'
  | 'mealMenus'
  | 'clubs'
  | 'clubMemberships'
  | 'socialAchievements'
  | 'quizzes'
  | 'quizAttempts'

export type Patch<T, P> = Omit<T, keyof P> & P
export type Item<S, K extends keyof S> = S[K] extends readonly (infer T)[] ? T : never
export type Timestamps = { createdAt?: string; updatedAt?: string }

export type PlatformStatePatches<S extends Record<SeedCollections, unknown>> = {
  // Not girişinin alanları; örnek veri ve eski kayıtlar bunları taşımaz (lib/grades.ts).
  grades: (Item<S, 'grades'> & Partial<OfficialGradeFields>)[]
  // Düzeltme geçmişi; ilk kez alınan yoklama ve örnek veri taşımaz (DOM-AKD-035). `lateMinutes`
  // yalnız `late` durumunda ve isteğe bağlıdır (DOM-AKD-036).
  attendance: (Item<S, 'attendance'> & {
    corrections?: AttendanceCorrection[]
    lateMinutes?: number
  })[]
  // İş akışıyla eklenen dersin adı ders listesinden okunur; listede yoksa boş kalır. Eski
  // kayıtlarda ders adı `subject` alanındadır.
  schedule: (Patch<Item<S, 'schedule'>, { title?: string; subject?: string }> &
    Timestamps & {
      cancelledAt?: string
      // kvkk: Ç — iptal gerekçesi (DOM-YTK-069); yalnız yöneticiye döner
      // (`PLATFORM_HIDDEN_FIELDS`, DOM-YTK-068).
      cancelReason?: string
      originalTeacherId?: string
      // kvkk: Ç — görevlendirme gerekçesi öğretmenin izin/sağlık durumunu söyleyebilir.
      substitutions?: LessonSubstitution[]
    })[]
  // Web bildirimi `status` ve `date` yazar; çevrimdışı telefon yalnız `createdAt` yazar. API
  // bildirimi (`lib/requests.ts`) ikisini ve bildiren kişiyi yazar.
  absences: {
    id: string
    studentId: string
    startDate: string
    endDate: string
    /** Tür etiketi; API bildirimi `reasonCategory` etiketini yazar, eski kayıt kendi metnini. */
    category: string
    // kvkk: Ç — genel gerekçe kategorisi (`lib/requests.ts`); eski kayıt ve telefon taşımaz.
    reasonCategory?: AbsenceReasonCategory
    // kvkk: Ö — eski kayıtların serbest açıklaması; API bildirimi yazmaz (DOM-ILT-053).
    // TODO(kvkk-mazeret-notu): Serbest açıklama OG-090'ın şifreli Ö tablosuyla gelir.
    reason?: string
    status?: string
    date?: string
    createdAt?: string
    updatedAt?: string
    notifiedBy?: RequestActor
    // İdare onayı (DOM-ILT-053); alanı olmayan eski kayıt `pending` okunur (`absenceApprovalStatus`).
    approvalStatus?: AbsenceApprovalStatus
    decidedAt?: string
    // kvkk: K — kararı veren kullanıcı yalnız personele döner (`PLATFORM_HIDDEN_FIELDS`).
    decidedBy?: RequestActor
    // kvkk: Ö — özür belgesi dosya kimlikleri; dosya adı ve içerik kayda girmez.
    fileIds?: string[]
  }[]
  // Talep işlemlerinin alanları; örnek veri ve eski kayıtlar taşımaz (lib/requests.ts).
  requests: (Item<S, 'requests'> & RequestFields)[]
  // Telefon yüklenen dosyanın cihazdaki yolunu da saklar; örnek veri ve web taşımaz.
  // Soru işlemlerinin alanları (kazanım, yanıtlayan, ek yanıtlar, geri çekme); örnek veri ve eski
  // kayıtlar taşımaz (lib/questions.ts).
  questions: (Item<S, 'questions'> &
    QuestionFields & {
      // kvkk: Ç — öğrencinin yüklediği dosyanın yolu.
      fileUri?: string | null
    })[]
  // Ödev ve teslim işlemlerinin alanları (geç teslim, dosya kimlikleri, değerlendiren);
  // örnek veri ve eski kayıtlar taşımaz (lib/homework.ts).
  homework: (Item<S, 'homework'> & HomeworkFields)[]
  submissions: (Item<S, 'submissions'> &
    SubmissionFields & {
      // kvkk: Ç — öğrencinin yüklediği ödev dosyasının yolu.
      fileUri?: string | null
      // kvkk: Ç — öğrencinin öğretmene teslim notu.
      note?: string
    })[]
  materials: (Item<S, 'materials'> & { fileUri?: string | null })[]
  // İletişim işlemlerinin alanları; örnek veri ve eski kayıtlar taşımaz (lib/communication.ts).
  announcements: (Item<S, 'announcements'> & AnnouncementFields)[]
  conversations: (Patch<Item<S, 'conversations'>, { lastMessageAt?: string }> &
    ConversationFields)[]
  conversationMessages: (Item<S, 'conversationMessages'> & ConversationMessageFields)[]
  // Uygulama içi bildirim ve kullanıcının okundu işareti (lib/notifications.ts); yalnız API
  // üretir, örnek veri ve çevrimdışı demo boştur.
  notifications: NotificationRecord[]
  notificationReads: NotificationReadRecord[]
  // Dijital veli onayı ve izin formu (lib/permission-forms.ts; IST-067): yalnız API üretir, örnek
  // veri ve çevrimdışı demo boştur. Okul takvimindeki etkinlik onayı `eventConsents`'tedir.
  permissionForms: PermissionFormRecord[]
  permissionDecisions: PermissionDecisionRecord[]
  // Randevu işlemlerinin alanları (süre dakika); eski kayıtlar taşımaz (lib/appointments.ts).
  appointments: (Item<S, 'appointments'> & AppointmentFields)[]
  preferences: Record<string, unknown>
  // Okul iş akışı modülleri kayıttan eklenir; anahtar kümesi derleme anında sabit değildir.
  modules: Record<string, boolean>
  audit: AuditEntry[]
  guidanceCases: Patch<Item<S, 'guidanceCases'>, { notes: GuidanceNote[]; updatedAt?: string }>[]
  mockExams: (Item<S, 'mockExams'> & { updatedAt?: string })[]
  mockResults: (Item<S, 'mockResults'> & {
    source?: string
    evaluationId?: string | null
    updatedAt?: string
  })[]
  studentGoals: Patch<
    Item<S, 'studentGoals'>,
    {
      reviewedAt?: string
      closedAt?: string
      steps: GoalStep[]
      comments: GoalComment[]
    }
  >[]
  studyTasks: (Item<S, 'studyTasks'> & Timestamps & { completedAt?: string; reviewedAt?: string })[]
  schoolEvents: (Item<S, 'schoolEvents'> & { teacherId?: string | null; updatedAt?: string })[]
  eventConsents: EventConsent[]
  transportRoutes: (Item<S, 'transportRoutes'> & { updatedAt?: string })[]
  transportAssignments: (Item<S, 'transportAssignments'> & { updatedAt?: string })[]
  mealMenus: (Item<S, 'mealMenus'> & { updatedAt?: string })[]
  clubs: (Item<S, 'clubs'> & { updatedAt?: string })[]
  clubMemberships: (Item<S, 'clubMemberships'> & { updatedAt?: string })[]
  clubAttendance: ClubAttendanceRecord[]
  socialAchievements: (Item<S, 'socialAchievements'> & { updatedAt?: string })[]
  opticalEvaluations: OpticalEvaluation[]
  tutorSessions: TutorSession[]
  // Quiz ve deneme işlemlerinin alanları (son tarih, deneme durumu ve süresi); örnek veri ve eski
  // kayıtlar taşımaz, alanı olmayan deneme tamamlanmıştır (lib/quiz.ts).
  quizzes: (Item<S, 'quizzes'> & QuizFields)[]
  quizAttempts: (Item<S, 'quizAttempts'> & QuizAttemptFields)[]
}
