// Genel Bakış kart yuvası: hangi kartın hangi rolde, hangi modülle ve hangi sütunda göründüğünün
// tek kaydı. Pano sayfaları kartları bilmez; `DashboardCardGrid` bu listeyi rol ve kapalı modüle
// göre süzer (dashboard-cards-model.ts) ve 2:1 yerleşimle çizer. İki kaynak birleşir (page-registry
// kalıbı): Oğuzhan'ın kartları ve `// Onur: kayıt ve finans` bloğu. Kural: docs/sayfalar/platform.md
// "Pano kartı ekleme".
import { buildDashboardCards, type DashboardCard } from './dashboard-cards-model.ts'
import { ADMIN_CARDS } from './AdminCards.tsx'
import { SLA_CARDS } from './AdminSlaCard.tsx'
import { ENROLLMENT_CARDS } from './HandoverEnrollmentCards.tsx'
import { FINANCE_CARDS } from './HandoverFinanceCards.tsx'
import { LEARNER_CARDS } from './LearnerCards.tsx'
import { STUDENT_CARDS } from './StudentCards.tsx'
import { TEACHER_CARDS } from './TeacherCards.tsx'

// Oğuzhan: akademik ve kurum kartları.
const OGUZHAN_CARDS: readonly DashboardCard[] = [
  ...ADMIN_CARDS,
  ...SLA_CARDS,
  ...TEACHER_CARDS,
  ...STUDENT_CARDS,
  ...LEARNER_CARDS,
]

// Onur'a devredilecek: bileşenleri Oğuzhan'ın dosyalarında duran finans ve kayıt kartları. Onur
// kartı `pages/finance/` ya da `pages/management/` altına taşıyıp girişini aşağıdaki Onur bloğuna
// alır ve buradan siler.
const DEVREDILECEK_CARDS: readonly DashboardCard[] = [...FINANCE_CARDS, ...ENROLLMENT_CARDS]

// Onur: kayıt ve finans
// Kendi dosyasında `defineCard({ id, roles, module, area, order, component })` ile yazılmış kartlar
// buraya içe aktarılıp eklenir; örn. `import { COLLECTION_CARDS } from '../finance/DashboardCards.tsx'`.
const ONUR_CARDS: readonly DashboardCard[] = []
// Onur: kayıt ve finans sonu

export const DASHBOARD_CARDS = buildDashboardCards(OGUZHAN_CARDS, DEVREDILECEK_CARDS, ONUR_CARDS)
