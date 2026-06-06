const port = Number(process.env.PORT || 4301)

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'kite-backend-api-example',
        time: new Date().toISOString()
      })
    }

    return Response.json({
      message: 'Hello from Kite backend API example',
      routes: ['/health']
    })
  }
})

console.log(`backend-api running at http://localhost:${port}`)
