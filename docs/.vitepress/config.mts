import { defineConfig } from 'vitepress'

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
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '快速开始', link: '/guide/quick-start' },
      { text: '示例项目', link: '/examples/' },
      { text: 'API', link: '/api' },
      { text: 'CLI', link: '/cli' }
    ],
    sidebar: [
      {
        text: '指南',
        items: [
          { text: '项目介绍', link: '/' },
          { text: '快速开始', link: '/guide/quick-start' },
          { text: '部署流程', link: '/guide/deploy-flow' },
          { text: '源码开发', link: '/guide/source-dev' }
        ]
      },
      {
        text: '示例',
        items: [
          { text: '示例总览', link: '/examples/' },
          { text: '前端项目', link: '/examples/frontend' },
          { text: '后端项目', link: '/examples/backend' },
          { text: 'SSR 项目', link: '/examples/ssr' }
        ]
      },
      {
        text: '参考',
        items: [
          { text: 'API 文档', link: '/api' },
          { text: 'CLI 文档', link: '/cli' },
          { text: '技术方案', link: '/spec' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ATQQ/Kite' }
    ]
  }
})
