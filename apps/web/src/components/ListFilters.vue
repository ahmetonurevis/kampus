<script setup>
import { computed, useId } from 'vue'
import Icon from './Icon.vue'
import { hasFilter } from '../lib/list-query.js'
const props = defineProps({
  fields: { type: Array, default: () => [] },
  rows: { type: Array, required: true },
  modelValue: { type: Object, required: true },
  externalActive: Boolean,
  externalLabel: { type: String, default: 'Seçili filtreler' },
})
const emit = defineEmits(['update:modelValue', 'reset'])
const expanded = defineModel('expanded', { type: Boolean, default: false })
const panelId = useId()
const active = computed(() => props.fields.filter((f) => hasFilter(props.modelValue[f.key])))
const activeCount = computed(() => active.value.length + Number(props.externalActive))
function clearFilters() {
  emit('update:modelValue', {})
  emit('reset')
}
function options(field) {
  return (
    field.options ||
    [...new Set(props.rows.map((r) => r[field.key]).filter((v) => v != null && v !== ''))]
      .sort((a, b) => String(a).localeCompare(String(b), 'tr', { numeric: true }))
      .map((value) => ({ value, label: value }))
  )
}
function update(key, value) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
function range(key, boundary, value) {
  update(key, { ...props.modelValue[key], [boundary]: value })
}
function selection(field) {
  const value = props.modelValue[field.key]
  if (field.type === 'date') return `${value.min || 'Başlangıç yok'} → ${value.max || 'Bitiş yok'}`
  if (field.type === 'number') return `${value.min ?? ''} – ${value.max ?? ''}`
  return options(field).find((o) => String(o.value) === String(value))?.label || value
}
function invalid(field) {
  const value = props.modelValue[field.key]
  if (!value || value.min == null || value.max == null || value.min === '' || value.max === '')
    return false
  return field.type === 'number' ? Number(value.min) > Number(value.max) : value.min > value.max
}
</script>
<template>
  <div v-if="fields.length || $slots['before-fields'] || $slots.actions" class="list-filters">
    <div class="filter-summary">
      <button
        class="btn btn-sm filter-toggle"
        :class="{ 'is-active': activeCount }"
        :aria-expanded="expanded"
        :aria-controls="panelId"
        @click="expanded = !expanded"
      >
        <Icon name="Filter" :size="16" />Filtreler
        <span v-if="activeCount" class="filter-count">{{ activeCount }}</span
        ><Icon name="ChevronDown" :size="15" :class="{ rotated: expanded }" />
      </button>
      <div class="filter-chips" aria-label="Aktif filtreler">
        <button
          v-if="externalActive"
          class="filter-chip"
          aria-label="Ek filtreleri kaldır"
          @click="emit('reset')"
        >
          {{ externalLabel }}<Icon name="X" :size="13" />
        </button>
        <button
          v-for="field in active"
          :key="field.key"
          class="filter-chip"
          :aria-label="`${field.label} filtresini kaldır`"
          @click="update(field.key, '')"
        >
          {{ field.label }}: {{ selection(field) }}<Icon name="X" :size="13" />
        </button>
      </div>
      <button v-if="activeCount" class="text-link filter-clear" @click="clearFilters">
        Filtreleri temizle
      </button>
      <div v-if="$slots.actions" class="filter-extra"><slot name="actions" /></div>
    </div>
    <div v-if="expanded" :id="panelId" class="filter-panel">
      <slot name="before-fields" />
      <div v-for="field in fields" :key="field.key" class="filter-control">
        <fieldset v-if="field.type === 'date' || field.type === 'number'">
          <legend>{{ field.label }}</legend>
          <div class="filter-range">
            <input
              :type="field.type"
              :aria-label="`${field.label} ${field.type === 'date' ? 'başlangıç' : 'en az'}`"
              :value="modelValue[field.key]?.min ?? ''"
              :step="field.type === 'number' ? 'any' : undefined"
              :aria-invalid="invalid(field)"
              :aria-describedby="invalid(field) ? `${panelId}-${field.key}-error` : undefined"
              :placeholder="field.type === 'number' ? 'En az' : undefined"
              @input="range(field.key, 'min', $event.target.value)"
            />
            <span aria-hidden="true">–</span>
            <input
              :type="field.type"
              :aria-label="`${field.label} ${field.type === 'date' ? 'bitiş' : 'en çok'}`"
              :value="modelValue[field.key]?.max ?? ''"
              :step="field.type === 'number' ? 'any' : undefined"
              :aria-invalid="invalid(field)"
              :aria-describedby="invalid(field) ? `${panelId}-${field.key}-error` : undefined"
              :placeholder="field.type === 'number' ? 'En çok' : undefined"
              @input="range(field.key, 'max', $event.target.value)"
            />
          </div>
          <small v-if="invalid(field)" :id="`${panelId}-${field.key}-error`" class="text-red"
            >Başlangıç değeri bitişten büyük olamaz.</small
          >
        </fieldset>
        <label v-else
          >{{ field.label
          }}<select
            :aria-label="field.label"
            :value="modelValue[field.key] || ''"
            @change="update(field.key, $event.target.value)"
          >
            <option value="">Tümü</option>
            <option v-for="option in options(field)" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select></label
        >
      </div>
    </div>
  </div>
</template>
