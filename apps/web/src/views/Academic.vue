<script setup>
import { useViewMemory } from '../lib/view-memory.js'
import { tutoringCalendarEntries } from '@kampus/school-core/lib/assessment-automation.ts'
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  state,
  role,
  currentStudent,
  selectedChildId,
  teacherClasses,
  teacherId,
  classById,
  teacherById,
  branchById,
  gradeAverage,
  absentCount,
  action,
} from '../stores/demo.js'
import { subjectById, subjectsForGrade } from '../data/curriculum.js'
import { average, dateLabel, dayKey, homeworkStatus, timeLabel } from '../lib/format.js'
import { recordAttendance } from '../lib/domain.js'
import { exportCsv } from '../lib/download.js'
import PageHeading from '../components/PageHeading.vue'
import DataTable from '../components/DataTable.vue'
import StatCard from '../components/StatCard.vue'
import Badge from '../components/Badge.vue'
import Avatar from '../components/Avatar.vue'
import Icon from '../components/Icon.vue'
import WeekCalendar from '../components/WeekCalendar.vue'
import TrendChart from '../components/TrendChart.vue'
import Modal from '../components/Modal.vue'
import StudentSummary from '../components/StudentSummary.vue'
import { useDetailPanel } from '../lib/use-detail-panel.js'
const studentPanel = useDetailPanel('ogrenci')
const panelStudent = computed(() =>
  state.students.find(
    (student) =>
      student.id === studentPanel.selectedId.value &&
      teacherClasses.value.some((schoolClass) => schoolClass.id === student.classId),
  ),
)
const remember = useViewMemory()
const gradesTable = ref(null)
const route = useRoute(),
  router = useRouter(),
  page = computed(() => route.path.split('/').at(-1)),
  selectedClass = remember('selectedClass', teacherClasses.value[0]?.id || 'c1'),
  attendanceDate = ref(dayKey()),
  marks = reactive({}),
  selectedLesson = ref(null),
  analysisSubject = remember('analysisSubject', 'all'),
  gradeSubject = remember('gradeSubject', 'all')
const profile = computed(() =>
  route.params.id
    ? state.students.find(
        (s) => s.id === route.params.id && teacherClasses.value.some((c) => c.id === s.classId),
      )
    : currentStudent.value,
)
const students = computed(() =>
  state.students
    .filter((s) => s.classId === selectedClass.value && s.isActive)
    .map((s) => ({
      ...s,
      class: classById(s.classId).name,
      score: gradeAverage(s.id),
      absent: absentCount(s.id),
    })),
)
const grades = computed(() =>
  profile.value
    ? state.grades
        .filter(
          (g) =>
            g.studentId === profile.value.id &&
            (gradeSubject.value === 'all' || g.subjectId === gradeSubject.value),
        )
        .sort((a, b) => b.date.localeCompare(a.date))
    : [],
)
const attendance = computed(() =>
  profile.value
    ? state.attendance
        .filter((a) => a.studentId === profile.value.id)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((a) => ({
          ...a,
          statusLabel: {
            present: 'Geldi',
            absent: 'Gelmedi',
            late: 'Geç geldi',
            excused: 'Mazeretli',
          }[a.status],
        }))
    : [],
)
const lessons = computed(() =>
  state.schedule
    .filter((l) => !l.cancelledAt)
    .filter((l) =>
      role.value === 'ogretmen' ? l.teacherId === teacherId : l.classId === profile.value?.classId,
    )
    .map((l) => ({ ...l, subtitle: `${classById(l.classId).name} · Derslik ${l.room}` }))
    .concat(tutoringCalendarEntries(state, { role: role.value, childId: selectedChildId.value })),
)
const availableSubjects = computed(() =>
  subjectsForGrade(
    classById(page.value === 'sinif-analizi' ? selectedClass.value : profile.value?.classId)
      ?.grade || 7,
  ),
)
const analysisGrades = computed(() =>
  state.grades.filter((g) =>
    page.value === 'sinif-analizi'
      ? students.value.some((s) => s.id === g.studentId)
      : g.studentId === profile.value?.id,
  ),
)
const subjectScores = computed(() =>
  availableSubjects.value
    .map((subject) => {
      const relevant = analysisGrades.value.filter((g) => g.subjectId === subject.id)
      return {
        topic: subject.name,
        score: average(relevant.map((g) => g.score)),
        count: relevant.length,
      }
    })
    .filter((s) => s.count),
)
const analysisScores = computed(() => {
  if (analysisSubject.value === 'all') return subjectScores.value
  const results = analysisGrades.value
    .filter((g) => g.subjectId === analysisSubject.value && g.topic !== 'Kazanım testi')
    .map((g) => ({ topic: g.topic, score: g.score }))
  for (const attempt of state.quizAttempts.filter(
    (a) =>
      state.quizzes.find((q) => q.id === a.quizId)?.subjectId === analysisSubject.value &&
      (page.value === 'sinif-analizi'
        ? students.value.some((s) => s.id === a.studentId)
        : a.studentId === profile.value?.id),
  ))
    results.push(...attempt.topicScores)
  return [...new Set(results.map((r) => r.topic))].map((topic) => ({
    topic,
    score: average(results.filter((r) => r.topic === topic).map((r) => r.score)),
  }))
})
watch(availableSubjects, (list) => {
  if (!list.some((s) => s.id === analysisSubject.value)) analysisSubject.value = 'all'
})
const trend = computed(() => {
  const relevant =
    page.value === 'sinif-analizi'
      ? state.grades.filter((g) => students.value.some((s) => s.id === g.studentId))
      : grades.value
  const dates = [...new Set(relevant.map((g) => g.date))].sort()
  return {
    labels: dates.map((d) => dateLabel(d, { day: undefined, month: 'long' })),
    values: dates.map((d) => average(relevant.filter((g) => g.date === d).map((g) => g.score))),
  }
})
const profileHomework = computed(() =>
  state.homework
    .filter((h) => h.classId === profile.value?.classId)
    .map((h) => ({
      ...h,
      status: homeworkStatus(h, state.submissions, profile.value.id),
      score: state.submissions.find(
        (s) => s.homeworkId === h.id && s.studentId === profile.value.id,
      )?.score,
    })),
)
const reviews = computed(() =>
  state.submissions
    .filter((s) => s.studentId === profile.value?.id && s.feedback)
    .map((s) => ({
      ...s,
      teacher: teacherById(state.homework.find((h) => h.id === s.homeworkId).teacherId),
      title: state.homework.find((h) => h.id === s.homeworkId).title,
    })),
)
watch(
  [selectedClass, attendanceDate],
  () => {
    for (const key of Object.keys(marks)) delete marks[key]
    for (const student of students.value)
      marks[student.id] =
        state.attendance.find(
          (a) => a.studentId === student.id && dayKey(a.date) === attendanceDate.value,
        )?.status || 'present'
  },
  { immediate: true },
)
function saveAttendance() {
  action(
    () =>
      recordAttendance(state, selectedClass.value, `${attendanceDate.value}T09:00:00.000Z`, marks),
    'Yoklama kaydedildi. Öğrenci ve veli panelleri güncellendi.',
  )
}
function selectChild(id) {
  selectedChildId.value = id
  router.push('/veli/dashboard')
}
const gradeColumns = [
  { key: 'title', label: 'Değerlendirme' },
  { key: 'subject', label: 'Ders' },
  { key: 'topic', label: 'Kazanım / Konu' },
  { key: 'date', label: 'Tarih' },
  { key: 'score', label: 'Puan' },
]
</script>
<template>
  <PageHeading :title="route.params.id && profile ? profile.name : ''"
    ><template
      v-if="role === 'ogretmen' && ['yoklama', 'siniflarim', 'sinif-analizi'].includes(page)"
      ><select v-model="selectedClass" aria-label="Sınıf seç">
        <option v-for="c in teacherClasses" :key="c.id" :value="c.id">
          {{ c.name }} · {{ branchById(c.branchId).name }}
        </option>
      </select></template
    ><button
      v-if="page === 'notlarim'"
      class="btn"
      @click="
        exportCsv(
          'notlarim',
          gradeColumns,
          (gradesTable?.filteredRows || grades).map((g) => ({
            ...g,
            date: dateLabel(g.date, { year: 'numeric' }),
          })),
        )
      "
    >
      <Icon name="Download" :size="17" />Sonuçları indir
    </button></PageHeading
  >
  <div v-if="route.params.id && !profile" class="panel empty-page">
    <h2>Öğrenci bulunamadı.</h2>
    <p>Bu öğrenci sınıflarınıza kayıtlı değil veya kayıt artık mevcut değil.</p>
    <RouterLink to="/ogretmen/siniflarim" class="btn">Sınıflarıma dön</RouterLink>
  </div>
  <div v-else-if="page === 'cocuk-secici'" class="three-grid">
    <article
      v-for="child in state.parents[0].studentIds.map((id) =>
        state.students.find((s) => s.id === id),
      )"
      :key="child.id"
      class="panel child-profile"
    >
      <Avatar :name="child.name" size="large" />
      <h2>{{ child.name }}</h2>
      <p>
        {{ classById(child.classId).name }} ·
        {{ branchById(classById(child.classId).branchId).name }}
      </p>
      <div class="branch-card-numbers">
        <div>
          <strong>{{ gradeAverage(child.id) }}</strong
          ><small>Ortalama</small>
        </div>
        <div>
          <strong>{{ absentCount(child.id) }}</strong
          ><small>Devamsızlık</small>
        </div>
      </div>
      <button
        class="btn"
        :class="selectedChildId === child.id ? 'btn-primary' : ''"
        @click="selectChild(child.id)"
      >
        {{ selectedChildId === child.id ? 'Seçili profili aç' : 'Bu profili seç'
        }}<Icon name="ArrowRight" :size="16" />
      </button>
    </article>
  </div>
  <section v-else-if="page === 'ders-programi'" class="panel">
    <WeekCalendar :events="lessons" @select="selectedLesson = $event" />
  </section>
  <template v-else-if="page === 'yoklama'"
    ><div class="attendance-banner">
      <div>
        <Icon name="ClipboardCheck" :size="25" /><span
          ><strong>{{ classById(selectedClass).name }}</strong
          ><small>{{ students.length }} öğrenci · {{ teacherById(teacherId).name }}</small></span
        >
      </div>
      <label
        >Tarih<input
          v-model="attendanceDate"
          type="date"
          :max="dayKey()"
          aria-label="Yoklama tarihi" /></label
      ><button class="btn" @click="students.forEach((s) => (marks[s.id] = 'present'))">
        <Icon name="CheckCheck" :size="17" />Herkes geldi
      </button>
    </div>
    <section class="panel">
      <div class="attendance-head"><span>Öğrenci</span><span>Devam durumu</span></div>
      <div v-for="student in students" :key="student.id" class="attendance-row">
        <div class="person-cell">
          <Avatar :name="student.name" />
          <div>
            <strong>{{ student.name }}</strong
            ><small>{{ student.id.toUpperCase() }}</small>
          </div>
        </div>
        <div class="attendance-controls">
          <button
            v-for="(label, key) in {
              present: 'Geldi',
              absent: 'Gelmedi',
              late: 'Geç geldi',
              excused: 'Mazeretli',
            }"
            :key="key"
            :class="{ selected: marks[student.id] === key, [key]: true }"
            :aria-pressed="marks[student.id] === key"
            @click="marks[student.id] = key"
          >
            <Icon
              :name="key === 'present' ? 'Check' : key === 'absent' ? 'X' : 'Clock3'"
              :size="16"
            />{{ label }}
          </button>
        </div>
      </div>
      <div class="attendance-footer">
        <span
          >{{ Object.values(marks).filter((m) => m === 'present').length }} geldi ·
          {{ Object.values(marks).filter((m) => m === 'absent').length }} gelmedi ·
          {{ Object.values(marks).filter((m) => m === 'late').length }} geç geldi</span
        ><button class="btn btn-primary" @click="saveAttendance">
          <Icon name="ClipboardCheck" :size="17" />Yoklamayı kaydet
        </button>
      </div>
    </section></template
  >
  <template v-else-if="page === 'siniflarim'"
    ><div class="three-grid">
      <button
        v-for="c in teacherClasses"
        :key="c.id"
        class="panel class-card"
        :class="{ selected: selectedClass === c.id }"
        @click="selectedClass = c.id"
      >
        <div class="class-card-top">
          <span class="level-badge">{{ c.level }}</span
          ><Badge text="Aktif" />
        </div>
        <h2>{{ c.name }}</h2>
        <p>{{ branchById(c.branchId).name }} · Derslik {{ c.room }}</p>
        <div class="class-card-bottom">
          <span
            ><Icon name="UsersRound" :size="17" />{{
              state.students.filter((s) => s.classId === c.id).length
            }}
            öğrenci</span
          ><Icon name="ArrowUpRight" />
        </div>
      </button>
    </div>
    <section class="panel">
      <div class="panel-heading">
        <div>
          <h2>{{ classById(selectedClass).name }} · Öğrenci listesi</h2>
          <p>Detaylı gelişim profili için öğrenciyi seçin.</p>
        </div>
      </div>
      <DataTable
        list-key="academic-datatable-1"
        :rows="students"
        :search-keys="['phone', 'email', 'class', 'number']"
        :filter-key="selectedClass"
        :columns="[
          { key: 'name', label: 'Öğrenci' },
          { key: 'email', label: 'E-posta' },
          { key: 'score', label: 'Ortalama' },
          { key: 'absent', label: 'Devamsızlık' },
          { key: 'actions', label: '' },
        ]"
        ><template #name="{ row }"
          ><div class="person-cell">
            <Avatar :name="row.name" size="small" />
            <div>
              <button class="text-link record-link" @click="studentPanel.open(row.id)">
                <strong>{{ row.name }}</strong>
              </button>
              <small>{{ row.class }} · No: {{ row.number }}</small>
            </div>
          </div></template
        ><template #score="{ value }"
          ><Badge :text="`${value}/100`" :tone="value < 65 ? 'amber' : 'green'" /></template
        ><template #absent="{ value }">{{ value }} ders</template
        ><template #actions="{ row }"
          ><RouterLink :to="`/ogretmen/ogrenci/${row.id}`" class="text-link"
            >Profili aç<Icon name="ArrowRight" :size="15" /></RouterLink></template
      ></DataTable></section
  ></template>
  <template v-else-if="['sinav-analizi', 'sinif-analizi'].includes(page)"
    ><div class="content-filters">
      <label
        >Ders / konu analizi<select v-model="analysisSubject" aria-label="Analiz dersi">
          <option value="all">Tüm dersler</option>
          <option v-for="s in availableSubjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select></label
      >
    </div>
    <div class="stats-grid stats-three">
      <StatCard
        label="Genel başarı"
        :value="`${average(analysisScores.map((s) => s.score))}/100`"
        icon="Award"
        note="Seçili ders kapsamındaki ortalama"
      /><StatCard
        label="En güçlü alan"
        :value="[...analysisScores].sort((a, b) => b.score - a.score)[0]?.topic || '—'"
        icon="TrendingUp"
        tone="green"
        note="Öğrenmeyi pekiştirin"
      /><StatCard
        label="Gelişim odağı"
        :value="[...analysisScores].sort((a, b) => a.score - b.score)[0]?.topic || '—'"
        icon="Target"
        tone="amber"
        note="Bir sonraki çalışma için öneri"
      />
    </div>
    <div class="two-grid">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>
              {{
                analysisSubject === 'all'
                  ? 'Ders bazlı başarı'
                  : `${subjectById(analysisSubject).name} · Konu analizi`
              }}
            </h2>
            <p>100 puan üzerinden değerlendirme</p>
          </div>
        </div>
        <div class="topic-bars">
          <div v-for="subject in analysisScores" :key="subject.topic">
            <div>
              <strong>{{ subject.topic }}</strong
              ><span>{{ subject.score }}/100</span>
            </div>
            <div class="progress">
              <span
                :style="{
                  width: `${subject.score}%`,
                  background: subject.score < 65 ? '#d59c43' : undefined,
                }"
              ></span>
            </div>
            <small>{{
              subject.score < 65
                ? 'Tekrar ve ek çalışma önerilir'
                : subject.score >= 80
                  ? 'Güçlü alan'
                  : 'Gelişmeye devam ediyor'
            }}</small>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Aylık başarı eğilimi</h2>
            <p>Geçmiş değerlendirmeler ve quiz sonuçları</p>
          </div>
        </div>
        <TrendChart
          :labels="trend.labels"
          :series="[{ label: 'Ortalama puan', values: trend.values }]"
        />
        <div class="info-box chart-note">
          <Icon name="BookOpen" :size="22" /><span
            >En düşük puanlı konuya haftada iki kısa tekrar ayırmak, gelişimi destekler.</span
          >
        </div>
      </section>
    </div></template
  >
  <template v-else-if="page === 'seviye-takibi'"
    ><section class="panel level-hero">
      <div class="level-orb">
        <strong>{{ classById(profile.classId).grade }}</strong
        ><small>SINIF</small>
      </div>
      <div>
        <span class="eyebrow">AKADEMİK GELİŞİM YOLCULUĞU</span>
        <h2>{{ profile.name }}, her gün biraz daha ileri.</h2>
        <p>
          {{ classById(profile.classId).name }} · Dönem hedeflerine ilerleme %{{ profile.progress }}
        </p>
        <div class="progress"><span :style="{ width: `${profile.progress}%` }"></span></div>
      </div>
      <Icon name="GraduationCap" :size="72" />
    </section>
    <section class="panel">
      <div class="panel-heading">
        <div>
          <h2>Akademik hedefler</h2>
          <p>Ders sonuçlarına göre kişisel çalışma öncelikleri</p>
        </div>
      </div>
      <div class="achievement-grid">
        <article v-for="subject in subjectScores" :key="subject.topic">
          <span class="mini-icon" :class="subject.score >= 80 ? 'mint' : 'lavender'"
            ><Icon :name="subject.score >= 80 ? 'Award' : 'Target'" :size="24" /></span
          ><strong>{{ subject.topic }}</strong
          ><Badge
            :text="
              subject.score >= 80
                ? 'Güçlü kazanımlar'
                : subject.score >= 65
                  ? 'Pekiştirme zamanı'
                  : 'Etüt önerilir'
            "
          />
          <p>
            {{
              subject.score >= 80
                ? 'Yeni nesil sorular ve projelerle ilerle.'
                : 'Konu özetini incele, testi çöz ve öğretmeninle değerlendir.'
            }}
          </p>
        </article>
      </div>
    </section>
    <div class="two-grid">
      <section class="panel">
        <div class="panel-heading"><h2>Ders bazlı başarı</h2></div>
        <div class="topic-bars">
          <div v-for="subject in subjectScores" :key="subject.topic">
            <div>
              <strong>{{ subject.topic }}</strong
              ><span>%{{ subject.score }}</span>
            </div>
            <div class="progress"><span :style="{ width: `${subject.score}%` }"></span></div>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>Gelişim geçmişi</h2></div>
        <TrendChart
          :labels="trend.labels"
          :series="[{ label: 'Başarı puanı', values: trend.values }]"
        />
      </section></div
  ></template>
  <section v-else-if="page === 'notlarim'" class="panel">
    <DataTable
      ref="gradesTable"
      list-key="academic-datatable-2"
      :rows="grades"
      :columns="gradeColumns"
      :filter-key="gradeSubject"
      :external-active="gradeSubject !== 'all'"
      :exclude-filters="['subject']"
      @reset="gradeSubject = 'all'"
      ><template #filters
        ><select v-model="gradeSubject" aria-label="Not dersi">
          <option value="all">Tüm dersler</option>
          <option v-for="s in availableSubjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select></template
      ><template #date="{ value }">{{ dateLabel(value, { year: 'numeric' }) }}</template
      ><template #score="{ value }"
        ><Badge :text="`${value}/100`" :tone="value < 65 ? 'amber' : 'green'" /></template
    ></DataTable>
  </section>
  <template v-else-if="page === 'devamsizlik'"
    ><div class="stats-grid stats-three">
      <StatCard
        label="Katıldığı ders"
        :value="attendance.filter((a) => a.status === 'present').length"
        icon="ClipboardCheck"
        tone="green"
        note="Zamanında katılım"
      /><StatCard
        label="Devamsızlık"
        :value="attendance.filter((a) => a.status === 'absent').length"
        icon="CalendarDays"
        tone="amber"
        note="Derse katılmadığı günler"
      /><StatCard
        label="Geç katılım"
        :value="attendance.filter((a) => a.status === 'late').length"
        icon="Clock3"
        note="Geç geldi olarak işaretlendi"
      />
    </div>
    <section class="panel">
      <DataTable
        list-key="academic-datatable-3"
        :rows="attendance"
        :columns="[
          { key: 'date', label: 'Ders tarihi' },
          { key: 'statusLabel', label: 'Katılım' },
          { key: 'reason', label: 'Not' },
        ]"
        ><template #date="{ value }">{{
          dateLabel(value, { year: 'numeric', weekday: 'long' })
        }}</template
        ><template #statusLabel="{ value }"><Badge :text="value" /></template
        ><template #reason="{ value }">{{ value || 'Kayıtlı mazeret yok' }}</template></DataTable
      >
    </section></template
  >
  <template v-else-if="page === 'ogretmen-degerlendirmeleri'"
    ><div class="two-grid">
      <article class="panel review-card">
        <div class="person-cell">
          <Avatar :name="teacherById(classById(profile.classId).teacherId).name" />
          <div>
            <strong>{{ teacherById(classById(profile.classId).teacherId).name }}</strong
            ><small>Dönem gelişim değerlendirmesi</small>
          </div>
        </div>
        <p>
          {{ profile.name.split(' ')[0] }}, ders çalışmalarında ilerleme gösteriyor.
          {{
            gradeAverage(profile.id) >= 75
              ? 'Öğrendiği yapıları örnek cümlelerle başarıyla pekiştiriyor.'
              : 'Dil bilgisi ve kelime tekrarlarıyla temelini güçlendirmesini öneriyorum.'
          }}
          {{
            absentCount(profile.id) >= 6
              ? 'Derse düzenli katılım konusunda birlikte takip yapmamız faydalı olacak.'
              : 'Ders katılımı ve çalışma alışkanlığı olumlu ilerliyor.'
          }}
        </p>
        <div class="review-footer">
          <Badge text="Akademik gelişim" /><small>{{ dateLabel(state.createdAt) }}</small>
        </div>
      </article>
      <article v-for="review in reviews" :key="review.id" class="panel review-card">
        <div class="person-cell">
          <Avatar :name="review.teacher.name" />
          <div>
            <strong>{{ review.teacher.name }}</strong
            ><small>{{ review.title }}</small>
          </div>
        </div>
        <p>{{ review.feedback }}</p>
        <div class="review-footer">
          <Badge :text="`${review.score}/100`" tone="green" /><small>{{
            dateLabel(review.submittedAt)
          }}</small>
        </div>
      </article>
    </div></template
  >
  <template v-else
    ><section class="panel student-summary">
      <Avatar :name="profile.name" size="large" />
      <div>
        <h2>{{ profile.name }}</h2>
        <p>
          {{ classById(profile.classId).name }} ·
          {{ branchById(classById(profile.classId).branchId).name }}
        </p>
        <span class="muted"
          >Sınıf danışmanı: {{ teacherById(classById(profile.classId).teacherId).name }}</span
        >
      </div>
      <div class="student-summary-stats">
        <div>
          <strong>{{ gradeAverage(profile.id) }}</strong
          ><small>Ortalama</small>
        </div>
        <div>
          <strong>{{ absentCount(profile.id) }}</strong
          ><small>Devamsızlık</small>
        </div>
        <div>
          <strong>%{{ profile.progress }}</strong
          ><small>Dönem ilerlemesi</small>
        </div>
      </div>
    </section>
    <div class="two-grid">
      <section class="panel">
        <div class="panel-heading"><h2>Akademik gelişim</h2></div>
        <TrendChart
          :labels="trend.labels"
          :series="[{ label: 'Not ortalaması', values: trend.values }]"
        />
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>Ödev durumu</h2></div>
        <div class="homework-summary">
          <div v-for="h in profileHomework" :key="h.id">
            <span
              ><strong>{{ h.title }}</strong
              ><small
                >{{ dateLabel(h.dueDate) }} ·
                {{ h.score != null ? `${h.score}/100` : 'Henüz notlandırılmadı' }}</small
              ></span
            ><Badge :text="h.status" />
          </div>
        </div>
      </section>
    </div>
    <section class="panel">
      <div class="panel-heading"><h2>Not geçmişi</h2></div>
      <DataTable
        ref="gradesTable"
        list-key="academic-datatable-4"
        :rows="grades"
        :columns="gradeColumns"
        :filter-key="gradeSubject"
        :external-active="gradeSubject !== 'all'"
        :exclude-filters="['subject']"
        @reset="gradeSubject = 'all'"
        ><template #date="{ value }">{{ dateLabel(value) }}</template
        ><template #score="{ value }"
          ><Badge :text="`${value}/100`" :tone="value >= 65 ? 'green' : 'amber'" /></template
      ></DataTable>
    </section>
    <section class="panel">
      <WeekCalendar
        :events="
          state.schedule
            .filter((l) => !l.cancelledAt)
            .filter((l) => l.classId === profile.classId)
            .map((l) => ({ ...l, subtitle: `Derslik ${l.room}` }))
        "
        @select="selectedLesson = $event"
      /></section
  ></template>
  <Modal
    v-if="studentPanel.selectedId.value && page === 'siniflarim'"
    drawer
    title="Öğrenci özeti"
    @close="studentPanel.close"
  >
    <StudentSummary
      v-if="panelStudent"
      :student="panelStudent"
      :profile-url="`/ogretmen/ogrenci/${panelStudent.id}`"
    />
    <p v-else class="muted">Bu öğrenci atandığınız sınıflarda bulunamadı.</p>
  </Modal>
  <Modal v-if="selectedLesson" drawer :title="selectedLesson.title" @close="selectedLesson = null"
    ><div class="lesson-detail">
      <Badge
        :text="selectedLesson.isTutoring ? 'Kazanım etüdü' : classById(selectedLesson.classId).name"
      />
      <p>
        <Icon name="CalendarDays" />{{
          dateLabel(selectedLesson.date, { weekday: 'long', year: 'numeric' })
        }}
      </p>
      <p>
        <Icon name="Clock3" />{{ timeLabel(selectedLesson.date) }} ·
        {{ selectedLesson.duration }} dakika
      </p>
      <p><Icon name="UsersRound" />{{ teacherById(selectedLesson.teacherId).name }}</p>
      <p>
        <Icon name="MapPin" />{{ branchById(classById(selectedLesson.classId).branchId).name }} ·
        Derslik {{ selectedLesson.room }}
      </p>
    </div></Modal
  >
</template>
