import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import HomeStats from './components/HomeStats.vue'
import StatsPanel from './components/StatsPanel.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HomeStats', HomeStats)
    app.component('StatsPanel', StatsPanel)
  }
} satisfies Theme
