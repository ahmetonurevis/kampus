<script setup>
import { useViewMemory } from '../lib/view-memory.js'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  state,
  classById,
  branchById,
  teacherById,
  gradeAverage,
  absentCount,
} from '../stores/demo.js'
import { average, slaStatus } from '../lib/format.js'
import PageHeading from '../components/PageHeading.vue'
import DataTable from '../components/DataTable.vue'
import StatCard from '../components/StatCard.vue'
import Badge from '../components/Badge.vue'
import Avatar from '../components/Avatar.vue'
import Icon from '../components/Icon.vue'
import { exportCsv } from '../lib/download.js'
import Modal from '../components/Modal.vue'
import StudentSummary from '../components/StudentSummary.vue'
import { useDetailPanel } from '../lib/use-detail-panel.js'
const studentPanel = useDetailPanel('ogrenci')
const panelStudent = computed(() =>
  state.students.find((student) => student.id === studentPanel.selectedId.value),
)
const remember = useViewMemory()
const table = ref(null)
const route = useRoute(),
  page = computed(() => route.path.split('/').at(-1)),
  branch = remember('branch', 'all')
const studentRows = computed(() =>
  state.students
    .filter(
      (s) =>
        (absentCount(s.id) >= 6 || gradeAverage(s.id) < 65) &&
        (branch.value === 'all' || classById(s.classId).branchId === branch.value),
    )
    .map((s) => ({
      ...s,
      class: classById(s.classId).name,
      branch: branchById(classById(s.classId).branchId).name,
      score: gradeAverage(s.id),
      absent: absentCount(s.id),
      risk: absentCount(s.id) >= 8 || gradeAverage(s.id) < 55 ? 'Yüksek risk' : 'Takip önerilir',
    })),
)
const teacherRows = computed(() =>
  state.teachers
    .filter((t) => t.isActive)
    .map((t) => {
      const questions = state.questions.filter((q) => q.teacherId === t.id)
      const answered = questions.filter((q) => q.answeredAt)
      const classes = state.classes.filter(
        (c) =>
          c.isActive && state.assignments.some((a) => a.classId === c.id && a.teacherId === t.id),
      )
      const breaches = questions.filter((q) =>
        q.answeredAt
          ? +new Date(q.answeredAt) - +new Date(q.createdAt) > 86400000
          : slaStatus(q) === 'Süre aşıldı',
      ).length
      const slaRate = questions.length
        ? Math.round(((questions.length - breaches) / questions.length) * 100)
        : 100
      return {
        ...t,
        classes: classes.map((c) => c.name.split(' · ')[0]).join(', '),
        students: state.students.filter((s) => classes.some((c) => c.id === s.classId)).length,
        response: answered.length
          ? `${average(answered.map((q) => (+new Date(q.answeredAt) - +new Date(q.createdAt)) / 3600000))} sa`
          : 'Henüz yanıt yok',
        pending: questions.filter((q) => !q.answeredAt).length,
        breaches,
        slaRate,
        score: Math.round((t.attendanceRate + t.homeworkRate + slaRate) / 3),
      }
    }),
)
const classRows = computed(() =>
  state.classes
    .filter((c) => branch.value === 'all' || c.branchId === branch.value)
    .map((c) => {
      const students = state.students.filter((s) => s.classId === c.id && s.isActive)
      return {
        ...c,
        branch: branchById(c.branchId).name,
        teacher: teacherById(c.teacherId).name,
        count: students.length,
        occupancy: Math.round((students.length / c.capacity) * 100),
        average: average(students.map((s) => gradeAverage(s.id))),
      }
    }),
)
const sourceRows = computed(() =>
  [...new Set(state.prospects.map((p) => p.source))].map((source) => {
    const entries = state.prospects.filter((p) => p.source === source)
    const enrolled = entries.filter((p) => p.stage === 'Kayıt oldu').length
    return {
      id: source,
      source,
      count: entries.length,
      enrolled,
      ratio: Math.round((enrolled / entries.length) * 100) + '%',
    }
  }),
)
const reportRows = computed(() =>
  page.value === 'risk-listesi'
    ? studentRows.value
    : page.value === 'subeler'
      ? classRows.value
      : page.value === 'kayit-raporlari'
        ? sourceRows.value
        : teacherRows.value,
)
const columns = computed(() =>
  page.value === 'risk-listesi'
    ? [
        { key: 'name', label: 'Öğrenci' },
        { key: 'class', label: 'Sınıf' },
        { key: 'branch', label: 'Şube' },
        { key: 'score', label: 'Ortalama' },
        { key: 'absent', label: 'Devamsızlık' },
        { key: 'risk', label: 'Risk durumu' },
      ]
    : page.value === 'subeler'
      ? [
          { key: 'name', label: 'Sınıf' },
          { key: 'branch', label: 'Şube' },
          { key: 'teacher', label: 'Öğretmen' },
          { key: 'count', label: 'Öğrenci' },
          { key: 'occupancy', label: 'Doluluk' },
          { key: 'average', label: 'Sınıf ortalaması' },
        ]
      : page.value === 'kayit-raporlari'
        ? [
            { key: 'source', label: 'Kanal' },
            { key: 'count', label: 'Aday sayısı' },
            { key: 'enrolled', label: 'Kesin kayıt' },
            { key: 'ratio', label: 'Dönüşüm oranı' },
          ]
        : page.value === 'sla-raporu'
          ? [
              { key: 'name', label: 'Öğretmen' },
              { key: 'classes', label: 'Sınıflar' },
              { key: 'response', label: 'Ort. yanıt süresi' },
              { key: 'pending', label: 'Bekleyen' },
              { key: 'breaches', label: 'İhlal' },
            ]
          : [
              { key: 'name', label: 'Öğretmen' },
              { key: 'classes', label: 'Sınıflar' },
              { key: 'students', label: 'Öğrenci sayısı' },
              { key: 'attendanceRate', label: 'Yoklama takibi' },
              { key: 'homeworkRate', label: 'Ödev takibi' },
              { key: 'slaRate', label: 'SLA uyumu (%)' },
              { key: 'score', label: 'Performans' },
            ],
)
const visibleColumns = computed(() =>
  page.value === 'risk-listesi'
    ? columns.value.filter((column) => column.key !== 'class')
    : columns.value,
)
</script>
<template>
  <PageHeading
    ><button
      class="btn"
      @click="exportCsv(route.meta.title, columns, table?.filteredRows || reportRows)"
    >
      <Icon name="Download" :size="17" />Raporu indir
    </button></PageHeading
  >
  <div v-if="page === 'subeler'" class="three-grid">
    <section v-for="b in state.branches" :key="b.id" class="panel branch-card">
      <span class="mini-icon lavender"><Icon name="Building2" :size="24" /></span>
      <h2>{{ b.name }} Şubesi</h2>
      <p>{{ b.address }}</p>
      <div class="branch-card-numbers">
        <div>
          <strong>{{
            state.students.filter((s) => classById(s.classId).branchId === b.id).length
          }}</strong
          ><small>Öğrenci</small>
        </div>
        <div>
          <strong>{{ state.classes.filter((c) => c.branchId === b.id).length }}</strong
          ><small>Sınıf</small>
        </div>
        <div>
          <strong
            >%{{
              Math.round(
                (state.students.filter((s) => classById(s.classId).branchId === b.id).length / 30) *
                  100,
              )
            }}</strong
          ><small>Doluluk</small>
        </div>
      </div>
    </section>
  </div>
  <div v-else-if="page === 'kayit-raporlari'" class="panel funnel-panel">
    <div class="panel-heading">
      <div>
        <h2>Adaydan öğrenciye</h2>
        <p>CRM kayıtlarının güncel aşama dağılımı</p>
      </div>
      <Badge :text="`${state.prospects.length} aday`" />
    </div>
    <div class="funnel">
      <div
        v-for="(stage, i) in [
          'Yeni aday',
          'İletişime geçildi',
          'Görüşme planlandı',
          'Teklif verildi',
          'Kayıt oldu',
          'Vazgeçti',
        ]"
        :key="stage"
      >
        <span class="funnel-step">0{{ i + 1 }}</span
        ><strong>{{ state.prospects.filter((p) => p.stage === stage).length }}</strong
        ><span>{{ stage }}</span>
        <div class="progress">
          <span
            :style="{
              width: `${(state.prospects.filter((p) => p.stage === stage).length / state.prospects.length) * 100}%`,
            }"
          ></span>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="stats-grid stats-three">
    <StatCard
      :label="page === 'risk-listesi' ? 'Takip edilen öğrenci' : 'Eğitim kadrosu'"
      :value="page === 'risk-listesi' ? studentRows.length : state.teachers.length"
      icon="UsersRound"
      note="Güncel kurum verileri"
    /><StatCard
      :label="page === 'risk-listesi' ? 'Yüksek riskli' : 'Bekleyen soru'"
      :value="
        page === 'risk-listesi'
          ? studentRows.filter((s) => s.risk === 'Yüksek risk').length
          : state.questions.filter((q) => !q.answeredAt).length
      "
      icon="Timer"
      tone="amber"
      note="Öncelik verilmesi önerilir"
    /><StatCard
      :label="page === 'risk-listesi' ? 'Risk eşiği' : 'SLA hedefi'"
      :value="page === 'risk-listesi' ? '6 ders / 65 puan' : '24 saat'"
      icon="Target"
      tone="green"
      note="Devam ve başarı birlikte değerlendirilir"
    />
  </div>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <h2>
          {{
            page === 'subeler'
              ? 'Sınıf ve ders dağılımı'
              : page === 'kayit-raporlari'
                ? 'Kanal bazlı dönüşüm'
                : page === 'risk-listesi'
                  ? 'Erken uyarı listesi'
                  : 'Öğretmen bazlı rapor'
          }}
        </h2>
        <p>Güncel kayıtlar · {{ reportRows.length }} sonuç</p>
      </div>
    </div>
    <DataTable
      ref="table"
      list-key="management-datatable-1"
      :rows="reportRows"
      :columns="visibleColumns"
      :filter-key="branch"
      :external-active="branch !== 'all'"
      :exclude-filters="['branch']"
      :search-keys="['phone', 'email', 'class', 'number']"
      :filters="
        page === 'sla-raporu'
          ? [{ key: 'subject', label: 'Branş' }]
          : page === 'risk-listesi'
            ? [{ key: 'class', label: 'Sınıf' }]
            : []
      "
      @reset="branch = 'all'"
      ><template #filters
        ><select
          v-if="page === 'subeler' || page === 'risk-listesi'"
          v-model="branch"
          aria-label="Şube seç"
        >
          <option value="all">Tüm şubeler</option>
          <option v-for="b in state.branches" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select></template
      ><template #name="{ row }"
        ><div class="person-cell">
          <Avatar :name="row.name" size="small" />
          <div>
            <button
              v-if="page === 'risk-listesi'"
              class="text-link record-link"
              @click="studentPanel.open(row.id)"
            >
              <strong>{{ row.name }}</strong>
            </button>
            <strong v-else>{{ row.name }}</strong
            ><small v-if="page === 'risk-listesi'">{{ row.class }} · No: {{ row.number }}</small
            ><small v-else-if="row.email">{{ row.email }}</small>
          </div>
        </div></template
      ><template #risk="{ value }"><Badge :text="value" /></template
      ><template #occupancy="{ row }"
        ><div class="inline-progress">
          <div class="progress"><span :style="{ width: `${row.occupancy}%` }"></span></div>
          <span>%{{ row.occupancy }}</span>
        </div></template
      ><template #breaches="{ value }"
        ><Badge :text="`${value} ihlal`" :tone="value ? 'red' : 'green'" /></template
      ><template #attendanceRate="{ value }">%{{ value }}</template
      ><template #homeworkRate="{ value }">%{{ value }}</template
      ><template #score="{ value }"
        ><strong :class="value < 65 ? 'text-red' : 'text-green'">{{ value }}/100</strong></template
      ></DataTable
    >
  </section>
  <Modal
    v-if="studentPanel.selectedId.value && page === 'risk-listesi'"
    drawer
    title="Öğrenci özeti"
    @close="studentPanel.close"
  >
    <StudentSummary v-if="panelStudent" :student="panelStudent" />
    <RouterLink
      v-if="panelStudent && state.modules.guidance"
      class="btn"
      :to="{ path: '/yonetici/rehberlik', query: { ogrenci: panelStudent.id } }"
      >Rehberlik takip dosyası aç</RouterLink
    >
    <p v-else class="muted">Öğrenci kaydı bulunamadı.</p>
  </Modal>
</template>
