<script setup>
import { computed } from 'vue'
const props = defineProps({
  points: { type: Array, required: true },
  label: { type: String, required: true },
  currency: Boolean,
})
const valid = computed(() => props.points.filter((point) => Number.isFinite(point.value)))
const positions = computed(() => {
  const values = valid.value.map((point) => point.value)
  const low = Math.min(...values),
    high = Math.max(...values)
  return valid.value.map((point, index) => ({
    x: valid.value.length === 1 ? 60 : 5 + (index * 110) / (valid.value.length - 1),
    y: high === low ? 25 : 45 - ((point.value - low) * 40) / (high - low),
  }))
})
const summary = computed(
  () =>
    `${props.label}: ${valid.value.map((point) => `${point.label} ${new Intl.NumberFormat('tr-TR', props.currency ? { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 } : { maximumFractionDigits: 1 }).format(props.currency ? point.value / 100 : point.value)}`).join('; ')}`,
)
</script>
<template>
  <svg v-if="valid.length" class="sparkline" viewBox="0 0 120 50" role="img" :aria-label="summary">
    <title>{{ summary }}</title>
    <polyline
      v-if="positions.length > 1"
      :points="positions.map((point) => `${point.x},${point.y}`).join(' ')"
    />
    <circle :cx="positions.at(-1).x" :cy="positions.at(-1).y" r="3" />
  </svg>
</template>
