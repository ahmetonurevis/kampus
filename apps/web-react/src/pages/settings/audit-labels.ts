// İşlem geçmişinin Türkçe etiketleri (saf). Sunucu ham `action` ve `entityType` döndürür;
// bilinmeyen değer kullanıcıya ham haliyle gösterilir (yeni işlem eklenince liste bozulmaz).

/** Varlık türü (koleksiyon adı) → Türkçe ad. Süzgeç seçenekleri bu listeden gelir. */
export const ENTITY_LABELS: Readonly<Record<string, string>> = {
  module: 'Modül ayarı',
  invoices: 'Taksit ve ödeme',
  grades: 'Not',
  attendance: 'Yoklama',
  absences: 'Devamsızlık',
  requests: 'Talep',
  questions: 'Soru',
  announcements: 'Duyuru',
  conversations: 'Yazışma',
  classes: 'Sınıf',
  branches: 'Kampüs',
  teachers: 'Öğretmen',
  students: 'Öğrenci',
  // Sağlık ve acil bilgi denetim satırları (OG-090): tekil `student`; süzgeçte `students`tan ayrışsın.
  student: 'Öğrenci sağlık kaydı',
  parents: 'Veli',
  studentGoals: 'Öğrenci hedefi',
  guidanceCases: 'Rehberlik kaydı',
  tutorSessions: 'Etüt',
  mockExams: 'Deneme sınavı',
  mockResults: 'Deneme sonucu',
  renewals: 'Yenileme',
  schedule: 'Ders programı',
  studyTasks: 'Çalışma görevi',
  schoolEvents: 'Okul etkinliği',
  eventConsents: 'Etkinlik izni',
  transportRoutes: 'Servis güzergâhı',
  transportAssignments: 'Servis ataması',
  mealMenus: 'Yemek menüsü',
  clubs: 'Kulüp',
  clubMemberships: 'Kulüp üyeliği',
  clubAttendance: 'Kulüp yoklaması',
  socialAchievements: 'Sosyal başarı',
  opticalProfiles: 'Optik profil',
  opticalEvaluations: 'Optik değerlendirme',
  workflow: 'Okul iş akışı',
  staff_invitation: 'Personel daveti',
  membership: 'Kurum üyeliği',
}

const VERBS: Readonly<Record<string, string>> = {
  archive: 'arşivlendi',
  restore: 'arşivden geri alındı',
}

const ACTION_LABELS: Readonly<Record<string, string>> = {
  'module.set': 'Modül açıldı veya kapatıldı',
  'invoice.pay': 'Taksit ödemesi alındı',
  'invoice.payOnline': 'Taksit çevrimiçi ödendi',
  'attendance.record': 'Yoklama alındı',
  'grade.record': 'Not girildi',
  'grade.update': 'Not düzeltildi',
  'announcement.publish': 'Duyuru yayımlandı',
  'announcement.revise': 'Duyuru düzeltildi',
  'announcement.withdraw': 'Duyuru geri çekildi',
  'announcement.read': 'Duyuru okundu',
  'conversation.start': 'Yazışma başlatıldı',
  'conversation.access': 'Yazışmaya gerekçeyle erişildi',
  'parent_contact.reveal': 'Veli iletişim bilgisi açıldı',
  'message.send': 'Mesaj gönderildi',
  'message.read': 'Mesaj okundu',
  'health_profile.read': 'Sağlık bilgisi görüntülendi',
  'health_profile.read_emergency': 'Acil bilgi görüntülendi',
  'health_profile.update': 'Sağlık bilgisi güncellendi',
  'file.orphans_purge': 'Yetim dosyalar temizlendi',
  'workflow.guidance': 'Rehberlik kaydı değişti',
  'request.open': 'Talep açıldı',
  'request.update': 'Talep güncellendi',
  'absence.notify': 'İzin/mazeret bildirildi',
  'question.ask': 'Soru gönderildi',
  'question.answer': 'Soru yanıtlandı',
  'question.withdraw': 'Soru geri çekildi',
  'staff.invite': 'Personel davet edildi',
  'staff.import': 'Personel toplu aktarımla davet edildi',
  'staff.invitation_cancel': 'Personel daveti iptal edildi',
  'staff.role_change': 'Personel rolü değiştirildi',
  'staff.deactivate': 'Personel hesabı pasifleştirildi',
  'staff.reactivate': 'Personel hesabı etkinleştirildi',
}

const WORKFLOW_LABELS: Readonly<Record<string, string>> = {
  goal: 'Hedef oluşturuldu',
  'goal-review': 'Hedef incelendi',
  'goal-step': 'Hedef adımı eklendi',
  'goal-step-done': 'Hedef adımı tamamlandı',
  'goal-suggest': 'Hedef önerildi',
  'goal-comment': 'Hedefe yorum eklendi',
  'goal-close': 'Hedef kapatıldı',
  exam: 'Deneme sınavı kaydedildi',
  'exam-result': 'Deneme sonucu girildi',
  'exam-import': 'Deneme sonuçları içe aktarıldı',
  renewal: 'Yenileme planlandı',
  'renewal-activate': 'Yenileme etkinleştirildi',
  lesson: 'Ders programa eklendi',
  substitute: 'Ders için yedek öğretmen atandı',
  'lesson-cancel': 'Ders iptal edildi',
  'study-task': 'Çalışma görevi verildi',
  'study-complete': 'Çalışma görevi tamamlandı',
  'study-review': 'Çalışma görevi incelendi',
  event: 'Okul etkinliği oluşturuldu',
  consent: 'Etkinlik izni yanıtlandı',
  'event-cancel': 'Etkinlik iptal edildi',
  route: 'Servis güzergâhı kaydedildi',
  'route-archive': 'Servis güzergâhı arşivlendi',
  'transport-assign': 'Servis ataması yapıldı',
  'transport-remove': 'Servis ataması kaldırıldı',
  meal: 'Yemek menüsü kaydedildi',
  club: 'Kulüp kaydedildi',
  'club-enroll': 'Kulübe kayıt yapıldı',
  'club-leave': 'Kulüpten ayrılma kaydedildi',
  'club-attendance': 'Kulüp yoklaması alındı',
  achievement: 'Sosyal başarı kaydedildi',
  'club-archive': 'Kulüp arşivlendi',
}

/** Etüt ve optik değerlendirme komutları (`tutoring.*`, `assessment.*`) için genel ifade. */
const FAMILY_LABELS: Readonly<Record<string, string>> = {
  workflow: 'Okul işlemi',
  tutoring: 'Etüt işlemi',
  assessment: 'Optik değerlendirme işlemi',
}

/** İşlem adı → okunur Türkçe başlık; bilinmeyen eylem ham adıyla döner. */
export function actionLabel(action: string): string {
  const known = ACTION_LABELS[action]
  if (known) return known
  const dot = action.indexOf('.')
  if (dot < 1) return action
  const head = action.slice(0, dot)
  const tail = action.slice(dot + 1)
  if (head === 'workflow') return WORKFLOW_LABELS[tail] ?? `${FAMILY_LABELS.workflow}: ${tail}`
  if (head === 'tutoring' || head === 'assessment') return `${FAMILY_LABELS[head]}: ${tail}`
  const verb = VERBS[tail]
  if (verb) return `${entityLabel(head)} ${verb}`
  return action
}

/** Varlık türü → Türkçe ad; bilinmeyen tür ham adıyla, boş tür "—" olarak gösterilir. */
export function entityLabel(entityType: string | null): string {
  if (!entityType) return '—'
  return ENTITY_LABELS[entityType] ?? entityType
}

/** Varlık türü süzgecinin seçenekleri (Türkçe adına göre sıralı). */
export function entityOptions(): Array<{ value: string; label: string }> {
  return Object.entries(ENTITY_LABELS)
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'tr'))
}

/** Alan adı listesi → tek satır (değerler sunucuda yoktur, yalnız adlar). */
export function fieldsLabel(fields: readonly string[]): string {
  return fields.length ? fields.join(', ') : '—'
}
