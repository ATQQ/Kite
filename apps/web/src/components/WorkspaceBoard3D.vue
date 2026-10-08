<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useI18n } from 'vue-i18n'
import type { Task, WorkspaceAgent } from '../store/workspace'
import { makeAgentFace } from '../lib/agentFace'

const props = defineProps<{
  agents: WorkspaceAgent[]
  tasks: Task[]
  unassigned: Task[]
  // 首页预览：不画待分配任务池、不 emit 任务选中（首页没有任务上下文）
  compact?: boolean
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
const actors: Actor[] = []
const faceTextures: THREE.Texture[] = []
let keyboardTexture: THREE.Texture | null = null
const monitorTimers: number[] = []

const cameraHome = new THREE.Vector3(0, 6.4, 13.2)
const cameraTarget = new THREE.Vector3(0, 1.0, 0)
let framedAspect = 0
let currentNarrow: boolean | null = null
let sceneHalfWidth = 5.1
let sceneHalfDepth = 4.1
let sceneStaticCenterX = 0

const CUBICLE_W = 2.9
const CUBICLE_D = 2.7
const PANEL_H = 1.25
const COL_W = 3.7
const ROW_D = 4.0
const DESK_H = 0.74
const LOUNGE_W = 6.6

const SCREEN_WIDTH = 512
const SCREEN_HEIGHT = 288
const SCREEN_ROTATE_MS = 4200
const ACTIVE_STATUSES = new Set(['claimed', 'in_progress', 'blocked', 'review'])

// 明亮办公室配色：整体奶白 / 浅灰木，状态色保持饱和以便辨识
const ROOM = {
  background: 0xeef2f7,
  fog: 0xe7edf5,
  floor: 0xf3f6fa,
  floorEdge: 0xdde5ee,
  carpet: 0xe3ebf5,
  panel: 0xfbfcfe,
  panelSide: 0xf1f5fa,
  panelCap: 0xdfe7f0,
  desk: 0xfdfefe,
  deskLeg: 0xc8d2de,
  cabinet: 0xeef2f7,
  chair: 0xd9e2ee,
  monitor: 0xe6ecf4,
  monitorStand: 0xcfd8e4,
  sofa: 0xdfe8f2,
  sofaCushion: 0xeef4fb,
  table: 0xf7fafd,
  counter: 0xf2f6fb,
  machine: 0xdce5ef,
  plantPot: 0xe0b98a,
  plantLeaf: 0x5fbf7a,
  whiteboard: 0xffffff,
  frame: 0xd7e0ea,
  skin: 0xf6d7bd,
  shirt: 0xf8fafc,
  pants: 0x33445c,
  shoe: 0x1f2937,
  hair: 0x3b3446,
  phone: 0x1f2937,
}

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

// 一个 Agent 可能同时推进多个需求，返回全部活跃任务供屏幕轮播
function activeTasksFor(agent: WorkspaceAgent): Task[] {
  const own = props.tasks.filter(
    (task) =>
      ACTIVE_STATUSES.has(task.status) &&
      (task.claimedAgentId === agent.id || (task.assignedProvider && task.assignedProvider === agent.provider)),
  )
  if (own.length) {
    return own.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }
  const fallback = props.tasks.filter(
    (task) => agent.openTaskIds?.includes(task.id) && ACTIVE_STATUSES.has(task.status),
  )
  return fallback
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
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  if (userData) Object.assign(mesh.userData, userData)
  parent.add(mesh)
  return mesh
}

function addGlow(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  color: number,
  userData?: Record<string, unknown>,
) {
  const mesh = addBox(parent, size, position, color, userData)
  const material = mesh.material as THREE.MeshStandardMaterial
  material.emissive = new THREE.Color(color)
  material.emissiveIntensity = 0.85
  material.roughness = 0.35
  mesh.castShadow = false
  return mesh
}

function addCylinder(
  parent: THREE.Object3D,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: [number, number, number],
  color: number,
  radialSegments = 16,
) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.06 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

const HEAD_SIZE = 0.34

function limbPivot(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], color: number) {
  // pivot 在肢体顶端：绕 X 轴旋转即为"摆臂 / 抬腿"
  const pivot = new THREE.Group()
  pivot.position.set(...position)
  addBox(pivot, size, [0, -size[1] / 2, 0], color)
  parent.add(pivot)
  return pivot
}

function makeHead(face: HTMLCanvasElement | null, faceTexture: THREE.Texture | null) {
  const group = new THREE.Group()
  const side = new THREE.MeshStandardMaterial({ color: ROOM.hair, roughness: 0.62 })
  const top = new THREE.MeshStandardMaterial({ color: ROOM.hair, roughness: 0.62 })
  const faceMaterial = new THREE.MeshStandardMaterial({
    map: faceTexture,
    color: 0xffffff,
    roughness: 0.5,
    emissive: 0xffffff,
    emissiveMap: faceTexture || undefined,
    emissiveIntensity: 0.22,
  })
  // BoxGeometry 面序：+X / -X / +Y / -Y / +Z / -Z —— 四个侧面都用 logo 脸
  const materials = [faceMaterial, faceMaterial, top, side, faceMaterial, faceMaterial]
  const head = new THREE.Mesh(new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE * 0.86), materials)
  head.castShadow = true
  group.add(head)
  // 头发只做顶盖：四个侧面都完整露出 logo，不管人物朝向哪边都能被认出
  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(HEAD_SIZE * 1.04, HEAD_SIZE * 0.1, HEAD_SIZE * 0.9),
    new THREE.MeshStandardMaterial({ color: ROOM.hair, roughness: 0.75 }),
  )
  hair.position.set(0, HEAD_SIZE * 0.52, 0)
  group.add(hair)
  void face
  return group
}

function makeKeyboardTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 176
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  if (!ctx) return texture
  ctx.fillStyle = '#cbd5e1'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const rows = 4
  const cols = 14
  const padX = 14
  const padY = 16
  const cellW = (canvas.width - padX * 2) / cols
  const cellH = (canvas.height - padY * 2) / rows
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const w = cellW - 5
      const h = cellH - 5
      const x = padX + col * cellW
      const y = padY + row * cellH
      ctx.fillStyle = row === rows - 1 && col > 3 && col < 10 ? '#94a3b8' : '#e2e8f0'
      fillRoundRect(ctx, x, y, w, h, 4)
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = 1.5
      fillRoundRect(ctx, x, y, w, h, 4)
      ctx.stroke()
    }
  }
  return texture
}

function makeKeyboard(texture: THREE.Texture) {
  const group = new THREE.Group()
  const width = 0.62
  const depth = 0.21
  const body = addBox(group, [width, 0.025, depth], [0, 0.012, 0], 0x475569)
  body.castShadow = false
  const deckMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 })
  deckMaterial.userData.sharedMap = true
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), deckMaterial)
  deck.rotation.x = -Math.PI / 2
  // 不额外翻转：贴图顶部（F 区）落在 -Z 远端，空格键靠近坐在 +Z 的人
  deck.position.y = 0.026
  group.add(deck)
  return group
}

function makeMouse() {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 }),
  )
  body.scale.set(1, 0.42, 1.45)
  body.position.y = 0.024
  body.castShadow = true
  group.add(body)
  addGlow(group, [0.012, 0.006, 0.03], [0, 0.046, -0.02], 0x94a3b8)
  return group
}

interface Person {
  group: THREE.Group
  head: THREE.Group
  torso: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
  meshes: THREE.Object3D[]
}

function makePerson(face: HTMLCanvasElement | null, faceTexture: THREE.Texture | null): Person {
  const group = new THREE.Group()
  const torso = new THREE.Group()
  torso.position.set(0, 0.62, 0)
  const body = addBox(torso, [0.34, 0.46, 0.22], [0, 0, 0], ROOM.shirt)
  const collar = addBox(torso, [0.2, 0.07, 0.2], [0, 0.24, 0.01], ROOM.skin)
  group.add(torso)

  const head = makeHead(face, faceTexture)
  head.position.set(0, 0.34, 0.01)
  torso.add(head)

  const armL = limbPivot(torso, [0.09, 0.42, 0.09], [-0.22, 0.18, 0], ROOM.shirt)
  const armR = limbPivot(torso, [0.09, 0.42, 0.09], [0.22, 0.18, 0], ROOM.shirt)
  addBox(armL, [0.1, 0.09, 0.11], [0, -0.42, 0], ROOM.skin)
  addBox(armR, [0.1, 0.09, 0.11], [0, -0.42, 0], ROOM.skin)

  const legL = limbPivot(group, [0.12, 0.4, 0.13], [-0.1, 0.4, 0], ROOM.pants)
  const legR = limbPivot(group, [0.12, 0.4, 0.13], [0.1, 0.4, 0], ROOM.pants)
  addBox(legL, [0.13, 0.08, 0.2], [0, -0.4, 0.03], ROOM.shoe)
  addBox(legR, [0.13, 0.08, 0.2], [0, -0.4, 0.03], ROOM.shoe)

  const meshes = [body, collar, head, armL, armR, legL, legR]
  return { group, head, torso, armL, armR, legL, legR, meshes }
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

function drawScreen(ctx: CanvasRenderingContext2D, agent: WorkspaceAgent, task: Task | null, tasks: Task[] = []) {
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

    const barWidth = tasks.length > 1 ? SCREEN_WIDTH - 60 - 54 : SCREEN_WIDTH - 60
    ctx.fillStyle = 'rgba(148,163,184,0.22)'
    fillRoundRect(ctx, 30, 250, barWidth, 12, 6)
    if (progress > 0) {
      ctx.fillStyle = hex
      fillRoundRect(ctx, 30, 250, Math.max(12, (barWidth * progress) / 100), 12, 6)
    }

    // 多任务推进时右上角给出"第几个 / 共几个"的轮播角标
    if (tasks.length > 1) {
      const index = Math.max(0, tasks.findIndex((item) => item.id === task.id))
      ctx.textAlign = 'right'
      ctx.fillStyle = hex
      ctx.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.fillText(`${index + 1}/${tasks.length}`, SCREEN_WIDTH - 30, 254)
      ctx.textAlign = 'left'
      const dotRadius = 3.5
      for (let i = 0; i < tasks.length; i += 1) {
        ctx.beginPath()
        ctx.arc(SCREEN_WIDTH - 30 - (tasks.length - 1 - i) * 11, 272, dotRadius, 0, Math.PI * 2)
        ctx.fillStyle = i === index ? hex : 'rgba(148,163,184,0.35)'
        ctx.fill()
      }
    }
  } else {
    ctx.fillStyle = '#5b6b82'
    ctx.font = '500 27px ui-sans-serif, system-ui, -apple-system, sans-serif'
    ctx.fillText(t('workspace.noActiveTask'), 30, 200)
  }
}

function makeMonitor(agent: WorkspaceAgent, tasks: Task[]) {
  const group = new THREE.Group()
  const canvas = document.createElement('canvas')
  canvas.width = SCREEN_WIDTH
  canvas.height = SCREEN_HEIGHT
  const ctx = canvas.getContext('2d')
  let cursor = 0
  const repaint = () => {
    if (!ctx) return
    const current = tasks.length ? tasks[cursor % tasks.length] : null
    drawScreen(ctx, agent, current, tasks)
    texture.needsUpdate = true
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  repaint()

  // 多任务时轮播：不同工位错开起始点，避免整屏同时翻页
  const timer = tasks.length > 1
    ? window.setInterval(() => {
        cursor = (cursor + 1) % tasks.length
        repaint()
      }, SCREEN_ROTATE_MS)
    : 0
  monitorTimers.push(timer)

  const screenWidth = 1.15
  const screenHeight = 0.65
  const base = addBox(group, [0.5, 0.05, 0.28], [0, 0.03, 0.02], ROOM.monitorStand, { agentId: agent.id })
  base.castShadow = false
  addBox(group, [0.08, 0.26, 0.08], [0, 0.17, 0], ROOM.monitorStand, { agentId: agent.id })
  const bezel = addBox(group, [screenWidth + 0.06, screenHeight + 0.06, 0.05], [0, 0.52, -0.01], ROOM.monitor, {
    agentId: agent.id,
  })
  bezel.castShadow = false

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(screenWidth, screenHeight),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  )
  screen.position.set(0, 0.52, 0.021)
  screen.userData.agentId = agent.id
  group.add(screen)

  pickables.push(base, bezel, screen)
  return group
}

function cubicleColumns(total: number) {
  if (total <= 1) return 1
  if (total <= 4) return currentNarrow ? 1 : 2
  if (total <= 6) return currentNarrow ? 2 : 3
  return currentNarrow ? 2 : Math.min(4, Math.ceil(total / 2))
}

function cubicleLayout(total: number): Array<[number, number]> {
  if (total <= 0) return []
  const columns = cubicleColumns(total)
  const rows = Math.ceil(total / columns)
  const countInRow = (row: number) => Math.min(columns, total - row * columns)
  return Array.from({ length: total }, (_, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const count = countInRow(row)
    const x = (column - (count - 1) / 2) * COL_W
    const z = ((rows - 1) / 2 - row) * ROW_D
    return [x, z] as [number, number]
  })
}

// ---------- 行为：人在干什么 ----------

type Activity =
  | 'desk'
  | 'pace'
  | 'sofa'
  | 'coffee'
  | 'phone'
  | 'water'
  | 'arcade'
  | 'pingPong'
  | 'patrol'

// 巡逻仍然占一部分，其余分配到休息区里更有辨识度的活动
const IDLE_ACTIVITIES: Activity[] = [
  'patrol',
  'coffee',
  'arcade',
  'pingPong',
  'sofa',
  'water',
  'phone',
  'patrol',
]

// 每个休息区动作只允许占用有限的实体站位，满员时回到独立工位
const ACTIVITY_CAPACITY: Partial<Record<Activity, number>> = {
  sofa: 3,
  coffee: 1,
  phone: 1,
  water: 1,
  arcade: 1,
  pingPong: 2,
  patrol: 2,
}

const ACTIVITY_TTL_MS = 45_000
const idleActivityCache = new Map<string, { activity: Activity; expiresAt: number }>()

interface Actor {
  agent: WorkspaceAgent
  person: Person
  activity: Activity
  seed: number
  home: THREE.Vector3
  patrol: THREE.Vector3[]
  phase: number
  legPhase: number
  heading: number
  waypoint: number
  wait: number
  pickMeshes: THREE.Mesh[]
  phone?: THREE.Mesh
  cup?: THREE.Object3D
  cupFill?: THREE.Mesh
  waterStream?: THREE.Mesh
  pongSide?: number
  pongBall?: THREE.Mesh
}

function hashSeed(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function activityFor(agent: WorkspaceAgent, activeIds: string[]): Activity {
  idleActivityCache.delete(agent.id)
  if (agent.state === 'working') return 'desk'
  if (agent.state === 'blocked') return 'pace'
  const now = performance.now()
  const activeSet = new Set(activeIds)
  for (const [id, entry] of idleActivityCache.entries()) {
    if (entry.expiresAt <= now || !activeSet.has(id)) idleActivityCache.delete(id)
  }
  const counts = new Map<Activity, number>()
  for (const { activity } of idleActivityCache.values()) {
    counts.set(activity, (counts.get(activity) || 0) + 1)
  }
  if (agent.state === 'stalled' && (counts.get('sofa') || 0) < (ACTIVITY_CAPACITY.sofa || 0)) {
    idleActivityCache.set(agent.id, { activity: 'sofa', expiresAt: now + ACTIVITY_TTL_MS })
    return 'sofa'
  }
  const available = IDLE_ACTIVITIES.filter(
    (activity) => (counts.get(activity) || 0) < (ACTIVITY_CAPACITY[activity] || Number.POSITIVE_INFINITY),
  )
  if (!available.length) return 'desk'
  const minimum = Math.min(...available.map((activity) => counts.get(activity) || 0))
  const candidates = available.filter((activity) => (counts.get(activity) || 0) === minimum)
  const activity = candidates[Math.floor(Math.random() * candidates.length)]
  idleActivityCache.set(agent.id, { activity, expiresAt: now + ACTIVITY_TTL_MS })
  return activity
}

function poseSitting(person: Person) {
  person.torso.position.y = 0.62
  person.legL.rotation.x = -1.4
  person.legR.rotation.x = -1.4
}

function poseStanding(person: Person) {
  person.torso.position.y = 0.62
}

function applyWalk(person: Person, legPhase: number, amount: number) {
  const swing = Math.sin(legPhase) * 0.55 * amount
  person.legL.rotation.x = swing
  person.legR.rotation.x = -swing
  person.armL.rotation.x = -swing * 0.6
  person.armR.rotation.x = swing * 0.6
}

function faceTowards(actor: Actor, target: THREE.Vector3, turnRate = 0.12) {
  const dx = target.x - actor.person.group.position.x
  const dz = target.z - actor.person.group.position.z
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return
  const desired = Math.atan2(dx, dz)
  let delta = desired - actor.heading
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  actor.heading += delta * turnRate
  actor.person.group.rotation.y = actor.heading
}

function makeActor(
  agent: WorkspaceAgent,
  home: THREE.Vector3,
  face: HTMLCanvasElement | null,
  texture: THREE.Texture | null,
  activity: Activity,
) {
  const person = makePerson(face, texture)
  person.group.position.copy(home)
  const actor: Actor = {
    agent,
    person,
    activity,
    seed: hashSeed(agent.id),
    home: home.clone(),
    patrol: [],
    phase: hashSeed(`${agent.id}:phase`) * Math.PI * 2,
    legPhase: hashSeed(`${agent.id}:leg`) * Math.PI * 2,
    heading: 0,
    waypoint: 0,
    wait: 0,
    pickMeshes: [],
  }
  actor.person.group.userData.agentId = agent.id
  // 四肢是 pivot Group，必须递归打标才能被 raycast 命中
  actor.person.group.traverse((node) => {
    node.userData.agentId = agent.id
  })
  for (const root of person.meshes) {
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) actor.pickMeshes.push(node as THREE.Mesh)
    })
  }
  return actor
}

function makePhoneProp() {
  const group = new THREE.Group()
  const body = addBox(group, [0.11, 0.2, 0.02], [0, 0, 0], ROOM.phone)
  body.castShadow = false
  const glow = addGlow(group, [0.095, 0.17, 0.012], [0, 0, 0.012], 0x7dd3fc)
  glow.castShadow = false
  return group
}

function makeCupProp() {
  const group = new THREE.Group()
  addBox(group, [0.09, 0.11, 0.09], [0, 0, 0], 0xfdfefe)
  addGlow(group, [0.075, 0.02, 0.075], [0, 0.055, 0], 0x8b5a2b)
  return group
}

function makePaddleProp() {
  const group = new THREE.Group()
  addBox(group, [0.028, 0.08, 0.028], [0, 0, 0], 0x7c5c3a)
  const blade = addBox(group, [0.13, 0.15, 0.022], [0, -0.1, 0], 0xef4444)
  blade.castShadow = false
  return group
}

function makeWaterCupProp() {
  const group = new THREE.Group()
  addBox(group, [0.09, 0.11, 0.09], [0, 0, 0], 0xf8fbff)
  const fill = addBox(group, [0.07, 0.075, 0.07], [0, -0.008, 0], 0x7dd3fc)
  const material = fill.material as THREE.MeshStandardMaterial
  material.transparent = true
  material.opacity = 0.78
  fill.castShadow = false
  return { group, fill }
}

function makeWaterDispenser(x: number, z: number) {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  addBox(group, [0.52, 1.08, 0.42], [0, 0.54, 0], 0xffffff)
  addBox(group, [0.44, 0.08, 0.36], [0, 0.72, 0.02], 0xe6edf6)
  addBox(group, [0.1, 0.08, 0.16], [0, 0.84, 0.2], 0x64748b)
  addBox(group, [0.3, 0.04, 0.18], [0, 0.66, 0.18], 0xdfe8f2)
  addGlow(group, [0.16, 0.18, 0.02], [0, 0.38, 0.22], 0x38bdf8)

  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.34, 18),
    new THREE.MeshStandardMaterial({
      color: 0x8fd0ff,
      transparent: true,
      opacity: 0.58,
      roughness: 0.16,
      metalness: 0.02,
    }),
  )
  bottle.position.set(0, 1.28, 0)
  bottle.castShadow = true
  group.add(bottle)

  const bottleWater = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.2, 16),
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.5,
      roughness: 0.2,
    }),
  )
  bottleWater.position.set(0, 1.23, 0)
  bottleWater.castShadow = false
  group.add(bottleWater)
  scene?.add(group)
}

function makeArcade(x: number, z: number) {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  addBox(group, [1.0, 1.74, 0.66], [0, 0.87, 0.02], 0xffffff)
  addBox(group, [1.04, 0.16, 0.8], [0, 0.08, 0.04], 0x1f2937)
  addBox(group, [0.07, 1.7, 0.76], [-0.49, 0.9, 0.03], 0xc8d2de)
  addBox(group, [0.07, 1.7, 0.76], [0.49, 0.9, 0.03], 0xc8d2de)
  addBox(group, [0.84, 0.72, 0.14], [0, 1.25, 0.09], 0x111827)
  addGlow(group, [0.66, 0.54, 0.04], [0, 1.26, 0.18], 0x38bdf8)
  addBox(group, [0.9, 0.2, 0.1], [0, 1.73, 0.1], 0x0ea5e9)

  const controlDeck = addBox(group, [0.9, 0.06, 0.44], [0, 1.0, 0.44], 0xe2e8f0)
  controlDeck.rotation.x = -0.36
  addBox(group, [0.9, 0.24, 0.12], [0, 0.89, 0.54], 0xc8d2de)

  const joystick = new THREE.Group()
  joystick.position.set(-0.21, 1.06, 0.4)
  joystick.rotation.x = -0.36
  addCylinder(joystick, 0.05, 0.06, 0.04, [0, 0.02, 0], 0x334155)
  addCylinder(joystick, 0.018, 0.022, 0.15, [0, 0.1, 0], 0x475569, 12)
  const joystickBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.34 }),
  )
  joystickBall.position.set(0, 0.19, 0)
  joystickBall.castShadow = true
  joystick.add(joystickBall)
  group.add(joystick)

  const controlKeyboard = new THREE.Group()
  controlKeyboard.position.set(0.22, 1.06, 0.4)
  controlKeyboard.rotation.x = -0.36
  addBox(controlKeyboard, [0.38, 0.05, 0.24], [0, 0.03, 0], 0x64748b)
  for (const [row, z] of [[0, -0.055], [1, 0.06]] as Array<[number, number]>) {
    for (let column = 0; column < 3; column += 1) {
      const x = -0.11 + column * 0.11
      addBox(controlKeyboard, [0.08, 0.025, 0.08], [x, 0.06, z], row === 0 ? 0xe2e8f0 : 0xcbd5e1)
    }
  }
  group.add(controlKeyboard)
  scene?.add(group)
}

function makePingPongTable(x: number, z: number) {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  addBox(group, [1.82, 0.08, 0.98], [0, 0.74, 0], 0xffffff)
  addBox(group, [1.74, 0.03, 0.9], [0, 0.79, 0], 0x2b6cb0)
  addBox(group, [1.7, 0.1, 0.02], [0, 0.86, 0], 0xf8fafc)
  for (const [lx, lz] of [
    [-0.76, -0.36],
    [0.76, -0.36],
    [-0.76, 0.36],
    [0.76, 0.36],
  ]) {
    addBox(group, [0.08, 0.7, 0.08], [lx, 0.35, lz], 0xc8d2de)
  }
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.036, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xff8c1a, roughness: 0.35 }),
  )
  ball.position.set(x, 0.88, z)
  ball.castShadow = true
  scene?.add(group)
  scene?.add(ball)
  return ball
}

// 工位：隔板 + 桌椅 + 显示器 + 状态灯带（明亮配色）
function makeCubicle(agent: WorkspaceAgent, position: [number, number], tasks: Task[]) {
  const group = new THREE.Group()
  const [x, z] = position
  group.position.set(x, 0, z)
  const stateColor = STATE_COLORS[agent.state] || STATE_COLORS.idle

  const carpet = addBox(group, [CUBICLE_W, 0.04, CUBICLE_D], [0, 0.02, 0], ROOM.carpet, {
    agentId: agent.id,
  })
  carpet.castShadow = false

  const back = addBox(group, [CUBICLE_W, PANEL_H, 0.08], [0, PANEL_H / 2, -CUBICLE_D / 2], ROOM.panel, {
    agentId: agent.id,
  })
  addBox(group, [0.08, PANEL_H, CUBICLE_D], [-CUBICLE_W / 2, PANEL_H / 2, 0], ROOM.panelSide, {
    agentId: agent.id,
  })
  addBox(group, [0.08, PANEL_H, CUBICLE_D], [CUBICLE_W / 2, PANEL_H / 2, 0], ROOM.panelSide, {
    agentId: agent.id,
  })
  addBox(group, [CUBICLE_W, 0.06, 0.14], [0, PANEL_H + 0.03, -CUBICLE_D / 2], ROOM.panelCap, {
    agentId: agent.id,
  })
  addBox(group, [0.14, 0.06, CUBICLE_D], [-CUBICLE_W / 2, PANEL_H + 0.03, 0], ROOM.panelCap, {
    agentId: agent.id,
  })
  addBox(group, [0.14, 0.06, CUBICLE_D], [CUBICLE_W / 2, PANEL_H + 0.03, 0], ROOM.panelCap, {
    agentId: agent.id,
  })

  const top = addBox(group, [2.2, 0.09, 0.9], [0, DESK_H, -0.34], ROOM.desk, { agentId: agent.id })
  for (const [lx, lz] of [
    [-0.92, -0.68],
    [0.92, -0.68],
    [-0.92, 0],
    [0.92, 0],
  ] as Array<[number, number]>) {
    addBox(group, [0.08, DESK_H, 0.08], [lx, DESK_H / 2, lz], ROOM.deskLeg)
  }
  const cabinet = addBox(group, [0.62, 0.56, 0.62], [0.72, 0.28, -0.3], ROOM.cabinet, { agentId: agent.id })
  addBox(group, [0.5, 0.02, 0.02], [0.72, 0.34, 0.02], ROOM.deskLeg)
  addBox(group, [0.5, 0.02, 0.02], [0.72, 0.2, 0.02], ROOM.deskLeg)

  addGlow(group, [CUBICLE_W - 0.14, 0.05, 0.05], [0, PANEL_H - 0.24, -CUBICLE_D / 2 + 0.07], stateColor, {
    agentId: agent.id,
  })

  const monitor = makeMonitor(agent, tasks)
  monitor.position.set(-0.3, DESK_H + 0.05, -0.5)
  group.add(monitor)

  // 桌面外设与椅子、座位同轴：人坐 +Z 正对屏幕，键盘在正前，鼠标在右手侧（+X）
  const keyboard = makeKeyboard(keyboardTexture!)
  keyboard.position.set(-0.3, DESK_H + 0.05, -0.16)
  keyboard.traverse((node) => {
    node.userData.agentId = agent.id
  })
  group.add(keyboard)

  const mouse = makeMouse()
  mouse.rotation.y = 0.12
  mouse.position.set(0.15, DESK_H + 0.05, -0.16)
  mouse.traverse((node) => {
    node.userData.agentId = agent.id
  })
  group.add(mouse)

  // 椅子（人不在工位时椅子空着）
  const chairSeat = addBox(group, [0.46, 0.08, 0.46], [-0.3, 0.38, 0.42], ROOM.chair, { agentId: agent.id })
  addBox(group, [0.5, 0.46, 0.08], [-0.3, 0.63, 0.64], ROOM.chair, { agentId: agent.id })
  addBox(group, [0.08, 0.38, 0.08], [-0.3, 0.19, 0.42], ROOM.chair)
  chairSeat.castShadow = false

  pickables.push(carpet, back, top, cabinet)
  scene?.add(group)
}

function makeTaskQueue(queueZ: number, centerX: number) {
  const count = Math.min(props.unassigned.length, 6)
  if (count === 0) return
  const spacing = 0.66
  const startX = centerX - ((count - 1) * spacing) / 2
  const tray = addBox(scene!, [Math.max(1.05, count * spacing + 0.3), 0.06, 0.72], [centerX, 0.03, queueZ], ROOM.counter)
  tray.castShadow = false
  for (let i = 0; i < count; i += 1) {
    const task = props.unassigned[i]
    const card = addBox(scene!, [0.56, 0.4, 0.05], [startX + i * spacing, 0.26, queueZ], 0xf8fafc, {
      taskId: task.id,
    })
    card.rotation.x = -0.24
    const tag = addGlow(scene!, [0.56, 0.06, 0.02], [startX + i * spacing, 0.44, queueZ - 0.02], 0xf59e0b, {
      taskId: task.id,
    })
    tag.rotation.x = -0.24
    pickables.push(card)
  }
}

interface LoungeSpots {
  sofa: THREE.Vector3[]
  coffee: THREE.Vector3
  coffeeStand: THREE.Vector3
  dispenser: THREE.Vector3
  dispenserStand: THREE.Vector3
  arcade: THREE.Vector3
  arcadeStand: THREE.Vector3
  pingPong: THREE.Vector3[]
  pingPongTable: THREE.Vector3
  pingPongBall: THREE.Mesh
  window: THREE.Vector3
  plant: THREE.Vector3
  patrol: THREE.Vector3[]
  corridorX: number
  center: THREE.Vector3
}

function makePlant(x: number, z: number) {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  addBox(group, [0.34, 0.3, 0.34], [0, 0.15, 0], ROOM.plantPot)
  const trunk = addBox(group, [0.06, 0.5, 0.06], [0, 0.52, 0], 0x7c5c3a)
  trunk.castShadow = false
  const leafMaterial = new THREE.MeshStandardMaterial({ color: ROOM.plantLeaf, roughness: 0.66 })
  for (let i = 0; i < 5; i += 1) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), leafMaterial)
    const angle = (i / 5) * Math.PI * 2
    leaf.position.set(Math.cos(angle) * 0.16, 0.78 + (i % 2) * 0.16, Math.sin(angle) * 0.16)
    leaf.scale.set(1.1, 0.72, 1.1)
    leaf.castShadow = true
    group.add(leaf)
  }
  scene?.add(group)
}

function makeLounge(originX: number, depth: number): LoungeSpots {
  const cx = originX + LOUNGE_W / 2
  const frontZ = depth / 2 - 0.6
  const backZ = -depth / 2 + 0.6

  // 地毯划分休息区
  const rug = addBox(scene!, [LOUNGE_W - 0.6, 0.03, depth - 1.0], [cx, 0.015, 0], 0xe8eef7)
  rug.castShadow = false

  // 长沙发 + 茶几
  const sofaZ = backZ + 0.15
  addBox(scene!, [2.3, 0.42, 0.8], [cx - 0.55, 0.3, sofaZ], ROOM.sofa)
  addBox(scene!, [2.3, 0.5, 0.16], [cx - 0.55, 0.62, sofaZ - 0.42], ROOM.sofa)
  for (const offset of [-0.85, 0.85]) {
    addBox(scene!, [0.16, 0.34, 0.8], [cx - 0.55 + offset, 0.32, sofaZ], ROOM.sofaCushion)
  }
  addBox(scene!, [0.9, 0.06, 0.5], [cx - 0.55, 0.44, sofaZ + 0.75], ROOM.table)
  addBox(scene!, [0.08, 0.42, 0.08], [cx - 0.55, 0.21, sofaZ + 0.75], ROOM.deskLeg)

  // 咖啡吧台 + 咖啡机
  const coffeeX = cx + 1.75
  addBox(scene!, [1.5, 0.9, 0.7], [coffeeX, 0.45, backZ + 0.4], ROOM.counter)
  addBox(scene!, [1.56, 0.06, 0.76], [coffeeX, 0.93, backZ + 0.4], ROOM.desk)
  const coffeeMachine = new THREE.Group()
  coffeeMachine.position.set(coffeeX - 0.1, 0.96, backZ + 0.38)
  scene?.add(coffeeMachine)
  addBox(coffeeMachine, [0.6, 0.62, 0.42], [0, 0.32, 0], 0xffffff)
  addBox(coffeeMachine, [0.64, 0.06, 0.46], [0, 0.65, 0], 0x334155)
  addBox(coffeeMachine, [0.46, 0.28, 0.06], [0, 0.42, 0.22], 0x334155)
  addGlow(coffeeMachine, [0.18, 0.05, 0.03], [-0.1, 0.56, 0.24], 0x38bdf8)
  addGlow(coffeeMachine, [0.18, 0.05, 0.03], [0.1, 0.56, 0.24], 0xf59e0b)
  addCylinder(coffeeMachine, 0.035, 0.035, 0.09, [-0.11, 0.24, 0.24], 0x475569, 12)
  addCylinder(coffeeMachine, 0.035, 0.035, 0.09, [0.11, 0.24, 0.24], 0x475569, 12)
  addBox(coffeeMachine, [0.4, 0.05, 0.2], [0, 0.03, 0.22], 0x1f2937)
  addBox(coffeeMachine, [0.09, 0.1, 0.09], [-0.11, 0.1, 0.22], 0xf8fafc)
  addBox(coffeeMachine, [0.09, 0.1, 0.09], [0.11, 0.1, 0.22], 0xf8fafc)
  addBox(coffeeMachine, [0.24, 0.14, 0.26], [0.05, 0.74, -0.06], 0x7dd3fc)
  addBox(coffeeMachine, [0.27, 0.04, 0.29], [0.05, 0.82, -0.06], 0x334155)

  // 饮水机放在前侧右角，街机和乒乓球把休息区分成两个玩法角落
  const dispenserX = cx + 2.35
  const dispenserZ = frontZ - 0.55
  const arcadeX = cx + 0.65
  const arcadeZ = frontZ - 0.65
  const pingPongX = cx - 2.0
  const pingPongZ = frontZ - 2.4
  makeWaterDispenser(dispenserX, dispenserZ)
  makeArcade(arcadeX, arcadeZ)
  const pingPongBall = makePingPongTable(pingPongX, pingPongZ)

  // 落地窗（后墙位置放窗框，视觉上"有窗"）
  const windowZ = backZ - 0.28
  for (let i = 0; i < 3; i += 1) {
    const wx = cx - 1.6 + i * 1.6
    addBox(scene!, [1.5, 2.0, 0.06], [wx, 1.0, windowZ], ROOM.frame)
    const glass = addBox(scene!, [1.34, 1.84, 0.02], [wx, 1.0, windowZ + 0.04], 0xdff0ff)
    glass.castShadow = false
  }

  // 白板（贴在休息区侧）
  addBox(scene!, [0.06, 1.1, 1.9], [originX + 0.08, 1.2, frontZ - 1.9], ROOM.whiteboard)
  addBox(scene!, [0.08, 0.06, 1.9], [originX + 0.08, 0.64, frontZ - 1.9], ROOM.frame)

  makePlant(cx - 1.9, frontZ - 0.5)
  makePlant(originX + 0.45, backZ + 1.6)

  const spots: LoungeSpots = {
    sofa: [
      new THREE.Vector3(cx - 1.25, 0, sofaZ + 0.32),
      new THREE.Vector3(cx - 0.55, 0, sofaZ + 0.32),
      new THREE.Vector3(cx + 0.15, 0, sofaZ + 0.32),
    ],
    coffee: new THREE.Vector3(coffeeX, 0, backZ + 1.35),
    coffeeStand: new THREE.Vector3(coffeeX, 0, backZ + 0.4),
    dispenser: new THREE.Vector3(dispenserX, 0, dispenserZ),
    dispenserStand: new THREE.Vector3(dispenserX, 0, dispenserZ + 0.64),
    arcade: new THREE.Vector3(arcadeX, 0, arcadeZ + 0.68),
    arcadeStand: new THREE.Vector3(arcadeX, 0, arcadeZ),
    pingPong: [
      new THREE.Vector3(pingPongX - 0.42, 0, pingPongZ + 0.92),
      new THREE.Vector3(pingPongX + 0.42, 0, pingPongZ - 0.92),
    ],
    pingPongTable: new THREE.Vector3(pingPongX, 0, pingPongZ),
    pingPongBall,
    window: new THREE.Vector3(cx - 1.6, 0, windowZ + 0.55),
    plant: new THREE.Vector3(cx - 1.9, 0, frontZ - 1.2),
    patrol: [
      new THREE.Vector3(cx + 1.1, 0, frontZ - 1.0),
      new THREE.Vector3(cx + 2.0, 0, 0.2),
      new THREE.Vector3(cx + 1.5, 0, backZ + 2.2),
      new THREE.Vector3(cx - 0.5, 0, backZ + 2.3),
      new THREE.Vector3(cx - 0.7, 0, 0.1),
    ],
    corridorX: originX + 0.45,
    center: new THREE.Vector3(cx, 0, 0),
  }
  return spots
}

function disposeMaterial(material: THREE.Material) {
  // 场景级共享贴图（如键盘）不该随单次重建销毁
  if (material.userData?.sharedMap) {
    material.dispose()
    return
  }
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

let buildToken = 0

async function rebuildScene() {
  if (!scene) return
  const token = ++buildToken
  const target = scene
  pickables.length = 0
  actors.length = 0
  for (const timer of monitorTimers) window.clearInterval(timer)
  monitorTimers.length = 0
  for (const texture of faceTextures) texture.dispose()
  faceTextures.length = 0
  for (const child of Array.from(target.children)) {
    if (child.userData.static) continue
    target.remove(child)
    disposeObject(child)
  }
  const layout = cubicleLayout(props.agents.length)
  const columns = cubicleColumns(props.agents.length)
  if (!keyboardTexture) keyboardTexture = makeKeyboardTexture()
  const rows = Math.ceil(props.agents.length / Math.max(columns, 1))
  const workingRows = Math.max(1, rows)
  // 工位区半宽/半深，休息区接在右侧
  const workHalfWidth = ((Math.min(columns, props.agents.length) - 1) / 2) * COL_W + CUBICLE_W / 2
  const workHalfDepth = ((workingRows - 1) / 2) * ROW_D + CUBICLE_D / 2
  const workCenterX = -LOUNGE_W / 2
  const spots = makeLounge(workHalfWidth + workCenterX + 0.35, Math.max(workHalfDepth * 2, 6.4))
  sceneHalfWidth = (workHalfWidth * 2 + LOUNGE_W) / 2
  sceneHalfDepth = Math.max(workHalfDepth, 3.4)
  sceneStaticCenterX = (workCenterX * workHalfWidth * 2 + spots.center.x * LOUNGE_W) / (workHalfWidth * 2 + LOUNGE_W)

  props.agents.forEach((agent, index) => {
    const [lx, lz] = layout[index] || [0, 0]
    const cubiclePosition: [number, number] = [lx + workCenterX, lz]
    makeCubicle(agent, cubiclePosition, activeTasksFor(agent))
  })
  if (!props.compact) makeTaskQueue(sceneHalfDepth + 0.9, sceneStaticCenterX)

  const faces = await Promise.all(props.agents.map((agent) => makeAgentFace(agent.provider)))
  // 场景已被下一次重建取代或组件卸载，丢弃这次的构建结果
  if (token !== buildToken || scene !== target) return

  const sofaCursor = { index: 0 }
  const patrolCursor = { index: 0 }
  const pingPongCursor = { index: 0 }
  props.agents.forEach((agent, index) => {
    const canvas = faces[index]
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    faceTextures.push(texture)

    const [lx, lz] = layout[index] || [0, 0]
    const seat = new THREE.Vector3(lx + workCenterX - 0.3, 0, lz + 0.26)
    const activity = activityFor(agent, props.agents.map((item) => item.id))
    let home = seat
    if (activity === 'sofa') {
      home = spots.sofa[sofaCursor.index % spots.sofa.length].clone()
      sofaCursor.index += 1
    } else if (activity === 'coffee') {
      home = spots.coffee.clone()
    } else if (activity === 'phone') {
      home = spots.window.clone()
    } else if (activity === 'water') {
      home = spots.dispenserStand.clone()
    } else if (activity === 'arcade') {
      home = spots.arcade.clone()
    } else if (activity === 'pingPong') {
      home = spots.pingPong[pingPongCursor.index % spots.pingPong.length].clone()
      pingPongCursor.index += 1
    } else if (activity === 'patrol') {
      home = seat.clone()
      patrolCursor.index += 1
    }

    const actor = makeActor(agent, home, canvas, texture, activity)
    if (activity === 'patrol') {
      // 每次进出工位都走本行前沿走廊，避免隔板间直线穿越
      const rowFrontZ = lz + CUBICLE_D / 2 + 0.35
      const front = new THREE.Vector3(seat.x, 0, rowFrontZ)
      const enter = new THREE.Vector3(spots.corridorX, 0, rowFrontZ)
      const leave = new THREE.Vector3(spots.corridorX, 0, spots.coffee.z)
      actor.patrol = [
        front.clone(),
        enter.clone(),
        ...spots.patrol,
        spots.coffee.clone(),
        leave.clone(),
        front.clone(),
        seat.clone(),
      ]
    }
    if (activity === 'desk') {
      poseSitting(actor.person)
      actor.person.group.position.copy(seat)
      // 与显示器同轴，正对屏幕（面朝 -Z）
      actor.heading = Math.PI
      actor.person.group.rotation.y = actor.heading
    } else if (activity === 'sofa') {
      poseSitting(actor.person)
      actor.person.torso.position.y = 0.74
      // 沙发靠 -z 后侧，面朝 +z 相机才能看到头像
      actor.heading = 0
      actor.person.group.rotation.y = actor.heading
    } else if (activity === 'pace') {
      poseStanding(actor.person)
      actor.person.group.position.set(seat.x, 0, seat.z + 0.9)
    } else {
      poseStanding(actor.person)
    }

    if (activity === 'phone') {
      const phone = makePhoneProp()
      phone.position.set(0, 0.9, 0.22)
      actor.person.torso.add(phone)
      actor.phone = phone.children[1] as THREE.Mesh
    }
    if (activity === 'coffee') {
      const cup = makeCupProp()
      cup.position.set(0.22, 0.98, 0.16)
      actor.person.torso.add(cup)
      actor.cup = cup
      actor.heading = Math.atan2(spots.coffeeStand.x - home.x, spots.coffeeStand.z - home.z)
      actor.person.group.rotation.y = actor.heading
    }
    if (activity === 'water') {
      const waterCup = makeWaterCupProp()
      waterCup.group.position.set(0, 0.16, 0.4)
      actor.person.torso.add(waterCup.group)
      actor.cup = waterCup.group
      actor.cupFill = waterCup.fill
      const stream = addBox(
        scene!,
        [0.035, 0.1, 0.035],
        [spots.dispenser.x, 0.8, spots.dispenser.z + 0.2],
        0x8fd8ff,
      )
      const streamMaterial = stream.material as THREE.MeshStandardMaterial
      streamMaterial.transparent = true
      streamMaterial.opacity = 0.65
      stream.castShadow = false
      stream.visible = false
      actor.waterStream = stream
      actor.heading = Math.PI
      actor.person.group.rotation.y = actor.heading
    }
    if (activity === 'arcade') {
      actor.heading = Math.PI
      actor.person.group.rotation.y = actor.heading
    }
    if (activity === 'pingPong') {
      actor.pongSide = home.z > spots.pingPongTable.z ? 1 : -1
      actor.pongBall = spots.pingPongBall
      actor.heading = actor.pongSide === 1 ? Math.PI : 0
      actor.person.group.rotation.y = actor.heading
      const paddle = makePaddleProp()
      paddle.position.set(0, -0.46, 0.03)
      paddle.rotation.x = 0.2
      actor.person.armR.add(paddle)
    }

    target.add(actor.person.group)
    pickables.push(...actor.pickMeshes)
    actors.push(actor)
  })
  for (const actor of actors) actor.person.group.updateMatrixWorld(true)
  frameCamera()
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
  // 横向用场景半宽、纵向用半深（俯视压缩后约为 0.7 倍），取更远的一个保证不裁切
  const requiredWidth = (1.2 * sceneHalfWidth) / Math.max(tanHalfHorizontal, 0.15)
  const requiredDepth = (1.2 * sceneHalfDepth * 0.7) / Math.max(Math.tan((camera.fov * Math.PI) / 360), 0.15)
  const scaled = Math.min(40, Math.max(9, Math.max(requiredWidth, requiredDepth)))
  const direction = cameraHome.clone().sub(cameraTarget).normalize()
  const center = new THREE.Vector3(sceneStaticCenterX, 1.05, Math.min(sceneHalfDepth * 0.2, 1.2))
  camera.position.copy(center).addScaledVector(direction, scaled)
  controls.target.copy(center)
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
    if (props.compact) return
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
  for (const actor of actors) {
    updateActor(actor)
  }
  controls?.update()
  renderer?.render(scene!, camera!)
}

function updateActor(actor: Actor) {
  const { person, activity } = actor
  const time = animationClock + actor.phase
  const bob = Math.sin(time * 1.6) * 0.008
  person.group.position.y = bob

  if (activity === 'desk') {
    // 打字 + 周期性伸手点鼠标：手臂前伸，手掌落在键帽/鼠标高度
    const typing = Math.sin(time * 9)
    const onMouse = Math.sin(time * 0.5 + actor.seed * 2.4) > 0.7
    person.armL.rotation.x = onMouse ? -1.61 - Math.max(0, Math.sin(time * 6)) * 0.12 : -1.61 + typing * 0.14
    person.armL.rotation.z = onMouse ? -0.5 : 0.3
    person.armR.rotation.x = -1.61 - typing * 0.14
    person.armR.rotation.z = -0.3
    person.head.rotation.x = -0.28 + Math.sin(time * 1.1) * 0.04
    person.head.rotation.y = Math.sin(time * 0.55) * 0.12
    person.torso.rotation.x = 0.06
    return
  }

  if (activity === 'pace') {
    // 阻塞：在工位旁小范围踱步 + 抱头
    const swing = Math.sin(time * 2.1)
    const walkZ = 0.12 + ((swing + 1) / 2) * 0.68
    person.group.position.z = actor.home.z + walkZ
    person.group.position.x = actor.home.x + Math.cos(time * 1.3) * 0.16
    applyWalk(person, time * 6.4, 0.7)
    person.armL.rotation.x = -2.5
    person.armR.rotation.x = -2.5
    person.armL.rotation.z = 0.7
    person.armR.rotation.z = -0.7
    person.head.rotation.x = -0.18
    person.head.rotation.z = Math.sin(time * 1.7) * 0.06
    person.group.rotation.y = swing > 0 ? Math.PI : 0
    return
  }

  if (activity === 'sofa') {
    // 停滞/摸鱼：瘫在沙发上刷手机，身体后仰 + 腿部晃动 + 拇指滑动，明显看得出在动
    const sway = Math.sin(time * 0.8)
    person.torso.rotation.x = -0.28 + sway * 0.06
    person.head.rotation.x = 0.3 + Math.sin(time * 1.3) * 0.08
    person.head.rotation.y = Math.sin(time * 0.5) * 0.3
    person.legL.rotation.x = -1.15
    person.legR.rotation.x = -1.05 + Math.sin(time * 0.9) * 0.05
    person.armL.rotation.x = -1.25 + Math.sin(time * 3.1) * 0.12
    person.armR.rotation.x = -1.25 - Math.sin(time * 3.1) * 0.12
    person.armL.rotation.z = 0.5
    person.armR.rotation.z = -0.5
    person.armL.rotation.y = Math.sin(time * 6.5) * 0.16
    person.armR.rotation.y = -Math.sin(time * 6.5) * 0.16
    person.group.position.y = -0.02 + bob * 0.4 + sway * 0.01
    person.group.rotation.z = sway * 0.03
    return
  }

  if (activity === 'coffee') {
    // 咖啡机前：等咖啡，偶尔举杯
    const lift = (Math.sin(time * 0.9) + 1) / 2
    person.armR.rotation.x = -0.5 - lift * 0.9
    person.armL.rotation.x = Math.sin(time * 1.2) * 0.1
    person.head.rotation.x = -0.05 - lift * 0.12
    person.head.rotation.y = Math.sin(time * 0.6) * 0.25
    person.legL.rotation.x = 0
    person.legR.rotation.x = 0
    person.group.position.y = bob
    if (actor.cup) actor.cup.visible = lift > 0.55
    return
  }

  if (activity === 'phone') {
    // 窗边刷手机：贴着落地窗来回踱步 + 低头 + 拇指动
    const stroll = Math.sin(time * 0.55)
    person.group.position.x = actor.home.x + stroll * 0.5
    person.group.position.z = actor.home.z + Math.cos(time * 0.4) * 0.12
    applyWalk(person, time * 5.2, 0.55)
    faceTowards(actor, new THREE.Vector3(actor.home.x + stroll * 1.2, 0, actor.home.z))
    person.armL.rotation.x = -1.3
    person.armR.rotation.x = -1.3
    person.armL.rotation.z = 0.55
    person.armR.rotation.z = -0.55
    person.head.rotation.x = 0.42 + Math.sin(time * 1.4) * 0.03
    const thumb = Math.sin(time * 7) * 0.12
    person.armL.rotation.y = thumb
    person.armR.rotation.y = -thumb
    person.group.position.y = bob
    if (actor.phone) {
      const material = actor.phone.material as THREE.MeshStandardMaterial
      material.emissiveIntensity = 0.55 + Math.sin(time * 3) * 0.2
    }
    return
  }

  if (activity === 'water') {
    // 饮水机：接水时手臂前伸，随后把杯子举到嘴边；水位随循环上升再下降
    const cycle = (time * 0.22 + actor.seed) % 1
    const pouring = cycle > 0.12 && cycle < 0.48
    const drinking = cycle > 0.58 && cycle < 0.86
    const drinkLift = drinking ? Math.min(1, (cycle - 0.58) / 0.08) : 0
    const water = pouring
      ? Math.min(1, (cycle - 0.12) / 0.34)
      : drinking
        ? Math.max(0, 1 - (cycle - 0.58) / 0.28)
        : cycle > 0.86
          ? 0
          : 1
    faceTowards(actor, new THREE.Vector3(actor.home.x, 0, actor.home.z - 0.4), 0.2)
    person.torso.rotation.x = 0.04 + Math.sin(time * 1.1) * 0.015
    person.head.rotation.x = pouring ? -0.08 : 0.06 + drinkLift * 0.05
    person.head.rotation.y = Math.sin(time * 0.6) * 0.06
    person.armL.rotation.x = pouring ? -1.55 : drinking ? -1.85 : -0.7
    person.armR.rotation.x = pouring ? -1.55 : drinking ? -1.95 : -0.7
    person.armL.rotation.z = pouring ? 0.18 : drinking ? 0.28 : 0.12
    person.armR.rotation.z = pouring ? -0.18 : drinking ? -0.32 : -0.12
    if (actor.cup) {
      actor.cup.position.set(0, drinking ? 0.24 + drinkLift * 0.08 : 0.16, drinking ? 0.24 : 0.4)
      actor.cup.rotation.x = drinking ? -0.68 * drinkLift : 0
    }
    if (actor.cupFill) {
      const height = Math.max(0.12, water)
      actor.cupFill.visible = water > 0.04
      actor.cupFill.scale.set(1, height, 1)
      actor.cupFill.position.y = -0.045 + 0.0375 * height
    }
    if (actor.waterStream) actor.waterStream.visible = pouring
    return
  }

  if (activity === 'arcade') {
    // 街机：快速交替按键，身体随节奏轻晃
    person.armL.rotation.x = -1.25 + Math.sin(time * 4.6) * 0.18
    person.armR.rotation.x = -1.48 + Math.sin(time * 5.8) * 0.2
    person.armL.rotation.z = 0.18
    person.armR.rotation.z = -0.18
    person.torso.rotation.x = 0.12 + Math.sin(time * 1.7) * 0.03
    person.head.rotation.x = 0.24 + Math.sin(time * 2.1) * 0.035
    person.head.rotation.y = Math.sin(time * 0.7) * 0.09
    person.group.rotation.z = Math.sin(time * 1.7) * 0.012
    person.group.position.y = bob + Math.sin(time * 4.2) * 0.004
    return
  }

  if (activity === 'pingPong') {
    // 乒乓球：球沿台面画弧，两边角色在自己侧球到达时挥拍
    const side = actor.pongSide ?? 1
    const rally = Math.sin(time * 2.64)
    const localHit = side * rally
    const swing = Math.max(0, localHit - 0.55) * 1.4
    person.group.position.x = actor.home.x + Math.sin(time * 5.28) * 0.07
    faceTowards(actor, new THREE.Vector3(actor.home.x, 0, actor.home.z - side * 0.9), 0.16)
    person.armL.rotation.x = -0.7 + Math.sin(time * 2.9) * 0.06
    person.armR.rotation.x = -1.24 + swing
    person.armR.rotation.z = -0.34 - swing * 0.18
    person.armL.rotation.z = 0.16
    person.torso.rotation.y = -rally * 0.12 * side
    person.torso.rotation.x = 0.07 + Math.abs(localHit) * 0.03
    person.head.rotation.x = 0.16
    person.head.rotation.y = -rally * 0.07
    person.group.rotation.z = Math.sin(time * 5.28) * 0.012
    if (actor.pongBall) {
      actor.pongBall.position.set(
        actor.home.x + (side === 1 ? 0.42 : -0.42) + Math.sin(time * 5.28) * 0.34,
        0.88 + (1 - rally * rally) * 0.1,
        actor.home.z - side * 0.92 + rally * 0.75,
      )
    }
    return
  }

  // patrol：在休息区与工位之间巡逻，走到点后停一会儿
  const target = actor.patrol[actor.waypoint % actor.patrol.length]
  const toTarget = new THREE.Vector3(target.x - person.group.position.x, 0, target.z - person.group.position.z)
  const distance = toTarget.length()
  if (distance < 0.12) {
    actor.wait += 0.016
    person.legL.rotation.x *= 0.85
    person.legR.rotation.x *= 0.85
    person.armL.rotation.x *= 0.85
    person.armR.rotation.x *= 0.85
    person.head.rotation.y = Math.sin(time * 1.1) * 0.5
    if (actor.wait > 1.2 + actor.seed * 1.6) {
      actor.wait = 0
      actor.waypoint = (actor.waypoint + 1) % actor.patrol.length
    }
    return
  }
  const speed = 0.028
  const step = toTarget.clone().normalize().multiplyScalar(Math.min(speed, distance))
  person.group.position.x += step.x
  person.group.position.z += step.z
  actor.legPhase += 0.16
  applyWalk(person, actor.legPhase, 1)
  person.head.rotation.y = 0
  person.head.rotation.x = Math.sin(actor.legPhase) * 0.04
  faceTowards(actor, target, 0.14)
}

onMounted(() => {
  if (!host.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color(ROOM.background)
  scene.fog = new THREE.Fog(ROOM.fog, 26, 52)
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.copy(cameraHome)
  camera.lookAt(cameraTarget)
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
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
    new THREE.MeshStandardMaterial({ color: ROOM.floor, roughness: 0.95 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  floor.userData.static = true
  scene.add(floor)

  const grid = new THREE.GridHelper(24, 24, ROOM.floorEdge, ROOM.floorEdge)
  grid.position.y = 0.01
  grid.userData.static = true
  scene.add(grid)
  const ambient = new THREE.AmbientLight(0xffffff, 1.35)
  ambient.userData.static = true
  scene.add(ambient)
  const hemisphere = new THREE.HemisphereLight(0xffffff, ROOM.floorEdge, 1.5)
  hemisphere.userData.static = true
  scene.add(hemisphere)
  const key = new THREE.DirectionalLight(0xffffff, 1.5)
  key.position.set(6, 11, 6)
  key.userData.static = true
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.camera.near = 1
  key.shadow.camera.far = 40
  key.shadow.camera.left = -14
  key.shadow.camera.right = 14
  key.shadow.camera.top = 12
  key.shadow.camera.bottom = -12
  key.shadow.radius = 2.5
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xeaf2ff, 0.55)
  fill.position.set(-7, 6, -5)
  fill.userData.static = true
  scene.add(fill)

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
  buildToken += 1
  for (const timer of monitorTimers) window.clearInterval(timer)
  monitorTimers.length = 0
  resizeObserver?.disconnect()
  host.value?.removeEventListener('pointerdown', onPointerDown)
  host.value?.removeEventListener('pointermove', onPointerMove)
  host.value?.removeEventListener('click', onClick)
  controls?.dispose()
  pickables.length = 0
  actors.length = 0
  for (const texture of faceTextures) texture.dispose()
  faceTextures.length = 0
  keyboardTexture?.dispose()
  keyboardTexture = null
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
