<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useI18n } from 'vue-i18n'
import type { Task, WorkspaceAgent } from '../store/workspace'

const props = defineProps<{
  agents: WorkspaceAgent[]
  tasks: Task[]
  unassigned: Task[]
}>()

const emit = defineEmits<{
  selectAgent: [agent: WorkspaceAgent]
  selectTask: [task: Task]
}>()

const { t, locale } = useI18n()

const host = ref<HTMLDivElement | null>(null)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let resizeObserver: ResizeObserver | null = null
let raycaster: THREE.Raycaster | null = null
let frame = 0
let animationClock = 0
const pointer = new THREE.Vector2()
let pointerStart: { x: number; y: number } | null = null
const pickables: THREE.Object3D[] = []
const avatarGroups = new Map<string, THREE.Group>()

const cameraHome = new THREE.Vector3(0, 5.6, 12.4)
const cameraTarget = new THREE.Vector3(0, 1.15, 0)
let framedAspect = 0
let currentNarrow: boolean | null = null
let sceneHalfWidth = 5.1

const SCREEN_WIDTH = 512
const SCREEN_HEIGHT = 288
const ACTIVE_STATUSES = new Set(['claimed', 'in_progress', 'blocked', 'review'])

const STATE_COLORS: Record<string, number> = {
  working: 0x38bdf8,
  idle: 0x64748b,
  blocked: 0xf59e0b,
  stalled: 0xef4444,
}

const STATE_HEX: Record<string, string> = {
  working: '#38bdf8',
  idle: '#64748b',
  blocked: '#f59e0b',
  stalled: '#ef4444',
}

const TASK_STATUS_LABEL: Record<string, string> = {
  todo: 'workspace.taskTodo',
  claimed: 'workspace.taskClaimed',
  in_progress: 'workspace.statusInProgress',
  blocked: 'workspace.statusBlocked',
  review: 'workspace.taskReview',
  done: 'workspace.statusDone',
  cancelled: 'workspace.statusCancelled',
}

function stateLabel(state: string) {
  return t(`workspace.${STATE_HEX[state] ? state : 'idle'}`)
}

function taskStatusLabel(status: string) {
  const key = TASK_STATUS_LABEL[status]
  return key ? t(key) : status
}

function currentTaskFor(agent: WorkspaceAgent) {
  const own = props.tasks.filter((task) => task.claimedAgentId === agent.id && ACTIVE_STATUSES.has(task.status))
  if (own.length) {
    return own.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  }
  return props.tasks.find((task) => agent.openTaskIds.includes(task.id)) || null
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
    emissiveIntensity: 0.16,
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
  const body = addBox(group, [0.46, 0.72, 0.32], [0, 0.62, 0], bodyColor)
  addBox(group, [0.44, 0.16, 0.24], [0, 1.12, 0], 0xf8fafc)
  const headGeometry = new THREE.SphereGeometry(0.25, 18, 14)
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xdbe4f0,
    roughness: 0.55,
    emissive: 0x93a3ba,
    emissiveIntensity: 0.35,
  })
  const head = new THREE.Mesh(headGeometry, headMaterial)
  head.position.set(0, 1.38, 0)
  head.castShadow = true
  group.add(head)
  return { group, meshes: [body, head] }
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, height / 2, width / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
  ctx.fill()
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = []
  let current = ''
  const tokens = text.split(/(\s+)/).filter((token) => token.length > 0)
  for (const token of tokens) {
    if (lines.length >= maxLines) break
    const candidate = current + token
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate
      continue
    }
    if (current.trim()) {
      lines.push(current.trim())
      current = ''
      if (lines.length >= maxLines) break
    }
    if (ctx.measureText(token).width <= maxWidth) {
      current = token.trimStart()
      continue
    }
    let chunk = ''
    for (const char of token) {
      if (chunk && ctx.measureText(chunk + char).width > maxWidth) {
        lines.push(chunk)
        chunk = char
        if (lines.length >= maxLines) break
      } else {
        chunk += char
      }
    }
    current = chunk
  }
  if (lines.length < maxLines && current.trim()) lines.push(current.trim())
  return lines.slice(0, maxLines)
}

function drawScreen(ctx: CanvasRenderingContext2D, agent: WorkspaceAgent, task: Task | null) {
  const hex = STATE_HEX[agent.state] || STATE_HEX.idle
  ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT)

  const background = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT)
  background.addColorStop(0, '#111c30')
  background.addColorStop(1, '#0a111d')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT)

  ctx.fillStyle = hex
  ctx.fillRect(0, 0, SCREEN_WIDTH, 10)

  ctx.textAlign = 'left'
  ctx.fillStyle = hex
  ctx.font = '700 22px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillText(stateLabel(agent.state).toUpperCase(), 30, 62)

  ctx.fillStyle = '#e8eef7'
  ctx.font = '700 36px ui-sans-serif, system-ui, -apple-system, sans-serif'
  const name = agent.displayName || agent.provider
  ctx.fillText(wrapLines(ctx, name, SCREEN_WIDTH - 60, 1)[0] || name, 30, 108)

  ctx.strokeStyle = 'rgba(148,163,184,0.22)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(30, 126)
  ctx.lineTo(SCREEN_WIDTH - 30, 126)
  ctx.stroke()

  if (task) {
    ctx.fillStyle = '#7f8ea3'
    ctx.font = '600 19px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText(taskStatusLabel(task.status).toUpperCase(), 30, 156)

    ctx.fillStyle = '#dbe4f0'
    ctx.font = '600 25px ui-sans-serif, system-ui, -apple-system, sans-serif'
    wrapLines(ctx, task.title, SCREEN_WIDTH - 60, 2).forEach((line, index) => {
      ctx.fillText(line, 30, 190 + index * 29)
    })

    const progress = Math.max(0, Math.min(100, Number(task.progress) || 0))
    ctx.textAlign = 'right'
    ctx.fillStyle = '#93a3ba'
    ctx.font = '700 20px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText(`${Math.round(progress)}%`, SCREEN_WIDTH - 30, 238)
    ctx.textAlign = 'left'

    const barWidth = SCREEN_WIDTH - 60
    ctx.fillStyle = 'rgba(148,163,184,0.22)'
    fillRoundRect(ctx, 30, 250, barWidth, 12, 6)
    if (progress > 0) {
      ctx.fillStyle = hex
      fillRoundRect(ctx, 30, 250, Math.max(12, (barWidth * progress) / 100), 12, 6)
    }
  } else {
    ctx.fillStyle = '#5b6b82'
    ctx.font = '500 27px ui-sans-serif, system-ui, -apple-system, sans-serif'
    ctx.fillText(t('workspace.noActiveTask'), 30, 200)
  }
}

function makeMonitor(agent: WorkspaceAgent, task: Task | null) {
  const group = new THREE.Group()
  const canvas = document.createElement('canvas')
  canvas.width = SCREEN_WIDTH
  canvas.height = SCREEN_HEIGHT
  const ctx = canvas.getContext('2d')
  if (ctx) drawScreen(ctx, agent, task)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  const screenWidth = 1.15
  const screenHeight = 0.65
  const base = addBox(group, [0.5, 0.05, 0.28], [0, 0.03, 0.02], 0x1f2937, { agentId: agent.id })
  base.castShadow = false
  addBox(group, [0.08, 0.34, 0.08], [0, 0.22, 0], 0x111827, { agentId: agent.id })
  const bezel = addBox(group, [screenWidth + 0.06, screenHeight + 0.06, 0.05], [0, 0.63, -0.01], 0x0b1120, {
    agentId: agent.id,
  })
  bezel.castShadow = false

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(screenWidth, screenHeight),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  )
  screen.position.set(0, 0.63, 0.021)
  screen.userData.agentId = agent.id
  group.add(screen)

  pickables.push(base, bezel, screen)
  return group
}

function deskLayout(total: number): Array<[number, number]> {
  if (total <= 0) return []
  if (total === 1) return [[0, 3.2]]
  if (currentNarrow) {
    const perRow = Math.ceil(total / 2)
    const spanX = Math.min(2.5, Math.max(0.9, 0.85 * perRow))
    return Array.from({ length: total }, (_, index) => {
      const row = Math.floor(index / perRow)
      const column = index % perRow
      const count = Math.min(perRow, total - row * perRow)
      const t0 = count > 1 ? (column / (count - 1)) * 2 - 1 : 0
      return [t0 * spanX, row === 0 ? 3.7 : 1.3] as [number, number]
    })
  }
  const spanX = Math.min(4.1, Math.max(1.4, 0.68 * total))
  return Array.from({ length: total }, (_, index) => {
    const t0 = (index / (total - 1)) * 2 - 1
    return [t0 * spanX, 3.2 - t0 * t0 * 1.4] as [number, number]
  })
}

function makeDesk(agent: WorkspaceAgent, position: [number, number], task: Task | null) {
  const group = new THREE.Group()
  const [x, z] = position
  group.position.set(x, 0, z)
  group.rotation.y = Math.atan2(cameraHome.x - x, cameraHome.z - z)

  const top = addBox(group, [1.5, 0.12, 0.82], [0, 0.9, 0], 0x334155, { agentId: agent.id })
  addBox(group, [0.09, 0.86, 0.09], [-0.6, 0.44, -0.28], 0x1e293b)
  addBox(group, [0.09, 0.86, 0.09], [0.6, 0.44, -0.28], 0x1e293b)
  addBox(group, [0.09, 0.86, 0.09], [-0.6, 0.44, 0.28], 0x1e293b)
  addBox(group, [0.09, 0.86, 0.09], [0.6, 0.44, 0.28], 0x1e293b)

  const strip = addBox(
    group,
    [1.44, 0.06, 0.06],
    [0, 0.96, 0.41],
    STATE_COLORS[agent.state] || STATE_COLORS.idle,
    { agentId: agent.id },
  )
  strip.castShadow = false

  const monitor = makeMonitor(agent, task)
  monitor.position.set(-0.22, 0.96, -0.12)
  group.add(monitor)

  const avatar = makeAvatar(agent.state)
  avatar.group.position.set(0.52, 0, 0.05)
  avatar.group.userData.baseY = 0
  avatar.group.userData.agentId = agent.id
  for (const mesh of avatar.meshes) mesh.userData.agentId = agent.id
  group.add(avatar.group)
  avatarGroups.set(agent.id, avatar.group)

  pickables.push(top, ...avatar.meshes)
  scene?.add(group)
}

function makeTaskQueue() {
  const count = Math.min(props.unassigned.length, 6)
  const spacing = 0.66
  const startX = -((count - 1) * spacing) / 2
  const tray = addBox(scene!, [Math.max(1.05, count * spacing + 0.3), 0.06, 0.72], [0, 0.03, 5.2], 0x1e293b)
  tray.castShadow = false
  for (let i = 0; i < count; i += 1) {
    const task = props.unassigned[i]
    const card = addBox(scene!, [0.56, 0.4, 0.05], [startX + i * spacing, 0.26, 5.2], 0xf59e0b, {
      taskId: task.id,
    })
    card.rotation.x = -0.24
    pickables.push(card)
  }
}

function disposeMaterial(material: THREE.Material) {
  const mapped = material as THREE.Material & { map?: THREE.Texture | null }
  mapped.map?.dispose()
  material.dispose()
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    mesh.geometry?.dispose?.()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach(disposeMaterial)
    else if (material) disposeMaterial(material)
  })
}

function rebuildScene() {
  if (!scene) return
  pickables.length = 0
  avatarGroups.clear()
  for (const child of Array.from(scene.children)) {
    if (child.userData.static) continue
    scene.remove(child)
    disposeObject(child)
  }
  const layout = deskLayout(props.agents.length)
  // +1 覆盖工位自身半宽与边缘留白
  sceneHalfWidth = layout.reduce((max, [x]) => Math.max(max, Math.abs(x)), 0) + 1
  props.agents.forEach((agent, index) => makeDesk(agent, layout[index] || [0, 3.2], currentTaskFor(agent)))
  makeTaskQueue()
}

function isNarrow() {
  if (!host.value) return false
  return host.value.clientWidth / Math.max(host.value.clientHeight, 1) < 1.15
}

function resize() {
  if (!host.value || !renderer || !camera) return
  const width = host.value.clientWidth
  const height = host.value.clientHeight
  renderer.setSize(width, height, false)
  camera.aspect = width / Math.max(height, 1)
  camera.updateProjectionMatrix()
  const narrow = isNarrow()
  if (narrow !== currentNarrow) {
    currentNarrow = narrow
    framedAspect = 0
    rebuildScene()
  }
  frameCamera()
}

function frameCamera() {
  if (!host.value || !camera || !controls) return
  const aspect = host.value.clientWidth / Math.max(host.value.clientHeight, 1)
  if (framedAspect && Math.abs(aspect - framedAspect) / framedAspect < 0.12) return
  framedAspect = aspect
  const tanHalfHorizontal = Math.tan((camera.fov * Math.PI) / 360) * Math.max(aspect, 0.4)
  // 1.55 是把场景半宽换算成相机距离的经验系数（含俯视投影带来的余量）
  const required = (1.55 * sceneHalfWidth) / Math.max(tanHalfHorizontal, 0.15)
  const scaled = Math.min(28, Math.max(9, required))
  const direction = cameraHome.clone().sub(cameraTarget).normalize()
  camera.position.copy(cameraTarget).addScaledVector(direction, scaled)
  controls.update()
}

function pick(event: MouseEvent) {
  if (!host.value || !camera || !raycaster) return null
  const rect = host.value.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  return raycaster.intersectObjects(pickables, false)[0]?.object || null
}

function onPointerDown(event: PointerEvent) {
  pointerStart = { x: event.clientX, y: event.clientY }
}

function onPointerMove(event: PointerEvent) {
  if (!host.value) return
  host.value.style.cursor = pick(event) ? 'pointer' : 'grab'
}

function onClick(event: MouseEvent) {
  if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) return
  pointerStart = null
  const hit = pick(event)
  if (!hit) return
  if (hit.userData.taskId) {
    const task = props.unassigned.find((item) => item.id === hit.userData.taskId)
    if (task) emit('selectTask', task)
    return
  }
  if (hit.userData.agentId) {
    const agent = props.agents.find((item) => item.id === hit.userData.agentId)
    if (agent) emit('selectAgent', agent)
  }
}

function animate() {
  frame = requestAnimationFrame(animate)
  animationClock += 0.016
  for (const [agentId, group] of avatarGroups) {
    const agent = props.agents.find((item) => item.id === agentId)
    const offset =
      agent?.state === 'working'
        ? Math.sin(animationClock * 5) * 0.025
        : agent?.state === 'idle'
          ? Math.sin(animationClock * 1.4) * 0.008
          : 0
    const baseY = Number(group.userData.baseY || 0)
    group.position.y += (baseY + offset - group.position.y) * 0.16
  }
  controls?.update()
  renderer?.render(scene!, camera!)
}

onMounted(() => {
  if (!host.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x09090b)
  scene.fog = new THREE.Fog(0x09090b, 11, 24)
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.copy(cameraHome)
  camera.lookAt(cameraTarget)
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.domElement.className = 'absolute inset-0 h-full w-full'
  renderer.domElement.style.cursor = 'grab'
  host.value.appendChild(renderer.domElement)
  raycaster = new THREE.Raycaster()

  controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(cameraTarget)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = 6
  controls.maxDistance = 30
  controls.minPolarAngle = 0.35
  controls.maxPolarAngle = 1.32
  controls.rotateSpeed = 0.6
  controls.zoomSpeed = 0.8
  controls.update()

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
  host.value.addEventListener('pointermove', onPointerMove)
  host.value.addEventListener('click', onClick)
  rebuildScene()
  resize()
  animate()
})

watch(
  () => [
    props.agents.map((agent) => `${agent.id}:${agent.state}:${agent.displayName}`).join(','),
    props.tasks
      .map((task) => `${task.id}:${task.status}:${task.progress ?? ''}:${task.claimedAgentId ?? ''}:${task.title}`)
      .join(','),
    props.unassigned.map((task) => task.id).join(','),
    locale.value,
  ],
  rebuildScene,
)

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  host.value?.removeEventListener('pointerdown', onPointerDown)
  host.value?.removeEventListener('pointermove', onPointerMove)
  host.value?.removeEventListener('click', onClick)
  controls?.dispose()
  if (scene) {
    for (const child of Array.from(scene.children)) disposeObject(child)
  }
  renderer?.dispose()
})
</script>

<template>
  <div
    ref="host"
    class="relative h-[360px] w-full overflow-hidden rounded-lg border border-border bg-base sm:h-[440px] md:h-[520px]"
    :aria-label="t('workspace.boardTitle')"
  >
    <div
      class="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-panel/90 px-2.5 py-1.5 text-[10px] text-textMuted backdrop-blur sm:left-4 sm:top-4 sm:px-3 sm:py-2 sm:text-xs"
    >
      <div class="mb-1 font-medium text-textMain">{{ t('workspace.boardTitle') }}</div>
      <div class="flex flex-wrap gap-x-3 gap-y-1">
        <span><i class="mr-1 inline-block h-2 w-2 rounded-full bg-sky-400" />{{ t('workspace.working') }}</span>
        <span><i class="mr-1 inline-block h-2 w-2 rounded-full bg-slate-500" />{{ t('workspace.idle') }}</span>
        <span><i class="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />{{ t('workspace.blocked') }}</span>
        <span><i class="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />{{ t('workspace.stalled') }}</span>
      </div>
    </div>
    <div
      class="pointer-events-none absolute bottom-3 right-3 z-10 rounded-md border border-border bg-panel/90 px-2.5 py-1.5 text-[10px] text-textMuted backdrop-blur sm:bottom-4 sm:right-4 sm:px-3 sm:py-2 sm:text-xs"
    >
      {{ t('workspace.pendingPool') }} · {{ unassigned.length }}
    </div>
    <div
      v-if="agents.length === 0"
      class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-xs text-textMuted"
    >
      {{ t('workspace.noAgents') }}
    </div>
  </div>
</template>
