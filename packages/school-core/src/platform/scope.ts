import { ANNOUNCEMENT_HIDDEN_FIELDS } from '../lib/communication-access.ts'
import { PARENT_CONTACT_FIELDS } from '../lib/parent-contact.ts'
import type { CollectionName } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import {
  ADMIN,
  ADMIN_FRONT_OFFICE,
  all,
  announcementRule,
  classOrBranch,
  classOrEveryone,
  gradeReader,
  member,
  NONE,
  ownBranch,
  ownClass,
  ownClub,
  ownExam,
  ownGrade,
  ownLevel,
  ownStudent,
  ownTeacher,
  parentMeeting,
  PERSONAL,
  personal,
  requesterId,
  submissionReader,
  text,
  texts,
  type FieldRules,
  type ReadRules,
} from '../modules/scope-builders.ts'

/**
 * Platform kapsam tabloları: Onur'un kayıt ve finans koleksiyonları dışındaki her koleksiyonun
 * okuma kuralı, alan ayıklaması ve maskesi. Birleşik tablolar ve kapsam mantığı
 * `lib/scope.ts`'tedir; bir koleksiyon iki kaynakta bulunamaz (`tests/scope.test.ts`). Yapı
 * taşları `modules/scope-builders.ts`'tedir.
 */

/**
 * Rol × koleksiyon okuma kuralları. Tabloda olmayan rol koleksiyonu okuyamaz (DOM-YTK-001).
 * Ön büro yalnız idari koleksiyonları okur; akademik veri, rehberlik, hedef ve etüt kapalıdır
 * (DOM-YTK-021). Öğretmen kendi sınıfları ve branşıyla sınırlıdır (DOM-YTK-022). Okul iş akışı
 * modüllerinde ayrıca modül kaydının rol listesi uygulanır.
 */
export const PLATFORM_READ_RULES = {
  subjects: { yonetici: all, onburo: all, ogretmen: all, ogrenci: all, veli: all },
  // Kampüs, sınıf, kadro: ön büro sınıf ve kontenjanı okur; diğerleri kendi kampüs/sınıfını.
  branches: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: (c, r) => member(c.branchIds, text(r, 'id')),
    ogrenci: (c, r) => member(c.branchIds, text(r, 'id')),
    veli: (c, r) => member(c.branchIds, text(r, 'id')),
  },
  classes: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: (c, r) => member(c.classIds, text(r, 'id')),
    ogrenci: (c, r) => member(c.classIds, text(r, 'id')),
    veli: (c, r) => member(c.classIds, text(r, 'id')),
  },
  // Öğretmen kendi kaydını; öğrenci ve veli sınıfında ders veren öğretmenleri (iletişimsiz) görür.
  teachers: {
    ...ADMIN,
    ogretmen: (c, r) => !!c.teacher && text(r, 'id') === c.teacher.id,
    ogrenci: (c, r) => member(c.classTeacherIds, text(r, 'id')),
    veli: (c, r) => member(c.classTeacherIds, text(r, 'id')),
  },
  students: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: (c, r) => member(c.studentIds, text(r, 'id')),
    ogrenci: (c, r) => member(c.studentIds, text(r, 'id')),
    veli: (c, r) => member(c.studentIds, text(r, 'id')),
  },
  parents: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
    ogrenci: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
    veli: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
  },
  assignments: { ...ADMIN, ogretmen: ownClass, ogrenci: ownClass, veli: ownClass },
  // Branş öğretmeni kendi dersini, sınıf rehber öğretmeni şubesinin bütün notlarını okur; notun
  // verildiği sınıf da kapsam verir (`gradeReader`).
  grades: { ...ADMIN, ogretmen: gradeReader, ...PERSONAL },
  attendance: { ...ADMIN, ogretmen: ownClass, ...PERSONAL },
  // Mazeret metni sağlık bilgisi içerebilir: öğretmenlerden yalnız sınıf rehber öğretmeni okur;
  // ön büro okumaz (DOM-ILT-053, DOM-YTK-021).
  absences: {
    ...ADMIN,
    ogretmen: (c, r) =>
      ownStudent(c, r) && member(c.homeroomIds, c.studentClass.get(text(r, 'studentId') ?? '')),
    ...PERSONAL,
  },
  schedule: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: (c, r) =>
      !!c.teacher &&
      (text(r, 'teacherId') === c.teacher.id || text(r, 'originalTeacherId') === c.teacher.id),
    ogrenci: ownClass,
    veli: ownClass,
  },
  // Soru bankası cevapları içerir; öğrenci ve veliye açılmaz.
  bank: { ...ADMIN, ogretmen: all },
  quizzes: {
    ...ADMIN,
    ogretmen: (c, r) => ownClass(c, r) || ownTeacher(c, r),
    ogrenci: ownClass,
    veli: ownClass,
  },
  quizAttempts: { ...ADMIN, ogretmen: ownStudent, ...PERSONAL },
  homework: {
    ...ADMIN,
    ogretmen: (c, r) => ownClass(c, r) || ownTeacher(c, r),
    ogrenci: ownClass,
    veli: ownClass,
  },
  // Teslimi ödevin öğretmeni ve öğrencinin sınıf rehber öğretmeni okur; aynı sınıfa başka dersle
  // giren öğretmen teslim notunu, puanını ve dosyasını görmez (DOM-AKD-074, DOM-YTK-022).
  submissions: { ...ADMIN, ogretmen: submissionReader, ...PERSONAL },
  questions: { ...ADMIN, ogretmen: ownTeacher, ...PERSONAL },
  videos: { ...ADMIN, ogretmen: all, ogrenci: ownLevel, veli: ownLevel },
  videoProgress: { ...ADMIN, ogretmen: ownStudent, ...PERSONAL },
  materials: { ...ADMIN, ogretmen: all, ogrenci: ownLevel, veli: ownLevel },
  // Yayında çözülen alıcı listesi varsa yalnız alıcılar ve yayınlayan görür; geri çekilen
  // duyuru alıcılara "Geri çekildi" olarak görünür, metnini yalnız yayınlayan ve yönetici alır;
  // listesi olmayan eski kayıt sınıfa özel veya genel kalır
  // (DOM-ILT-001, DOM-ILT-004; lib/communication-access.ts).
  announcements: {
    yonetici: announcementRule(all),
    onburo: announcementRule(all),
    ogretmen: announcementRule(classOrEveryone),
    ogrenci: announcementRule(classOrEveryone),
    veli: announcementRule(classOrEveryone),
  },
  // Birebir yazışma yalnız taraflarındır; yöneticinin okuması gerekçeli ayrı işlemdir (DOM-YTK-052).
  conversations: {
    ogretmen: ownTeacher,
    ogrenci: (c, r) => ownStudent(c, r) && text(r, 'audience') === 'student',
    veli: (c, r) => ownStudent(c, r) && text(r, 'audience') === 'parent',
  },
  // Mesaj ayrı kayıttır ve yazışmanın taraf anahtarlarını taşır (ADR 0005): yalnız yazışmanın
  // tarafı okur. Velide mesajın veli kimliği de aktörün kendisi olmalıdır; her velinin yazışması
  // ayrıdır, kimliksiz eski kayıt hiçbir veliye açılmaz (DOM-ILT-010, DOM-YTK-052).
  conversationMessages: {
    ogretmen: ownTeacher,
    ogrenci: (c, r) => ownStudent(c, r) && text(r, 'audience') === 'student',
    veli: (c, r) =>
      ownStudent(c, r) &&
      text(r, 'audience') === 'parent' &&
      c.userId !== undefined &&
      text(r, 'parentUserId') === c.userId,
  },
  // Uygulama içi bildirim öğrenciye ait olaydır: öğrenci kendi `student`, veli bağlı çocuğunun
  // `parent` bildirimini görür; personelin bildirimi yoktur (lib/notifications.ts
  // `canSeeNotification`). Okundu işareti yalnız kendi kullanıcısınındır (DOM-ILT-073). API bu
  // iki koleksiyonu genel okumaya açmaz; bildirim ucu aynı kuralı SQL'de uygular.
  notifications: {
    ogrenci: (c, r) => ownStudent(c, r) && text(r, 'audience') === 'student',
    veli: (c, r) => ownStudent(c, r) && text(r, 'audience') === 'parent',
  },
  notificationReads: {
    ogrenci: (c, r) => c.userId !== undefined && text(r, 'userId') === c.userId,
    veli: (c, r) => c.userId !== undefined && text(r, 'userId') === c.userId,
  },
  // Veli görüşmesini öğrenci görmez; veli yalnız kendi açtığını görür, başka velinin görüşmesi
  // ona görünmez (DOM-ILT-103, DOM-ILT-073). Açanı bilinmeyen eski veli görüşmesi kapalıdır.
  // Velayeti olmayan ya da iletişim kısıtlı veli öğrencinin randevusunu görmez: çocuk bağlantısı
  // aktör kurulurken düşer (`lib/guardianship.ts` `guardedActorLinks`; DOM-ILT-070, -074).
  appointments: {
    ...ADMIN,
    ogretmen: ownTeacher,
    ogrenci: (c, r) => ownStudent(c, r) && !parentMeeting(r),
    veli: (c, r) =>
      ownStudent(c, r) &&
      (!parentMeeting(r) || (c.userId !== undefined && requesterId(r) === c.userId)),
  },
  requests: { ...ADMIN_FRONT_OFFICE, ...PERSONAL },
  // İzin formu (DOM-ILT-036, -037): öğretmen açtığı formu ve sınıflarına ya da öğrencilerine
  // açılmış formu, öğrenci ve veli hedefinde kendisi/çocuğu olan formu görür; ön büro görmez.
  permissionForms: {
    ...ADMIN,
    ogretmen: (c, r) =>
      ownTeacher(c, r) ||
      texts(r, 'classIds').some((id) => c.classIds.has(id)) ||
      texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
    ogrenci: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
    veli: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
  },
  // Kararı formun öğretmeni ve öğrencinin öğretmeni görür; veli yalnız kendi verdiği kararı
  // görür, ayrı velilerin kararı ve notu birbirine görünmez (DOM-ILT-073, DOM-ILT-037).
  permissionDecisions: {
    ...ADMIN,
    ogretmen: (c, r) => ownTeacher(c, r) || ownStudent(c, r),
    ogrenci: ownStudent,
    veli: (c, r) =>
      ownStudent(c, r) && c.userId !== undefined && text(r, 'decidedByUserId') === c.userId,
  },
  availability: { ...ADMIN, ogretmen: ownTeacher },
  // Denetim kaydını yalnız yönetici görür (DOM-YTK-053).
  audit: ADMIN,
  // Rehberlik: rehberlik görevli öğretmen kurumun bütün dosyalarını okur (DOM-YTK-026); diğer
  // öğretmen sorumlusu olduğu dosyanın ve sınıflarındaki öğrencilerin paylaşılan planını görür.
  // Yönetici paylaşılan planı okur. Ön büro hiç okumaz (DOM-YTK-021). İç not alanları
  // `PLATFORM_HIDDEN_FIELDS` ile ayıklanır (DOM-ILT-040).
  guidanceCases: {
    ...ADMIN,
    ogretmen: (c, r) => c.counselor || ownTeacher(c, r) || ownStudent(c, r),
    ...PERSONAL,
  },
  mockExams: { ...ADMIN, ogretmen: ownGrade, ogrenci: ownGrade, veli: ownGrade },
  mockResults: { ...ADMIN, ogretmen: ownStudent, ...PERSONAL },
  // Branş öğretmeni kendi dersinin ve genel net hedeflerini görür.
  studentGoals: {
    ...ADMIN,
    ogretmen: (c, r) =>
      ownStudent(c, r) && (!text(r, 'subjectId') || text(r, 'subjectId') === c.teacher?.subjectId),
    ...PERSONAL,
  },
  studyTasks: { ...ADMIN, ogretmen: ownTeacher, ...PERSONAL },
  schoolEvents: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: classOrBranch,
    ogrenci: classOrBranch,
    veli: classOrBranch,
  },
  eventConsents: { ...ADMIN_FRONT_OFFICE, ogretmen: ownStudent, ...PERSONAL },
  transportRoutes: { ...ADMIN_FRONT_OFFICE, ogrenci: ownBranch, veli: ownBranch },
  transportAssignments: { ...ADMIN_FRONT_OFFICE, ...PERSONAL },
  mealMenus: { ...ADMIN_FRONT_OFFICE, ogrenci: ownBranch, veli: ownBranch },
  clubs: { ...ADMIN, ogretmen: ownTeacher, ogrenci: ownBranch, veli: ownBranch },
  clubMemberships: { ...ADMIN, ogretmen: ownClub, ...PERSONAL },
  clubAttendance: { ...ADMIN, ogretmen: ownClub, ...PERSONAL },
  socialAchievements: { ...ADMIN, ogretmen: ownClub, ...PERSONAL },
  // Öğrenci ve veli profili yalnız görebildiği denemenin (düzeyi kendi düzeyi) revizyon eşlemesi
  // için okur; cevap anahtarı alanları gizlidir. Başka düzeyin profili başlık/yerleşim/revizyon
  // olarak da sayılamaz.
  opticalProfiles: { ...ADMIN, ogretmen: all, ogrenci: ownExam, veli: ownExam },
  opticalEvaluations: {
    ...ADMIN,
    ogretmen: (c, r) => ownStudent(c, r) && text(r, 'subjectId') === c.teacher?.subjectId,
    ...PERSONAL,
  },
  tutorSessions: {
    ...ADMIN,
    ogretmen: ownTeacher,
    ogrenci: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
    veli: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
  },
} as const satisfies ReadRules

const GUIDANCE_INTERNAL: readonly string[] = ['internalNote', 'notes']
const TEACHER_PRIVATE: readonly string[] = ['email', 'phone', 'attendanceRate', 'homeworkRate']
const CORRECTION_HISTORY: readonly string[] = ['corrections']
// Veli iletişimi ve yakınlığı öğrenciye, yakınlığı öğretmene dönmez (DOM-YTK-020, DOM-KAY-003).
const PARENT_PRIVATE: readonly string[] = ['phone', 'email', 'relationship']
const PARENT_RELATIONSHIP: readonly string[] = ['relationship']
const ANSWER_KEY_FIELDS: readonly string[] = ['keyCsv', 'keys']
// kvkk: Ç — iptal ve yedek görevlendirme gerekçesi öğretmenin izin/sağlık durumunu söyleyebilir
// (DOM-YTK-068). Görevlendirme geçmişi gerekçeyi taşıdığı için bütünüyle gizlidir; yedek atandığı
// `originalTeacherId` ve öğretmen alanından okunur.
const LESSON_REASONS: readonly string[] = ['cancelReason', 'substitutions']
const MESSAGE_HIDDEN_FIELDS: readonly string[] = ['senderUserId', 'parentUserId']
// kvkk: K — kararı veren kullanıcı yalnız yöneticiye döner; öbürleri ilişkiyi (`relation`) görür.
const DECIDER_FIELDS: readonly string[] = ['decidedByUserId']
// kvkk: Ç — kimlik no yalnız yönetici ve ön büroya, maskeli döner; doğum tarihini öğretmen görmez.
const STUDENT_IDENTITY: readonly string[] = ['nationalId', 'birthDate']
const STUDENT_NATIONAL_ID: readonly string[] = ['nationalId']
const FRONT_OFFICE_STUDENT: readonly string[] = ['progress']
// kvkk: K — velinin telefonu ve e-postası (DOM-YTK-055).
const PARENT_CONTACT: readonly string[] = PARENT_CONTACT_FIELDS
/**
 * Alan ayıklama: rol satırı görse de bu alanları hiç almaz (yanıt, arama, sıralama dahil).
 * Ön büro öğrencinin akademik ilerlemesini görmez (DOM-YTK-021); öğrenci ve veli öğretmenin
 * iletişim ve performans alanlarını görmez; rehberlik iç notu yalnız rehberlik görevli
 * öğretmene döner (DOM-ILT-040, DOM-ILT-041). Not ve yoklamanın düzeltme geçmişi (gerekçe,
 * düzelten kişi) öğrenci ve veliye dönmez; onlar yalnız güncel değeri görür (DOM-AKD-035,
 * DOM-AKD-051).
 */
export const PLATFORM_HIDDEN_FIELDS = {
  // Kimlik no (kvkk Ç) yalnız yönetici ve ön büroya döner, o da maskeli (`maskNationalId`);
  // öğretmen kimlik no ve doğum tarihini, öğrenci ve veli kimlik noyu görmez (guvenlik-kvkk.md §8).
  students: (c) =>
    c.role === 'yonetici'
      ? NONE
      : c.role === 'onburo'
        ? FRONT_OFFICE_STUDENT
        : c.role === 'ogretmen'
          ? STUDENT_IDENTITY
          : STUDENT_NATIONAL_ID,
  teachers: (c) => (personal(c) ? TEACHER_PRIVATE : NONE),
  // Öğrenci velinin iletişimini ve yakınlığını görmez; öğretmen yakınlığı görmez, iletişimi
  // maskeli görür (`PLATFORM_MASKED_FIELDS`, DOM-YTK-055).
  // TODO(#10): DOM-YTK-055 ve DOM-ILT-073 gereği veli de hiçbir velinin iletişimini görmemeli;
  // kayıt testi (prospects) veliden tam telefon beklediği için o değişene kadar açık.
  parents: (c) =>
    c.role === 'ogrenci' ? PARENT_PRIVATE : c.role === 'ogretmen' ? PARENT_RELATIONSHIP : NONE,
  grades: (c) => (personal(c) ? CORRECTION_HISTORY : NONE),
  attendance: (c) => (personal(c) ? CORRECTION_HISTORY : NONE),
  // İptal ve yedek gerekçesi yalnız yöneticiye döner. Öğretmen (asıl ya da yedek), ön büro,
  // öğrenci ve veli dersin iptal edildiğini ve yedek öğretmeni görür, gerekçeyi görmez
  // (DOM-YTK-068).
  schedule: (c) => (c.role === 'yonetici' ? NONE : LESSON_REASONS),
  // İç not yalnız rehberlik görevli öğretmene döner; yönetici, ön büro, görevsiz öğretmen, öğrenci
  // ve veli görmez (DOM-ILT-040, DOM-YTK-020).
  // TODO(IST-020): yöneticinin adli/idari soruşturma gerekçesiyle, denetim kaydına düşen erişimi.
  guidanceCases: (c) => (c.counselor ? NONE : GUIDANCE_INTERNAL),
  // Okundu ayrıntısı ve alıcı listesi ham dönmez; sayı olarak eklenir (DOM-ILT-003).
  announcements: () => ANNOUNCEMENT_HIDDEN_FIELDS,
  // Gönderenin kişi kimliği ve velinin kullanıcı kimliği kopyası hiçbir role ham dönmez;
  // gönderen tarafı `sender` alanındadır (DOM-ILT-014).
  conversationMessages: () => MESSAGE_HIDDEN_FIELDS,
  permissionDecisions: (c) => (c.role === 'yonetici' ? NONE : DECIDER_FIELDS),
  // Öğrenci ve veli kendi analizini görür; sınavın bütün cevap anahtarını (kitapçık, tüm sorular)
  // görmez, profil onlara yalnız `revision` ile güncel analizi eşlemek için döner.
  opticalProfiles: (c) => (personal(c) ? ANSWER_KEY_FIELDS : NONE),
} as const satisfies FieldRules

/**
 * Değeri maskeli dönen alanlar (rol görür ama tam değeri görmez). Maskeli alan serbest metin
 * aramasına da girmez: ham değerde eşleşme maskelenen haneleri tahmin ettirir. Öğretmen ders
 * verdiği öğrencinin velisinin iletişimini maskeli görür, tam değeri ayrı ve denetim kaydına
 * düşen "Göster" işlemiyle açar (DOM-YTK-055, `lib/parent-contact.ts`).
 */
export const PLATFORM_MASKED_FIELDS = {
  parents: (c) => (c.role === 'ogretmen' ? PARENT_CONTACT : NONE),
} as const satisfies FieldRules

/**
 * Rol görse de serbest metin aramasına girmeyen alanlar (`Scope.searchExcludedFields`). Kimlik no
 * ve doğum tarihi aranırsa değer istek adresine (`?q=`) ve istek loguna düşer; maskeli değerin son
 * dört hanesiyle eşleşme de kimlik noyu tahmin ettirir.
 */
export const PLATFORM_UNSEARCHABLE_FIELDS = {
  students: STUDENT_IDENTITY,
} as const satisfies Partial<Record<CollectionName, readonly string[]>>

/**
 * Modül kaydının rol listesi menü sayfasını belirler; bu koleksiyonlarda satır kuralı olan öğrenci
 * ve veli de okur. Optik modülü yalnız yönetici ve öğretmene menü sayfası açar, ama öğrenci ve veli
 * Deneme Sınavları detayında kendi soru analizini görür (`docs/optik-degerlendirme-etut.md`); satır
 * kuralı (`PLATFORM_READ_RULES`) yalnız kendi/bağlı çocuğunun kaydını verir.
 */
export const PLATFORM_READ_BEYOND_MODULE_ROLES = {
  opticalEvaluations: ['ogrenci', 'veli'],
  opticalProfiles: ['ogrenci', 'veli'],
} as const satisfies Partial<Record<CollectionName, readonly Role[]>>
