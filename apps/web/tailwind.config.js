/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: '#09090b',
        panel: '#18181b',
        border: '#27272a',
        primary: '#3b82f6',
        success: '#10b981',
        danger: '#ef4444',
        textMain: '#f4f4f5',
        textMuted: '#a1a1aa'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace']
      }
    },
  },
  plugins: [],
}