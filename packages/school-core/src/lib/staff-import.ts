import { z } from 'zod'

import { csvTable, foldHeader, type CsvColumn } from './delimited-input.ts'
import {
  STAFF_ACCOUNT_MESSAGES,
  STAFF_ROLE_LABELS,
  staffEmailSchema,
  staffNameSchema,
  type StaffInvitationInput,
  type StaffRole,
} from './staff-accounts.ts'

/**
 * Toplu personel aktarımı (IST-007; docs/domain/yetki-ve-kapsam.md DOM-YTK-070). Yönetici CSV
 * dosyasıyla en çok 1.000 personeli bir işlemde davet eder: bütün satırlar doğrulanmadan hiç kayıt
 * yazılmaz, hatalar dosyadaki satır numarasıyla döner. Her satır tek davetle aynı kuralları taşır
 * (`lib/staff-accounts.ts`); ek olarak dosya içinde yinelenen e-posta ve öğretmen kaydı reddedilir.
 *
 * Öğretmen satırı kurumun var olan öğretmen kaydına bağlanır: önce aynı e-postalı etkin kayıt,
 * yoksa (branş ve kampüs girildiyse) aynı ad, branş ve kampüsteki e-postasız tek kayıt; kayıtta
 * başka bir e-posta varsa satır reddedilir (adaşı başka kişinin kaydına bağlanmasın). Branş ve kampüs
 * yalnız öğretmen satırında girilir ve bulunan kaydın branşı/kampüsüyle uyuşmalıdır; aktarım
 * öğretmen kaydı açmaz (kayıt telefon ister, kadro ekranından açılır). Saf fonksiyonlardır: API
 * kurum kilidi altında okuduğu bağlamı verir.
 */

export const STAFF_IMPORT_MAX_ROWS = 1000
/** Gövde sınırı: 1.000 satır × en uzun satır (ad 120, e-posta 254, rol, branş, kampüs) payıyla. */
export const STAFF_IMPORT_MAX_CHARS = 600_000

export const STAFF_IMPORT_COLUMNS = {
  name: { aliases: ['ad', 'ad soyad', 'adı soyadı', 'isim'], required: true },
  email: { aliases: ['e-posta', 'eposta', 'email', 'mail'], required: true },
  role: { aliases: ['rol'], required: true },
  subject: { aliases: ['branş', 'ders'], required: false },
  campus: { aliases: ['kampüs', 'şube'], required: false },
} as const satisfies Record<string, CsvColumn>

export type StaffImportField = keyof typeof STAFF_IMPORT_COLUMNS

/** İndirilebilir örnek dosya (başlık ve iki örnek satır; `;` ayraçlı, Excel Türkçe yerelinde açılır). */
export const STAFF_IMPORT_SAMPLE = [
  'ad;e-posta;rol;branş;kampüs',
  'Ayla Demir;ayla.demir@okul.example;Öğretmen;Matematik;Kadıköy Kampüsü',
  'Kerem Uçar;kerem.ucar@okul.example;Ön büro;;',
].join('\n')

export const staffImportInputSchema = z.strictObject({
  // kvkk: K — personelin adı ve e-postası; satır içerikleri loglanmaz, denetime yazılmaz.
  csv: z
    .string()
    .min(1, 'Dosya içeriği boş.')
    .max(STAFF_IMPORT_MAX_CHARS, 'Dosya çok büyük. En çok 1.000 satır aktarılabilir.'),
  /** Önizleme: doğrular, hiçbir şey yazmaz. */
  dryRun: z.boolean().default(false),
})
export type StaffImportInput = z.input<typeof staffImportInputSchema>

/** Satır hatası: dosyadaki satır, alan (satırın bütünü için `null`), kararlı kod ve Türkçe ileti. */
export const staffImportIssueSchema = z.object({
  line: z.number().int().min(1),
  field: z.enum(['name', 'email', 'role', 'subject', 'campus']).nullable(),
  code: z.string(),
  message: z.string(),
})
export type StaffImportIssue = z.infer<typeof staffImportIssueSchema>

export interface StaffImportRow {
  line: number
  name: string
  email: string
  role: string
  subject: string
  campus: string
  extraCells: boolean
}

/** CSV'yi satırlara ayırır; dosya düzeyindeki sorun `DomainError` (satır sınırı dahil). */
export function parseStaffImport(raw: string): StaffImportRow[] {
  return csvTable(raw, STAFF_IMPORT_COLUMNS, STAFF_IMPORT_MAX_ROWS).map((row) => ({
    line: row.line,
    ...row.values,
    extraCells: row.extraCells,
  }))
}

// "Ön Büro & Satış" menüdeki etikettir; katlanmış biçimde boşluk düşer, `&` kalır.
const ROLE_ALIASES = new Map<string, StaffRole>([
  ['yonetici', 'yonetici'],
  ['ogretmen', 'ogretmen'],
  ['onburo', 'onburo'],
  ['onburo&satis', 'onburo'],
])

/** Rol hücresi: kod (`ogretmen`) ya da etiket ("Öğretmen", "Ön büro"); büyük-küçük harf fark etmez. */
export function parseStaffRole(value: string): StaffRole | null {
  return ROLE_ALIASES.get(foldHeader(value)) ?? null
}

export const STAFF_IMPORT_MESSAGES = {
  staff_import_invalid: 'Dosyada düzeltilmesi gereken satırlar var. Hiçbir personel aktarılmadı.',
  role_invalid: `Rol ${Object.values(STAFF_ROLE_LABELS).join(', ')} olmalı.`,
  extra_cells: 'Satırda başlıktan fazla dolu hücre var.',
  teacher_only: 'Branş ve kampüs yalnız öğretmen satırında girilir.',
  subject_unknown: 'Bu branş bulunamadı.',
  campus_unknown: 'Bu kampüs bulunamadı.',
  teacher_not_found:
    'Bu e-posta ya da ad, branş ve kampüsle öğretmen kaydı bulunamadı. Önce kadroya öğretmen kaydını ekleyin ya da branş ve kampüsü boş bırakın.',
  teacher_ambiguous:
    'Bu bilgilerle birden çok öğretmen kaydı var. Bu kişiyi tek tek davet edip öğretmen kaydını seçin.',
  teacher_email_mismatch:
    'Bu ad, branş ve kampüsteki öğretmen kaydında başka bir e-posta var. Kadrodaki e-postayı düzeltin ya da branş ve kampüsü boş bırakın.',
  subject_mismatch: 'Öğretmen kaydının branşı dosyadakiyle uyuşmuyor.',
  campus_mismatch: 'Öğretmen kaydının kampüsü dosyadakiyle uyuşmuyor.',
} as const

/** Kurumun var olan öğretmen kaydı (bağlantı için gereken alanlar). */
export interface StaffImportTeacher {
  id: string
  name: string
  email: string
  subjectId: string
  branchId: string
}

/** Planın gördüğü kurum durumu; API kurum kilidi altında okur. */
export interface StaffImportContext {
  /** Kurumda üyeliği olan e-postalar (küçük harf). */
  memberEmails: ReadonlySet<string>
  /** Kurumda bekleyen daveti olan e-postalar (küçük harf). */
  pendingEmails: ReadonlySet<string>
  /** Etkin öğretmen kayıtları. */
  teachers: readonly StaffImportTeacher[]
  /** Başka hesaba bağlı öğretmen kayıtları. */
  linkedTeacherIds: ReadonlySet<string>
  /** Kurumun bekleyen bir davetinin tuttuğu öğretmen kayıtları (`invitations.teacher_id`). */
  pendingTeacherIds: ReadonlySet<string>
  /** Etkin kampüsler. */
  campuses: readonly { id: string; name: string }[]
  /** Branşlar (dersler). */
  subjects: readonly { id: string; name: string }[]
}

export interface StaffImportPlan {
  invitations: (StaffInvitationInput & { line: number })[]
  issues: StaffImportIssue[]
}

const sameText = (a: string, b: string) => foldHeader(a) === foldHeader(b)

function findByNameOrId<T extends { id: string; name: string }>(
  items: readonly T[],
  value: string,
): T | undefined {
  return items.find((item) => item.id === value) ?? items.find((item) => sameText(item.name, value))
}

/**
 * Satırları doğrular ve davet listesini çıkarır (IST-007, DOM-YTK-070). Hata varsa davet listesi
 * boştur: çağıran hiçbir şey yazmaz. Bir satırın birden çok hatası ayrı maddedir.
 */
export function planStaffImport(
  rows: readonly StaffImportRow[],
  context: StaffImportContext,
): StaffImportPlan {
  const issues: StaffImportIssue[] = []
  const invitations: StaffImportPlan['invitations'] = []
  const firstLineByEmail = new Map<string, number>()
  const firstLineByTeacher = new Map<string, number>()
  const teachersByEmail = new Map<string, StaffImportTeacher[]>()
  for (const teacher of context.teachers) {
    const key = teacher.email.trim().toLowerCase()
    if (!key) continue
    teachersByEmail.set(key, [...(teachersByEmail.get(key) ?? []), teacher])
  }

  for (const row of rows) {
    const add = (field: StaffImportField | null, code: string, message: string) =>
      issues.push({ line: row.line, field, code, message })
    const before = issues.length
    if (row.extraCells) add(null, 'extra_cells', STAFF_IMPORT_MESSAGES.extra_cells)

    const name = staffNameSchema.safeParse(row.name)
    if (!name.success) add('name', 'name_invalid', name.error.issues[0]?.message ?? '')
    const email = staffEmailSchema.safeParse(row.email)
    if (!email.success) add('email', 'email_invalid', email.error.issues[0]?.message ?? '')
    else {
      const first = firstLineByEmail.get(email.data)
      if (first !== undefined)
        add('email', 'duplicate_email', `Bu e-posta dosyanın ${first}. satırında da var.`)
      else {
        firstLineByEmail.set(email.data, row.line)
        if (context.memberEmails.has(email.data))
          add('email', 'member_exists', STAFF_ACCOUNT_MESSAGES.member_exists)
        else if (context.pendingEmails.has(email.data))
          add('email', 'invitation_exists', STAFF_ACCOUNT_MESSAGES.invitation_exists)
      }
    }
    const role = parseStaffRole(row.role)
    if (role === null) add('role', 'role_invalid', STAFF_IMPORT_MESSAGES.role_invalid)

    let teacherId: string | undefined
    if (role !== null && role !== 'ogretmen') {
      if (row.subject) add('subject', 'teacher_only', STAFF_IMPORT_MESSAGES.teacher_only)
      if (row.campus) add('campus', 'teacher_only', STAFF_IMPORT_MESSAGES.teacher_only)
    } else if (role === 'ogretmen') {
      const subject = row.subject ? findByNameOrId(context.subjects, row.subject) : undefined
      const campus = row.campus ? findByNameOrId(context.campuses, row.campus) : undefined
      if (row.subject && !subject)
        add('subject', 'subject_unknown', STAFF_IMPORT_MESSAGES.subject_unknown)
      if (row.campus && !campus)
        add('campus', 'campus_unknown', STAFF_IMPORT_MESSAGES.campus_unknown)
      const unknown = (row.subject && !subject) || (row.campus && !campus)
      let candidates = email.success ? (teachersByEmail.get(email.data) ?? []) : []
      // Adla eşleşme yalnız e-postasız kayda bağlanır; e-postası farklı kayıt başka kişidir.
      let otherEmail = false
      if (candidates.length === 0 && subject && campus && name.success) {
        const named = context.teachers.filter(
          (teacher) =>
            sameText(teacher.name, name.data) &&
            teacher.subjectId === subject.id &&
            teacher.branchId === campus.id,
        )
        candidates = named.filter((teacher) => !teacher.email.trim())
        otherEmail = candidates.length === 0 && named.length > 0
      }
      const [teacher, ...others] = candidates
      if (otherEmail)
        add(null, 'teacher_email_mismatch', STAFF_IMPORT_MESSAGES.teacher_email_mismatch)
      else if (others.length > 0)
        add(null, 'teacher_ambiguous', STAFF_IMPORT_MESSAGES.teacher_ambiguous)
      else if (teacher !== undefined) {
        if (subject && teacher.subjectId !== subject.id)
          add('subject', 'subject_mismatch', STAFF_IMPORT_MESSAGES.subject_mismatch)
        if (campus && teacher.branchId !== campus.id)
          add('campus', 'campus_mismatch', STAFF_IMPORT_MESSAGES.campus_mismatch)
        const first = firstLineByTeacher.get(teacher.id)
        if (first !== undefined)
          add(
            null,
            'duplicate_teacher',
            `Bu öğretmen kaydı dosyanın ${first}. satırında başka bir hesaba bağlanıyor.`,
          )
        else {
          firstLineByTeacher.set(teacher.id, row.line)
          if (context.linkedTeacherIds.has(teacher.id))
            add(null, 'teacher_already_linked', STAFF_ACCOUNT_MESSAGES.teacher_already_linked)
          else if (context.pendingTeacherIds.has(teacher.id))
            add(
              null,
              'teacher_invitation_pending',
              STAFF_ACCOUNT_MESSAGES.teacher_invitation_pending,
            )
        }
        teacherId = teacher.id
      } else if ((row.subject || row.campus) && !unknown)
        add(null, 'teacher_not_found', STAFF_IMPORT_MESSAGES.teacher_not_found)
    }

    if (issues.length === before && name.success && email.success && role !== null)
      invitations.push({
        line: row.line,
        name: name.data,
        email: email.data,
        role,
        ...(teacherId === undefined ? {} : { teacherId }),
      })
  }
  return { invitations: issues.length === 0 ? invitations : [], issues }
}
