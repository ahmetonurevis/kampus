import { z } from 'zod'

/**
 * Kursun seviye modeli: sınav programı + ders + konu ağacı (ADR 0008 karar 2; IST-001). Dil
 * okulunun CEFR seviyesi ve okulun sınıf düzeyi + kazanımı yerine kursta düzey, hazırlanılan
 * sınavın oturumudur (YKS TYT/AYT, KPSS GY-GK/ÖABT, LGS); ölçme ve etüt konuya bağlanır.
 *
 * Program tanımı kurumundur: örnek liste (`SAMPLE_EXAM_PROGRAMS`) başlangıç önerisidir ve soru
 * sayıları sınavı düzenleyen kurumun (ÖSYM, MEB) o yılki kılavuzundan doğrulanır. Fonksiyonlar
 * saftır; programın kalıcılığı ve kursiyer–program bağı ADR 0008 adım 2'dedir.
 */

z.config(z.locales.tr())

/** Hazırlanılan sınavlar ve düzenleyen kurum. */
export const EXAMS = {
  yks: { label: 'YKS', authority: 'ÖSYM' },
  kpss: { label: 'KPSS', authority: 'ÖSYM' },
  ales: { label: 'ALES', authority: 'ÖSYM' },
  dgs: { label: 'DGS', authority: 'ÖSYM' },
  yds: { label: 'YDS', authority: 'ÖSYM' },
  lgs: { label: 'LGS', authority: 'MEB' },
} as const satisfies Record<string, { label: string; authority: string }>
export type Exam = keyof typeof EXAMS
export const EXAM_KEYS = Object.keys(EXAMS) as [Exam, ...Exam[]]

/** Konu ağacının en çok derinliği: konu → alt konu → başlık. */
export const TOPIC_MAX_DEPTH = 3

const idSchema = z
  .string()
  .trim()
  .min(1, 'Kimlik boş olamaz.')
  .max(60)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'Kimlik küçük harf, rakam, - ve _ içerir.')
const nameSchema = z.string().trim().min(1, 'Ad boş olamaz.').max(120)

export interface TopicNode {
  id: string
  name: string
  children?: TopicNode[] | undefined
}

export const topicNodeSchema: z.ZodType<TopicNode> = z.strictObject({
  id: idSchema,
  name: nameSchema,
  get children() {
    return z.array(topicNodeSchema).max(100).optional()
  },
})

export const programSubjectSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  /** Oturumdaki soru sayısı; deneme net hesabının ve optik anahtarın üst sınırıdır. */
  questionCount: z.int().min(1).max(200),
  topics: z.array(topicNodeSchema).max(200),
})
export type ProgramSubject = z.infer<typeof programSubjectSchema>

function depthOf(nodes: readonly TopicNode[] | undefined): number {
  if (!nodes?.length) return 0
  return 1 + Math.max(...nodes.map((node) => depthOf(node.children)))
}

function collectIds(nodes: readonly TopicNode[] | undefined, into: string[]): string[] {
  for (const node of nodes ?? []) {
    into.push(node.id)
    collectIds(node.children, into)
  }
  return into
}

const firstDuplicate = (values: readonly string[]) =>
  values.find((value, index) => values.indexOf(value) !== index)

export const examProgramSchema = z
  .strictObject({
    id: idSchema,
    exam: z.enum(EXAM_KEYS),
    /** Sınavın oturumu ya da testi: TYT, AYT, GY-GK, ÖABT… */
    session: z.string().trim().min(1).max(40),
    /** Puan türü ya da alan (Sayısal, Eşit ağırlık, Matematik öğretmenliği); yoksa boş. */
    track: z.string().trim().min(1).max(60).optional(),
    title: nameSchema,
    subjects: z.array(programSubjectSchema).min(1, 'En az bir ders ekleyin.').max(30),
  })
  .superRefine((program, ctx) => {
    const duplicateSubject = firstDuplicate(program.subjects.map((subject) => subject.id))
    if (duplicateSubject !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['subjects'],
        message: 'Aynı ders programda iki kez yer alamaz.',
      })
    program.subjects.forEach((subject, index) => {
      if (depthOf(subject.topics) > TOPIC_MAX_DEPTH)
        ctx.addIssue({
          code: 'custom',
          path: ['subjects', index, 'topics'],
          message: `Konu ağacı en çok ${TOPIC_MAX_DEPTH} düzeydir.`,
        })
      if (firstDuplicate(collectIds(subject.topics, [])) !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['subjects', index, 'topics'],
          message: 'Aynı konu bir derste iki kez yer alamaz.',
        })
    })
  })
export type ExamProgram = z.infer<typeof examProgramSchema>

/** Programın toplam soru sayısı (hesaplanır, saklanmaz). */
export function programQuestionCount(program: Pick<ExamProgram, 'subjects'>): number {
  return program.subjects.reduce((sum, subject) => sum + subject.questionCount, 0)
}

export interface TopicEntry {
  subjectId: string
  topicId: string
  /** Kökten konuya adlar: ["Problemler", "Yaş problemleri"]. */
  path: string[]
}

/**
 * Programın bütün konuları, ağaç sırasıyla düzleştirilmiş. Optik anahtarın ve etüdün bağlanacağı
 * konu listesi budur (okuldaki kazanımın karşılığı).
 */
export function programTopics(program: Pick<ExamProgram, 'subjects'>): TopicEntry[] {
  const entries: TopicEntry[] = []
  const walk = (subjectId: string, nodes: readonly TopicNode[] | undefined, parents: string[]) => {
    for (const node of nodes ?? []) {
      const path = [...parents, node.name]
      entries.push({ subjectId, topicId: node.id, path })
      walk(subjectId, node.children, path)
    }
  }
  for (const subject of program.subjects) walk(subject.id, subject.topics, [])
  return entries
}

const leaf = (id: string, name: string): TopicNode => ({ id, name })

/**
 * Örnek programlar (kurum ilk açılışta bunlardan seçip düzenler). Ders ve soru sayıları 2026
 * itibarıyla kamuya açık sınav yapısını izler; her yıl ÖSYM ve MEB kılavuzundan doğrulanır
 * (ADR 0008 "Açık sorular"). Konu ağaçları kısaltılmış örnektir, tam müfredat değildir.
 */
export const SAMPLE_EXAM_PROGRAMS: readonly ExamProgram[] = [
  {
    id: 'yks-tyt',
    exam: 'yks',
    session: 'TYT',
    title: 'YKS TYT hazırlık',
    subjects: [
      {
        id: 'turkce',
        name: 'Türkçe',
        questionCount: 40,
        topics: [
          leaf('sozcukte-anlam', 'Sözcükte anlam'),
          leaf('paragraf', 'Paragraf'),
          leaf('dil-bilgisi', 'Dil bilgisi'),
        ],
      },
      {
        id: 'sosyal',
        name: 'Sosyal Bilimler',
        questionCount: 20,
        topics: [
          leaf('tarih', 'Tarih'),
          leaf('cografya', 'Coğrafya'),
          leaf('felsefe', 'Felsefe'),
          leaf('din-kulturu', 'Din kültürü'),
        ],
      },
      {
        id: 'temel-matematik',
        name: 'Temel Matematik',
        questionCount: 40,
        topics: [
          leaf('temel-kavramlar', 'Temel kavramlar'),
          leaf('rasyonel-sayilar', 'Rasyonel sayılar'),
          {
            id: 'problemler',
            name: 'Problemler',
            children: [
              leaf('sayi-problemleri', 'Sayı problemleri'),
              leaf('yas-problemleri', 'Yaş problemleri'),
              leaf('hareket-problemleri', 'Hareket problemleri'),
            ],
          },
          leaf('geometri', 'Geometri'),
        ],
      },
      {
        id: 'fen',
        name: 'Fen Bilimleri',
        questionCount: 20,
        topics: [leaf('fizik', 'Fizik'), leaf('kimya', 'Kimya'), leaf('biyoloji', 'Biyoloji')],
      },
    ],
  },
  {
    id: 'yks-ayt-sayisal',
    exam: 'yks',
    session: 'AYT',
    track: 'Sayısal',
    title: 'YKS AYT sayısal hazırlık',
    subjects: [
      {
        id: 'matematik',
        name: 'Matematik',
        questionCount: 40,
        topics: [
          leaf('fonksiyonlar', 'Fonksiyonlar'),
          leaf('limit-turev', 'Limit ve türev'),
          leaf('integral', 'İntegral'),
        ],
      },
      { id: 'fizik', name: 'Fizik', questionCount: 14, topics: [leaf('mekanik', 'Mekanik')] },
      {
        id: 'kimya',
        name: 'Kimya',
        questionCount: 13,
        topics: [leaf('organik-kimya', 'Organik kimya')],
      },
      {
        id: 'biyoloji',
        name: 'Biyoloji',
        questionCount: 13,
        topics: [leaf('kalitim', 'Kalıtım')],
      },
    ],
  },
  {
    id: 'kpss-gy-gk',
    exam: 'kpss',
    session: 'GY-GK',
    title: 'KPSS genel yetenek ve genel kültür',
    subjects: [
      {
        id: 'genel-yetenek',
        name: 'Genel Yetenek',
        questionCount: 60,
        topics: [
          {
            id: 'gy-turkce',
            name: 'Türkçe',
            children: [leaf('gy-paragraf', 'Paragraf'), leaf('gy-dil-bilgisi', 'Dil bilgisi')],
          },
          {
            id: 'gy-matematik',
            name: 'Matematik',
            children: [
              leaf('gy-problemler', 'Problemler'),
              leaf('gy-sayisal-mantik', 'Sayısal mantık'),
            ],
          },
        ],
      },
      {
        id: 'genel-kultur',
        name: 'Genel Kültür',
        questionCount: 60,
        topics: [
          leaf('gk-tarih', 'Tarih'),
          leaf('gk-cografya', 'Coğrafya'),
          leaf('gk-vatandaslik', 'Vatandaşlık'),
        ],
      },
    ],
  },
  {
    id: 'lgs',
    exam: 'lgs',
    session: 'LGS',
    title: 'LGS hazırlık',
    subjects: [
      { id: 'turkce', name: 'Türkçe', questionCount: 20, topics: [leaf('paragraf', 'Paragraf')] },
      {
        id: 'matematik',
        name: 'Matematik',
        questionCount: 20,
        topics: [leaf('carpanlar-katlar', 'Çarpanlar ve katlar')],
      },
      {
        id: 'fen',
        name: 'Fen Bilimleri',
        questionCount: 20,
        topics: [leaf('dna-genetik', 'DNA ve genetik kod')],
      },
      {
        id: 'inkilap',
        name: 'T.C. İnkılap Tarihi ve Atatürkçülük',
        questionCount: 10,
        topics: [leaf('milli-uyanis', 'Millî uyanış')],
      },
      {
        id: 'din',
        name: 'Din Kültürü ve Ahlak Bilgisi',
        questionCount: 10,
        topics: [leaf('kader-inanci', 'Kader inancı')],
      },
      {
        id: 'ingilizce',
        name: 'İngilizce',
        questionCount: 10,
        topics: [leaf('friendship', 'Friendship')],
      },
    ],
  },
]
