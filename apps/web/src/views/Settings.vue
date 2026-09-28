<script setup>
import { computed, reactive, ref } from 'vue'
import { state, role, currentStudent, theme, action, resetDemo } from '../stores/demo.js'
import { roles } from '../modules/navigation.js'
import { dateLabel } from '../lib/format.js'
import PageHeading from '../components/PageHeading.vue'
import DataTable from '../components/DataTable.vue'
import Avatar from '../components/Avatar.vue'
import Badge from '../components/Badge.vue'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import LineTabs from '../components/LineTabs.vue'
const showReset = ref(false),
  tab = ref('general')
const preferenceKey = computed(() => `${role.value}-${currentStudent.value.id}`)
const preferences = reactive({
  email: true,
  sms: true,
  push: false,
  homework: true,
  finance: true,
  announcements: true,
  appointments: true,
  ...(state.preferences[preferenceKey.value] || {}),
})
const modules = [
  {
    key: 'crm',
    title: 'Kayıt & CRM',
    description: 'Aday takibi, kampüs görüşmeleri ve kesin kayıt.',
    icon: 'ContactRound',
  },
  {
    key: 'academic',
    title: 'Akademik yönetim',
    description: 'Sınıflar, yoklama, ders programları ve başarı analizleri.',
    icon: 'GraduationCap',
  },
  {
    key: 'learning',
    title: 'Dijital öğrenme',
    description: 'Ödevler, videolar, quizler ve soru-cevap.',
    icon: 'BookOpen',
  },
  {
    key: 'finance',
    title: 'Finans & Tahsilat',
    description: 'Taksit planları, ödemeler, dekont ve sözleşmeler.',
    icon: 'Wallet',
  },
  {
    key: 'communication',
    title: 'İletişim & Portallar',
    description: 'Mesajlaşma, randevular, duyurular ve talepler.',
    icon: 'MessagesSquare',
  },
]
const users = computed(() =>
  Object.entries(roles).map(([key, r]) => ({
    id: key,
    name: r.name,
    role: r.label,
    permission:
      key === 'yonetici' ? 'admin' : ['ogretmen', 'onburo'].includes(key) ? 'editor' : 'viewer',
    status: 'Aktif',
  })),
)
function toggleModule(module) {
  action(
    () => {
      state.modules[module.key] = !state.modules[module.key]
    },
    `${module.title} modülü ${state.modules[module.key] ? 'kapatıldı' : 'açıldı'}.`,
  )
}
function savePreferences() {
  action(() => {
    state.preferences[preferenceKey.value] = { ...preferences }
  }, 'Bildirim tercihleriniz kaydedildi.')
}
</script>
<template>
  <PageHeading /><template v-if="role === 'yonetici'"
    ><LineTabs
      v-model="tab"
      label="Kurum ayarları"
      :options="[
        { value: 'general', label: 'Kurum & Modüller' },
        { value: 'users', label: 'Kullanıcı & Yetkiler' },
        { value: 'activity', label: 'İşlem Geçmişi' },
      ]"
    />
    <template v-if="tab === 'general'"
      ><section class="panel institution-settings">
        <span class="institution-logo"><Icon name="GraduationCap" :size="36" /></span>
        <div>
          <h2>Akademi Özel Okulları</h2>
          <p>
            {{ state.branches.filter((b) => b.isActive).length }} kampüs ·
            {{ state.students.filter((s) => s.isActive).length }} öğrenci ·
            {{ state.teachers.filter((t) => t.isActive).length }} öğretmen
          </p>
        </div>
        <Badge text="Demo çalışma alanı" />
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Modül yönetimi</h2>
            <p>Kapalı modüller menülerden kaldırılır ve doğrudan bağlantı ile açılamaz.</p>
          </div>
        </div>
        <div class="settings-rows">
          <div v-for="module in modules" :key="module.key" class="settings-row">
            <span class="mini-icon lavender"><Icon :name="module.icon" :size="23" /></span>
            <div>
              <strong>{{ module.title }}</strong>
              <p>{{ module.description }}</p>
            </div>
            <button
              class="switch"
              :class="{ on: state.modules[module.key] }"
              role="switch"
              :aria-checked="state.modules[module.key]"
              :aria-label="module.title"
              @click="toggleModule(module)"
            >
              <span></span>
            </button>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Demo verilerini sıfırla</h2>
            <p>Bu tarayıcıdaki tüm demo değişikliklerini kaldırıp başlangıç verilerine dönün.</p>
          </div>
          <button class="btn btn-danger" @click="showReset = true">
            <Icon name="RefreshCw" :size="17" />Demoyu sıfırla
          </button>
        </div>
      </section></template
    >
    <section v-else-if="tab === 'users'" class="panel">
      <div class="panel-heading">
        <div>
          <h2>Kullanıcı ve rol listesi</h2>
          <p>Demo hesapları ve örnek yetki eşlemesi. Gerçek kimlik doğrulama kullanılmaz.</p>
        </div>
        <Badge text="Statik demo listesi" tone="gray" />
      </div>
      <DataTable
        list-key="settings-datatable-1"
        :rows="users"
        :columns="[
          { key: 'name', label: 'Kullanıcı' },
          { key: 'role', label: 'Panel rolü' },
          { key: 'permission', label: 'Yetki grubu' },
          { key: 'status', label: 'Durum' },
        ]"
        ><template #name="{ row }"
          ><div class="person-cell">
            <Avatar :name="row.name" /><strong>{{ row.name }}</strong>
          </div></template
        ><template #status="{ value }"><Badge :text="value" /></template
      ></DataTable>
    </section>
    <section v-else class="panel">
      <div class="panel-heading"><h2>Demo işlem geçmişi</h2></div>
      <DataTable
        list-key="settings-datatable-2"
        :rows="state.audit"
        :columns="[
          { key: 'action', label: 'İşlem' },
          { key: 'actor', label: 'Rol' },
          { key: 'date', label: 'Tarih' },
        ]"
        empty="Bu oturumda henüz işlem yapılmadı."
        ><template #actor="{ value }">{{ roles[value]?.label || value }}</template
        ><template #date="{ value }">{{
          dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
        }}</template></DataTable
      >
    </section></template
  >
  <template v-else
    ><section class="panel">
      <div class="panel-heading">
        <div>
          <h2>Bildirim kanalları</h2>
          <p>Hangi kanaldan haberdar olmak istersiniz?</p>
        </div>
      </div>
      <div class="settings-rows">
        <div
          v-for="(label, key) in {
            email: 'E-posta bildirimleri',
            sms: 'SMS bildirimleri',
            push: 'Uygulama bildirimleri',
          }"
          :key="key"
          class="settings-row"
        >
          <span class="mini-icon lavender"
            ><Icon :name="key === 'email' ? 'Mail' : key === 'sms' ? 'Phone' : 'Bell'"
          /></span>
          <div>
            <strong>{{ label }}</strong>
            <p>Demo tercihi kaydedilir; gerçek mesaj veya bildirim gönderilmez.</p>
          </div>
          <button
            class="switch"
            :class="{ on: preferences[key] }"
            role="switch"
            :aria-checked="preferences[key]"
            :aria-label="label"
            @click="preferences[key] = !preferences[key]"
          >
            <span></span>
          </button>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-heading">
        <div>
          <h2>Bildirim konuları</h2>
          <p>Size ulaşacak bilgileri kişiselleştirin.</p>
        </div>
      </div>
      <div class="settings-rows">
        <div
          v-for="(label, key) in {
            homework: 'Ödev ve sınav hatırlatmaları',
            finance: 'Ödeme ve taksit hatırlatmaları',
            announcements: 'Kurum duyuruları',
            appointments: 'Randevu güncellemeleri',
          }"
          :key="key"
          class="settings-row"
        >
          <div>
            <strong>{{ label }}</strong>
          </div>
          <button
            class="switch"
            :class="{ on: preferences[key] }"
            role="switch"
            :aria-checked="preferences[key]"
            :aria-label="label"
            @click="preferences[key] = !preferences[key]"
          >
            <span></span>
          </button>
        </div>
      </div>
      <div class="settings-footer">
        <button class="btn btn-primary" @click="savePreferences">
          <Icon name="Check" :size="17" />Tercihleri kaydet
        </button>
      </div>
    </section></template
  >
  <section class="panel">
    <div class="panel-heading">
      <div>
        <h2>Görünüm</h2>
        <p>Size en uygun çalışma ortamını seçin.</p>
      </div>
      <div class="theme-buttons">
        <button class="btn" :class="{ 'btn-primary': theme === 'light' }" @click="theme = 'light'">
          <Icon name="Sun" :size="17" />Açık</button
        ><button class="btn" :class="{ 'btn-primary': theme === 'dark' }" @click="theme = 'dark'">
          <Icon name="Moon" :size="17" />Koyu
        </button>
      </div>
    </div>
  </section>
  <Modal v-if="showReset" title="Demo verileri sıfırlansın mı?" @close="showReset = false"
    ><p>
      Eklediğiniz adaylar, öğrenciler, notlar, ödemeler, ödevler, mesajlar ve diğer demo
      değişiklikleri bu tarayıcıdan kaldırılacak. Başlangıçtaki örnek veriler yeniden oluşturulacak.
    </p>
    <div class="modal-actions">
      <button class="btn" @click="showReset = false">Vazgeç</button
      ><button
        class="btn btn-danger"
        @click="
          () => {
            resetDemo()
            showReset = false
          }
        "
      >
        Evet, demoyu sıfırla
      </button>
    </div></Modal
  >
</template>
