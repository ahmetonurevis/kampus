// Sınıf özetindeki veli iletişimi satırları (saf; DOM-YTK-055). İletişim alanları sunucudan
// öğretmene maskeli gelir; burada yalnız öğrenciyle eşlenir ve sıralanır.

export type ContactStudent = { id: string; name: string }
export type ContactParent = {
  id: string
  name: string
  studentIds: readonly string[]
  phone?: string | undefined
  email?: string | undefined
}
export type ParentContactRow = {
  key: string
  student: ContactStudent
  parentId: string
  parentName: string
  phone: string | undefined
  email: string | undefined
}

/**
 * Sınıf öğrencilerinin velileri: veli birden çok öğrenciye bağlıysa her sınıf öğrencisi için ayrı
 * satır (açılış öğrenci başına denetlenir); sınıfta olmayan öğrencinin bağı atlanır. Öğrenci adına,
 * sonra veli adına göre (Türkçe) sıralı.
 */
export function parentContactRows(
  parents: readonly ContactParent[],
  students: readonly ContactStudent[],
): ParentContactRow[] {
  const byStudent = new Map(students.map((student) => [student.id, student]))
  const rows: ParentContactRow[] = []
  for (const parent of parents)
    for (const studentId of parent.studentIds) {
      const student = byStudent.get(studentId)
      if (!student) continue
      rows.push({
        key: `${parent.id}:${studentId}`,
        student,
        parentId: parent.id,
        parentName: parent.name,
        phone: parent.phone,
        email: parent.email,
      })
    }
  return rows.sort(
    (a, b) =>
      a.student.name.localeCompare(b.student.name, 'tr') ||
      a.parentName.localeCompare(b.parentName, 'tr'),
  )
}
