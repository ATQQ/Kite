import { createRouter, createWebHistory } from 'vue-router'
import { useProjectStore } from '../store/project'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/',
    component: () => import('../layouts/DefaultLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: () => import('../views/Dashboard.vue')
      },
      {
        path: 'projects',
        name: 'ProjectList',
        component: () => import('../views/ProjectList.vue')
      },
      {
        path: 'projects/:id/files',
        name: 'ProjectFiles',
        component: () => import('../views/FileExplorer.vue')
      },
      {
        path: 'projects/:id',
        name: 'ProjectDetail',
        component: () => import('../views/ProjectDetail.vue')
      },
      {
        path: 'logs',
        name: 'LogBoard',
        component: () => import('../views/LogBoard.vue')
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('../views/Settings.vue')
      },
      {
        path: 'migration',
        name: 'Migration',
        component: () => import('../views/Migration.vue')
      }
    ]
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, _from, next) => {
  const projectStore = useProjectStore()
  if (to.meta.requiresAuth && !projectStore.adminToken) {
    next('/login')
  } else if (to.path === '/login' && projectStore.adminToken) {
    next('/')
  } else {
    next()
  }
})