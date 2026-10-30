import { MODULE_KEYS, isModuleKey, type ModuleKey } from './collection-modules.ts'
import { schoolModules } from './school-workflows.ts'

/**
 * Modül ayar ekranının gösterdiği ad ve kısa açıklama. Okul iş akışı modüllerinin metni
 * `school-workflows.ts` kaydından gelir (menüyle aynı); temel modüllerin menü sayfaları ayrı
 * olduğu için metinleri burada tutulur. Web ve mobil aynı tabloyu okur.
 */
export interface ModuleInfo {
  key: ModuleKey
  title: string
  description: string
  icon: string
}

const BASE_MODULES: readonly ModuleInfo[] = [
  {
    key: 'crm',
    title: 'Kayıt & CRM',
    description: 'Aday takibi, kampüs görüşmeleri ve kesin kayıt.',
    icon: 'ContactRound',
  },
  {
    key: 'academic',
    title: 'Akademik yönetim',
    description: 'Sınıflar, yoklama, ders programları ve başarı analizleri.',
    icon: 'GraduationCap',
  },
  {
    key: 'learning',
    title: 'Dijital öğrenme',
    description: 'Ödevler, videolar, quizler ve soru-cevap.',
    icon: 'BookOpen',
  },
  {
    key: 'finance',
    title: 'Finans & Tahsilat',
    description: 'Taksit planları, ödemeler, dekont ve sözleşmeler.',
    icon: 'Wallet',
  },
  {
    key: 'communication',
    title: 'İletişim & Portallar',
    description: 'Mesajlaşma, randevular, duyurular ve talepler.',
    icon: 'MessagesSquare',
  },
]

const byKey = new Map<string, ModuleInfo>()
for (const info of BASE_MODULES) byKey.set(info.key, info)
for (const module of schoolModules) {
  if (isModuleKey(module.key))
    byKey.set(module.key, {
      key: module.key,
      title: module.title,
      description: module.description,
      icon: module.icon,
    })
}

/** Modülün görünen adı ve açıklaması; bilinmeyen anahtar `undefined`. */
export function moduleInfo(key: string): ModuleInfo | undefined {
  return byKey.get(key)
}

/** Kayıtlı her modül için bilgi; anahtar sırası `MODULE_KEYS` ile aynıdır. */
export const MODULE_INFOS: readonly ModuleInfo[] = MODULE_KEYS.flatMap((key) => {
  const info = byKey.get(key)
  return info ? [info] : []
})
