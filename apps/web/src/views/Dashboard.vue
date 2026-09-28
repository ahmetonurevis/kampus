<script setup>
import { useViewMemory } from '../lib/view-memory.js'
import { computed } from 'vue'
import {
  state,
  role,
  currentStudent,
  teacherId,
  teacherClasses,
  classById,
  studentById,
  gradeAverage,
  absentCount,
  teacherById,
} from '../stores/demo.js'
import { money, number, dateLabel, dayKey, sum, invoiceStatus, slaStatus } from '../lib/format.js'
import { roles } from '../modules/navigation.js'
import PageHeading from '../components/PageHeading.vue'
import StatCard from '../components/StatCard.vue'
import TrendChart from '../components/TrendChart.vue'
import Icon from '../components/Icon.vue'
import Avatar from '../components/Avatar.vue'
import Badge from '../components/Badge.vue'
import LessonAgenda from '../components/LessonAgenda.vue'
const remember = useViewMemory()
const branch = remember('branch', 'all'),
  period = remember('period', '6')
const isAdmin = computed(() => role.value === 'yonetici')
const isStaff = computed(() => ['yonetici', 'onburo'].includes(role.value))
const students = computed(() =>
  state.students.filter(
    (s) => s.isActive && (branch.value === 'all' || classById(s.classId).branchId === branch.value),
  ),
)
const invoices = computed(() =>
  state.invoices.filter((i) =>
    isStaff.value
      ? students.value.some((s) => s.id === i.studentId)
      : i.studentId === currentStudent.value.id,
  ),
)
const collected = computed(() =>
  sum(
    invoices.value.filter((i) => i.paidAt),
    'amount',
  ),
)
const total = computed(() => sum(invoices.value, 'amount'))
const due = computed(() => invoices.value.filter((i) => invoiceStatus(i) === 'Gecikmiş'))
const currentMonth = dayKey().slice(0, 7)
const monthlyCollected = computed(() =>
  sum(
    invoices.value.filter((i) => i.paidAt && dayKey(i.paidAt).startsWith(currentMonth)),
    'amount',
  ),
)
const monthSeries = computed(() => {
  const [year, month] = currentMonth.split('-').map(Number)
  return Array.from(
    { length: Number(period.value) },
    (_, i) => new Date(Date.UTC(year, month - Number(period.value) + i, 15)),
  )
})
const revenueSeries = computed(() => [
  {
    label: 'Gerçekleşen tahsilat',
    color: 'var(--primary)',
    dashed: false,
    area: true,
    values: monthSeries.value.map((m) =>
      sum(
        invoices.value.filter(
          (i) => i.paidAt && dayKey(i.paidAt).slice(0, 7) === dayKey(m).slice(0, 7),
        ),
        'amount',
      ),
    ),
  },
  {
    label: 'Planlanan (taksit bazlı)',
    color: 'var(--chart-reference)',
    dashed: true,
    values: monthSeries.value.map((m) =>
      sum(
        invoices.value.filter((i) => dayKey(i.dueDate).slice(0, 7) === dayKey(m).slice(0, 7)),
        'amount',
      ),
    ),
  },
])
const lessons = computed(() =>
  state.schedule
    .filter(
      (l) =>
        dayKey(l.date) === dayKey() &&
        (isStaff.value
          ? branch.value === 'all' || classById(l.classId).branchId === branch.value
          : role.value === 'ogretmen'
            ? l.teacherId === teacherId
            : l.classId === currentStudent.value.classId),
    )
    .sort((a, b) => a.date.localeCompare(b.date)),
)
const unanswered = computed(() =>
  state.questions.filter(
    (q) => !q.answeredAt && (role.value !== 'ogretmen' || q.teacherId === teacherId),
  ),
)
const breaches = computed(
  () => unanswered.value.filter((q) => slaStatus(q) === 'Süre aşıldı').length,
)
const pendingHomework = computed(() =>
  state.homework.filter(
    (h) =>
      h.classId === currentStudent.value.classId &&
      !state.submissions.some(
        (s) => s.homeworkId === h.id && s.studentId === currentStudent.value.id,
      ),
  ),
)
const pendingGrading = computed(
  () =>
    state.submissions.filter(
      (s) =>
        s.score == null &&
        state.homework.find((h) => h.id === s.homeworkId)?.teacherId === teacherId,
    ).length,
)
const trials = computed(() =>
  state.prospects.filter((p) => p.trialAt && dayKey(p.trialAt) === dayKey()),
)
const cards = computed(() =>
  isAdmin.value
    ? [
        {
          label: 'Bu ay tahsilat',
          value: money(monthlyCollected.value),
          icon: 'Wallet',
          tone: 'purple',
          note: 'Son 6 ayın tahsilat eğilimi',
        },
        {
          label: 'Aktif öğrenci',
          value: number(students.value.length),
          icon: 'GraduationCap',
          tone: 'blue',
          note: `${state.classes.filter((c) => c.isActive && (branch.value === 'all' || c.branchId === branch.value)).length} sınıfta öğrenmeye devam ediyor`,
        },
        {
          label: 'Tahsilat oranı',
          value: `%${Math.round((collected.value / (total.value || 1)) * 100)}`,
          icon: 'ChartNoAxesCombined',
          tone: 'green',
          note: 'Tüm ödeme planına göre',
        },
        {
          label: 'SLA ihlali',
          value: breaches.value,
          icon: 'Timer',
          tone: 'amber',
          note: `${unanswered.value.length} soru yanıt bekliyor`,
        },
      ]
    : role.value === 'onburo'
      ? [
          {
            label: 'Bugünkü tanışma görüşmesi',
            value: trials.value.length,
            icon: 'CalendarDays',
          },
          {
            label: 'Görüşme bekleyen aday',
            value: state.prospects.filter((p) => p.stage === 'Yeni aday').length,
            icon: 'ContactRound',
            tone: 'blue',
          },
          {
            label: 'Toplam kesin kayıt',
            value: state.prospects.filter((p) => p.stage === 'Kayıt oldu').length,
            icon: 'UserRoundPlus',
            tone: 'green',
            note: 'CRM kayıt dönüşümü',
          },
          {
            label: 'Geciken taksit',
            value: due.value.length,
            icon: 'Wallet',
            tone: 'amber',
            note: `${money(sum(due.value, 'amount'))} tahsilat bekliyor`,
          },
        ]
      : role.value === 'ogretmen'
        ? [
            {
              label: 'Bugünkü dersler',
              value: lessons.value.length,
              icon: 'CalendarDays',
            },
            {
              label: 'Öğrencilerim',
              value: state.students.filter((s) =>
                teacherClasses.value.some((c) => c.id === s.classId),
              ).length,
              icon: 'GraduationCap',
              tone: 'blue',
              note: 'Atandığınız sınıflardaki öğrenciler',
            },
            {
              label: 'Değerlendirme bekliyor',
              value: pendingGrading.value,
              icon: 'NotebookPen',
              tone: 'green',
              note: 'Teslim edilen ödev',
            },
            {
              label: 'Yanıt bekleyen soru',
              value: unanswered.value.length,
              icon: 'MessageCircleQuestion',
              tone: 'amber',
              note: `${breaches.value} soruda süre aşıldı`,
            },
          ]
        : [
            {
              label: 'Genel not ortalaması',
              value: `${gradeAverage(currentStudent.value.id)}/100`,
              icon: 'Award',
              tone: 'purple',
              note: 'Tüm değerlendirmeler',
            },
            {
              label: 'Bugünkü dersler',
              value: lessons.value.length,
              icon: 'CalendarDays',
              tone: 'blue',
              note: classById(currentStudent.value.classId).name,
            },
            {
              label: role.value === 'veli' ? 'Güncel bakiye' : 'Bekleyen ödev',
              value:
                role.value === 'veli'
                  ? money(total.value - collected.value)
                  : pendingHomework.value.length,
              icon: role.value === 'veli' ? 'Wallet' : 'NotebookPen',
              tone: 'green',
              note: role.value === 'veli' ? 'Kalan taksitler toplamı' : '',
            },
            {
              label: 'Devamsızlık',
              value: `${absentCount(currentStudent.value.id)} ders`,
              icon: 'ClipboardCheck',
              tone: 'amber',
              note: 'Kayıtlı ders geçmişi',
            },
          ],
)
const announcements = computed(() =>
  state.announcements
    .filter(
      (a) =>
        !a.classId ||
        isStaff.value ||
        (role.value === 'ogretmen'
          ? teacherClasses.value.some((c) => c.id === a.classId)
          : a.classId === currentStudent.value.classId),
    )
    .slice(0, 3),
)
const branchStats = computed(() =>
  state.branches
    .filter((b) => b.isActive && (branch.value === 'all' || b.id === branch.value))
    .map((b, index) => {
      const classes = state.classes.filter((c) => c.isActive && c.branchId === b.id)
      const count = state.students.filter(
        (s) => s.isActive && classes.some((c) => c.id === s.classId),
      ).length
      return {
        ...b,
        color: `var(--chart-${(index % 3) + 1})`,
        count,
        capacity: sum(classes, 'capacity'),
        percentage: Math.round((count / (sum(classes, 'capacity') || 1)) * 100),
      }
    }),
)
const latestAttempt = computed(
  () =>
    state.quizAttempts
      .filter((a) => a.studentId === currentStudent.value.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0],
)
const visibleCards = computed(() =>
  cards.value.filter((card) => {
    const sections = {
      finance: ['Bu ay tahsilat', 'Tahsilat oranı', 'Geciken taksit', 'Güncel bakiye'],
      crm: ['Bugünkü tanışma görüşmesi', 'Görüşme bekleyen aday', 'Toplam kesin kayıt'],
      learning: ['SLA ihlali', 'Bekleyen ödev', 'Değerlendirme bekliyor', 'Yanıt bekleyen soru'],
      academic: [
        'Aktif öğrenci',
        'Öğrencilerim',
        'Bugünkü dersler',
        'Devamsızlık',
        'Genel not ortalaması',
      ],
    }
    return Object.entries(sections).every(
      ([module, labels]) => !labels.includes(card.label) || state.modules[module],
    )
  }),
)
const academicSeries = computed(() => {
  const relevant = state.grades.filter((g) =>
    role.value === 'ogretmen'
      ? state.students.some(
          (s) => s.id === g.studentId && teacherClasses.value.some((c) => c.id === s.classId),
        ) && g.subjectId === teacherById(teacherId).subjectId
      : g.studentId === currentStudent.value.id,
  )
  const months = [...new Set(relevant.map((g) => dayKey(g.date).slice(0, 7)))].sort()
  return {
    labels: months.map((month) =>
      dateLabel(`${month}-15T09:00:00Z`, {
        day: undefined,
        month: 'short',
      }),
    ),
    series: [
      {
        label: role.value === 'ogretmen' ? 'Sınıflarımın branş ortalaması' : 'Not ortalaması',
        values: months.map((month) => {
          const rows = relevant.filter((g) => dayKey(g.date).startsWith(month))
          return Math.round(rows.reduce((sum, g) => sum + g.score, 0) / (rows.length || 1))
        }),
      },
    ],
  }
})
const collectionSpark = computed(() =>
  monthSeries.value.slice(-6).map((month, index) => ({
    label: dateLabel(month, { day: undefined, month: 'short', year: 'numeric' }),
    value: revenueSeries.value[0].values.slice(-6)[index],
  })),
)
const gradeSpark = computed(() =>
  academicSeries.value.labels.slice(-6).map((label, index) => ({
    label,
    value: academicSeries.value.series[0].values.slice(-6)[index],
  })),
)
const upcomingLessons = computed(() =>
  state.schedule
    .filter(
      (l) =>
        +new Date(l.date) >= Date.now() &&
        (role.value === 'ogretmen'
          ? l.teacherId === teacherId
          : l.classId === currentStudent.value.classId),
    )
    .sort((a, b) => a.date.localeCompare(b.date)),
)
const displayLessons = computed(() => {
  if (lessons.value.length) return lessons.value
  const first = upcomingLessons.value[0]
  return first
    ? upcomingLessons.value.filter((lesson) => dayKey(lesson.date) === dayKey(first.date))
    : []
})
const priorityInvoices = computed(() =>
  invoices.value
    .filter((i) => !i.paidAt)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 4),
)
</script>
<template>
  <PageHeading
    :title="`Merhaba, ${(role === 'ogretmen' ? teacherById(teacherId).name : roles[role].name).split(' ')[0]}`"
    :description="
      isAdmin
        ? 'Kayıt, tahsilat ve akademik durum özeti.'
        : role === 'veli'
          ? `${currentStudent.name} için güncel eğitim özeti.`
          : role === 'ogretmen'
            ? 'Ders programınız, teslimler ve öğrenci soruları.'
            : role === 'onburo'
              ? 'Aday görüşmeleri, kayıtlar ve tahsilat takibi.'
              : 'Ders programınız, ödevleriniz ve son değerlendirmeler.'
    "
    ><div class="date-chip">
      <Icon name="CalendarDays" :size="17" />{{ dateLabel(new Date(), { year: 'numeric' }) }}
    </div>
    <select v-if="isStaff" v-model="branch" aria-label="Şube filtresi">
      <option value="all">Tüm kampüsler</option>
      <option v-for="b in state.branches.filter((b) => b.isActive)" :key="b.id" :value="b.id">
        {{ b.name }}
      </option>
    </select></PageHeading
  >
  <div v-if="visibleCards.length" class="stats-grid">
    <StatCard
      v-for="(card, index) in visibleCards"
      :key="card.label"
      v-bind="card"
      :soft="index === 0"
      :points="
        card.label === 'Bu ay tahsilat'
          ? collectionSpark
          : card.label === 'Genel not ortalaması'
            ? gradeSpark
            : []
      "
      :spark-currency="card.label === 'Bu ay tahsilat'"
      :spark-label="
        card.label === 'Bu ay tahsilat' ? 'Son 6 ayın tahsilatı' : 'Aylık not ortalaması'
      "
    />
  </div>
  <div class="dashboard-grid">
    <section v-if="isStaff && state.modules.finance" class="panel main-chart">
      <div class="panel-heading">
        <div>
          <h2>Ciro & tahsilat</h2>
          <p>Vade tarihine göre plan · ödeme tarihine göre tahsilat</p>
        </div>
        <select v-model="period" aria-label="Grafik dönemi">
          <option value="6">Son 6 ay</option>
          <option value="12">Son 12 ay</option>
        </select>
      </div>
      <div class="chart-totals">
        <div>
          <small>Toplam tahsilat</small><strong>{{ money(collected) }}</strong>
        </div>
        <div>
          <small>Bekleyen bakiye</small
          ><strong class="muted">{{ money(total - collected) }}</strong>
        </div>
      </div>
      <TrendChart
        :labels="monthSeries.map((m) => dateLabel(m, { day: undefined, month: 'short' }))"
        :series="revenueSeries"
        currency
      />
    </section>
    <section v-if="!isStaff && state.modules.academic" class="panel agenda-panel">
      <div class="panel-heading">
        <div>
          <h2>{{ lessons.length ? 'Bugünkü ders programı' : 'Yaklaşan dersler' }}</h2>
          <p>{{ dateLabel(displayLessons[0]?.date || new Date(), { weekday: 'long' }) }}</p>
        </div>
        <RouterLink
          :to="`/${role}/${role === 'veli' ? 'akademik-takip' : 'ders-programi'}`"
          class="text-link"
          >Programı aç<Icon name="ArrowRight" :size="15"
        /></RouterLink>
      </div>
      <LessonAgenda :lessons="displayLessons" />
    </section>
    <section v-if="isStaff && state.modules.academic" class="panel branch-panel soft-surface">
      <div class="panel-heading">
        <div>
          <h2>Kampüs dolulukları</h2>
          <p>Aktif öğrenci ve kontenjan dağılımı</p>
        </div>
        <Icon name="Building2" :size="20" />
      </div>
      <div class="occupancy-summary">
        <strong
          >%{{
            Math.round(
              (students.length / (branchStats.reduce((n, b) => n + b.capacity, 0) || 1)) * 100,
            )
          }}</strong
        >
        <div>
          <span>Genel doluluk</span
          ><small
            >{{ students.length }} öğrenci ·
            {{ branchStats.reduce((n, b) => n + b.capacity, 0) }} kontenjan</small
          >
        </div>
      </div>
      <div class="branch-progress-list">
        <div v-for="b in branchStats" :key="b.id" class="branch-progress">
          <div>
            <span><i :style="{ background: b.color }"></i>{{ b.name }}</span
            ><strong
              >{{ b.count }}<small> / {{ b.capacity }}</small></strong
            >
          </div>
          <div class="progress">
            <span :style="{ width: `${b.percentage}%`, background: b.color }"></span>
          </div>
        </div>
      </div>
    </section>
    <section
      v-if="!isStaff && state.modules.learning && (role !== 'veli' || state.modules.academic)"
      class="panel focus-panel soft-surface"
    >
      <div class="panel-heading">
        <div>
          <h2>{{ role === 'ogretmen' ? 'Yanıt bekleyen sorular' : 'Bekleyen ödevler' }}</h2>
          <p>
            {{
              role === 'ogretmen'
                ? 'Öğrencilerinizden gelen son sorular'
                : classById(currentStudent.classId).name
            }}
          </p>
        </div>
        <Icon name="Target" />
      </div>
      <template v-if="role === 'ogretmen'"
        ><RouterLink
          v-for="q in unanswered.slice(0, 3)"
          :key="q.id"
          to="/ogretmen/sorular"
          class="question-preview"
          ><strong>{{ q.title }}</strong
          ><span>{{ studentById(q.studentId).name }}</span
          ><Badge :text="slaStatus(q)" /></RouterLink></template
      ><template v-else>
        <div class="homework-preview">
          <RouterLink
            v-for="homework in [...pendingHomework]
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
              .slice(0, 3)"
            :key="homework.id"
            :to="`/${role}/${role === 'veli' ? 'akademik-takip' : 'odevler'}`"
          >
            <strong>{{ homework.title }}</strong
            ><small>Son teslim · {{ dateLabel(homework.dueDate) }}</small>
          </RouterLink>
          <p v-if="!pendingHomework.length" class="empty-inline">Bekleyen ödev bulunmuyor.</p>
        </div>
      </template>
    </section>
  </div>
  <div
    v-if="role === 'ogrenci' && latestAttempt && state.modules.learning"
    class="latest-quiz-banner"
  >
    <span class="mini-icon mint"><Icon name="Award" :size="22" /></span>
    <div>
      <strong>Son quiz sonucun: {{ latestAttempt.score }}/100</strong>
      <p>
        {{ state.quizzes.find((q) => q.id === latestAttempt.quizId)?.title }} ·
        {{ latestAttempt.correct }}/{{ latestAttempt.total }} doğru ·
        {{ dateLabel(latestAttempt.date) }}
      </p>
    </div>
    <RouterLink to="/ogrenci/soru-coz" class="text-link"
      >Pratiğe devam et<Icon name="ArrowRight" :size="16"
    /></RouterLink>
  </div>
  <div class="dashboard-grid bottom-grid">
    <section v-if="isStaff ? state.modules.finance : state.modules.academic" class="panel">
      <div class="panel-heading">
        <div>
          <h2>
            {{ isStaff ? 'Yaklaşan ödemeler & takip' : 'Akademik gelişim' }}
          </h2>
          <p>
            {{
              isStaff
                ? 'Öncelik verilmesi gereken tahsilatlar'
                : role === 'ogretmen'
                  ? 'Sınıflarınızın aylık branş ortalaması'
                  : `${currentStudent.name} · Aylık not ortalaması`
            }}
          </p>
        </div>
        <RouterLink
          :to="
            isStaff
              ? `/${role}/${isAdmin ? 'finans' : 'tahsilat-takip'}`
              : `/${role}/${role === 'ogretmen' ? 'sinif-analizi' : 'sinav-analizi'}`
          "
          class="text-link"
          >Tümünü gör<Icon name="ArrowRight" :size="14"
        /></RouterLink>
      </div>
      <div v-if="isStaff" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Öğrenci</th>
              <th>Vade tarihi</th>
              <th>Tutar</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="invoice in priorityInvoices" :key="invoice.id">
              <td>
                <div class="person-cell">
                  <Avatar :name="studentById(invoice.studentId).name" size="small" />
                  <div>
                    <strong>{{ studentById(invoice.studentId).name }}</strong
                    ><small>{{ classById(studentById(invoice.studentId).classId).name }}</small>
                  </div>
                </div>
              </td>
              <td>{{ dateLabel(invoice.dueDate) }}</td>
              <td class="amount">{{ money(invoice.amount) }}</td>
              <td><Badge :text="invoiceStatus(invoice)" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <TrendChart v-else :labels="academicSeries.labels" :series="academicSeries.series" />
    </section>
    <section v-if="state.modules.communication" class="panel">
      <div class="panel-heading">
        <div>
          <h2>Kampüsten haberler</h2>
          <p>Güncel duyurular ve gelişmeler</p>
        </div>
        <span class="mini-icon lavender"><Icon name="Megaphone" :size="17" /></span>
      </div>
      <div class="announcement-list">
        <article v-for="(a, i) in announcements" :key="a.id">
          <span class="announcement-icon" :class="['lavender', 'mint', 'peach'][i]"
            ><Icon :name="['Megaphone', 'CalendarDays', 'BookOpen'][i]" :size="18"
          /></span>
          <div>
            <h3>{{ a.title }}</h3>
            <p>{{ a.text.slice(0, 82) }}…</p>
            <small>{{ dateLabel(a.date) }}<span>·</span>{{ a.category }}</small>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
