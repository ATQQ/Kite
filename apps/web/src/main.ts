import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import { useThemeStore } from './store/theme'
import './style.css'
import App from './App.vue'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

// Initialize theme before mount
useThemeStore(pinia)

app.mount('#app')