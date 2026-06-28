import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import { useThemeStore } from './store/theme'
import { useLocaleStore } from './store/locale'
import { i18n } from './i18n'
import './style.css'
import App from './App.vue'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(i18n)

useThemeStore(pinia)
useLocaleStore(pinia)

app.mount('#app')
