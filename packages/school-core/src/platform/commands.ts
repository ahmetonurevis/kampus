import {
  CONFLICTS,
  SCOPE,
  spec,
  workflow,
  type CommandSpec,
  type ModuleCommandSpec,
} from '../modules/command-builders.ts'

/**
 * Platform komut tabloları: Onur'un kayıt ve finans komutları dışındaki her komut (iş akışı,
 * optik/etüt otomasyonu, temel yazma işlemleri). Birleşik tablo ve sözleşme
 * `modules/commands.ts`'tedir; bir komut adı iki kaynakta bulunamaz
 * (`tests/commands.test.ts`).
 */

/** Okul iş akışı komutları (`runWorkflow`); yenileme komutları Onur bloğundadır. */
export const PLATFORM_WORKFLOW_COMMANDS = {
  goal: workflow('goals', ['studentGoals', 'mockExams', 'mockResults']),
  'goal-review': workflow('goals', ['studentGoals']),
  'goal-step': workflow('goals', ['studentGoals']),
  'goal-step-done': workflow('goals', ['studentGoals']),
  'goal-suggest': workflow('goals', ['studentGoals', 'mockResults', 'subjects']),
  'goal-comment': workflow('goals', ['studentGoals']),
  'goal-close': workflow('goals', ['studentGoals']),
  guidance: workflow('guidance', ['guidanceCases']),
  'guidance-note': workflow('guidance', ['guidanceCases']),
  exam: workflow('exams', ['mockExams']),
  'exam-result': workflow('exams', ['mockExams', 'mockResults']),
  'exam-import': workflow('exams', ['mockExams', 'mockResults']),
  lesson: workflow('planning', ['branches', 'subjects', ...CONFLICTS]),
  substitute: workflow('planning', ['branches', 'subjects', ...CONFLICTS]),
  // Yoklaması alınmış ders günü iptal edilmez (DOM-YTK-069).
  'lesson-cancel': workflow('planning', ['schedule', 'attendance']),
  'study-task': workflow('study', ['studyTasks']),
  'study-complete': workflow('study', ['studyTasks']),
  'study-review': workflow('study', ['studyTasks']),
  event: workflow('calendar', ['branches', ...CONFLICTS]),
  consent: workflow('calendar', ['schoolEvents', 'eventConsents']),
  'event-cancel': workflow('calendar', ['schoolEvents']),
  route: workflow('transport', ['branches', 'transportRoutes', 'transportAssignments']),
  'route-archive': workflow('transport', ['transportRoutes', 'transportAssignments']),
  'transport-assign': workflow('transport', ['transportRoutes', 'transportAssignments']),
  'transport-remove': workflow('transport', ['transportRoutes', 'transportAssignments']),
  meal: workflow('meals', ['branches', 'mealMenus']),
  club: workflow('clubs', ['branches']),
  'club-enroll': workflow('clubs', ['clubMemberships']),
  'club-leave': workflow('clubs', ['clubMemberships']),
  'club-attendance': workflow('clubs', ['clubMemberships', 'clubAttendance']),
  achievement: workflow('clubs', ['clubMemberships', 'socialAchievements']),
  'club-archive': workflow('clubs', ['clubMemberships']),
} as const satisfies Record<string, ModuleCommandSpec>

const OPTICAL = ['mockExams', 'mockResults', 'opticalProfiles', 'opticalEvaluations'] as const
/** Optik değerlendirme ve otomatik etüt komutları (`runAssessment`). */
export const ASSESSMENT_COMMANDS = {
  profile: workflow('optical', ['mockExams', 'opticalProfiles', 'subjects']),
  evaluate: workflow('optical', [...OPTICAL]),
  plan: workflow('tutoring', [...OPTICAL, 'branches', 'availability', ...CONFLICTS]),
  slot: workflow('tutoring', ['availability', ...CONFLICTS]),
  // Randevusu olan saat kaldırılamaz (DOM-ILT-101); randevular okunur, yazılmaz.
  'slot-remove': workflow('tutoring', ['availability', 'appointments']),
  cancel: workflow('tutoring', ['tutorSessions']),
  attendance: workflow('tutoring', ['tutorSessions']),
} as const satisfies Record<string, ModuleCommandSpec>
/** Temel yazma işlemleri (anahtarlar `lib/authorize.ts` eylem adlarıdır); kayıt ve finans dışında. */
export const PLATFORM_OPERATION_COMMANDS = {
  'attendance.record': spec('academic', [...SCOPE, 'attendance']),
  'grade.record': spec('academic', [...SCOPE, 'grades', 'quizzes', 'quizAttempts']),
  'grade.update': spec('academic', [...SCOPE, 'grades']),
  'record.archive': spec(null, [
    ...SCOPE,
    'branches',
    'contracts',
    'guidanceCases',
    'homework',
    'submissions',
    'questions',
    'prospects',
    'renewals',
    'studyTasks',
    'availability',
    'mealMenus',
    'clubMemberships',
    'transportRoutes',
    'transportAssignments',
    ...CONFLICTS,
  ]),
  'record.restore': spec(null, [...SCOPE, 'branches']),
  // Kampüs/öğretmen/sınıf kaydı (`saveBranch`, `saveTeacher`, `saveClass`): çekirdek kayıtlar,
  // modül kapatılamaz. Öğretmen kampüs/branş değişikliği gelecek etütleri, sınıf düzenlemesi
  // program/randevu/etüt/etkinlik çakışmalarını denetler ve açık ödev, soru, quiz ve çalışma
  // görevlerini yeni ders öğretmenine taşır.
  'branch.save': spec(null, [...SCOPE, 'branches']),
  'teacher.save': spec(null, [...SCOPE, 'branches', 'tutorSessions']),
  'class.save': spec(null, [
    ...SCOPE,
    'branches',
    'homework',
    'submissions',
    'questions',
    'quizzes',
    'quizAttempts',
    'studyTasks',
    ...CONFLICTS,
  ]),
  // İletişim (`lib/communication.ts`); alıcı çözümü kampüs listesini de okur.
  'announcement.publish': spec('communication', [...SCOPE, 'branches', 'announcements']),
  'announcement.revise': spec('communication', [...SCOPE, 'announcements']),
  'announcement.withdraw': spec('communication', [...SCOPE, 'announcements']),
  'announcement.read': spec('communication', [...SCOPE, 'announcements']),
  // Mesajlar ayrı kayıtlardır (ADR 0005). API bu komutlarda koleksiyonları kısmi yükler: yalnız
  // hedef yazışma, aynı öğrencinin yazışmaları ve yalnız okunmamış karşı taraf mesajları
  // (`services/communication.ts`); mesaj gönderimi var olan mesajları hiç yüklemez.
  'conversation.start': spec('communication', [...SCOPE, 'conversations', 'conversationMessages']),
  'message.send': spec('communication', [...SCOPE, 'conversations', 'conversationMessages']),
  'message.read': spec('communication', [...SCOPE, 'conversations', 'conversationMessages']),
  'conversation.access': spec('communication', [...SCOPE, 'conversations']),
  // Talep ve izin/mazeret (`lib/requests.ts`). API talep açarken talepleri hiç, güncellerken
  // yalnız hedef talebi; bildirimde yalnız aynı öğrencinin bildirimlerini yükler.
  'request.open': spec('communication', [...SCOPE, 'requests']),
  'request.update': spec('communication', [...SCOPE, 'requests']),
  'absence.notify': spec('academic', [...SCOPE, 'absences']),
  // Randevu (`lib/appointments.ts`): talep seçilen uygunluk saatini, onay ve talep çakışmayı
  // okur (DOM-ILT-101). API talepte yalnız seçilen uygunluk saatini yükler.
  'appointment.book': spec('communication', [...SCOPE, 'availability', ...CONFLICTS]),
  'appointment.update': spec('communication', [...SCOPE, ...CONFLICTS]),
  // Alınabilir saat listesi (DOM-ILT-105): yazmaz; her saati talepteki çakışma denetiminden
  // geçirir, öğretmenin kampüs ve ders adını okur.
  'appointment.slots': spec('communication', [
    ...SCOPE,
    'availability',
    'branches',
    'subjects',
    ...CONFLICTS,
  ]),
  // Öğretmenime Sor (`lib/questions.ts`); kazanım denetimi ders listesini okur. API soru açarken
  // soruları hiç, yanıt ve geri çekmede yalnız hedef soruyu yükler.
  'question.ask': spec('learning', [...SCOPE, 'subjects', 'questions']),
  'question.answer': spec('learning', [...SCOPE, 'questions']),
  'question.withdraw': spec('learning', [...SCOPE, 'questions']),
  // Uygulama içi bildirimin okundu işareti (`lib/notifications.ts`, DOM-ILT-020, -073). Görünürlük
  // üyelik bağlantılarındandır; kapsam kaynağı yalnız yetki (modül, rol) için okunur. API yalnız
  // aktörün gördüğü bildirimleri ve kendi okundu işaretlerini yükler.
  'notification.read': spec('communication', [...SCOPE, 'notifications', 'notificationReads']),
  'notification.read_all': spec('communication', [...SCOPE, 'notifications', 'notificationReads']),
  // Aydınlatma ve açık rıza (`lib/privacy-notices.ts`, `lib/consents.ts`; DOM-YTK-056…062):
  // platform yeteneğidir, modül kapatılamaz (aydınlatma ve geri çekme her zaman açık olmalı).
  // Kayıtlar ilişkisel tablolardadır (`privacy_notices`, `notice_acknowledgements`, `consents`);
  // API kapsam kaynağını yalnız okuma kapsamı (`consent.read`, `consent.status`) için yükler.
  'notice.publish': spec(null, [...SCOPE]),
  'notice.acknowledge': spec(null, [...SCOPE]),
  'consent.give': spec(null, [...SCOPE]),
  'consent.withdraw': spec(null, [...SCOPE]),
  'consent.read': spec(null, [...SCOPE]),
  'consent.status': spec(null, [...SCOPE]),
  // Eğitim yılı ve dönem (`lib/academic-years.ts`; DOM-YTK-063…067): çekirdek kurum ayarıdır,
  // modül kapatılamaz. Kayıtlar ilişkisel tablolardadır (`academic_years`, `academic_terms`);
  // koleksiyon yüklenmez, liste yalnız tablo okumasıdır.
  'academicYear.read': spec(null, [...SCOPE]),
  'academicYear.manage': spec(null, [...SCOPE]),
  // Veli–öğrenci bağı (`lib/guardianship.ts`; DOM-ILT-070…075): platform yeteneğidir (velayet
  // rıza ve kapsamın girdisidir), modül kapatılamaz. Kayıtlar `student_guardians` tablosundadır.
  'guardian.read': spec(null, [...SCOPE]),
  'guardian.manage': spec(null, [...SCOPE]),
  // Dil okulu kur programı (`lib/courses.ts`; DOM-DIL-005…007): modüle bağlı değildir, kurum türüne
  // bağlıdır (yalnız `language_school`; okulda 404). Kayıtlar ilişkisel tablodadır (`courses`).
  'course.read': spec(null, [...SCOPE]),
  'course.manage': spec(null, [...SCOPE]),
  'course.eozel': spec(null, [...SCOPE]),
  // Dil okulu grubu (`lib/language-groups.ts`; IST-077, DOM-DIL-008, -040…043): kur gibi modüle
  // değil kurum türüne bağlıdır (okulda 404). Kayıtlar ilişkisel tablolardadır (`language_groups`,
  // `language_group_members`, `language_group_waitlist`).
  'group.read': spec(null, [...SCOPE]),
  'group.manage': spec(null, [...SCOPE]),
  'group.waitlist': spec(null, [...SCOPE]),
} as const satisfies Record<string, CommandSpec>
