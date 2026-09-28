<script setup>
import Icon from './Icon.vue'
import Sparkline from './Sparkline.vue'
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  note: { type: String, default: '' },
  icon: { type: String, default: 'TrendingUp' },
  tone: { type: String, default: 'purple' },
  trend: { type: String, default: '' },
  soft: Boolean,
  points: { type: Array, default: () => [] },
  sparkLabel: { type: String, default: '' },
  sparkCurrency: Boolean,
})
</script>
<template>
  <article class="stat-card" :class="{ 'soft-surface': soft, 'has-sparkline': points.length }">
    <div class="stat-top">
      <span>{{ label }}</span
      ><span class="stat-icon" :class="tone"><Icon :name="icon" :size="19" /></span>
    </div>
    <div class="stat-middle">
      <strong
        :class="{
          'money-value': String(value).includes('₺'),
          'text-value': String(value).length > 16 && !String(value).includes('₺'),
        }"
        >{{ value }}</strong
      >
      <Sparkline
        v-if="points.length"
        :points="points"
        :label="sparkLabel"
        :currency="sparkCurrency"
      />
    </div>
    <div v-if="note || trend" class="stat-bottom">
      <span v-if="trend" class="trend"><Icon name="ArrowUpRight" :size="13" />{{ trend }}</span
      ><span v-if="note">{{ note }}</span>
    </div>
  </article>
</template>
