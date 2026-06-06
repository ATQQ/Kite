const root = new URL('.', import.meta.url).pathname

Bun.serve({
  port: 4300,
  async fetch(request) {
    const url = new URL(request.url)
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname
    const file = Bun.file(`${root}${pathname}`)

    if (await file.exists()) {
      return new Response(file)
    }

    return new Response('Not Found', { status: 404 })
  }
})

console.log('frontend-basic running at http://localhost:4300')
