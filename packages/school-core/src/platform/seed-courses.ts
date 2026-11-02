import type { Course, CourseEOzel } from '../lib/courses.ts'

/** Örnek kur kimliği: sıradan türetilen sabit UUID (`…-0000c0000001`). */
export const seedCourseId = (sequence: number) =>
  `00000000-0000-4000-8000-0000c0${String(sequence).padStart(6, '0')}`

/**
 * Kampüs Dil Akademisi örnek kur programı (IST-076; DOM-DIL-005…007). Genel İngilizce A1 → A2 →
 * B1.1 → B1.2 zinciri belgelidir ve e-Özel'de onaylıdır (B1.2 onay bekleyen taslak); konuşma
 * kulübü belgesiz ve 90 dakikalık blokludur; IELTS yazma hazırlığı işlenmemiş taslaktır.
 * Kimlikler sabit, anlar kurumun güncel eğitim yılından türetilir. e-Özel izini işaretleyen
 * kullanıcı tohumda verilir (kurucu yönetici).
 */
export function createCourses(academicYear: number, recordedByUserId: string): Course[] {
  const recordedAt = new Date(`${academicYear}-08-20T09:00:00+03:00`).toISOString()
  const activatedAt = new Date(`${academicYear}-09-01T09:00:00+03:00`).toISOString()
  const eOzel = (programCode: string, approval: CourseEOzel['approval']): CourseEOzel => ({
    programCode,
    approval,
    recordedAt,
    recordedByUserId,
  })
  const general = {
    language: 'en',
    skillFocus: [],
    weeklyHours: 6,
    sessionMinutes: 45,
    minLearners: 6,
    maxLearners: 14,
    certified: true,
    archivedAt: null,
  } as const
  return [
    {
      ...general,
      id: seedCourseId(1),
      name: 'Genel İngilizce A1',
      level: 'A1',
      description: 'Başlangıç düzeyi genel İngilizce; dört beceri dengeli.',
      totalHours: 96,
      nextCourseId: seedCourseId(2),
      status: 'active',
      activatedAt,
      eOzel: eOzel('KDA-EN-A1', 'approved'),
    },
    {
      ...general,
      id: seedCourseId(2),
      name: 'Genel İngilizce A2',
      level: 'A2',
      description: 'Temel düzey genel İngilizce.',
      totalHours: 96,
      nextCourseId: seedCourseId(3),
      status: 'active',
      activatedAt,
      eOzel: eOzel('KDA-EN-A2', 'approved'),
    },
    {
      ...general,
      id: seedCourseId(3),
      name: 'Genel İngilizce B1.1',
      level: 'B1',
      description: 'Orta düzeyin ilk kuru.',
      totalHours: 72,
      nextCourseId: seedCourseId(4),
      status: 'active',
      activatedAt,
      eOzel: eOzel('KDA-EN-B1-1', 'approved'),
    },
    {
      ...general,
      id: seedCourseId(4),
      name: 'Genel İngilizce B1.2',
      level: 'B1',
      description: 'Orta düzeyin ikinci kuru.',
      totalHours: 72,
      nextCourseId: null,
      status: 'draft',
      activatedAt: null,
      eOzel: eOzel('KDA-EN-B1-2', 'pending'),
    },
    {
      id: seedCourseId(5),
      name: 'Konuşma Kulübü B1',
      language: 'en',
      level: 'B1',
      skillFocus: ['speaking'],
      description: 'Haftada bir 90 dakikalık konuşma pratiği.',
      totalHours: 24,
      weeklyHours: 2,
      sessionMinutes: 90,
      minLearners: 4,
      maxLearners: 10,
      certified: false,
      nextCourseId: null,
      status: 'active',
      activatedAt,
      archivedAt: null,
      eOzel: {
        programCode: null,
        approval: 'not_submitted',
        recordedAt: null,
        recordedByUserId: null,
      },
    },
    {
      id: seedCourseId(6),
      name: 'IELTS Yazma Hazırlık',
      language: 'en',
      level: 'B2',
      skillFocus: ['writing'],
      description: null,
      totalHours: 40,
      weeklyHours: 4,
      sessionMinutes: 45,
      minLearners: 4,
      maxLearners: 12,
      certified: false,
      nextCourseId: null,
      status: 'draft',
      activatedAt: null,
      archivedAt: null,
      eOzel: {
        programCode: null,
        approval: 'not_submitted',
        recordedAt: null,
        recordedByUserId: null,
      },
    },
  ]
}
