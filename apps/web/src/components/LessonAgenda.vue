<script setup>
import Icon from './Icon.vue'
import Badge from './Badge.vue'
import { classById, teacherById } from '../stores/demo.js'
import { subjectById } from '../data/curriculum.js'
import { timeLabel } from '../lib/format.js'
defineProps({ lessons: { type: Array, required: true } })
</script>
<template>
  <div class="lesson-list">
    <div v-for="lesson in lessons.slice(0, 4)" :key="lesson.id" class="lesson-row">
      <div class="lesson-time">
        <strong>{{ timeLabel(lesson.date) }}</strong
        ><small>{{ lesson.duration }} dk</small>
      </div>
      <span class="lesson-subject" :class="subjectById(lesson.subjectId)?.color || 'blue'"
        ><Icon :name="subjectById(lesson.subjectId)?.icon || 'BookOpen'" :size="19"
      /></span>
      <div>
        <strong>{{ lesson.title }}</strong
        ><small
          >{{ lesson.isTutoring ? 'Kazanım etüdü' : classById(lesson.classId).name }} ·
          {{ teacherById(lesson.teacherId).name }}</small
        >
      </div>
      <Badge :text="`Derslik ${lesson.room}`" tone="gray" />
    </div>
    <p v-if="!lessons.length" class="empty-inline">
      Planlanmış ders yok. Haftalık programınıza göz atabilirsiniz.
    </p>
  </div>
</template>
