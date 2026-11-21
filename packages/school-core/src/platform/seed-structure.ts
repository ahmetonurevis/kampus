import { subjects, subjectsForGrade } from '../data/curriculum.ts'
import { required } from './seed-support.ts'

/**
 * Örnek kurum yapısı: kampüsler, öğretmenler, sınıflar ve ders atamaları. Kimlikler sabittir;
 * `data/seed.ts` öğrencileri bunun üstüne kurar.
 */
export function createStructure() {
  const branches = [
    {
      id: 'b1',
      name: 'Kadıköy Kampüsü',
      address: 'Caferağa Mah. Moda Cad. No: 24, İstanbul',
      color: '#8674c9',
    },
    {
      id: 'b2',
      name: 'Beşiktaş Kampüsü',
      address: 'Sinanpaşa Mah. Ihlamurdere Cad. No: 18, İstanbul',
      color: '#6aab9c',
    },
    {
      id: 'b3',
      name: 'Ataşehir Kampüsü',
      address: 'Atatürk Mah. Ataşehir Bulvarı No: 36, İstanbul',
      color: '#d4a475',
    },
  ].map((b) => ({ ...b, isActive: true, deletedAt: null as string | null }))
  const teacherNames = [
    'Selin Kaya',
    'Ahmet Yıldırım',
    'Derya Arslan',
    'Burcu Aksoy',
    'Emre Demir',
    'Ceren Aydın',
    'Mehmet Koç',
    'Ebru Çelik',
    'Canan Şahin',
    'Murat Eren',
    'İrem Güneş',
    'Okan Polat',
    'Seda Tekin',
    'Bahar Yalçın',
    'Tolga Acar',
    'Nermin Bulut',
  ]
  const teachers = branches.flatMap((branch, b) =>
    subjects.map((subject, i) => ({
      id: `t${b * subjects.length + i + 1}`,
      name:
        b === 0
          ? required(teacherNames[i], 'öğretmen adı')
          : `${['Aylin', 'Cem', 'Sevgi', 'Barış', 'Banu', 'Erdem', 'Sibel', 'Hakan', 'Nur', 'Deniz', 'Özge', 'Alper', 'Gizem', 'Koray', 'Pelin', 'Suat'][i]} ${b === 1 ? ['Özer', 'Akın', 'Uslu', 'Çetin'][i % 4] : ['Güler', 'Kurt', 'Toprak', 'Erdem'][i % 4]}`,
      subjectId: subject.id,
      subject: subject.name,
      branchId: branch.id,
      email: `ogretmen${b * subjects.length + i + 1}@kampus.example`,
      phone: `0555100${String(b * 16 + i).padStart(4, '0')}`,
      attendanceRate: 100 - (i % 4) * 3,
      homeworkRate: 98 - (i % 5) * 4,
      isActive: true,
      deletedAt: null as string | null,
      // kvkk: K — rehberlik görevi (DOM-YTK-026): iç notları okur ve yazar. Demo öğretmeni Selin
      // Kaya aynı zamanda rehberlik görevlisidir.
      guidanceCounselor: b === 0 && i === 0,
    })),
  )
  const gradeOrder = [7, 5, 6, 8, 9, 10, 11, 12]
  const classes = branches.flatMap((branch, b) =>
    gradeOrder.map((grade, i) => ({
      id: `c${b * 8 + i + 1}`,
      name: `${grade}-${['A', 'B', 'C'][b]}`,
      grade,
      section: ['A', 'B', 'C'][b],
      level: `${grade}. Sınıf`,
      branchId: branch.id,
      teacherId: required(
        teachers.find(
          (t) => t.branchId === branch.id && t.subjectId === (grade <= 8 ? 'math' : 'literature'),
        ),
        'sınıf öğretmeni',
      ).id,
      capacity: 24,
      room: `${b + 1}${String(i + 1).padStart(2, '0')}`,
      isActive: true,
      deletedAt: null as string | null,
    })),
  )
  const assignments = classes.flatMap((c) =>
    subjectsForGrade(c.grade).map((subject) => ({
      id: `assign-${c.id}-${subject.id}`,
      classId: c.id,
      subjectId: subject.id,
      teacherId: required(
        teachers.find((t) => t.branchId === c.branchId && t.subjectId === subject.id),
        'branş öğretmeni',
      ).id,
    })),
  )
  return { branches, teachers, gradeOrder, classes, assignments }
}
