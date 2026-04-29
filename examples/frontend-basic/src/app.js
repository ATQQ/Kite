const button = document.querySelector('#deploy-button')
const status = document.querySelector('#status')

button?.addEventListener('click', () => {
  const now = new Date().toLocaleString()
  status.textContent = `页面正常运行\n构建时间: ${now}\n来源: examples/frontend-basic`
})
