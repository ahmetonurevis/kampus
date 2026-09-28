import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'
import { logError, notify } from './stores/demo.js'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/inter/latin-ext-400.css'
import '@fontsource/inter/latin-ext-500.css'
import '@fontsource/inter/latin-ext-600.css'
import '@fontsource/inter/latin-ext-700.css'
import './styles.css'
import './styles/presentation.css'

const app = createApp(App)
app.config.errorHandler = (error, instance, info) => {
  logError(error, info)
  notify('Bir hata oluştu. Lütfen sayfayı yenileyip tekrar deneyin.', 'error')
}
app.use(router).mount('#app')
