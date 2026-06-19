import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './config/wallet' // Initialize Reown AppKit
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
