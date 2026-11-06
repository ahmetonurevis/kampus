import type { ContractLifecycle } from '../lib/contract-status.ts'
import type { ContractTerms } from '../lib/domain.ts'
import { subjects } from './curriculum.ts'
import { createSchoolWorkflows } from './school-workflows.ts'
import { createAssessmentAutomation } from './assessment-automation.ts'
import type { EnrollmentRecord, Renewal } from '../lib/school-workflows.ts'
import type { RequestActor } from '../lib/requests.ts'
import type { ProspectFields } from '../lib/prospects.ts'
import { createGradesAndAttendance, createTimetable } from '../platform/seed-academic.ts'
import { createCommunication } from '../platform/seed-communication.ts'
import { createLearning, quizGrades } from '../platform/seed-learning.ts'
import type { Item, Patch, PlatformStatePatches, Timestamps } from '../platform/seed-state.ts'
import { createStructure } from '../platform/seed-structure.ts'
import { required } from '../platform/seed-support.ts'
export const topics = subjects.map((s) => s.name)

export const studentNames = [
  'Deniz Yılmaz',
  'Ece Yılmaz',
  'Zeynep Demir',
  'Arda Çelik',
  'Elif Şahin',
  'Mert Aydın',
  'Defne Koç',
  'Kerem Arslan',
  'Asya Yıldız',
  'Emir Kaya',
  'Duru Aksoy',
  'Ege Öztürk',
  'İpek Güneş',
  'Kaan Polat',
  'Ada Tekin',
  'Berk Acar',
  'Mina Yalçın',
  'Can Eren',
  'Yağmur Erdem',
  'Ali Keskin',
  'Lara Bulut',
  'Oğuz Karaca',
  'Selin Kurt',
  'Umut Doğan',
  'Nehir Baş',
  'Atlas Özkan',
  'Sude Kaplan',
  'Efe Taş',
  'Azra Sarı',
  'Doruk Uçar',
  'Melis Sezer',
  'Baran Aslan',
  'İdil Kılıç',
  'Yiğit Avcı',
  'Nil Güler',
  'Bora Can',
  'Nisa Duman',
  'Alp Toprak',
  'Ceren Aksu',
  'Tuna Yavuz',
  'Ela Çetin',
  'Burak Işık',
  'Öykü Sağlam',
  'Onur Deniz',
  'Selma Ateş',
  'Emre Özdemir',
  'Nazlı Çakır',
  'Fırat Ekinci',
  'Sena Altun',
  'Batuhan Yücel',
  'İrem Çınar',
  'Tolga Öz',
  'Buse Duran',
  'Serkan Şen',
]

/**
 * Örnek veri: `createSeed(now)` tüm koleksiyonları birleştirir. Kimlikler sabit, tarihler `now`'a
 * göre üretilir. Kurum yapısı, not/yoklama, program, öğrenme ve iletişim kayıtları Oğuzhan'ın
 * `platform/seed-*.ts` dosyalarındadır; burada öğrenci/veli ile Onur'un kayıt ve finans verisi
 * (`// Onur: kayıt ve finans` blokları), `State` tipi ve birleştirme kalır.
 */
function buildSeed(now: Date) {
  const date = (days: number, hour = 9) => {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() + days)
    d.setUTCHours(hour, 0, 0, 0)
    return d.toISOString()
  }
  const month = (offset: number, day = 10) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, day, 9)).toISOString()
  const { branches, teachers, gradeOrder, classes, assignments } = createStructure()
  const names = [...studentNames]
  const firstNames = [
    'Eylül',
    'Berkay',
    'Aylin',
    'Kuzey',
    'Zehra',
    'Kıvanç',
    'Damla',
    'Demir',
    'İlayda',
    'Uras',
    'Dilan',
    'Aras',
    'Gökçe',
    'Alper',
    'İclal',
    'Eray',
    'Deren',
    'Utku',
    'Bengisu',
    'Eren',
  ]
  const lastNames = [
    'Akın',
    'Güven',
    'Yüksel',
    'Bayram',
    'Soylu',
    'Özer',
    'Çalışkan',
    'Taşkın',
    'Bilgin',
    'Uslu',
  ]
  for (const last of lastNames)
    for (const first of firstNames)
      if (names.length < 240 && !names.includes(`${first} ${last}`)) names.push(`${first} ${last}`)
  const students = names.map((name, i) => ({
    id: `s${i + 1}`,
    name,
    classId: required(classes[i % classes.length], 'sınıf').id,
    parentId: i < 2 ? 'p1' : `p${i + 1}`,
    email: `ogrenci${i + 1}@kampus.example`,
    phone: `0555010${String(i + 1).padStart(4, '0')}`,
    joinedAt: month(-12, 3 + (i % 20)),
    isActive: true,
    progress: 45 + ((i * 7) % 50),
    number: String(2026001 + i),
  }))
  const parents = [
    { id: 'p1', name: 'Ayşe Yılmaz', studentIds: ['s1', 's2'] },
    ...students.slice(2).map((s, i) => ({
      id: s.parentId,
      name: `${['Fatma', 'Mustafa', 'Zeynep', 'Ali'][i % 4]} ${s.name.split(' ').at(-1)}`,
      studentIds: [s.id],
    })),
  ]
  const { grades, attendance } = createGradesAndAttendance({
    now,
    date,
    month,
    students,
    classes,
  })
  // Onur: kayıt ve finans
  const invoices = students.flatMap((s, i) =>
    Array.from({ length: 8 }, (_, n) => {
      const paid = n < 3 || (n === 3 && i % 4 !== 0)
      return {
        id: `inv-${s.id}-${n}`,
        studentId: s.id,
        installment: n + 1,
        amount: 2450000 + (i % 3) * 250000,
        dueDate: month(n - 3),
        paidAt: paid ? month(n - 3, 8) : null,
        method: paid ? ['Banka havalesi', 'Kredi kartı', 'Nakit'][i % 3] : null,
        reminderAt: null as string | null,
      }
    }),
  )
  const prospects = [
    'Alara Güven',
    'Ömer Faruk',
    'Doğa Yıldırım',
    'Sarp Ekin',
    'İnci Özer',
    'Rüzgar Soylu',
    'Aylin Akın',
    'Cem Arı',
    'Esma Korkmaz',
    'Poyraz Yüksel',
    'Eylül Varol',
    'Ozan Işık',
    'Beren Dal',
    'Sinan Gök',
    ...studentNames.slice(0, 4),
    'Melisa Önal',
    'Ege Yaman',
    'İdil Uğur',
    'Yağız Özkan',
    'Nehir Tunç',
    'Aren Özen',
    'İnci Sarı',
    'Efe Gündüz',
    'Nil Su',
    'Çınar Ateş',
    'Dora Keskin',
    'Mira Bal',
  ].map((name, i) => ({
    id: `pr${i + 1}`,
    name,
    phone: `0555020${String(i + 1).padStart(4, '0')}`,
    email: `aday${i + 1}@kampus.example`,
    branchId: required(branches[i % 3], 'kampüs').id,
    interest: `${gradeOrder[i % 8]}. Sınıf · ${required(gradeOrder[i % 8], 'düzey') < 9 ? 'Ortaokul' : 'Anadolu Lisesi'}`,
    source: ['Web sitesi', 'Veli referansı', 'Kampüs ziyareti', 'Telefon', 'Bursluluk sınavı'][
      i % 5
    ],
    stage:
      i >= 14 && i < 18
        ? 'Kayıt oldu'
        : ['Yeni aday', 'İletişime geçildi', 'Görüşme planlandı', 'Teklif verildi', 'Vazgeçti'][
            i % 5
          ],
    studentId: i >= 14 && i < 18 ? `s${i - 13}` : null,
    createdAt: date(-i * 2),
    trialAt: i % 5 === 2 ? date(i % 5, 9 + (i % 4)) : null,
    notes: [
      {
        id: `note${i}`,
        text: [
          'Veliyle akademik program, okul servisi ve yemek hizmetleri görüşüldü.',
          'Kampüs gezisi ve rehberlik görüşmesi planlandı. Bursluluk koşulları paylaşıldı.',
          'Öğrencinin önceki okul notları değerlendirildi; sınıf kontenjanı hakkında bilgi verildi.',
        ][i % 3],
        date: date(-i - 1),
        author: 'Büşra Aydın',
      },
    ],
  }))
  // Onur: kayıt ve finans sonu
  const {
    bank,
    quizzes,
    quizAttempts,
    homework,
    submissions,
    questions,
    videos,
    videoProgress,
    materials,
  } = createLearning({ now, date, students, classes, assignments, teachers, gradeOrder })
  grades.push(...quizGrades(quizAttempts, quizzes))
  const { announcements, conversations, conversationMessages, appointments, requests } =
    createCommunication(date)
  const { schedule, availability } = createTimetable({
    now,
    date,
    classes,
    assignments,
    teachers,
  })
  const state = {
    version: 3,
    createdAt: now.toISOString(),
    subjects: structuredClone(subjects),
    assignments,
    branches,
    teachers,
    classes,
    students,
    parents,
    grades,
    attendance,
    // Onur: kayıt ve finans
    invoices,
    prospects,
    // Onur: kayıt ve finans sonu
    bank,
    quizzes,
    homework,
    submissions,
    questions,
    videos,
    videoProgress,
    materials,
    announcements,
    conversations,
    conversationMessages,
    appointments,
    requests,
    schedule,
    availability,
    quizAttempts,
    absences: [],
    notifications: [],
    notificationReads: [],
    permissionForms: [],
    permissionDecisions: [],
    // Onur: kayıt ve finans
    contracts: students.map((s) => ({
      id: `contract-${s.id}`,
      studentId: s.id,
      date: s.joinedAt,
      amount: invoices.filter((x) => x.studentId === s.id).reduce((a, x) => a + x.amount, 0),
      title: 'Özel okul eğitim sözleşmesi',
    })),
    // Onur: kayıt ve finans sonu
    preferences: {},
    modules: { crm: true, finance: true, academic: true, learning: true, communication: true },
    audit: [],
  }
  const extensions = createSchoolWorkflows(state, date)
  const { workflowModules, ...records } = extensions
  const expanded = { ...state, ...records, modules: { ...state.modules, ...workflowModules } }
  return { ...expanded, ...createAssessmentAutomation(expanded) }
}

// State tipi örnek veri üreticisinden türetilir. Örnek veride boş başlayan koleksiyonlar ile
// işlemlerin sonradan eklediği isteğe bağlı alanlar burada tamamlanır.
type SeedState = ReturnType<typeof buildSeed>
type SeedItem<K extends keyof SeedState> = Item<SeedState, K>
export type State = Omit<SeedState, keyof StatePatches> & StatePatches
type StatePatches = OnurStatePatches & PlatformStatePatches<SeedState>

// Onur: kayıt ve finans
type OnurStatePatches = {
  // Arayüzden kaydedilen öğrenciye okul numarası verilmez. Kimlik no ve doğum tarihi
  // `records.data`'ya yazılmaz; API'de `student_identities` tablosundadır (DOM-KAY-012).
  students: (Patch<SeedItem<'students'>, { number?: string }> & {
    academicYear?: number
    /** Kaydın donduğu an (DOM-DIL-052); `isActive` değişmez, durum bundan türetilir (DOM-KAY-026). */
    frozenAt?: string | null
  })[]
  invoices: (SeedItem<'invoices'> &
    Timestamps & {
      /** Okunurken eklenen kısmi ödeme tutarı (API, DOM-FIN-030); saklanmaz. */
      paidCents?: number
      feeKind?: string
      contractId?: string
      academicYear?: number
    })[]
  // Kesin kayıtta yazılan veli iletişimi ve yakınlık derecesi (lib/enrollment.ts, DOM-KAY-003,
  // DOM-KAY-012); örnek veri taşımaz.
  // kvkk: K — veli telefonu, e-postası ve yakınlık derecesi.
  parents: (SeedItem<'parents'> & { phone?: string; email?: string; relationship?: string })[]
  contracts: (SeedItem<'contracts'> & {
    classId?: string
    academicYear?: number
    invoiceIds?: string[]
  } & Partial<ContractTerms> &
    ContractLifecycle)[]
  // Aday işlemlerinin alanları ve notu yazan kişi; örnek veri ve eski kayıtlar taşımaz
  // (lib/prospects.ts).
  prospects: (Patch<
    SeedItem<'prospects'>,
    { notes: (SeedItem<'prospects'>['notes'][number] & { by?: RequestActor })[] }
  > &
    ProspectFields)[]
  renewals: Renewal[]
  enrollmentHistory: EnrollmentRecord[]
}
// Onur: kayıt ve finans sonu

export function createSeed(now = new Date()): State {
  return buildSeed(now)
}
