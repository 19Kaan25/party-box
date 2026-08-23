import { createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const root = createRoot(document.getElementById('root'))
const devLabRequested = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('devLab') === '1'

const render = (component) => root.render(
  <StrictMode>{component}</StrictMode>,
)

if (devLabRequested) {
  // Nur der Dev-Server kann das Labor laden. Der dynamische Import haelt die
  // Labor-JavaScript-Logik aus dem Produktions-Bundle heraus.
  import('./components/dev/DevPlayerLab.jsx').then((module) => {
    render(createElement(module.default))
  })
} else {
  render(<App />)
}
