import type { Scope } from './scope.ts'

/**
 * Ödeyicisi olunan çocuklar (ON-313; K-04 kullanıcı kararı 2026-11-03; DOM-FIN-052, DOM-ILT-074).
 * Velayeti olmayan ödeyici veli, çocuğu `/me` çocuk listesinde ve öğrenci okumasında görmez
 * (velayet kapsamı); finans sayfalarının çocuk seçicisi bu listeyle ödediği çocuğu da sunar.
 * Liste yalnız finans seçicisi içindir: akademik ve iletişim ekranları velayet listesini okur.
 *
 * KVKK asgarisi (md. 4): seçici için gereken ad ve güncel sınıf adı döner; numara, doğum tarihi,
 * veli ve iletişim alanı dönmez. Kapsam core `scope.payerStudentIds`'tir (ödeyici ve iletişim
 * kısıtı olmayan bağ; arşivlenmiş öğrenci kapsam vermez). Velayetli ödeyicinin çocuğu da listede
 * yer alır; istemci velayet listesiyle kimlikten birleştirir.
 */
export type PayerChild = {
  id: string
  // kvkk: K — öğrencinin adı
  name: string
  /** Öğrencinin güncel sınıfı ya da kur grubu; sınıf kaydı okunamazsa `null`. */
  className: string | null
}

type StudentRow = { id: string; name?: unknown; classId?: unknown }
type ClassRow = { id: string; name?: unknown }

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/**
 * Kapsamdaki ödeyici çocukların seçici satırları, ada göre (Türkçe sıralama) dizili. Kapsamda
 * olmayan öğrenci satırı yok sayılır; adı olmayan kayıt `—` yazılır, kimlik ad yerine gösterilmez.
 */
export function payerChildren(
  scope: Pick<Scope, 'payerStudentIds'>,
  students: readonly StudentRow[],
  classes: readonly ClassRow[],
): PayerChild[] {
  const classNames = new Map(classes.map((row) => [row.id, text(row.name)]))
  return students
    .filter((student) => scope.payerStudentIds.has(student.id))
    .map((student) => ({
      id: student.id,
      name: text(student.name) ?? '—',
      className:
        typeof student.classId === 'string' ? (classNames.get(student.classId) ?? null) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id))
}
