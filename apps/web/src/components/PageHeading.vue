<script setup>
import { useRoute } from 'vue-router'
defineProps({ title: { type: String, default: '' }, description: { type: String, default: '' } })
const route = useRoute()
</script>
<template>
  <div class="page-heading">
    <div>
      <h1>{{ title || route.meta.title }}</h1>
      <p>{{ description || route.meta.description }}</p>
    </div>
    <div class="heading-actions"><slot /></div>
  </div>
</template>
