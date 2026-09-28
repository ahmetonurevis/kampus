<script setup>
import { useViewMemory } from '../lib/view-memory.js'
import { computed, reactive, ref, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { state, action, id, branchById, teacherById, gradeAverage } from '../stores/demo.js'
import {
  saveBranch,
  saveClass,
  saveTeacher,
  archiveRecord,
  restoreRecord,
  branchSchema,
  teacherSchema,
  classSchema,
} from '../lib/school-management.js'
import { subjects, subjectsForGrade } from '../data/curriculum.js'
import { average, slaStatus } from '../lib/format.js'
import { exportCsv } from '../lib/download.js'
import PageHeading from '../components/PageHeading.vue'
import DataTable from '../components/DataTable.vue'
import StatCard from '../components/StatCard.vue'
import Badge from '../components/Badge.vue'
import Avatar from '../components/Avatar.vue'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import CompactList from '../components/CompactList.vue'
import FormSteps from '../components/FormSteps.vue'
import { useFormErrors } from '../lib/use-form-errors.js'
import LineTabs from '../components/LineTabs.vue'
import { useDetailPanel } from '../lib/use-detail-panel.js'
const classPanel = useDetailPanel('sinif')
const detailClass = computed(() =>
  state.classes.find((record) => record.id === classPanel.selectedId.value),
)
const detailAssignments = computed(() =>
  state.assignments.filter((assignment) => assignment.classId === detailClass.value?.id),
)
const remember = useViewMemory()
const formElement = ref(null)
const {
  errors,
  errorId,
  field,
  validate,
  show: showErrors,
  clear: clearErrors,
} = useFormErrors(formElement)
const step = ref(0)
async function goToStep(value) {
  step.value = value
  clearErrors()
  await nextTick()
  formElement.value?.querySelector('.step-heading')?.focus()
}
function validateClassInfo() {
  if (!validate(classSchema, form)) return false
  const next = {}
  const name = `${form.grade}-${form.section.trim().toLocaleUpperCase('tr')}`
  if (!activeBranches.value.some((b) => b.id === form.branchId))
    next.branchId = 'Aktif bir kampüs seçin.'
  if (!activeTeachers.value.some((t) => t.id === form.teacherId))
    next.teacherId = 'Aktif bir sınıf danışmanı seçin.'
  if (
    state.classes.some(
      (c) =>
        c.isActive &&
        c.id !== editingId.value &&
        c.branchId === form.branchId &&
        c.name.toLocaleUpperCase('tr') === name,
    )
  )
    next.section = 'Bu kampüste aynı isimde bir sınıf zaten var.'
  if (
    state.classes.some(
      (c) =>
        c.isActive &&
        c.id !== editingId.value &&
        c.branchId === form.branchId &&
        c.room.toLocaleLowerCase('tr') === form.room.trim().toLocaleLowerCase('tr'),
    )
  )
    next.room = 'Bu derslik başka bir aktif sınıfa atanmış.'
  if (editingId.value && classStudents(editingId.value).length > form.capacity)
    next.capacity = 'Kontenjan mevcut öğrenci sayısından az olamaz.'
  return showErrors(next)
}
function validateAssignments() {
  const next = {}
  for (const subject of subjectsForGrade(Number(form.grade))) {
    if (
      !activeTeachers.value.some(
        (t) => t.id === subjectTeachers[subject.id] && t.subjectId === subject.id,
      )
    )
      next[`subject-${subject.id}`] = `${subject.name} için uygun branş öğretmeni seçin.`
  }
  return showErrors(next)
}
function advanceClass() {
  if (step.value === 0 && !validateClassInfo()) return
  if (step.value === 1 && !validateAssignments()) return
  goToStep(step.value + 1)
}
const table = ref(null)
const route = useRoute()
const personnel = computed(() => route.path.endsWith('/personel'))
const branchFilter = remember('branchFilter', 'all'),
  subjectFilter = remember('subjectFilter', 'all'),
  archived = remember('archived', false),
  modal = ref(''),
  editingId = ref(null),
  removal = ref(null),
  replacementId = ref('')
const form = reactive({}),
  subjectTeachers = reactive({})
const activeBranches = computed(() => state.branches.filter((b) => b.isActive))
const activeTeachers = computed(() => state.teachers.filter((t) => t.isActive))
const visibleBranches = computed(() => state.branches.filter((b) => b.isActive !== archived.value))
const classStudents = (classId) => state.students.filter((s) => s.classId === classId && s.isActive)
const branchClasses = (branchId) =>
  state.classes.filter((c) => c.branchId === branchId && c.isActive)
const classRows = computed(() =>
  state.classes
    .filter(
      (c) =>
        c.isActive !== archived.value &&
        (branchFilter.value === 'all' || c.branchId === branchFilter.value),
    )
    .map((c) => ({
      ...c,
      branch: branchById(c.branchId)?.name,
      teacher: teacherById(c.teacherId)?.name,
      count: classStudents(c.id).length,
      occupancy: Math.round((classStudents(c.id).length / c.capacity) * 100),
      average: average(classStudents(c.id).map((s) => gradeAverage(s.id))),
      lessons: state.assignments.filter((a) => a.classId === c.id).length,
    })),
)
function teacherPerformance(teacher) {
  const questions = state.questions.filter((q) => q.teacherId === teacher.id)
  const breaches = questions.filter((q) =>
    q.answeredAt
      ? +new Date(q.answeredAt) - +new Date(q.createdAt) > 86400000
      : slaStatus(q) === 'Süre aşıldı',
  ).length
  const slaRate = questions.length ? ((questions.length - breaches) / questions.length) * 100 : 100
  return Math.round((teacher.attendanceRate + teacher.homeworkRate + slaRate) / 3)
}
const teacherRows = computed(() =>
  state.teachers
    .filter(
      (t) =>
        t.isActive !== archived.value &&
        (branchFilter.value === 'all' || t.branchId === branchFilter.value) &&
        (subjectFilter.value === 'all' || t.subjectId === subjectFilter.value),
    )
    .map((t) => ({
      ...t,
      branch: branchById(t.branchId)?.name,
      classes:
        state.assignments
          .filter(
            (a) =>
              a.teacherId === t.id && state.classes.some((c) => c.id === a.classId && c.isActive),
          )
          .map((a) => state.classes.find((c) => c.id === a.classId).name)
          .join(', ') || 'Henüz ders atanmamış',
      performance: teacherPerformance(t),
      pending: state.questions.filter((q) => q.teacherId === t.id && !q.answeredAt).length,
    })),
)
const rows = computed(() => (personnel.value ? teacherRows.value : classRows.value))
const columns = computed(() =>
  personnel.value
    ? [
        { key: 'name', label: 'Öğretmen' },
        { key: 'subject', label: 'Branş' },
        { key: 'branch', label: 'Kampüs' },
        { key: 'classes', label: 'Ders verdiği sınıflar' },
        { key: 'attendanceRate', label: 'Yoklama' },
        { key: 'homeworkRate', label: 'Ödev takibi' },
        { key: 'performance', label: 'Performans' },
        { key: 'actions', label: 'İşlemler' },
      ]
    : [
        { key: 'name', label: 'Sınıf' },
        { key: 'branch', label: 'Kampüs' },
        { key: 'teacher', label: 'Sınıf danışmanı' },
        { key: 'count', label: 'Öğrenci / Kontenjan' },
        { key: 'lessons', label: 'Branş' },
        { key: 'average', label: 'Ortalama' },
        { key: 'actions', label: 'İşlemler' },
      ],
)
const formTitle = computed(
  () =>
    `${{ branch: 'Kampüs', class: 'Sınıf', teacher: 'Öğretmen' }[modal.value] || ''} ${editingId.value ? 'düzenle' : 'ekle'}`,
)
function fillTeachers() {
  for (const subject of subjectsForGrade(Number(form.grade))) {
    if (
      !activeTeachers.value.some(
        (t) => t.id === subjectTeachers[subject.id] && t.subjectId === subject.id,
      )
    )
      subjectTeachers[subject.id] =
        activeTeachers.value.find((t) => t.subjectId === subject.id && t.branchId === form.branchId)
          ?.id ||
        activeTeachers.value.find((t) => t.subjectId === subject.id)?.id ||
        ''
  }
}
watch(() => form.grade, fillTeachers)
function open(kind, record = null) {
  step.value = 0
  clearErrors()
  editingId.value = record?.id || null
  for (const key of Object.keys(form)) delete form[key]
  for (const key of Object.keys(subjectTeachers)) delete subjectTeachers[key]
  Object.assign(
    form,
    kind === 'branch'
      ? { name: '', address: '' }
      : kind === 'teacher'
        ? {
            name: '',
            email: '',
            phone: '',
            subjectId: 'math',
            branchId: activeBranches.value[0]?.id || '',
          }
        : {
            grade: 7,
            section: 'D',
            branchId: activeBranches.value[0]?.id || '',
            teacherId: activeTeachers.value[0]?.id || '',
            capacity: 24,
            room: '',
          },
    record || {},
  )
  if (kind === 'class') {
    for (const assignment of state.assignments.filter((a) => a.classId === record?.id))
      subjectTeachers[assignment.subjectId] = assignment.teacherId
    fillTeachers()
  }
  modal.value = kind
}
function save() {
  if (modal.value === 'class') {
    if (step.value < 2) return advanceClass()
    if (!validateClassInfo()) {
      step.value = 0
      return
    }
    if (!validateAssignments()) {
      step.value = 1
      return
    }
  } else if (!validate(modal.value === 'branch' ? branchSchema : teacherSchema, form)) return
  if (
    action(
      () => {
        if (modal.value === 'branch') saveBranch(state, form, id, editingId.value)
        if (modal.value === 'teacher') saveTeacher(state, form, id, editingId.value)
        if (modal.value === 'class') saveClass(state, form, subjectTeachers, id, editingId.value)
      },
      `${formTitle.value.split(' ')[0]} kaydedildi. İlgili paneller güncellendi.`,
    )
  )
    modal.value = ''
}
function remove(kind, record) {
  removal.value = { kind, record }
  replacementId.value = ''
  modal.value = 'archive'
}
const destinations = computed(() => {
  if (!removal.value) return []
  const { kind, record } = removal.value
  if (kind === 'branch') return activeBranches.value.filter((b) => b.id !== record.id)
  if (kind === 'class')
    return state.classes
      .filter((c) => c.isActive && c.id !== record.id && c.grade === record.grade)
      .map((c) => ({
        ...c,
        name: `${c.name} · ${branchById(c.branchId).name} · ${c.capacity - classStudents(c.id).length} boş yer`,
      }))
  return activeTeachers.value
    .filter((t) => t.id !== record.id && t.subjectId === record.subjectId)
    .map((t) => ({ ...t, name: `${t.name} · ${branchById(t.branchId).name}` }))
})
function archive() {
  if (
    action(
      () => archiveRecord(state, removal.value.kind, removal.value.record.id, replacementId.value),
      `${removal.value.record.name} arşivlendi. Geçmiş kayıtları korundu.`,
    )
  )
    modal.value = ''
}
function restore(kind, record) {
  action(() => restoreRecord(state, kind, record.id), `${record.name} yeniden etkinleştirildi.`)
}
</script>
<template>
  <PageHeading>
    <button
      class="btn"
      @click="
        exportCsv(
          route.meta.title,
          columns.filter((c) => c.key !== 'actions'),
          table?.filteredRows || rows,
        )
      "
    >
      <Icon name="Download" :size="17" />Listeyi indir
    </button>
    <button v-if="!personnel" class="btn" @click="open('branch')">
      <Icon name="Plus" :size="17" />Kampüs ekle
    </button>
    <button class="btn btn-primary btn-create" @click="open(personnel ? 'teacher' : 'class')">
      <Icon name="Plus" :size="17" />{{ personnel ? 'Öğretmen ekle' : 'Sınıf ekle' }}
    </button>
  </PageHeading>
  <div class="stats-grid stats-three">
    <StatCard
      :label="personnel ? 'Aktif eğitim kadrosu' : 'Aktif kampüs'"
      :value="personnel ? activeTeachers.length : activeBranches.length"
      :icon="personnel ? 'UsersRound' : 'Building2'"
    />
    <StatCard
      :label="personnel ? 'Ders branşı' : 'Aktif sınıf'"
      :value="
        personnel
          ? new Set(activeTeachers.map((t) => t.subjectId)).size
          : state.classes.filter((c) => c.isActive).length
      "
      icon="BookOpen"
      tone="green"
      note="Ortaokul ve lise"
    />
    <StatCard
      label="Aktif öğrenci"
      :value="state.students.filter((s) => s.isActive).length"
      icon="GraduationCap"
      tone="amber"
      note="Tüm kampüslerde"
    />
  </div>
  <div class="catalog-toolbar">
    <LineTabs
      v-model="archived"
      label="Kayıt durumu"
      :options="[
        { value: false, label: 'Aktif kayıtlar' },
        { value: true, label: 'Arşiv', icon: 'Archive' },
      ]"
    />
    <span class="muted">{{
      archived
        ? 'Geçmişi korunan kayıtları yeniden etkinleştirebilirsiniz.'
        : 'Sınıf danışmanı ve branş öğretmenleri ayrı ayrı atanır.'
    }}</span>
  </div>
  <div v-if="!personnel" class="three-grid campus-grid">
    <article v-for="b in visibleBranches" :key="b.id" class="panel campus-card">
      <div class="campus-top">
        <span class="mini-icon lavender"><Icon name="School" :size="26" /></span
        ><Badge
          :text="b.isActive ? 'Aktif kampüs' : 'Arşivde'"
          :tone="b.isActive ? 'green' : 'gray'"
        />
      </div>
      <h2>{{ b.name }}</h2>
      <p class="muted">{{ b.address }}</p>
      <div class="campus-metrics">
        <div>
          <strong>{{ branchClasses(b.id).length }}</strong
          ><span>Sınıf</span>
        </div>
        <div>
          <strong>{{
            branchClasses(b.id).reduce((n, c) => n + classStudents(c.id).length, 0)
          }}</strong
          ><span>Öğrenci</span>
        </div>
        <div>
          <strong>{{
            state.teachers.filter((t) => t.isActive && t.branchId === b.id).length
          }}</strong
          ><span>Öğretmen</span>
        </div>
      </div>
      <div class="catalog-actions">
        <template v-if="b.isActive"
          ><button class="btn btn-sm" :aria-label="`${b.name} düzenle`" @click="open('branch', b)">
            <Icon name="Pencil" :size="15" />Düzenle</button
          ><button
            class="btn btn-sm btn-neutral"
            :aria-label="`${b.name} arşivle`"
            @click="remove('branch', b)"
          >
            Arşivle
          </button></template
        ><button v-else class="btn btn-sm" @click="restore('branch', b)">
          Yeniden etkinleştir
        </button>
      </div>
    </article>
  </div>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <h2>{{ personnel ? 'Branş öğretmenleri' : 'Sınıflar ve ders atamaları' }}</h2>
        <p>
          {{ rows.length }} {{ archived ? 'arşiv kaydı' : 'aktif kayıt' }} ·
          {{ personnel ? 'İletişim, branş ve görev bilgileri' : '5–12. sınıf düzeyleri' }}
        </p>
      </div>
    </div>
    <DataTable
      ref="table"
      list-key="schoolmanagement-datatable-1"
      :rows="rows"
      :columns="columns"
      :mobile-columns="
        personnel ? ['subject', 'branch', 'performance'] : ['branch', 'count', 'teacher']
      "
      :filter-key="[branchFilter, subjectFilter, archived]"
      :external-active="branchFilter !== 'all' || subjectFilter !== 'all'"
      :exclude-filters="['branch', 'subject']"
      :filters="
        personnel
          ? [{ key: 'pending', label: 'Bekleyen soru', type: 'number' }]
          : [
              { key: 'grade', label: 'Sınıf düzeyi' },
              { key: 'occupancy', label: 'Doluluk (%)', type: 'number' },
            ]
      "
      @reset="
        () => {
          branchFilter = 'all'
          subjectFilter = 'all'
        }
      "
      ><template #filters
        ><select v-model="branchFilter" aria-label="Kampüs filtresi">
          <option value="all">Tüm kampüsler</option>
          <option v-for="b in state.branches" :key="b.id" :value="b.id">
            {{ b.name }}
          </option></select
        ><select v-if="personnel" v-model="subjectFilter" aria-label="Branş filtresi">
          <option value="all">Tüm branşlar</option>
          <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select></template
      >
      <template #name="{ row }"
        ><div class="person-cell">
          <Avatar :name="row.name" size="small" />
          <div>
            <button
              v-if="!personnel"
              class="text-link record-link"
              @click="classPanel.open(row.id)"
            >
              <strong>{{ row.name }}</strong></button
            ><strong v-else>{{ row.name }}</strong
            ><small>{{
              personnel ? row.email : `${row.grade < 9 ? 'Ortaokul' : 'Lise'} · Derslik ${row.room}`
            }}</small>
          </div>
        </div></template
      >
      <template #classes="{ value }"><CompactList :value="value" label="sınıf" /></template>
      <template #subject="{ value }"><Badge :text="value" /></template
      ><template #count="{ row }"
        ><strong>{{ row.count }}</strong> / {{ row.capacity }}</template
      ><template #attendanceRate="{ value }">%{{ value }}</template
      ><template #performance="{ value }"
        ><Badge :text="`${value}/100`" :tone="value >= 80 ? 'green' : 'amber'" /></template
      ><template #homeworkRate="{ value }">%{{ value }}</template
      ><template #average="{ row }">{{
        row.count ? `${row.average}/100` : 'Henüz not yok'
      }}</template>
      <template #actions="{ row }"
        ><div class="catalog-actions">
          <template v-if="row.isActive"
            ><button
              class="btn btn-sm"
              :aria-label="`${row.name} düzenle`"
              @click="open(personnel ? 'teacher' : 'class', row)"
            >
              Düzenle</button
            ><button
              class="btn btn-sm btn-neutral"
              :aria-label="`${row.name} arşivle`"
              @click="remove(personnel ? 'teacher' : 'class', row)"
            >
              <Icon name="Archive" :size="17" /></button></template
          ><button v-else class="btn btn-sm" @click="restore(personnel ? 'teacher' : 'class', row)">
            Yeniden etkinleştir
          </button>
        </div></template
      >
    </DataTable>
  </section>
  <Modal
    v-if="classPanel.selectedId.value && !personnel"
    drawer
    title="Sınıf özeti"
    @close="classPanel.close"
  >
    <template v-if="detailClass">
      <div class="detail-person">
        <span class="mini-icon lavender"><Icon name="School" :size="24" /></span>
        <div>
          <h3>{{ detailClass.name }}</h3>
          <p>{{ branchById(detailClass.branchId)?.name }} · Derslik {{ detailClass.room }}</p>
        </div>
        <Badge :text="detailClass.isActive ? 'Aktif' : 'Arşivde'" />
      </div>
      <dl class="detail-metrics">
        <div>
          <dt>Öğrenci / Kontenjan</dt>
          <dd>{{ classStudents(detailClass.id).length }} / {{ detailClass.capacity }}</dd>
        </div>
        <div>
          <dt>Sınıf danışmanı</dt>
          <dd>{{ teacherById(detailClass.teacherId)?.name }}</dd>
        </div>
      </dl>
      <section class="detail-section">
        <h3>Ders ve öğretmen atamaları</h3>
        <ul class="detail-list">
          <li v-for="assignment in detailAssignments" :key="assignment.id">
            <strong>{{
              subjects.find((subject) => subject.id === assignment.subjectId)?.name
            }}</strong
            ><span>{{ teacherById(assignment.teacherId)?.name }}</span>
          </li>
        </ul>
        <p v-if="!detailAssignments.length" class="muted">Henüz ders atanmamış.</p>
      </section>
      <section class="detail-section">
        <h3>Öğrenciler</h3>
        <DataTable
          :key="detailClass.id"
          :list-key="`class-summary-${detailClass.id}`"
          :rows="classStudents(detailClass.id)"
          :columns="[
            { key: 'name', label: 'Öğrenci' },
            { key: 'number', label: 'Okul numarası' },
          ]"
        />
      </section>
      <button v-if="detailClass.isActive" class="btn full" @click="open('class', detailClass)">
        Sınıfı düzenle
      </button>
    </template>
    <p v-else class="muted">Sınıf kaydı bulunamadı.</p>
  </Modal>
  <Modal
    v-if="['branch', 'teacher', 'class'].includes(modal)"
    :drawer="modal !== 'class'"
    :title="formTitle"
    :wide="modal === 'class'"
    @close="modal = ''"
    ><form ref="formElement" novalidate class="form-grid" @submit.prevent="save">
      <FormSteps
        v-if="modal === 'class'"
        class="full"
        :steps="['Sınıf bilgileri', 'Öğretmen atamaları', 'Kontrol']"
        :current="step"
        @back="goToStep"
      />
      <h3 v-if="modal === 'class'" class="full step-heading" tabindex="-1">
        {{
          ['Sınıf bilgileri', 'Ders ve öğretmen atamaları', 'Kaydetmeden önce kontrol edin'][step]
        }}
      </h3>
      <p class="full form-hint">
        {{
          modal === 'class' && step === 2
            ? 'Bilgileri değiştirmek için önceki adımlara dönebilirsiniz.'
            : 'Bu adımdaki tüm alanlar zorunludur.'
        }}
      </p>
      <template v-if="modal === 'branch'">
        <label class="full"
          >Kampüs adı<input
            v-model="form.name"
            v-bind="field('name', 'Kampüs adı')"
            maxlength="80"
            placeholder="Örn. Çamlıca Kampüsü"
          />
          <small v-if="errors.name" :id="errorId('name')" class="field-error">{{
            errors.name
          }}</small></label
        >
        <label class="full"
          >Adres<textarea
            v-model="form.address"
            v-bind="field('address', 'Adres')"
            rows="3"
            maxlength="240"
          ></textarea>
          <small v-if="errors.address" :id="errorId('address')" class="field-error">{{
            errors.address
          }}</small></label
        >
      </template>
      <template v-if="modal === 'teacher'">
        <label class="full"
          >Ad soyad<input
            v-model="form.name"
            v-bind="field('name', 'Ad soyad')"
            maxlength="80"
          /><small v-if="errors.name" :id="errorId('name')" class="field-error">{{
            errors.name
          }}</small></label
        >
        <label
          >E-posta<input
            v-model="form.email"
            v-bind="field('email', 'E-posta')"
            type="email"
          /><small v-if="errors.email" :id="errorId('email')" class="field-error">{{
            errors.email
          }}</small></label
        >
        <label
          >Telefon<input
            v-model="form.phone"
            v-bind="field('phone', 'Telefon')"
            inputmode="tel"
            placeholder="05XXXXXXXXX"
          /><small v-if="errors.phone" :id="errorId('phone')" class="field-error">{{
            errors.phone
          }}</small></label
        >
        <label
          >Branş<select v-model="form.subjectId" v-bind="field('subjectId', 'Branş')">
            <option v-for="subject in subjects" :key="subject.id" :value="subject.id">
              {{ subject.name }}
            </option></select
          ><small v-if="errors.subjectId" :id="errorId('subjectId')" class="field-error">{{
            errors.subjectId
          }}</small></label
        >
      </template>
      <label v-if="modal === 'teacher' || (modal === 'class' && step === 0)"
        >Kampüs<select v-model="form.branchId" v-bind="field('branchId', 'Kampüs')">
          <option v-for="branch in activeBranches" :key="branch.id" :value="branch.id">
            {{ branch.name }}
          </option></select
        ><small v-if="errors.branchId" :id="errorId('branchId')" class="field-error">{{
          errors.branchId
        }}</small></label
      >
      <template v-if="modal === 'class' && step === 0">
        <label
          >Sınıf düzeyi<select v-model.number="form.grade" v-bind="field('grade', 'Sınıf düzeyi')">
            <option v-for="grade in 8" :key="grade" :value="grade + 4">
              {{ grade + 4 }}. Sınıf
            </option></select
          ><small v-if="errors.grade" :id="errorId('grade')" class="field-error">{{
            errors.grade
          }}</small></label
        >
        <label
          >Şube harfi<input
            v-model="form.section"
            v-bind="field('section', 'Şube harfi')"
            maxlength="3"
            placeholder="A"
          /><small v-if="errors.section" :id="errorId('section')" class="field-error">{{
            errors.section
          }}</small></label
        >
        <label
          >Kontenjan<input
            v-model.number="form.capacity"
            v-bind="field('capacity', 'Kontenjan')"
            type="number"
            min="1"
            max="40"
          /><small v-if="errors.capacity" :id="errorId('capacity')" class="field-error">{{
            errors.capacity
          }}</small></label
        >
        <label
          >Derslik<input
            v-model="form.room"
            v-bind="field('room', 'Derslik')"
            maxlength="30"
            placeholder="Örn. 209"
          /><small v-if="errors.room" :id="errorId('room')" class="field-error">{{
            errors.room
          }}</small></label
        >
        <label
          >Sınıf danışmanı<select
            v-model="form.teacherId"
            v-bind="field('teacherId', 'Sınıf danışmanı')"
          >
            <option v-for="teacher in activeTeachers" :key="teacher.id" :value="teacher.id">
              {{ teacher.name }} · {{ teacher.subject }}
            </option></select
          ><small v-if="errors.teacherId" :id="errorId('teacherId')" class="field-error">{{
            errors.teacherId
          }}</small></label
        >
      </template>
      <template v-if="modal === 'class' && step === 1">
        <p class="full muted">
          Her ders için ilgili branştan bir öğretmen seçin. Atamalar öğretmen panellerine yansır.
        </p>
        <label v-for="subject in subjectsForGrade(Number(form.grade))" :key="subject.id"
          >{{ subject.name }} öğretmeni
          <select
            v-model="subjectTeachers[subject.id]"
            v-bind="field(`subject-${subject.id}`, `${subject.name} öğretmeni`)"
          >
            <option value="">Öğretmen seçin</option>
            <option
              v-for="teacher in activeTeachers.filter((t) => t.subjectId === subject.id)"
              :key="teacher.id"
              :value="teacher.id"
            >
              {{ teacher.name }} · {{ branchById(teacher.branchId)?.name }}
            </option>
          </select>
          <small
            v-if="errors[`subject-${subject.id}`]"
            :id="errorId(`subject-${subject.id}`)"
            class="field-error"
            >{{ errors[`subject-${subject.id}`] }}</small
          >
        </label>
      </template>
      <template v-if="modal === 'class' && step === 2">
        <dl class="review-grid full">
          <div>
            <dt>Sınıf</dt>
            <dd>{{ form.grade }}-{{ form.section.toLocaleUpperCase('tr') }}</dd>
          </div>
          <div>
            <dt>Kampüs</dt>
            <dd>{{ branchById(form.branchId)?.name }}</dd>
          </div>
          <div>
            <dt>Kontenjan / Derslik</dt>
            <dd>{{ form.capacity }} öğrenci · {{ form.room }}</dd>
          </div>
          <div>
            <dt>Danışman</dt>
            <dd>{{ teacherById(form.teacherId)?.name }}</dd>
          </div>
        </dl>
        <ul class="assignment-review full">
          <li v-for="subject in subjectsForGrade(Number(form.grade))" :key="subject.id">
            <span>{{ subject.name }}</span
            ><strong>{{ teacherById(subjectTeachers[subject.id])?.name }}</strong>
          </li>
        </ul>
      </template>
      <div class="modal-actions full">
        <button type="button" class="btn" @click="modal = ''">Vazgeç</button>
        <button
          v-if="modal === 'class' && step > 0"
          type="button"
          class="btn"
          @click="goToStep(step - 1)"
        >
          Geri
        </button>
        <button class="btn btn-primary" type="submit">
          <Icon :name="modal === 'class' && step < 2 ? 'ArrowRight' : 'Check'" :size="17" />{{
            modal === 'class' && step < 2 ? 'Devam et' : 'Kaydet'
          }}
        </button>
      </div>
    </form></Modal
  >
  <Modal v-if="modal === 'archive'" title="Kaydı arşivle" @close="modal = ''"
    ><form class="form-grid" @submit.prevent="archive">
      <div class="info-box full">
        <strong>{{ removal.record.name }}</strong>
        <p>
          {{
            removal.kind === 'branch'
              ? 'Aktif sınıflar ve öğretmenler seçtiğiniz kampüse aktarılır.'
              : removal.kind === 'class'
                ? 'Aktif öğrenciler aynı düzeydeki seçili sınıfa aktarılır; bu sınıfın gelecek dersleri kapatılır.'
                : 'Aktif dersler, danışmanlıklar, bekleyen sorular ve görüşmeler aynı branştaki öğretmene devredilir.'
          }}
          Geçmiş not, ödeme ve yoklama kayıtları korunur.
        </p>
      </div>
      <label class="full"
        >Aktarım hedefi<select v-model="replacementId">
          <option value="">Bağlı aktif kayıt yoksa aktarım gerekmiyor</option>
          <option v-for="destination in destinations" :key="destination.id" :value="destination.id">
            {{ destination.name }}
          </option>
        </select></label
      >
      <p class="muted full">
        Arşivden yeniden etkinleştirme, aktarılmış öğrenci ve görevleri geri taşımaz.
      </p>
      <div class="modal-actions full">
        <button class="btn" type="button" @click="modal = ''">Vazgeç</button
        ><button class="btn btn-primary" type="submit">Arşivlemeyi tamamla</button>
      </div>
    </form></Modal
  >
</template>
