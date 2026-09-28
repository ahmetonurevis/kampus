<script setup>
import { computed, ref } from 'vue'
import { dateLabel, dayKey, timeLabel } from '../lib/format.js'
import Icon from './Icon.vue'
defineProps({ events: { type: Array, default: () => [] } })
defineEmits(['select'])
const offset = ref(0)
const days = computed(() => {
  const base = new Date(`${dayKey()}T09:00:00Z`)
  const weekday = base.getUTCDay()
  base.setUTCDate(base.getUTCDate() - ((weekday + 6) % 7) + offset.value * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString()
  })
})
</script>
<template>
  <div class="calendar">
    <div class="calendar-toolbar">
      <div>
        <h3>{{ dateLabel(days[0]) }} – {{ dateLabel(days[6], { year: 'numeric' }) }}</h3>
        <span class="muted">Haftalık görünüm</span>
      </div>
      <div class="button-row">
        <button class="btn btn-sm" @click="offset = 0">Bugün</button
        ><button class="icon-button" aria-label="Önceki hafta" @click="offset--">
          <Icon name="ChevronLeft" /></button
        ><button class="icon-button" aria-label="Sonraki hafta" @click="offset++">
          <Icon name="ChevronRight" />
        </button>
      </div>
    </div>
    <div
      class="calendar-grid"
      tabindex="0"
      role="region"
      aria-label="Haftalık takvim; diğer günler için yatay kaydırın"
    >
      <div
        v-for="day in days"
        :key="day"
        class="calendar-day"
        :class="{ today: dayKey(day) === dayKey() }"
      >
        <div class="calendar-date">
          <span>{{ dateLabel(day, { weekday: 'short', day: undefined, month: undefined }) }}</span
          ><strong>{{ new Date(day).getUTCDate() }}</strong>
        </div>
        <button
          v-for="(event, i) in events.filter((e) => dayKey(e.date) === dayKey(day))"
          :key="event.id"
          class="calendar-event"
          :class="`event-${i % 3}`"
          @click="$emit('select', event)"
        >
          <span>{{ timeLabel(event.date) }}</span
          ><strong>{{ event.title }}</strong
          ><small>{{ event.subtitle }}</small></button
        ><span v-if="!events.some((e) => dayKey(e.date) === dayKey(day))" class="calendar-empty"
          >Plan yok</span
        >
      </div>
    </div>
  </div>
</template>
