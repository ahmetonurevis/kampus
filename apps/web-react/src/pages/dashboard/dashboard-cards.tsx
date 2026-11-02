// Genel Bakış kart yuvası: hangi kartın hangi rolde, hangi modülle ve hangi sütunda göründüğünün
// tek kaydı. Pano sayfaları kartları bilmez; `DashboardCardGrid` bu listeyi rol ve kapalı modüle
// göre süzer (dashboard-cards-model.ts) ve 2:1 yerleşimle çizer. İki kaynak birleşir (page-registry
// kalıbı): Oğuzhan'ın kartları ve `// Onur: kayıt ve finans` bloğu. Kural: docs/sayfalar/platform.md
// "Pano kartı ekleme".
import { buildDashboardCards, type DashboardCard } from './dashboard-cards-model.ts'
import { ADMIN_CARDS } from './AdminCards.tsx'
import { ADMIN_TREND_CARDS } from './AdminTrendCards.tsx'
import { SLA_CARDS } from './AdminSlaCard.tsx'
import { GRADE_TREND_CARDS } from './GradeTrendCards.tsx'
import { LEARNER_CARDS } from './LearnerCards.tsx'
import { NEWS_CARDS } from './NewsCard.tsx'
import { STUDENT_CARDS } from './StudentCards.tsx'
import { TEACHER_CARDS } from './TeacherCards.tsx'
import { TEACHER_QUESTION_CARDS } from './TeacherQuestionCards.tsx'
// Onur: kayıt ve finans
import { ENROLLMENT_CARDS } from '../crm/EnrollmentDashboardCards.tsx'
import { FINANCE_CARDS } from '../finance/FinanceDashboardCards.tsx'
// Onur: kayıt ve finans sonu

// Oğuzhan: akademik ve kurum kartları.
const OGUZHAN_CARDS: readonly DashboardCard[] = [
  ...ADMIN_CARDS,
  ...ADMIN_TREND_CARDS,
  ...SLA_CARDS,
  ...TEACHER_CARDS,
  ...STUDENT_CARDS,
  ...LEARNER_CARDS,
  ...TEACHER_QUESTION_CARDS,
  ...GRADE_TREND_CARDS,
  ...NEWS_CARDS,
]

// Onur: kayıt ve finans
// Kendi dosyasında `defineCard({ id, roles, module, area, order, component })` ile yazılmış kartlar
// buraya içe aktarılıp eklenir.
const ONUR_CARDS: readonly DashboardCard[] = [...FINANCE_CARDS, ...ENROLLMENT_CARDS]
// Onur: kayıt ve finans sonu

export const DASHBOARD_CARDS = buildDashboardCards(OGUZHAN_CARDS, ONUR_CARDS)
