<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { roles } from '../modules/navigation.js'
import { setRole } from '../stores/demo.js'
import Icon from '../components/Icon.vue'
import LoginStory from '../components/LoginStory.vue'
const selected = ref('yonetici'),
  router = useRouter()
function enter() {
  setRole(selected.value)
  router.push(`/${selected.value}/dashboard`)
}
</script>
<template>
  <main id="main" class="login-page">
    <LoginStory />
    <section class="login-form">
      <div class="login-form-inner">
        <span class="demo-pill"><span class="status-dot"></span>İNTERAKTİF DEMO</span>
        <h2>Kampüs’e hoş geldiniz.</h2>
        <p class="login-lead">
          Sizin için hazırladığımız dünyayı keşfedin.<br />Başlamak için bir rol seçin.
        </p>
        <form novalidate @submit.prevent="enter">
          <fieldset class="role-cards">
            <legend class="sr-only">Demo rolünüzü seçin</legend>
            <label
              v-for="(r, key) in roles"
              :key="key"
              class="role-card"
              :class="{ selected: selected === key }"
              ><input v-model="selected" type="radio" name="role" :value="key" /><span
                class="role-icon"
                ><Icon :name="r.icon" :size="23" /></span
              ><span class="role-copy"
                ><strong>{{ r.label }}</strong
                ><small>{{ r.description }}</small></span
              ><span class="radio-indicator"><span></span></span
            ></label>
          </fieldset>
          <button class="btn btn-primary login-submit" type="submit">
            Demoyu keşfet<Icon name="ArrowRight" :size="19" />
          </button>
        </form>
        <p class="login-footnote">
          <Icon name="ShieldCheck" :size="16" />Hesap oluşturmanız gerekmez. Tüm veriler örnektir.
        </p>
      </div>
      <div class="login-copyright">
        © {{ new Date().getFullYear() }} Kampüs. Öğrenmenin her adımında.
      </div>
    </section>
  </main>
</template>
