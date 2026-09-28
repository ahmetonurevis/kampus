<script setup>
import { computed } from 'vue'
const props = defineProps({
  labels: { type: Array, required: true },
  series: { type: Array, required: true },
  currency: Boolean,
})
const maximum = computed(() =>
  props.currency ? Math.max(100, ...props.series.flatMap((s) => s.values)) * 1.15 : 100,
)
const y = (value) => 178 - (value / maximum.value) * 148
const x = (index) => 64 + (index / Math.max(1, props.labels.length - 1)) * 566
const points = (values) => values.map((value, i) => `${x(i)},${y(value)}`).join(' ')
const areaPoints = (values) => `${x(0)},178 ${points(values)} ${x(values.length - 1)},178`
const seriesColor = (item, index) => item.color || `var(--chart-${(index % 3) + 1})`
const dashed = (item, index) => item.dashed ?? index > 0
const axis = (value) =>
  props.currency
    ? `${new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(value / 100)} ₺`
    : Math.round(value)
</script>
<template>
  <div class="trend-chart">
    <div class="chart-legend">
      <span v-for="(item, i) in series" :key="item.label"
        ><svg class="legend-swatch" viewBox="0 0 28 14" aria-hidden="true">
          <rect
            v-if="item.area"
            x="0"
            y="5"
            width="28"
            height="9"
            :fill="seriesColor(item, i)"
            fill-opacity="0.12"
          />
          <line
            x1="0"
            x2="28"
            y1="5"
            y2="5"
            :stroke="seriesColor(item, i)"
            :stroke-width="dashed(item, i) ? 1.8 : 2.8"
            :stroke-dasharray="dashed(item, i) ? '5 4' : undefined"
          /></svg
        >{{ item.label }}</span
      >
    </div>
    <svg
      class="chart-plot"
      viewBox="0 0 664 219"
      role="img"
      :aria-label="series.map((s) => `${s.label}: ${s.values.join(', ')}`).join('; ')"
    >
      <g v-for="n in 5" :key="n">
        <line
          x1="64"
          x2="637"
          :y1="30 + (n - 1) * 37"
          :y2="30 + (n - 1) * 37"
          stroke="var(--border)"
          stroke-dasharray="4 4"
        />
        <text x="0" :y="34 + (n - 1) * 37" class="chart-label">
          {{ axis((maximum * (5 - n)) / 4) }}
        </text>
      </g>
      <template v-for="(item, j) in series" :key="`area-${item.label}`">
        <polygon
          v-if="item.area && item.values.length"
          :points="areaPoints(item.values)"
          :fill="seriesColor(item, j)"
          fill-opacity="0.12"
        />
      </template>
      <g v-for="(item, j) in series" :key="item.label">
        <polyline
          :points="points(item.values)"
          fill="none"
          :stroke="seriesColor(item, j)"
          :stroke-width="dashed(item, j) ? 1.8 : 2.8"
          stroke-linejoin="round"
          :stroke-dasharray="dashed(item, j) ? '5 4' : undefined"
        />
        <circle
          v-for="(value, i) in item.values"
          :key="i"
          :cx="x(i)"
          :cy="y(value)"
          :r="dashed(item, j) ? 3 : 4"
          :fill="seriesColor(item, j)"
          stroke="var(--surface)"
          stroke-width="2"
        >
          <title>
            {{ labels[i] }} · {{ item.label }}:
            {{ currency ? (value / 100).toLocaleString('tr-TR') + ' ₺' : value }}
          </title>
        </circle>
      </g>
      <text
        v-for="(label, i) in labels"
        :key="i"
        :x="x(i)"
        y="210"
        text-anchor="middle"
        class="chart-label"
      >
        {{ label }}
      </text>
    </svg>
    <details class="chart-data">
      <summary>Grafik verilerini görüntüle</summary>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Dönem</th>
              <th v-for="item in series" :key="item.label">{{ item.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(label, i) in labels" :key="i">
              <td>{{ label }}</td>
              <td v-for="item in series" :key="item.label">
                {{
                  currency ? (item.values[i] / 100).toLocaleString('tr-TR') + ' ₺' : item.values[i]
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>
