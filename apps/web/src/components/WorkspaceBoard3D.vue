<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import type { Task, WorkspaceAgent } from '../store/workspace'

const props = defineProps<{
  agents: WorkspaceAgent[]
  unassigned: Task[]
}>()

const emit = defineEmits<{
  selectAgent: [agent: WorkspaceAgent]
  selectTask: [task: Task]
}>()

const host = ref<HTMLDivElement | null>(null)
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let frame = 0
let resizeObserver: ResizeObserver | null = null
let raycaster: THREE.Raycaster | null = null
let pointer = new THREE.Vector2()
let animationClock = 0
const pickables: THREE.Object3D[] = []
const avatarMeshes = new Map<string, THREE.Mesh[]>()
const avatarGroups = new Map<string, THREE.Group>()

const STATE_COLORS: Record<string, number> = {
  working: 0x38bdf8,
  idle: 0x64748b,
  blocked: 0xf59e0b,
  stalled: 0xef4444,
}

function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  color: number,
  userData?: Record<string, unknown>,
) {
  const geometry = new THREE.BoxGeometry(...size)
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.68,
    metalness: 0.04,
    emissive: color,
    emissiveIntensity: 0.18,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  if (userData) Object.assign(mesh.userData, userData)
  parent.add(mesh)
  return mesh
}

function makeAvatar(state: string) {
  const group = new THREE.Group()
  const bodyColor = STATE_COLORS[state] || STATE_COLORS.idle
  const body = addBox(group, [0.58, 0.85, 0.38], [0, 0.72, 0], bodyColor)
  addBox(group, [0.55, 0.18, 0.28], [0, 1.3, 0], 0xf8fafc)
  const headGeometry = new THREE.SphereGeometry(0.3, 18, 14)
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.7,
    emissive: 0x475569,
    emissiveIntensity: 0.18,
  })
  const head = new THREE.Mesh(headGeometry, headMaterial)
  head.position.set(0, 1.62, 0)
  head.castShadow = true
  group.add(head)
  return { group, meshes: [body, head] }
}

function makeDesk(agent: WorkspaceAgent, index: number) {
  const group = new THREE.Group()
  const angle = (index / Math.max(props.agents.length, 1)) * Math.PI * 2
  const radius = 4.2
  group.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
  group.rotation.y = -angle + Math.PI / 2

  addBox(group, [1.8, 0.12, 0.9], [0, 0.9, 0], 0x334155)
  addBox(group, [0.12, 0.9, 0.12], [-0.72, 0.45, -0.3], 0x1e293b)
  addBox(group, [0.12, 0.9, 0.12], [0.72, 0.45, -0.3], 0x1e293b)
  addBox(group, [0.72, 0.48, 0.08], [0, 1.28, -0.15], 0x0f172a)

  const avatar = makeAvatar(agent.state)
  avatar.group.position.set(0, 0, 0.65)
  avatar.group.userData.baseY = 0
  avatar.group.userData.agentId = agent.id
  for (const mesh of avatar.meshes) mesh.userData.agentId = agent.id
  group.add(avatar.group)
  avatarMeshes.set(agent.id, avatar.meshes)
  avatarGroups.set(agent.id, avatar.group)

  const badge = addBox(group, [1.15, 0.08, 0.18], [0, 1.66, -0.15], STATE_COLORS[agent.state] || STATE_COLORS.idle, { agentId: agent.id })
  badge.castShadow = false
  pickables.push(badge, ...avatar.meshes)
  scene?.add(group)
}

function makeTaskQueue() {
  const count = Math.min(props.unassigned.length, 8)
  for (let i = 0; i < count; i += 1) {
    const x = -1.2 + (i % 4) * 0.8
    const z = 6.1 + Math.floor(i / 4) * 0.55
    const task = props.unassigned[i]
    const card = addBox(scene!, [0.62, 0.38, 0.05], [x, 0.25, z], 0xf59e0b, { taskId: task.id })
    card.rotation.x = -0.18
    pickables.push(card)
  }
}

function rebuildScene() {
  if (!scene) return
  pickables.length = 0
  avatarMeshes.clear()
  avatarGroups.clear()
  for (const child of Array.from(scene.children)) {
    if (child.userData.static) continue
    scene.remove(child)
    child.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose?.()
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose())
      else mesh.material?.dispose?.()
    })
  }
  props.agents.forEach((agent, index) => makeDesk(agent, index))
  makeTaskQueue()
}

function resize() {
  if (!host.value || !renderer || !camera) return
  const width = host.value.clientWidth
  const height = host.value.clientHeight
  renderer.setSize(width, height, false)
  camera.aspect = width / Math.max(height, 1)
  camera.updateProjectionMatrix()
}

function onPointerDown(event: PointerEvent) {
  if (!host.value || !renderer || !camera || !raycaster) return
  const rect = host.value.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects(pickables, false)
  const hit = hits[0]?.object
  if (!hit) return
  if (hit.userData.agentId) {
    const agent = props.agents.find((item) => item.id === hit.userData.agentId)
    if (agent) emit('selectAgent', agent)
  }
  if (hit.userData.taskId) {
    const task = props.unassigned.find((item) => item.id === hit.userData.taskId)
    if (task) emit('selectTask', task)
  }
}

function animate() {
  frame = requestAnimationFrame(animate)
  animationClock += 0.016
  for (const [agentId, group] of avatarGroups) {
    const agent = props.agents.find((item) => item.id === agentId)
    const offset = agent?.state === 'working' ? Math.sin(animationClock * 5) * 0.025 : agent?.state === 'idle' ? Math.sin(animationClock * 1.4) * 0.008 : 0
    const baseY = Number(group.userData.baseY || 0)
    group.position.y += (baseY + offset - group.position.y) * 0.16
  }
  renderer?.render(scene!, camera!)
}

onMounted(() => {
  if (!host.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x09090b)
  scene.fog = new THREE.Fog(0x09090b, 10, 22)
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 7.8, 11.2)
  camera.lookAt(0, 0.5, 0)
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.domElement.className = 'absolute inset-0 h-full w-full'
  host.value.appendChild(renderer.domElement)
  raycaster = new THREE.Raycaster()

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x172033, roughness: 0.9 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  floor.userData.static = true
  scene.add(floor)

  const grid = new THREE.GridHelper(24, 24, 0x334155, 0x263247)
  grid.position.y = 0.01
  grid.userData.static = true
  scene.add(grid)
  scene.add(new THREE.AmbientLight(0xb8c7dc, 1.1))
  scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x172033, 2.1))
  const key = new THREE.DirectionalLight(0xffffff, 3.2)
  key.position.set(5, 10, 5)
  key.castShadow = true
  scene.add(key)

  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host.value)
  host.value.addEventListener('pointerdown', onPointerDown)
  rebuildScene()
  resize()
  animate()
})

watch(() => [props.agents.map((agent) => `${agent.id}:${agent.state}`).join(','), props.unassigned.map((task) => task.id).join(',')], rebuildScene)

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  host.value?.removeEventListener('pointerdown', onPointerDown)
  renderer?.dispose()
})
</script>

<template>
  <div
    ref="host"
    class="relative h-[540px] w-full overflow-hidden rounded-lg border border-border bg-base"
    aria-label="Workspace 3D board"
  >
    <div class="pointer-events-none absolute left-4 top-4 z-10 rounded-md border border-border bg-panel/90 px-3 py-2 text-xs text-textMuted backdrop-blur">
      <div class="mb-1 font-medium text-textMain">Agent 工作间</div>
      <div class="flex flex-wrap gap-3">
        <span><i class="mr-1 inline-block h-2 w-2 rounded-full bg-sky-400" />工作中</span>
        <span><i class="mr-1 inline-block h-2 w-2 rounded-full bg-slate-500" />空闲</span>
        <span><i class="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />阻塞</span>
        <span><i class="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />停滞</span>
      </div>
    </div>
    <div class="pointer-events-none absolute bottom-4 right-4 z-10 rounded-md border border-border bg-panel/90 px-3 py-2 text-xs text-textMuted backdrop-blur">
      待分配任务 {{ unassigned.length }}
    </div>
  </div>
</template>
