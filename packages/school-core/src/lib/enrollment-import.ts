import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { csvTable, foldHeader, type CsvColumn } from './delimited-input.ts'
import type { MakeId } from './domain.ts'
import {
  findParentMatches,
  GUARDIAN_RELATIONSHIP_LABELS,
  GUARDIAN_RELATIONSHIPS,
  guardianRequired,
  hasNonCustodialBond,
  isValidTurkishId,
  type GuardianRelationship,
  type ParentBond,
} from './enrollment.ts'
import {
  normalizeImportIdentity,
  parseImportDay,
  parseImportPhone,
  type ImportIssue,
  type ImportNotice,
  type ImportRowStatus,
} from './enrollment-import-cells.ts'
import { maskPhone } from './parent-contact.ts'
import { maskNationalId } from './scope.ts'

/**
 * Pilot verisi aktarımı: öğrenci ve veli (IST-007, ON-060; docs/domain/kayit-ve-crm.md DOM-KAY-010,
 * DOM-KAY-012, DOM-KAY-013). Okul canlıya geçerken mevcut öğrencilerini dosyadan yükler: bütün
 * satırlar doğrulanmadan hiçbir kayıt yazılmaz, sorunlar dosyadaki satır numarasıyla döner. Aday ve
 * sözleşme açılmaz; taksit ayrı aktarımdır (`lib/finance-installment-import.ts`).
 *
 * Aynı veli telefonu kardeşleri aynı veli kaydına bağlar. DOM-KAY-013 eşleşmeyi öneri sayar,
 * kendiliğinden birleştirmez: önizleme her eşleşmeyi satırda gösterir, yöneticinin onayı öneriyi
 * kabul eder. Telefon aynı ama ad farklıysa satır hatalıdır: yanlış yazılmış telefon çocuğu başka
 * bir veliye bağlamasın. Kurumda kayıtlı kimlik tekrar yazılmaz; aynı adlı etkin öğrencide satır
 * atlanır (ikinci yükleme mükerrer kayıt açmaz), başka adda ya da pasif öğrencide satır hatalıdır.
 * Saf fonksiyonlardır: API kurum kilidi altında okuduğu bağlamı verir.
 */

export const STUDENT_IMPORT_MAX_ROWS = 1000

export const STUDENT_IMPORT_COLUMNS = {
  name: { aliases: ['öğrenci adı', 'öğrenci', 'ad soyad', 'adı soyadı', 'ad'], required: true },
  className: { aliases: ['sınıf', 'sınıf adı'], required: true },
  campus: { aliases: ['kampüs', 'şube'], required: false },
  identityKind: { aliases: ['kimlik türü'], required: false },
  identityNumber: {
    aliases: ['kimlik no', 'kimlik numarası', 't.c. kimlik no', 'tc kimlik no', 'tc no'],
    required: true,
  },
  birthDate: { aliases: ['doğum tarihi'], required: true },
  // Zorunluluk satır bazındadır: kursta 18 yaş ve üstü kursiyerde veli alınmaz (DOM-KAY-012).
  guardianName: { aliases: ['veli adı', 'veli'], required: false },
  guardianPhone: { aliases: ['veli telefonu', 'veli telefon'], required: false },
  relationship: { aliases: ['yakınlık', 'yakınlık derecesi'], required: false },
  studentPhone: { aliases: ['öğrenci telefonu'], required: false },
} as const satisfies Record<string, CsvColumn>

export type StudentImportField = keyof typeof STUDENT_IMPORT_COLUMNS

/** İndirilebilir örnek dosya (`;` ayraçlı, Excel Türkçe yerelinde açılır); kimlikler örnektir. */
export const STUDENT_IMPORT_SAMPLE = [
  'öğrenci adı;sınıf;kampüs;kimlik türü;kimlik no;doğum tarihi;veli adı;veli telefonu;yakınlık;öğrenci telefonu',
  'Ece Demir;7-A;Kadıköy Kampüsü;T.C.;10000000146;14.03.2013;Ayla Demir;05321234567;Anne;',
  'Can Demir;5-B;Kadıköy Kampüsü;T.C.;10000000078;02.09.2015;Ayla Demir;05321234567;Anne;',
].join('\n')

export interface StudentImportRow {
  line: number
  name: string
  className: string
  campus: string
  identityKind: string
  identityNumber: string
  birthDate: string
  guardianName: string
  guardianPhone: string
  relationship: string
  studentPhone: string
  extraCells: boolean
}

/** Metni satırlara ayırır; dosya düzeyindeki sorun `DomainError` (satır sınırı dahil). */
export function parseStudentImport(raw: string): StudentImportRow[] {
  return csvTable(raw, STUDENT_IMPORT_COLUMNS, STUDENT_IMPORT_MAX_ROWS).map((row) => ({
    line: row.line,
    ...row.values,
    extraCells: row.extraCells,
  }))
}

export const STUDENT_IMPORT_MESSAGES = {
  student_import_invalid: 'Dosyada düzeltilmesi gereken satırlar var. Hiçbir öğrenci aktarılmadı.',
  extra_cells: 'Satırda başlıktan fazla dolu hücre var.',
  name_invalid: 'Öğrenci adını 2–80 karakter girin.',
  campus_not_found: 'Bu kampüs bulunamadı.',
  class_not_found: 'Bu sınıf bulunamadı.',
  class_ambiguous: 'Bu adda birden çok sınıf var. Kampüs sütununu doldurun.',
  class_capacity_full: 'Sınıfın kontenjanı dosyadaki bu satıra yetmiyor.',
  identity_kind_invalid: 'Kimlik türü T.C. ya da Yabancı olmalı.',
  identity_invalid: 'Geçerli bir T.C. kimlik numarası girin.',
  foreign_identity_invalid: 'Yabancı kimlik numarasını 5–20 karakter girin.',
  student_identity_conflict: 'Bu kimlik numarası kurumda başka adla kayıtlı bir öğrencide.',
  student_identity_inactive:
    'Bu kimlik numarası ayrılmış bir öğrencide kayıtlı. Bu öğrenciyi kesin kayıt ekranından alın.',
  birth_date_invalid: 'Doğum tarihi geçmiş bir gün olmalı (GG.AA.YYYY ya da YYYY-AA-GG).',
  guardian_name_required: 'Veli adını 2–80 karakter girin.',
  guardian_phone_invalid: 'Veli telefonunu 05XXXXXXXXX biçiminde girin.',
  guardian_relationship_invalid: `Yakınlık ${Object.values(GUARDIAN_RELATIONSHIP_LABELS).join(', ')} olmalı.`,
  guardian_not_applicable:
    '18 yaş ve üstü kursiyer sözleşmenin tarafı ve ödeyicisidir; veli bilgisi alınmaz.',
  guardian_phone_conflict:
    'Bu telefon başka adla kayıtlı bir veliyle eşleşiyor. Telefonu ya da veli adını düzeltin.',
  guardian_relationship_conflict:
    'Aynı veli için farklı yakınlık yazılmış. Yakınlığı kayıtlı olanla aynı yapın.',
  guardian_ambiguous:
    'Bu telefon ve adla birden çok veli kaydı var. Bu öğrenciyi kesin kayıt ekranından alın.',
  parent_not_guardian:
    'Bu telefondaki veli velayet sahibi ve ödeyici olarak bağlanamaz (velayeti yok ya da iletişim kısıtı var).',
  student_phone_invalid: 'Öğrenci telefonunu 05XXXXXXXXX biçiminde girin.',
  already_imported: 'Bu kimlikle kayıtlı öğrenci var; satır atlanır, mükerrer kayıt açılmaz.',
  existing_guardian:
    'Bu telefon kurumda kayıtlı veliyle eşleşti; öğrenci mevcut veli kaydına bağlanır (kardeş).',
} as const

// Katlanmış ad (`foldHeader`): "T.C." → `t.c.`, "Yabancı" → `yabanci`; boş hücre T.C. sayılır.
const KIND_ALIASES = new Map<string, 'tc' | 'foreign'>([
  ['', 'tc'],
  ['tc', 'tc'],
  ['t.c.', 'tc'],
  ['t.c', 'tc'],
  ['yabanci', 'foreign'],
  ['yabanciuyruklu', 'foreign'],
  ['foreign', 'foreign'],
])

const RELATIONSHIP_ALIASES = new Map<string, GuardianRelationship>([
  ...GUARDIAN_RELATIONSHIPS.map((key) => [foldHeader(key), key] as const),
  ...GUARDIAN_RELATIONSHIPS.map(
    (key) => [foldHeader(GUARDIAN_RELATIONSHIP_LABELS[key]), key] as const,
  ),
])

const isKnownRelationship = (value: string | undefined): value is GuardianRelationship =>
  GUARDIAN_RELATIONSHIPS.some((item) => item === value)

const sameName = (left: string, right: string) => foldHeader(left) === foldHeader(right)

/** Planın gördüğü kurum durumu; API kurum kilidi altında (önizlemede tek görüntüde) okur. */
export interface StudentImportContext {
  institutionType: InstitutionType
  /** Bugün, Europe/Istanbul günü. */
  today: string
  now: string
  /** Satırlardaki kimlik numaralarının arşivlenmemiş satırları: numara → öğrenci. */
  identityHolders: ReadonlyMap<string, string>
  /** Kurumun etkin veli–öğrenci bağları (velayet ve iletişim kısıtı; DOM-ILT-070, -074). */
  bonds: readonly ParentBond[]
}

export type StudentImportState = Pick<
  State,
  'students' | 'parents' | 'classes' | 'branches' | 'renewals' | 'prospects'
>

/** Velinin kaynağı: dosyada yeni, dosyanın önceki satırıyla aynı, kurumda kayıtlı, kursiyerin kendisi. */
export const GUARDIAN_MATCHES = ['new', 'file', 'existing', 'self'] as const
export type GuardianMatch = (typeof GUARDIAN_MATCHES)[number]

type PlannedGuardian =
  | { kind: 'new'; phone: string; name: string; relationship: GuardianRelationship }
  | { kind: 'existing'; parentId: string; relationship: GuardianRelationship }
  | { kind: 'self' }

export interface PlannedStudent {
  line: number
  name: string
  classId: string
  phone: string
  identity: { kind: 'tc' | 'foreign'; number: string; birthDate: string }
  guardian: PlannedGuardian
}

/** Önizleme satırı: kimlik ve telefon maskeli; tam değer yanıtta hiç dönmez. */
export interface StudentImportPreviewRow {
  line: number
  status: ImportRowStatus
  name: string
  className: string
  campus: string
  identityMasked: string
  guardianName: string
  guardianPhoneMasked: string
  relationship: GuardianRelationship | null
  guardianMatch: GuardianMatch | null
  issues: ImportIssue[]
  notices: ImportNotice[]
}

export interface StudentImportPlan {
  rows: StudentImportPreviewRow[]
  /** Hata varsa boştur: çağıran hiçbir şey yazmaz. */
  students: PlannedStudent[]
  issues: ImportIssue[]
  newGuardianCount: number
  existingGuardianCount: number
}

type GuardianEntry =
  | { kind: 'new'; name: string; relationship: GuardianRelationship; firstLine: number }
  | {
      kind: 'existing'
      parentId: string
      name: string
      relationship: GuardianRelationship
      firstLine: number
    }

type AddIssue = (
  field: StudentImportField | null,
  code: keyof typeof STUDENT_IMPORT_MESSAGES,
) => void

/** Kontenjan sayımı (DOM-KAY-010): aktif öğrenciler ve aynı sınıfa planlanmış yenilemeler. */
function occupancy(state: StudentImportState): Map<string, number> {
  const byClass = new Map<string, Set<string>>()
  const add = (classId: string, studentId: string) => {
    const set = byClass.get(classId) ?? new Set<string>()
    set.add(studentId)
    byClass.set(classId, set)
  }
  for (const student of state.students) if (student.isActive) add(student.classId, student.id)
  for (const renewal of state.renewals)
    if (renewal.targetClassId && renewal.status === 'Planlandı')
      add(renewal.targetClassId, renewal.studentId)
  return new Map([...byClass].map(([classId, set]) => [classId, set.size]))
}

function resolveClass(
  row: StudentImportRow,
  branches: readonly { id: string; name: string }[],
  classes: readonly { id: string; name: string; branchId: string }[],
  add: AddIssue,
): string | null {
  const campus = row.campus.trim()
  let pool = classes
  if (campus) {
    const branch =
      branches.find((item) => item.id === campus) ??
      branches.find((item) => sameName(item.name, campus))
    if (!branch) {
      add('campus', 'campus_not_found')
      return null
    }
    pool = classes.filter((item) => item.branchId === branch.id)
  }
  const cell = row.className.trim()
  const byId = pool.find((item) => item.id === cell)
  const [first, second] = byId ? [byId] : pool.filter((item) => sameName(item.name, cell))
  if (first === undefined) {
    add('className', 'class_not_found')
    return null
  }
  if (second !== undefined) {
    add('className', 'class_ambiguous')
    return null
  }
  return first.id
}

interface ResolvedGuardian {
  guardian: PlannedGuardian
  match: GuardianMatch
  relationship: GuardianRelationship
  notice: ImportNotice | null
}

/**
 * Velinin çözümü (DOM-KAY-012, -013). Eşleşme kesin kaydın önerisiyle aynıdır (`findParentMatches`:
 * velinin, öğrencisinin ya da öğrencisine dönüşmüş adayın telefonu). Eşleşen veli velayetsiz ya da
 * kısıtlıysa bağ kurulmaz (DOM-ILT-070, -074); ileti kısıtın hangi öğrencide olduğunu söylemez.
 */
function resolveGuardian(
  state: StudentImportState,
  row: StudentImportRow,
  context: StudentImportContext,
  guardians: Map<string, GuardianEntry>,
  add: AddIssue,
): ResolvedGuardian | null {
  const name = row.guardianName.trim()
  const validName = name.length >= 2 && name.length <= 80
  const phone = parseImportPhone(row.guardianPhone)
  const relationship = RELATIONSHIP_ALIASES.get(foldHeader(row.relationship))
  if (!validName) add('guardianName', 'guardian_name_required')
  if (phone === null) add('guardianPhone', 'guardian_phone_invalid')
  if (relationship === undefined) add('relationship', 'guardian_relationship_invalid')
  if (phone === null || relationship === undefined || !validName) return null

  const seen = guardians.get(phone)
  if (seen !== undefined) {
    if (!sameName(seen.name, name)) {
      add('guardianPhone', 'guardian_phone_conflict')
      return null
    }
    if (seen.relationship !== relationship) {
      add('relationship', 'guardian_relationship_conflict')
      return null
    }
    const notice = {
      code: 'sibling_in_file',
      message: `Veli dosyanın ${seen.firstLine}. satırıyla aynı; öğrenciler aynı veli kaydına bağlanır (kardeş).`,
    }
    return seen.kind === 'new'
      ? {
          guardian: { kind: 'new', phone, name: seen.name, relationship },
          match: 'file',
          relationship,
          notice,
        }
      : {
          guardian: { kind: 'existing', parentId: seen.parentId, relationship },
          match: 'existing',
          relationship,
          notice,
        }
  }

  const matches = findParentMatches(state, phone)
  if (matches.length === 0) {
    guardians.set(phone, { kind: 'new', name, relationship, firstLine: row.line })
    return {
      guardian: { kind: 'new', phone, name, relationship },
      match: 'new',
      relationship,
      notice: null,
    }
  }
  const [parentMatch, other] = matches.filter((match) => sameName(match.name, name))
  if (parentMatch === undefined) {
    add('guardianPhone', 'guardian_phone_conflict')
    return null
  }
  if (other !== undefined) {
    add('guardianPhone', 'guardian_ambiguous')
    return null
  }
  if (hasNonCustodialBond(parentMatch.parentId, context.bonds)) {
    add('guardianPhone', 'parent_not_guardian')
    return null
  }
  const recorded = state.parents.find((parent) => parent.id === parentMatch.parentId)?.relationship
  if (isKnownRelationship(recorded) && recorded !== relationship) {
    add('relationship', 'guardian_relationship_conflict')
    return null
  }
  const { parentId } = parentMatch
  guardians.set(phone, { kind: 'existing', parentId, name, relationship, firstLine: row.line })
  return {
    guardian: { kind: 'existing', parentId, relationship },
    match: 'existing',
    relationship,
    notice: { code: 'existing_guardian', message: STUDENT_IMPORT_MESSAGES.existing_guardian },
  }
}

/**
 * Satırları doğrular, yazılacak öğrencileri çıkarır (IST-007; DOM-KAY-010, -012, -013). Bir satırın
 * birden çok sorunu ayrı maddedir; sorun iletileri hücre değeri taşımaz.
 */
export function planStudentImport(
  state: StudentImportState,
  rows: readonly StudentImportRow[],
  context: StudentImportContext,
): StudentImportPlan {
  const studentsById = new Map(state.students.map((student) => [student.id, student]))
  const branches = state.branches.filter((branch) => branch.isActive)
  const activeBranchIds = new Set(branches.map((branch) => branch.id))
  const classes = state.classes.filter(
    (item) => item.isActive && activeBranchIds.has(item.branchId),
  )
  const capacityOf = new Map(classes.map((item) => [item.id, item.capacity]))
  const occupants = occupancy(state)
  const firstLineByIdentity = new Map<string, number>()
  const guardians = new Map<string, GuardianEntry>()
  const preview: StudentImportPreviewRow[] = []
  const planned: PlannedStudent[] = []
  const allIssues: ImportIssue[] = []

  for (const row of rows) {
    const issues: ImportIssue[] = []
    const notices: ImportNotice[] = []
    const add: AddIssue = (field, code) =>
      issues.push({ line: row.line, field, code, message: STUDENT_IMPORT_MESSAGES[code] })

    if (row.extraCells) add(null, 'extra_cells')
    const name = row.name.trim()
    if (name.length < 2 || name.length > 80) add('name', 'name_invalid')

    const kind = KIND_ALIASES.get(foldHeader(row.identityKind))
    if (kind === undefined) add('identityKind', 'identity_kind_invalid')
    const number = normalizeImportIdentity(row.identityNumber)
    const validNumber =
      kind === 'foreign'
        ? number.length >= 5 && number.length <= 20
        : kind === 'tc' && isValidTurkishId(number)
    if (kind !== undefined && !validNumber)
      add('identityNumber', kind === 'tc' ? 'identity_invalid' : 'foreign_identity_invalid')

    const birthDate = parseImportDay(row.birthDate)
    const validBirth = birthDate !== null && birthDate < context.today
    if (!validBirth) add('birthDate', 'birth_date_invalid')

    let skip = false
    if (validNumber) {
      const firstLine = firstLineByIdentity.get(number)
      if (firstLine !== undefined)
        issues.push({
          line: row.line,
          field: 'identityNumber',
          code: 'duplicate_identity',
          message: `Bu kimlik numarası dosyanın ${firstLine}. satırında da var.`,
        })
      else {
        firstLineByIdentity.set(number, row.line)
        const holderId = context.identityHolders.get(number)
        if (holderId !== undefined) {
          const holder = studentsById.get(holderId)
          if (!holder?.isActive) add('identityNumber', 'student_identity_inactive')
          else if (!sameName(holder.name, name)) add('identityNumber', 'student_identity_conflict')
          else skip = true
        }
      }
    }

    let classId: string | null = null
    let resolved: ResolvedGuardian | null = null
    let studentPhone = ''
    if (skip)
      notices.push({ code: 'already_imported', message: STUDENT_IMPORT_MESSAGES.already_imported })
    else {
      classId = resolveClass(row, branches, classes, add)
      if (row.studentPhone.trim()) {
        const phone = parseImportPhone(row.studentPhone)
        if (phone === null) add('studentPhone', 'student_phone_invalid')
        else studentPhone = phone
      }
      if (validBirth && !guardianRequired(context.institutionType, birthDate, context.now)) {
        if (row.guardianName.trim() || row.guardianPhone.trim() || row.relationship.trim())
          add('guardianName', 'guardian_not_applicable')
        resolved = {
          guardian: { kind: 'self' },
          match: 'self',
          relationship: 'other',
          notice: null,
        }
      } else resolved = resolveGuardian(state, row, context, guardians, add)
      if (resolved?.notice) notices.push(resolved.notice)
    }

    // Kontenjan yalnız hatasız satırda tüketilir: hatalı satır düzeltilince sonraki satırın sonucu
    // değişmesin diye sayım yazılacak satırlarla ilerler.
    if (issues.length === 0 && !skip && classId !== null) {
      const held = occupants.get(classId) ?? 0
      if (held >= (capacityOf.get(classId) ?? 0)) add('className', 'class_capacity_full')
      else occupants.set(classId, held + 1)
    }

    allIssues.push(...issues)
    if (
      issues.length === 0 &&
      !skip &&
      classId !== null &&
      resolved !== null &&
      birthDate !== null &&
      kind !== undefined
    )
      planned.push({
        line: row.line,
        name,
        classId,
        phone: studentPhone,
        identity: { kind, number, birthDate },
        guardian: resolved.guardian,
      })
    preview.push({
      line: row.line,
      status: issues.length > 0 ? 'invalid' : skip ? 'skipped' : 'ready',
      name,
      className: row.className.trim(),
      campus: row.campus.trim(),
      identityMasked: number === '' ? '' : maskNationalId(number),
      guardianName: row.guardianName.trim(),
      guardianPhoneMasked: row.guardianPhone.trim() === '' ? '' : maskPhone(row.guardianPhone),
      relationship: resolved === null || resolved.match === 'self' ? null : resolved.relationship,
      guardianMatch: resolved?.match ?? null,
      issues,
      notices,
    })
  }
  const failed = allIssues.length > 0
  const entries = [...guardians.values()]
  return {
    rows: preview,
    students: failed ? [] : planned,
    issues: allIssues,
    newGuardianCount: entries.filter((entry) => entry.kind === 'new').length,
    existingGuardianCount: entries.filter((entry) => entry.kind === 'existing').length,
  }
}

/** Yazılan öğrenci: kimlik satırı ve veli bağı için servisin ihtiyacı (`student_guardians`). */
export interface AppliedStudent {
  studentId: string
  identity: PlannedStudent['identity']
  bond: { parentId: string; relationship: GuardianRelationship; existing: boolean } | null
}

/**
 * Planı State'e uygular: öğrenci ve veli kayıtları kesin kayıttaki biçimle açılır (DOM-KAY-003:
 * veli zorunluyken öğrencinin iletişimi yalnız dosyada ayrıca verildiyse yazılır; yetişkin
 * kursiyerin satırı `relationship: 'self'`, DOM-KAY-012). Aynı telefondaki yeni veli bir kez açılır.
 */
export function applyStudentImport(
  state: Pick<State, 'students' | 'parents'>,
  planned: readonly PlannedStudent[],
  makeId: MakeId,
  now: string,
): AppliedStudent[] {
  const parentsById = new Map(state.parents.map((parent) => [parent.id, parent]))
  const newParents = new Map<string, string>()
  return planned.map((item): AppliedStudent => {
    const id = makeId('s')
    const { guardian } = item
    const openParent = (parent: State['parents'][number]) => {
      state.parents.push(parent)
      parentsById.set(parent.id, parent)
      return parent.id
    }
    let parentId: string
    switch (guardian.kind) {
      case 'existing':
        parentId = guardian.parentId
        parentsById.get(parentId)?.studentIds.push(id)
        break
      case 'new': {
        const known = newParents.get(guardian.phone)
        if (known === undefined) {
          parentId = openParent({
            id: makeId('p'),
            name: guardian.name,
            phone: guardian.phone,
            relationship: guardian.relationship,
            studentIds: [id],
          })
          newParents.set(guardian.phone, parentId)
        } else {
          parentId = known
          parentsById.get(known)?.studentIds.push(id)
        }
        break
      }
      case 'self':
        parentId = openParent({
          id: makeId('p'),
          name: item.name,
          studentIds: [id],
          relationship: 'self',
        })
        break
      default:
        return guardian satisfies never
    }
    state.students.push({
      id,
      name: item.name,
      classId: item.classId,
      parentId,
      email: '',
      phone: item.phone,
      joinedAt: now,
      isActive: true,
      progress: 0,
    })
    return {
      studentId: id,
      identity: item.identity,
      bond:
        guardian.kind === 'self'
          ? null
          : {
              parentId,
              relationship: guardian.relationship,
              existing: guardian.kind === 'existing',
            },
    }
  })
}
