<script setup>
import { computed } from 'vue'
import { state, classById, branchById, gradeAverage, absentCount } from '../stores/demo.js'
import { dateLabel, homeworkStatus } from '../lib/format.js'
import { subjectById } from '../data/curriculum.js'
import Avatar from './Avatar.vue'
import Badge from './Badge.vue'
const props = defineProps({
  student: { type: Object, required: true },
  profileUrl: { type: String, default: '' },
})
const schoolClass = computed(() => classById(props.student.classId))
const grades = computed(() =>
  state.grades
    .filter((grade) => grade.studentId === props.student.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4),
)
const attendance = computed(() =>
  state.attendance
    .filter((record) => record.studentId === props.student.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4),
)
const homework = computed(() =>
  state.homework
    .filter((record) => record.classId === props.student.classId)
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
    .slice(0, 4),
)
</script>
<template>
  <div class="detail-person">
    <Avatar :name="student.name" />
    <div>
      <h3>{{ student.name }}</h3>
      <p>{{ schoolClass?.name }} · No: {{ student.number }}</p>
      <small>{{ branchById(schoolClass?.branchId)?.name }}</small>
    </div>
  </div>
  <dl class="detail-metrics">
    <div>
      <dt>Not ortalaması</dt>
      <dd>{{ gradeAverage(student.id) }}/100</dd>
    </div>
    <div>
      <dt>Devamsızlık</dt>
      <dd>{{ absentCount(student.id) }} ders</dd>
    </div>
  </dl>
  <section class="detail-section">
    <h3>Son notlar</h3>
    <ul class="detail-list">
      <li v-for="grade in grades" :key="grade.id">
        <div>
          <strong>{{ subjectById(grade.subjectId)?.name || grade.subject }}</strong
          ><small>{{ dateLabel(grade.date) }} · {{ grade.topic }}</small>
        </div>
        <Badge :text="`${grade.score}/100`" :tone="grade.score < 65 ? 'amber' : 'green'" />
      </li>
    </ul>
    <p v-if="!grades.length" class="muted">Henüz not kaydı bulunmuyor.</p>
  </section>
  <section class="detail-section">
    <h3>Son yoklamalar</h3>
    <ul class="detail-list">
      <li v-for="record in attendance" :key="record.id">
        <span>{{ dateLabel(record.date) }}</span
        ><Badge
          :text="
            { present: 'Geldi', absent: 'Gelmedi', late: 'Geç geldi', excused: 'Mazeretli' }[
              record.status
            ]
          "
        />
      </li>
    </ul>
    <p v-if="!attendance.length" class="muted">Henüz yoklama kaydı bulunmuyor.</p>
  </section>
  <section v-if="state.modules.learning" class="detail-section">
    <h3>Son ödevler</h3>
    <ul class="detail-list">
      <li v-for="assignment in homework" :key="assignment.id">
        <div>
          <strong>{{ assignment.title }}</strong
          ><small>{{ dateLabel(assignment.dueDate) }} son teslim</small>
        </div>
        <Badge :text="homeworkStatus(assignment, state.submissions, student.id)" />
      </li>
    </ul>
    <p v-if="!homework.length" class="muted">Henüz ödev atanmamış.</p>
  </section>
  <RouterLink v-if="profileUrl" :to="profileUrl" class="btn full"
    >Tam öğrenci profilini aç</RouterLink
  >
</template>
