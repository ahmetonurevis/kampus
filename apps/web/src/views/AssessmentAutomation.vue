<script setup>
import { useRoute } from 'vue-router'
import { state } from '../stores/demo.js'
import OpticalAssessment from '../components/OpticalAssessment.vue'
import TutoringManagement from '../components/TutoringManagement.vue'
const route = useRoute()
</script>
<template>
  <template v-if="state.modules[route.meta.module]">
    <OpticalAssessment v-if="route.meta.module === 'optical'" />
    <TutoringManagement v-else />
  </template>
  <section v-else class="panel">
    <h1>Modül kullanıma kapalı</h1>
    <p>Yönetici modül ayarlarını değiştirebilir.</p>
  </section>
</template>
