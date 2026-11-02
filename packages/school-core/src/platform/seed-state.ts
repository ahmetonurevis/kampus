import type { AttendanceCorrection } from '../lib/domain.ts'
import type { OfficialGradeFields } from '../lib/grades.ts'
import type {
  AnnouncementFields,
  ConversationFields,
  ConversationMessageFields,
} from '../lib/communication.ts'
import type { AbsenceReasonCategory, RequestActor, RequestFields } from '../lib/requests.ts'
import type { AppointmentFields } from '../lib/appointments.ts'
import type { QuestionFields } from '../lib/questions.ts'
import type { NotificationReadRecord, NotificationRecord } from '../lib/notifications.ts'
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

export type Patch<T, P> = Omit<T, keyof P> & P
export type Item<S, K extends keyof S> = S[K] extends readonly (infer T)[] ? T : never
export type Timestamps = { createdAt?: string; updatedAt?: string }

export type PlatformStatePatches<S extends Record<SeedCollections, unknown>> = {
  // Not girişinin alanları; örnek veri ve eski kayıtlar bunları taşımaz (lib/grades.ts).
  grades: (Item<S, 'grades'> & Partial<OfficialGradeFields>)[]
  // Düzeltme geçmişi; ilk kez alınan yoklama ve örnek veri taşımaz (DOM-AKD-035).
  attendance: (Item<S, 'attendance'> & { corrections?: AttendanceCorrection[] })[]
  // İş akışıyla eklenen dersin adı ders listesinden okunur; listede yoksa boş kalır. Eski
  // kayıtlarda ders adı `subject` alanındadır.
  schedule: (Patch<Item<S, 'schedule'>, { title?: string; subject?: string }> &
    Timestamps & {
      cancelledAt?: string
      // kvkk: Ç — iptal gerekçesi (DOM-YTK-069); öğrenci ve veliye dönmez
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
    // TODO(kvkk-mazeret-notu): Serbest açıklama F2'de şifreli ayrı tabloyla gelir.
    reason?: string
    status?: string
    date?: string
    createdAt?: string
    notifiedBy?: RequestActor
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
  submissions: (Item<S, 'submissions'> & {
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
}
