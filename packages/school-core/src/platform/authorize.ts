import type { QuestionParties } from '../lib/authorize.ts'
import type { HomeworkParties } from '../lib/homework.ts'
import type { AnnouncementPublisher, AnnouncementTarget } from '../lib/communication.ts'
import type { ConversationParties } from '../lib/communication-access.ts'
import type { ArchiveKind } from '../lib/school-management.ts'
import type { QuizParties } from '../lib/quiz.ts'
import type { Role } from '../modules/navigation.ts'
import type { PLATFORM_OPERATION_COMMANDS } from './commands.ts'

/**
 * Platform yetki tabloları: Onur'un kayıt ve finans eylemleri dışındaki her temel yazma eyleminin
 * hedef tipi ve rol matrisi. Anahtarlar `platform/commands.ts` `PLATFORM_OPERATION_COMMANDS`
 * ile aynıdır (rol tablosunu tip denetler). Birleşik tablolar, karar mantığı (`authorize`, kapsam denetimi) ve
 * Onur bloğu `lib/authorize.ts`'tedir; bir eylem iki kaynakta bulunamaz
 * (`tests/authorize.test.ts`).
 */

type PlatformAction = keyof typeof PLATFORM_OPERATION_COMMANDS

/** Eylem başına yetkinin dayandığı hedef bilgisi; kimlikler istemciden gelse de kapsamla denetlenir. */
export type PlatformWriteTargets = {
  /** `reason`: yönetici düzeltmesinin gerekçesi (DOM-AKD-035). */
  'attendance.record': { classId: string; date: string; reason?: string }
  'grade.record': { studentId: string; subjectId: string }
  /**
   * `reason`: not düzeltmesinin gerekçesi (DOM-AKD-051). `classId`: notun verildiği sınıf; yetki
   * öğrencinin güncel sınıfına değil buna göre verilir. Sınıfı saklanmamış eski notta öğrencinin
   * güncel sınıfı kullanılır.
   */
  'grade.update': { studentId: string; subjectId: string; classId?: string; reason?: string }
  'record.archive': { kind: ArchiveKind }
  'record.restore': { kind: ArchiveKind }
  // Oluşturma ve düzenleme aynı eylemdir; kural ve çakışmalar işlemdedir (`lib/school-management.ts`).
  'branch.save': Record<string, never>
  'teacher.save': Record<string, never>
  'class.save': Record<string, never>
  // İletişim (DOM-ILT-001…024, DOM-YTK-052); kararlar `lib/communication-access.ts`.
  'announcement.publish': { target: AnnouncementTarget; category: string }
  /** Kayıt yoksa `undefined`; varlık işlemin işidir (404). */
  'announcement.revise': { announcement: { publishedBy?: AnnouncementPublisher } | undefined }
  'announcement.withdraw': { announcement: { publishedBy?: AnnouncementPublisher } | undefined }
  'announcement.read': Record<string, never>
  'conversation.start': ConversationParties
  /**
   * `parentUserIds`: yazışmanın öğrencisine velayetli ve kısıtsız bağı olan veli hesapları
   * (API `student_guardians`'tan verir; DOM-ILT-070, -074). Verilmezse veli kısıtı denetlenmez.
   */
  'message.send': {
    conversation: ConversationParties | undefined
    userId: string
    parentUserIds?: readonly string[] | undefined
  }
  'message.read': { conversation: ConversationParties | undefined; userId: string }
  'conversation.access': { reason: string; conversation?: ConversationParties | undefined }
  // Talep ve izin/mazeret (`lib/requests.ts`): hedef öğrenci istemciden gelir, kapsamla denetlenir.
  'request.open': { studentId: string }
  'request.update': Record<string, never>
  'absence.notify': { studentId: string }
  // Randevu (`lib/appointments.ts`): talep hedef öğrenciyle; durum değişikliğinin kaydı ve
  // aktörün o kayıttaki rolü (öğretmen, talep eden) işlemde denetlenir.
  'appointment.book': { studentId: string }
  'appointment.update': Record<string, never>
  /** Saat listesi (DOM-ILT-105): yazma değil okuma; hedef öğrenci istemciden gelir. */
  'appointment.slots': { studentId: string }
  // Öğretmenime Sor (`lib/questions.ts`): öğrenci oturumdan, ders ve öğretmen gövdeden gelir; kayıt
  // yoksa `undefined` (varlık işlemin işidir, 404).
  'question.ask': { studentId: string | undefined; subjectId: string; teacherId?: string }
  'question.answer': { question: QuestionParties | undefined }
  'question.withdraw': { question: QuestionParties | undefined }
  // Ödev (`lib/homework.ts`; DOM-AKD-070…073): sınıf ve ders gövdeden, öğrenci oturumdan gelir;
  // kayıt yoksa `undefined` (varlık işlemin işidir, 404).
  'homework.assign': { classId: string; subjectId: string }
  'homework.update': { homework: HomeworkParties | undefined }
  'homework.archive': { homework: HomeworkParties | undefined }
  'homework.submit': { studentId: string | undefined; homework: { classId: string } | undefined }
  'homework.grade': { homework: HomeworkParties | undefined }
  // Bildirim okundu işareti: görünürlük `lib/notifications.ts` `canSeeNotification`'dadır.
  'notification.read': Record<string, never>
  'notification.read_all': Record<string, never>
  // Aydınlatma ve açık rıza (DOM-YTK-056…062): kim rıza verir ve geri çeker kararı
  // `lib/consents.ts` (`requireConsentAuthority`, `planConsentWithdrawal`), gösterim kararı
  // `lib/privacy-notices.ts`'tedir; burada yalnız rol ve okuma kapsamı.
  'notice.publish': Record<string, never>
  'notice.acknowledge': Record<string, never>
  'consent.give': Record<string, never>
  'consent.withdraw': Record<string, never>
  /** Rıza satırları; `studentId` yoksa aktörün kendi hesap rızaları (tanıtım iletisi). */
  'consent.read': { studentId: string | undefined }
  /** Amaç başına geçerli rıza sonucu (var/yok); `studentId` yoksa aktörün hesap amaçları. */
  'consent.status': { studentId: string | undefined }
  // Eğitim yılı ve dönem (DOM-YTK-063…067): kural `lib/academic-years.ts`; okuma alan kapsamı
  // `academicYearView`'dadır (öğrenci ve veli yalnız ad, tarih, etkinlik).
  'academicYear.read': Record<string, never>
  'academicYear.manage': Record<string, never>
  // Veli–öğrenci bağı (DOM-ILT-070…075): kural `lib/guardianship.ts`; okuma alan kapsamı
  // `guardianLinksView`'dadır (veli yalnız kendi bağını, kısıt alanı olmadan görür).
  'guardian.read': Record<string, never>
  'guardian.manage': Record<string, never>
  // Dil okulu kur programı (DOM-DIL-005…007): kural `lib/courses.ts`. Koordinatörün seviye kapsamı
  // (`assertCourseManager`) ve öğrenci/veli görünümü (`courseView`) orada çözülür.
  'course.read': Record<string, never>
  'course.manage': Record<string, never>
  'course.eozel': Record<string, never>
  // Dil okulu grubu (IST-077; DOM-DIL-008, -040…043): kural `lib/language-groups.ts`. Koordinatörün
  // seviye kapsamı (`assertCourseManager`), satır kapsamı (`canReadGroup`) ve öğrenci/veli görünümü
  // (`groupView`) orada çözülür.
  'group.read': Record<string, never>
  'group.manage': Record<string, never>
  'group.waitlist': Record<string, never>
  // Quiz (`lib/quiz.ts`; DOM-AKD-075…078): sınıf ve ders gövdeden, öğrenci oturumdan gelir;
  // kayıt yoksa `undefined` (varlık işlemin işidir, 404).
  'quiz.create': { classId: string; subjectId: string }
  'quiz.update': { quiz: QuizParties | undefined }
  'quiz.archive': { quiz: QuizParties | undefined }
  'quiz.start': { studentId: string | undefined; quiz: { classId: string } | undefined }
  'quiz.submit': { studentId: string | undefined; quiz: { classId: string } | undefined }
}

/** Matrisin bu eylemlerdeki varsayılanı (rapor ve testler için; kapsam kuralları `lib/authorize.ts`). */
export const PLATFORM_WRITE_ACTION_ROLES = {
  // Yoklama: öğretmen ders verdiği sınıfta aynı gün; yönetici gerekçeyle düzeltir (DOM-YTK-022,
  // DOM-AKD-035, DOM-AKD-054).
  'attendance.record': ['yonetici', 'ogretmen'],
  // Not girişi yalnız atandığı sınıf + dersin öğretmenindedir; yönetici yalnız gerekçeli düzeltme
  // yapar (yetki matrisi "Not, değerlendirme", DOM-AKD-054).
  'grade.record': ['ogretmen'],
  'grade.update': ['yonetici', 'ogretmen'],
  // Kampüs, sınıf, kadro yalnız yöneticidedir (yetki matrisi, DOM-YTK-020).
  'record.archive': ['yonetici'],
  'record.restore': ['yonetici'],
  // Kampüs, sınıf ve kadro kaydı da yalnız yöneticinindir: ön büro sınıf ve kontenjanı yalnız
  // okur, öğretmen kendi sınıflarını okur (yetki matrisi "Kampüs, sınıf, kadro", DOM-YTK-001).
  'branch.save': ['yonetici'],
  'teacher.save': ['yonetici'],
  'class.save': ['yonetici'],
  // Duyuruyu yönetici, idari konuda ön büro, kendi sınıflarına öğretmen yayınlar; öğrenci ve
  // veli yayınlamaz (DOM-ILT-002). Düzeltme ve geri çekme yayınlayan veya yöneticidedir (DOM-ILT-004).
  'announcement.publish': ['yonetici', 'onburo', 'ogretmen'],
  'announcement.revise': ['yonetici', 'onburo', 'ogretmen'],
  'announcement.withdraw': ['yonetici', 'onburo', 'ogretmen'],
  // Okundu işareti alıcınındır; görünürlük kapsamdadır (DOM-ILT-003).
  'announcement.read': ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'],
  // Birebir yazışma öğretmen, öğrenci ve veli arasındadır (DOM-ILT-010, -011, -012, -024).
  'conversation.start': ['ogretmen', 'ogrenci', 'veli'],
  'message.send': ['ogretmen', 'ogrenci', 'veli'],
  'message.read': ['ogretmen', 'ogrenci', 'veli'],
  // Yöneticinin yazışmayı okuması gerekçeli ve denetim kayıtlı ayrı işlemdir (DOM-YTK-052).
  'conversation.access': ['yonetici'],
  // Talebi veli bağlı çocuğu için açar; durum, ilgili birim ve yanıt ön büro ve yöneticidedir.
  // Yetişkin kursiyerin kendi adına talebi henüz yoktur (DOM-YTK-030).
  // TODO(adult-learner): dil okulunda kursiyer (`ogrenci`) kendi talebini ve bildirimini açar.
  'request.open': ['veli'],
  'request.update': ['yonetici', 'onburo'],
  // İzin ve mazereti veli bildirir (DOM-ILT-053); ön büro yoklama ve mazeret görmez (DOM-YTK-021).
  'absence.notify': ['veli'],
  // Randevuyu veli bağlı çocuğu, öğrenci kendisi için talep eder; onay ve red ilgili
  // öğretmenindir, geri çekme talep edenindir (DOM-ILT-100, -102). Yönetici ve ön büro yazmaz.
  // TODO(randevu-yonetici-iptal): yöneticinin onaylı randevuyu iptal etmesi kural olarak yok.
  'appointment.book': ['ogrenci', 'veli'],
  'appointment.update': ['ogretmen', 'ogrenci', 'veli'],
  // Alınabilir saat listesi yalnız talep açan rollerindir (DOM-ILT-105): `available` bir öğrencinin
  // gözünden hesaplanır ve yalnız talep ekranında anlamlıdır. Öğretmen ve yönetici uygunluk
  // saatlerini ham koleksiyondan (`availability`) zaten okur; ön büro randevu görmez (DOM-ILT-103).
  'appointment.slots': ['ogrenci', 'veli'],
  // Öğretmenime Sor: soruyu öğrenci kendi sınıfının ders öğretmenine gönderir ve yanıtsızken geri
  // çeker; yanıtı yalnız sorunun atandığı öğretmen yazar. Veli çocuğunun sorusunu salt okur;
  // yönetici ve ön büro soru yazmaz (DOM-ILT-090…093).
  'question.ask': ['ogrenci'],
  'question.answer': ['ogretmen'],
  'question.withdraw': ['ogrenci'],
  // Ödevi derse giren öğretmen kendi sınıf ve branşına, yönetici her sınıfa verir; düzenleme ve
  // arşiv ödevin öğretmeni ya da yöneticidedir. Teslim öğrencinin, değerlendirme ödevin
  // öğretmeninindir; veli salt okur, ön büro ödev görmez (DOM-AKD-070…074, DOM-YTK-021).
  'homework.assign': ['yonetici', 'ogretmen'],
  'homework.update': ['yonetici', 'ogretmen'],
  'homework.archive': ['yonetici', 'ogretmen'],
  'homework.submit': ['ogrenci'],
  'homework.grade': ['ogretmen'],
  // Bildirimin okundu işareti alıcınındır; her rol kendi bildirim merkezini kullanır, görünürlük
  // `lib/notifications.ts` `canSeeNotification`'dadır (DOM-ILT-020, DOM-ILT-073).
  'notification.read': ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'],
  'notification.read_all': ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'],
  // Aydınlatma metnini yönetici yayımlar; her rol kendi kitlesinin metnini görür ve gösterimini
  // kaydeder (DOM-YTK-056).
  'notice.publish': ['yonetici'],
  'notice.acknowledge': ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'],
  // Rızayı velayetli veli ya da 18 yaşını doldurmuş öğrenci verir ve geri çeker; itirazı 18 yaş
  // altı öğrenci kendisi verir. Personel rıza vermez (DOM-YTK-057, -059, -062).
  'consent.give': ['ogrenci', 'veli'],
  'consent.withdraw': ['ogrenci', 'veli'],
  // Yetki matrisi "Fotoğraf/video rızası": yönetici ve ön büro okur, öğretmen yalnız sonucu
  // (var/yok) görür, öğrenci ve veli kendi kapsamını okur.
  'consent.read': ['yonetici', 'onburo', 'ogrenci', 'veli'],
  'consent.status': ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'],
  // Takvim herkesin okuduğu kurum bilgisidir; yılı, dönemi ve yıl geçişini yalnız yönetici
  // yönetir (DOM-YTK-067, DOM-YTK-020).
  'academicYear.read': ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'],
  'academicYear.manage': ['yonetici'],
  // Velayet ve veli bağını yönetici veya yetkili ön büro belgeye dayanarak değiştirir
  // (DOM-ILT-071); veli yalnız kendi bağını okur (DOM-ILT-073).
  'guardian.read': ['yonetici', 'onburo', 'veli'],
  'guardian.manage': ['yonetici', 'onburo'],
  // Kur kataloğunu beş rol okur (öğrenci ve veli yalnız etkin kurları, daraltılmış). Kuru yönetici
  // ve seviyenin akademik koordinatörü (öğretmen + görev, DOM-YTK-027) yönetir; e-Özel kaydını
  // yalnız yönetici işaretler (DOM-DIL-005, -006; IST-076).
  'course.read': ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'],
  'course.manage': ['yonetici', 'ogretmen'],
  'course.eozel': ['yonetici'],
  // Grubu yönetici ve kurun seviyesinin akademik koordinatörü planlar; ön büro okur; öğretmen kendi
  // grubunu, öğrenci ve veli kendi grubunu daraltılmış okur. Bekleme sırasını yönetici ve ön büro
  // okur (DOM-DIL-043; yazma kayıt akışındadır, ON-058).
  'group.read': ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'],
  'group.manage': ['yonetici', 'ogretmen'],
  'group.waitlist': ['yonetici', 'onburo'],
  // Quizi yönetici ya da sınıfın o dersine atanmış öğretmen hazırlar, düzenler ve arşivler;
  // denemeyi öğrenci başlatır ve gönderir. Veli çocuğunun sonucunu salt okur, ön büro quiz
  // görmez (DOM-AKD-075…079, DOM-YTK-021).
  'quiz.create': ['yonetici', 'ogretmen'],
  'quiz.update': ['yonetici', 'ogretmen'],
  'quiz.archive': ['yonetici', 'ogretmen'],
  'quiz.start': ['ogrenci'],
  'quiz.submit': ['ogrenci'],
} as const satisfies Record<PlatformAction, readonly Role[]>
