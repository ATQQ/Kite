import { defineConfig } from 'vitepress'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

export default defineConfig({
  title: 'Kite',
  description: '轻量级 Web / Server / CLI 自动化部署工具',
  lang: 'zh-CN',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]
  ],
  vite: {
    server: {
      port: 5440
    }
  },
  async buildEnd(siteConfig) {
    const outDir = siteConfig.outDir
    await Promise.all([
      rm(join(outDir, 'stats.json'), { force: true }),
      rm(join(outDir, 'stats.csv'), { force: true })
    ])
  },
  themeConfig: {
    logo: '/logo.svg',
    outline: [2,3],
    nav: [
      { text: '快速开始', link: '/guide/quick-start' },
      { text: 'API', link: '/api' },
      { text: 'CLI', link: '/cli' },
      { text: '统计', link: '/stats' },
      { text: '更新日志', link: '/release-notes' }
    ],
    sidebar: [
      {
        text: '指南',
        items: [
          { text: '项目介绍', link: '/' },
          { text: '快速开始', link: '/guide/quick-start' },
          { text: '部署流程', link: '/guide/deploy-flow' },
          { text: '源码开发', link: '/guide/source-dev' },
          { text: '使用统计', link: '/guide/telemetry' },
          { text: '使用统计面板', link: '/stats' }
        ]
      },
      {
        text: '参考',
        items: [
          { text: 'API 文档', link: '/api' },
          { text: 'CLI 文档', link: '/cli' },
          { text: '技术方案', link: '/spec' },
          { text: '更新日志', link: '/release-notes' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ATQQ/Kite' }
    ],
    footer: {
      message: '<a href="/stats">使用统计</a> · <a href="/guide/telemetry">隐私说明</a> · 数据透明，零敏感字段',
      copyright: '© 2026 Kite'
    }
  }
})
