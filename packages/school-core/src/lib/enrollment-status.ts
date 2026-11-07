/**
 * Öğrencinin kayıt durumu ve geçiş olayları (docs/domain/kayit-ve-crm.md DOM-KAY-026; DOM-KAY-001,
 * -020, -022, -024). Durum saklanmaz, her okumada var olan kayıtlardan türetilir (hesaplanabilen
 * değer saklanmaz): öğrencinin `isActive` bayrağı, dönem geçişi kayıtları (`renewals`) ve ayrılış
 * kaydı (`student_withdrawals`). Öğrenciyi pasifleştiren yalnız iki işlem vardır: ayrılış
 * (`withdrawStudent`) ve mezuniyet geçişi (`renewal-activate`, `mode: 'graduate'`). Bu yüzden
 * pasif öğrencide uygulanmış mezuniyet varsa durum `graduated`, yoksa `withdrawn`'dır; ayrılış
 * kaydı yalnız olayın tarihini verir. Durumu belirleyen `isActive`'tir: işlemler bayrağı aynı
 * transaction'da yazar, iki kaynak ayrışırsa (ör. ayrılış kaydı olan aktif öğrenci) bayrak kazanır.
 *
 * Saf modül: State'e bağlı değildir; API depodan okuduğu satırları, web/mobil State'i verir.
 */

export const ENROLLMENT_STATUSES = ['active', 'withdrawn', 'graduated'] as const
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number]

export const ENROLLMENT_STATUS_LABELS: Readonly<Record<EnrollmentStatus, string>> = {
  active: 'Aktif',
  withdrawn: 'Ayrıldı',
  graduated: 'Mezun',
}

/**
 * Durumun sonuçları; tüketiciler durumla `switch` yazmak yerine bunu okur. Sınıf listesi ve
 * kontenjan (DOM-KAY-010), yoklama, akademik bildirim ve mesaj yalnız aktif öğrenci içindir.
 * Ayrılan ve mezun öğrencinin finans bildirimi sürer: ayrılışta borç taksiti ve iade ödemesi,
 * mezuniyette kapanmamış borç olabilir (DOM-FIN-040, -041; DOM-KAY-022).
 */
export interface EnrollmentStatusEffects {
  /** Sınıf/grup listesinde görünür ve kontenjanda yer tutar. */
  readonly roster: boolean
  /** Yoklamaya yazılır. */
  readonly attendance: boolean
  /** Akademik ve iletişim bildirimlerinin (ödev, not, devamsızlık, duyuru) alıcısıdır. */
  readonly academicNotices: boolean
  /** Finans bildirimlerinin (taksit, tahsilat, iade, sözleşme) alıcısıdır. */
  readonly financeNotices: boolean
}

export const ENROLLMENT_STATUS_EFFECTS = {
  active: { roster: true, attendance: true, academicNotices: true, financeNotices: true },
  withdrawn: { roster: false, attendance: false, academicNotices: false, financeNotices: true },
  graduated: { roster: false, attendance: false, academicNotices: false, financeNotices: true },
} as const satisfies Record<EnrollmentStatus, EnrollmentStatusEffects>

/** Türetmenin okuduğu öğrenci alanları. Alanı olmayan eski kayıt aktiftir (`isActive` varsayılanı). */
export interface EnrollmentStudent {
  id: string
  classId: string
  isActive?: boolean
  joinedAt?: string
}

/** Yenileme ve dönem geçişi kaydı (`renewals`; `lib/school-workflows.ts` `Renewal`). */
export interface EnrollmentRenewal {
  id: string
  studentId: string
  mode: 'renew' | 'graduate'
  status: string
  year: number
  fromClassId: string
  targetClassId: string
  createdAt: string
  activatedAt?: string
}

/** Ayrılış kaydı (`student_withdrawals`; API `StoredWithdrawal`). */
export interface EnrollmentWithdrawal {
  id: string
  studentId: string
  withdrawalDate: string
}

export interface EnrollmentRecords {
  renewals: readonly EnrollmentRenewal[]
  /** Çevrimdışı State'te ayrılış kaydı yoktur; verilmezse ayrılış olayı tarihsiz döner. */
  withdrawals?: readonly EnrollmentWithdrawal[]
}

const GRADUATED = 'Mezun'
const PROMOTED = 'Tamamlandı'
const PLANNED = 'Planlandı'

const isGraduation = (renewal: EnrollmentRenewal) =>
  renewal.mode === 'graduate' && renewal.status === GRADUATED

/**
 * Tek öğrencinin kayıt durumu. `renewals` yalnız bu öğrencinin kayıtları olmak zorunda değildir;
 * öğrenci kimliğiyle süzülür. Çok öğrencide `enrollmentStatuses` kullanılır (satır başına tarama
 * yok).
 */
export function enrollmentStatus(
  student: EnrollmentStudent,
  records: Pick<EnrollmentRecords, 'renewals'>,
): EnrollmentStatus {
  if (student.isActive !== false) return 'active'
  return records.renewals.some((item) => item.studentId === student.id && isGraduation(item))
    ? 'graduated'
    : 'withdrawn'
}

/** Öğrenci kimliği → kayıt durumu; mezuniyet kayıtları bir kez indekslenir. */
export function enrollmentStatuses(
  students: readonly EnrollmentStudent[],
  records: Pick<EnrollmentRecords, 'renewals'>,
): Map<string, EnrollmentStatus> {
  const graduated = new Set(
    records.renewals.filter(isGraduation).map((renewal) => renewal.studentId),
  )
  return new Map(
    students.map((student) => [
      student.id,
      student.isActive !== false ? 'active' : graduated.has(student.id) ? 'graduated' : 'withdrawn',
    ]),
  )
}

/**
 * Geçiş olayları. Her olay var olan bir kayıttan türetilir; ayrı olay tablosu yoktur.
 *
 * | Olay        | Üreten işlem (API)                                                       | Durum     |
 * | ----------- | ------------------------------------------------------------------------ | --------- |
 * | `enrolled`  | kesin kayıt `POST /prospects/:id/enroll` (`enrollProspectWithTariff`)    | active    |
 * | `renewed`   | yenileme planı `POST /finance/renewals` (`planRenewal`, `mode: 'renew'`) | değişmez  |
 * | `promoted`  | dönem geçişi `POST /finance/renewals/:id/activate` (`mode: 'renew'`)     | active    |
 * | `graduated` | dönem geçişi `POST /finance/renewals/:id/activate` (`mode: 'graduate'`)  | graduated |
 * | `withdrawn` | ayrılış `POST /students/:id/withdraw` (`withdrawStudent`)                | withdrawn |
 *
 * Ayrılış öğrencinin planlanmış yenilemesini iptal eder (`İptal`); iptal edilen yenileme hiç
 * yürürlüğe girmediği için olay üretmez. Planlanmış mezuniyet de uygulanana kadar olay değildir.
 */
export type EnrollmentEvent =
  | { kind: 'enrolled'; at: string | null; classId: string }
  | { kind: 'renewed'; at: string; renewalId: string; year: number; targetClassId: string }
  | {
      kind: 'promoted'
      at: string
      renewalId: string
      year: number
      fromClassId: string
      toClassId: string
    }
  | { kind: 'graduated'; at: string; renewalId: string; fromClassId: string }
  | { kind: 'withdrawn'; at: string | null; withdrawalId: string | null }
export type EnrollmentEventKind = EnrollmentEvent['kind']

/** Olayın kayıt durumuna etkisi; `null` durumu değiştirmez. */
export const ENROLLMENT_EVENT_STATUS: Readonly<
  Record<EnrollmentEventKind, EnrollmentStatus | null>
> = {
  enrolled: 'active',
  renewed: null,
  promoted: 'active',
  graduated: 'graduated',
  withdrawn: 'withdrawn',
}

const DAY_START = 'T00:00:00.000Z'
/** Ayrılış günü (`YYYY-MM-DD`) sıralamada günün başı sayılır; aynı günün işlemlerinden önce gelir. */
const sortKey = (event: EnrollmentEvent) =>
  event.at !== null && event.at.length === 10 ? `${event.at}${DAY_START}` : (event.at ?? '')

/**
 * Öğrencinin geçiş olayları, eskiden yeniye. Kesin kayıt anı `joinedAt`, sınıfı ilk dönem
 * geçişinin `fromClassId`'sidir (geçiş yoksa güncel sınıf). Ayrılış olayının tarihi ayrılış
 * kaydının `withdrawalDate` günüdür; kayıt yoksa (çevrimdışı State) tarihsiz döner.
 */
export function enrollmentEvents(
  student: EnrollmentStudent,
  records: EnrollmentRecords,
): EnrollmentEvent[] {
  const renewals = records.renewals.filter((item) => item.studentId === student.id)
  const applied = renewals
    .filter((item) => item.activatedAt !== undefined)
    .sort((left, right) => (left.activatedAt ?? '').localeCompare(right.activatedAt ?? ''))
  const enrolled: EnrollmentEvent = {
    kind: 'enrolled',
    at: student.joinedAt ?? null,
    classId: applied[0]?.fromClassId ?? student.classId,
  }
  const events: EnrollmentEvent[] = []
  for (const renewal of renewals) {
    if (renewal.mode === 'renew' && (renewal.status === PLANNED || renewal.status === PROMOTED))
      events.push({
        kind: 'renewed',
        at: renewal.createdAt,
        renewalId: renewal.id,
        year: renewal.year,
        targetClassId: renewal.targetClassId,
      })
    if (renewal.activatedAt === undefined) continue
    if (renewal.mode === 'renew' && renewal.status === PROMOTED)
      events.push({
        kind: 'promoted',
        at: renewal.activatedAt,
        renewalId: renewal.id,
        year: renewal.year,
        fromClassId: renewal.fromClassId,
        toClassId: renewal.targetClassId,
      })
    if (isGraduation(renewal))
      events.push({
        kind: 'graduated',
        at: renewal.activatedAt,
        renewalId: renewal.id,
        fromClassId: renewal.fromClassId,
      })
  }
  if (enrollmentStatus(student, records) === 'withdrawn') {
    const withdrawal = records.withdrawals?.find((item) => item.studentId === student.id)
    events.push({
      kind: 'withdrawn',
      at: withdrawal?.withdrawalDate ?? null,
      withdrawalId: withdrawal?.id ?? null,
    })
  }
  // Kesin kayıt her zaman ilk olaydır; tarihsiz ayrılış sonda kalır.
  const dated = events
    .filter((event) => event.at !== null)
    .sort((left, right) => sortKey(left).localeCompare(sortKey(right)))
  return [enrolled, ...dated, ...events.filter((event) => event.at === null)]
}
