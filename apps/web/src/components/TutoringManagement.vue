<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { state, role, selectedChildId, transaction, notify, logError } from '../stores/demo.js'
import {
  automationExams,
  automationSchemas,
  planTutoring,
  tutoringSessions,
  runAssessment,
} from '@kampus/school-core/lib/assessment-automation.js'
import { dateLabel, dayKey, timeLabel } from '../lib/format.js'
import { exportCsv } from '../lib/download.js'
import { useDetailPanel } from '../lib/use-detail-panel.js'
import { useFormErrors } from '../lib/use-form-errors.js'
import PageHeading from './PageHeading.vue'
import DataTable from './DataTable.vue'
import Modal from './Modal.vue'
import Badge from './Badge.vue'
const route = useRoute(),
  session = computed(() => ({ role: role.value, childId: selectedChildId.value })),
  canManage = computed(() => ['yonetici', 'ogretmen'].includes(role.value))
const exams = computed(() => automationExams(state, session.value)),
  panel = useDetailPanel('etut')
const form = ref(null),
  validation = useFormErrors(form),
  plan = ref(null),
  error = ref(''),
  table = ref(null),
  previewTable = ref(null)
const now = ref(Date.now())
let timer
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 30000)
})
onBeforeUnmount(() => clearInterval(timer))
const input = ref({
  examId: exams.value.find((e) => e.id === route.query.sinav)?.id || exams.value[0]?.id || '',
  threshold: 70,
  fromDate: dayKey(new Date(Date.now() + 86400000)),
  toDate: dayKey(new Date(Date.now() + 14 * 86400000)),
  duration: 30,
  maxGroupSize: 12,
  branchId: '',
  subjectId: '',
})
const teachers = computed(() =>
  state.teachers.filter((t) => t.isActive && (role.value === 'yonetici' || t.id === 't1')),
)
const subjects = computed(() =>
  state.subjects.filter(
    (s) =>
      state.mockExams.find((e) => e.id === input.value.examId)?.subjectIds.includes(s.id) &&
      (role.value !== 'ogretmen' || s.id === state.teachers.find((t) => t.id === 't1')?.subjectId),
  ),
)
const subjectName = (id) => state.subjects.find((s) => s.id === id)?.name || id
const studentName = (id) => state.students.find((s) => s.id === id)?.name || id
const branchName = (id) => state.branches.find((b) => b.id === id)?.name || id
const teacherName = (id) => state.teachers.find((t) => t.id === id)?.name || id
const rows = computed(() =>
  tutoringSessions(state, session.value).map((s) => ({
    ...s,
    title: `${subjectName(s.subjectId)} · ${s.topic}`,
    teacher: teacherName(s.teacherId),
    campus: branchName(s.branchId),
    students: s.studentIds.map(studentName).join(', '),
  })),
)
const selected = computed(() => rows.value.find((s) => s.id === panel.selectedId.value))
const columns = [
  { key: 'title', label: 'Etüt / Kazanım' },
  { key: 'teacher', label: 'Öğretmen' },
  { key: 'campus', label: 'Kampüs' },
  { key: 'date', label: 'Tarih' },
  { key: 'room', label: 'Derslik' },
  { key: 'students', label: 'Öğrenciler' },
  { key: 'status', label: 'Durum' },
  { key: 'actions', label: 'İşlemler' },
]
const previewRows = computed(() =>
  plan.value
    ? [
        ...plan.value.sessions.map((s, i) => ({
          ...s,
          id: `planned-${i}`,
          title: `${subjectName(s.subjectId)} · ${s.topic}`,
          teacher: teacherName(s.teacherId),
          campus: branchName(s.branchId),
          students: s.studentIds.map(studentName).join(', '),
          status: 'Planlanabilir',
          reason: '',
        })),
        ...plan.value.unresolved.map((s, i) => ({
          ...s,
          id: `unresolved-${i}`,
          title: `${subjectName(s.subjectId)} · ${s.topic}`,
          teacher: '—',
          campus: branchName(s.branchId),
          students: s.studentIds.map(studentName).join(', '),
          room: '—',
          status: 'Yerleştirilemedi',
        })),
      ]
    : [],
)
const previewColumns = [
  ...columns.filter((c) => c.key !== 'actions'),
  { key: 'reason', label: 'Açıklama' },
]
const slotInput = ref(null),
  slotForm = ref(null),
  slotErrors = useFormErrors(slotForm),
  slotTable = ref(null)
const slots = computed(() =>
  state.availability
    .filter(
      (s) => Date.parse(s.date) > now.value && teachers.value.some((t) => t.id === s.teacherId),
    )
    .map((s) => ({ ...s, teacher: teacherName(s.teacherId) })),
)
const marks = ref(null),
  cancelReason = ref(null),
  confirmSlot = ref(null)
watch(
  input,
  () => {
    plan.value = null
    error.value = ''
    validation.clear()
  },
  { deep: true },
)
watch(
  () => input.value.examId,
  () => {
    input.value.subjectId = ''
  },
)
watch([role, selectedChildId, () => panel.selectedId.value], () => {
  marks.value = null
  cancelReason.value = null
})
function showError(exception) {
  logError(exception, 'tutoring', 'warn')
  error.value =
    exception.issues?.[0]?.message ||
    (exception.name === 'Error' ? exception.message : 'Etüt işlemi tamamlanamadı. Tekrar deneyin.')
  notify(error.value, 'error')
}
function previewPlan() {
  if (!validation.validate(automationSchemas.plan, input.value)) return
  try {
    plan.value = planTutoring(state, session.value, input.value)
  } catch (exception) {
    plan.value = null
    showError(exception)
  }
}
function commit() {
  if (!plan.value?.sessions.length) return
  const result = transaction(
    (next, id) =>
      runAssessment(
        next,
        session.value,
        'plan',
        { ...input.value, expectedPlan: JSON.stringify(plan.value) },
        id,
      ),
    'Otomatik etüt planı kaydedildi.',
  )
  if (result) plan.value = null
}
function openSlot() {
  slotErrors.clear()
  slotInput.value = {
    teacherId: teachers.value[0]?.id || '',
    date: `${input.value.fromDate}T16:00`,
    duration: 30,
  }
}
function saveSlot() {
  const value = {
    ...slotInput.value,
    date: /(?:Z|[+-]\d{2}:\d{2})$/.test(slotInput.value.date)
      ? slotInput.value.date
      : `${slotInput.value.date}+03:00`,
  }
  if (!slotErrors.validate(automationSchemas.slot, value)) return
  if (
    transaction(
      (next, id) => runAssessment(next, session.value, 'slot', value, id),
      'Öğretmen uygunluk saati eklendi.',
    )
  ) {
    slotInput.value = null
    plan.value = null
  }
}
function removeSlot() {
  if (
    transaction(
      (next, id) => runAssessment(next, session.value, 'slot-remove', {}, id, confirmSlot.value.id),
      'Uygunluk saati kaldırıldı.',
    )
  ) {
    confirmSlot.value = null
    plan.value = null
  }
}
function startAttendance() {
  marks.value = Object.fromEntries(
    selected.value.studentIds.map((id) => [id, selected.value.attendance[id] || 'Geldi']),
  )
}
function saveAttendance() {
  if (
    transaction(
      (next, id) =>
        runAssessment(
          next,
          session.value,
          'attendance',
          { marks: marks.value },
          id,
          selected.value.id,
        ),
      'Etüt yoklaması kaydedildi.',
    )
  )
    marks.value = null
}
function cancel() {
  if (
    transaction(
      (next, id) =>
        runAssessment(
          next,
          session.value,
          'cancel',
          { reason: cancelReason.value },
          id,
          selected.value.id,
        ),
      'Etüt iptal edildi.',
    )
  ) {
    cancelReason.value = null
    plan.value = null
  }
}
function download() {
  exportCsv(
    'etut-plani',
    columns.filter((c) => c.key !== 'actions'),
    table.value?.filteredRows || rows.value,
  )
}
</script>
<template>
  <PageHeading
    ><button v-if="canManage" class="btn" @click="openSlot">Uygunluk saati ekle</button
    ><button class="btn" @click="download">Etüt listesini CSV indir</button></PageHeading
  >
  <section v-if="canManage" class="panel tutor-panel">
    <h2>Eksik kazanımlardan etüt planla</h2>
    <p>
      Güncel optik soru sonuçları kullanılır. Eşiğin altındaki kazanımlar kampüs, sınıf düzeyi ve
      ders bazında gruplanır. Ders, randevu, etkinlik ve diğer etüt çakışmaları kontrol edilir.
    </p>
    <form ref="form" class="tutor-panel" novalidate @submit.prevent="previewPlan">
      <div class="tutor-fields">
        <label
          >Sınav<select v-model="input.examId" v-bind="validation.field('examId', 'Sınav')">
            <option v-for="exam in exams" :key="exam.id" :value="exam.id">{{ exam.title }}</option>
          </select></label
        >
        <label
          >Kazanım başarı eşiği (%)<input
            v-model.number="input.threshold"
            type="number"
            min="1"
            max="100"
            v-bind="validation.field('threshold', 'Kazanım başarı eşiği (%)')"
        /></label>
        <label
          >Etüt başlangıç tarihi<input
            v-model="input.fromDate"
            type="date"
            v-bind="validation.field('fromDate', 'Etüt başlangıç tarihi')"
        /></label>
        <label
          >Etüt bitiş tarihi<input
            v-model="input.toDate"
            type="date"
            v-bind="validation.field('toDate', 'Etüt bitiş tarihi')"
        /></label>
        <label
          >Etüt süresi (dakika)<input
            v-model.number="input.duration"
            type="number"
            min="15"
            max="120"
            v-bind="validation.field('duration', 'Etüt süresi (dakika)')"
        /></label>
        <label
          >Grup başına en fazla öğrenci<input
            v-model.number="input.maxGroupSize"
            type="number"
            min="1"
            max="40"
            v-bind="validation.field('maxGroupSize', 'Grup başına en fazla öğrenci')"
        /></label>
        <label
          >Kampüs<select v-model="input.branchId">
            <option value="">Tüm kampüsler</option>
            <option
              v-for="campus in state.branches.filter((b) => b.isActive)"
              :key="campus.id"
              :value="campus.id"
            >
              {{ campus.name }}
            </option>
          </select></label
        >
        <label
          >Ders<select v-model="input.subjectId">
            <option value="">Yetkimdeki tüm dersler</option>
            <option v-for="subject in subjects" :key="subject.id" :value="subject.id">
              {{ subject.name }}
            </option>
          </select></label
        >
      </div>
      <p
        v-for="(message, key) in validation.errors.value"
        :id="validation.errorId(key)"
        :key="key"
        role="alert"
        class="tutor-error"
      >
        {{ message }}
      </p>
      <p v-if="error" role="alert" class="tutor-error">{{ error }}</p>
      <p>
        Öğretmenin en az etüt süresi kadar uygunluk aralığı olmalıdır. Derslik kapasitesi grup
        sınırını ayrıca kısıtlar. Aynı sınav/kazanım için mevcut etüt öğrencileri tekrar atanmaz.
      </p>
      <button class="btn btn-primary" :disabled="!state.modules.exams" type="submit">
        Etüt planını önizle
      </button>
      <p v-if="!state.modules.exams">Etüt planlamak için deneme sınavları modülünü açın.</p>
    </form>
  </section>
  <section v-if="plan" class="panel">
    <div class="panel-heading">
      <div>
        <h2>Etüt planı önizlemesi</h2>
        <p>
          {{ plan.evaluatedStudents }} öğrenci değerlendirildi · {{ plan.sessions.length }} etüt
          planlanabilir · {{ plan.unresolved.length }} grup yerleştirilemedi ·
          {{ plan.covered.length }} öğrenci/kazanım zaten etütte.
        </p>
      </div>
      <button
        class="btn"
        @click="
          exportCsv('etut-onizleme', previewColumns, previewTable?.filteredRows || previewRows)
        "
      >
        Önizlemeyi CSV indir
      </button>
    </div>
    <p v-if="!plan.evaluatedStudents">
      Bu sınavda güncel optik kazanım değerlendirmesi yok. Önce cevap dosyasını değerlendirin.
    </p>
    <DataTable
      ref="previewTable"
      list-key="tutor-preview"
      :rows="previewRows"
      :columns="previewColumns"
      :mobile-columns="['teacher', 'date', 'status', 'reason']"
      empty="Eşiğin altında yeni etüt gerektiren kazanım bulunamadı."
    >
      <template #date="{ value }">{{
        value ? `${dateLabel(value)} ${timeLabel(value)}` : '—'
      }}</template>
      <template #status="{ value }"><Badge :text="value" /></template>
    </DataTable>
    <p v-if="plan.unresolved.length">
      Yerleştirilemeyen gruplar kaydedilmez. Uygunluk saati ekleyip tekrar planlayabilirsiniz.
    </p>
    <div class="tutor-actions">
      <button class="btn btn-primary" :disabled="!plan.sessions.length" @click="commit">
        Onayla ve etütleri oluştur</button
      ><button class="btn" @click="plan = null">Önizlemeyi kapat</button>
    </div>
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <h2>Etütlerim</h2>
        <p>
          {{
            canManage
              ? 'Görev kapsamınızdaki etütler ve yoklamaları'
              : 'Öğrenciye atanan kazanım etütleri'
          }}
        </p>
      </div>
    </div>
    <DataTable
      :key="`${role}-${selectedChildId}`"
      ref="table"
      :list-key="`tutors-${role}-${selectedChildId}`"
      :rows="rows"
      :columns="columns"
      :mobile-columns="['date', 'teacher', 'status']"
      empty="Henüz atanmış etüt yok."
    >
      <template #title="{ row }"
        ><button class="text-link" @click="panel.open(row.id)">{{ row.title }}</button></template
      >
      <template #date="{ value }">{{ dateLabel(value) }} {{ timeLabel(value) }}</template>
      <template #status="{ value }"><Badge :text="value" /></template>
      <template #actions="{ row }"
        ><button class="btn btn-sm" @click="panel.open(row.id)">Etüt ayrıntısı</button></template
      >
    </DataTable>
  </section>
  <section v-if="canManage" class="panel">
    <div class="panel-heading">
      <div>
        <h2>Öğretmen uygunluk saatleri</h2>
        <p>Planlayıcı bu aralıkları kullanır; mevcut randevu ve etütler ayrıca kontrol edilir.</p>
      </div>
    </div>
    <DataTable
      ref="slotTable"
      :list-key="`tutor-slots-${role}`"
      :rows="slots"
      :columns="[
        { key: 'teacher', label: 'Öğretmen' },
        { key: 'date', label: 'Tarih' },
        { key: 'duration', label: 'Dakika' },
        { key: 'actions', label: 'İşlemler' },
      ]"
      :mobile-columns="['date', 'duration']"
      empty="Gelecek uygunluk saati yok."
    >
      <template #date="{ value }">{{ dateLabel(value) }} {{ timeLabel(value) }}</template>
      <template #actions="{ row }"
        ><button class="btn btn-sm" @click="confirmSlot = row">Uygunluğu kaldır</button></template
      >
    </DataTable>
  </section>
  <Modal
    v-if="panel.selectedId.value"
    :title="selected?.title || 'Etüt bulunamadı'"
    drawer
    @close="panel.close"
  >
    <template v-if="selected">
      <Badge :text="selected.status" />
      <p>
        {{ dateLabel(selected.date, { year: 'numeric' }) }} {{ timeLabel(selected.date) }} ·
        {{ selected.duration }} dakika
      </p>
      <p>{{ selected.teacher }} · {{ selected.campus }} · Derslik {{ selected.room }}</p>
      <p v-for="studentId in selected.studentIds" :key="studentId">
        {{ studentName(studentId) }} · Kazanım başarısı %{{
          selected.scores.find((s) => s.studentId === studentId)?.percent
        }}
        · {{ selected.attendance[studentId] || 'Yoklama alınmadı' }}
      </p>
      <p v-if="selected.cancelReason">İptal nedeni: {{ selected.cancelReason }}</p>
      <div v-if="canManage && selected.status !== 'İptal'" class="tutor-actions">
        <button class="btn" :disabled="Date.parse(selected.date) > now" @click="startAttendance">
          Yoklama al / güncelle</button
        ><button v-if="selected.status !== 'Tamamlandı'" class="btn" @click="cancelReason = ''">
          Etüdü iptal et
        </button>
      </div>
      <p v-if="canManage && Date.parse(selected.date) > now">
        Yoklama etüt başladığında alınabilir.
      </p>
    </template>
    <p v-else>Etüt mevcut rol veya çocuk kapsamında bulunamadı.</p>
  </Modal>
  <Modal v-if="slotInput" title="Uygunluk saati ekle" @close="slotInput = null">
    <form ref="slotForm" class="tutor-panel" novalidate @submit.prevent="saveSlot">
      <label
        >Öğretmen<select
          v-model="slotInput.teacherId"
          v-bind="slotErrors.field('teacherId', 'Öğretmen')"
        >
          <option v-for="teacher in teachers" :key="teacher.id" :value="teacher.id">
            {{ teacher.name }} · {{ subjectName(teacher.subjectId) }}
          </option>
        </select></label
      >
      <label
        >Uygunluk tarihi ve saati<input
          v-model="slotInput.date"
          type="datetime-local"
          v-bind="slotErrors.field('date', 'Uygunluk tarihi ve saati')"
      /></label>
      <label
        >Uygunluk süresi (dakika)<input
          v-model.number="slotInput.duration"
          type="number"
          min="15"
          max="120"
          v-bind="slotErrors.field('duration', 'Uygunluk süresi (dakika)')"
      /></label>
      <p
        v-for="(message, key) in slotErrors.errors.value"
        :id="slotErrors.errorId(key)"
        :key="key"
        role="alert"
        class="tutor-error"
      >
        {{ message }}
      </p>
      <button class="btn btn-primary" type="submit">Uygunluk saatini kaydet</button>
    </form>
  </Modal>
  <Modal v-if="marks && selected" title="Etüt yoklaması" @close="marks = null"
    ><form class="tutor-panel" @submit.prevent="saveAttendance">
      <label v-for="studentId in selected.studentIds" :key="studentId"
        >{{ studentName(studentId)
        }}<select v-model="marks[studentId]">
          <option>Geldi</option>
          <option>Gelmedi</option>
          <option>İzinli</option>
        </select></label
      ><button class="btn btn-primary" type="submit">Yoklamayı kaydet</button>
    </form></Modal
  >
  <Modal
    v-if="cancelReason !== null && selected"
    title="Etüdü iptal et"
    @close="cancelReason = null"
    ><form class="tutor-panel" @submit.prevent="cancel">
      <label
        >İptal nedeni<textarea
          v-model="cancelReason"
          minlength="2"
          maxlength="500"
          required
        /></label
      ><button class="btn btn-primary" type="submit">İptali onayla</button>
    </form></Modal
  >
  <Modal v-if="confirmSlot" title="Uygunluğu kaldır" @close="confirmSlot = null"
    ><p>
      {{ confirmSlot.teacher }} · {{ dateLabel(confirmSlot.date) }}
      {{ timeLabel(confirmSlot.date) }} uygunluğu kaldırılacak. Önceden oluşturulmuş etüt ve
      randevular korunur.
    </p>
    <button class="btn btn-primary" @click="removeSlot">Kaldırmayı onayla</button></Modal
  >
</template>
<style scoped>
.tutor-panel {
  display: grid;
  gap: 18px;
}
.panel.tutor-panel {
  padding: var(--space-card);
}
.tutor-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.tutor-panel label {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.tutor-panel input,
.tutor-panel select,
.tutor-panel textarea {
  width: 100%;
  min-width: 0;
}
.tutor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}
.tutor-error {
  color: var(--red);
}
p {
  overflow-wrap: anywhere;
}
@media (max-width: 650px) {
  .tutor-fields {
    grid-template-columns: 1fr;
  }
}
</style>
