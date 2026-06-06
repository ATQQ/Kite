const port = Number(process.env.PORT || 4302)

const renderPage = () => {
  const time = new Date().toLocaleString('zh-CN', { hour12: false })

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kite SSR Example</title>
    <style>
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: #09090b;
        color: #f4f4f5;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }
      main {
        width: min(720px, calc(100vw - 48px));
        padding: 40px;
        border: 1px solid #27272a;
        border-radius: 24px;
        background: #18181b;
      }
      code {
        color: #10b981;
      }
    </style>
  </head>
  <body>
    <main>
      <p><code>Kite SSR Example</code></p>
      <h1>服务端渲染页面</h1>
      <p>这段 HTML 由 Bun 服务在请求时生成。</p>
      <p>渲染时间：<code>${time}</code></p>
    </main>
  </body>
</html>`
}

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'kite-ssr-basic-example' })
    }

    return new Response(renderPage(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
  }
})

console.log(`ssr-basic running at http://localhost:${port}`)
