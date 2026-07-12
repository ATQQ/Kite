const port = Number(process.env.PORT || 4301)
const instanceId = process.env.NODE_APP_INSTANCE ?? process.env.pm_id ?? '0'
const pid = process.pid

Bun.serve({
  port,
  reusePort: true,
  fetch(request) {
    const url = new URL(request.url)
    const ts = new Date().toISOString()
    console.log(`[${ts}] [inst=${instanceId} pid=${pid}] ${request.method} ${url.pathname}`)

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'kite-backend-api-example',
        instanceId,
        pid,
        time: ts
      })
    }

    if (url.pathname === '/error') {
      console.error(`[${ts}] [inst=${instanceId} pid=${pid}] simulated error on ${url.pathname}`)
      return Response.json({ ok: false, error: 'simulated' }, { status: 500 })
    }

    return Response.json({
      message: 'Hello from Kite backend API example',
      instanceId,
      pid,
      routes: ['/health', '/error']
    })
  }
})

console.log(`[inst=${instanceId} pid=${pid}] backend-api running at http://localhost:${port}`)
