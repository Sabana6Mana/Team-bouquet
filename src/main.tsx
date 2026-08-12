import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { BackendProvider } from './context/BackendProvider'
import ErrorBoundary from './components/ErrorBoundary'
import { initializeNativeRuntime } from './lib/nativeRuntime'
import './styles/global.css'

void initializeNativeRuntime()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <BackendProvider>
          <App />
        </BackendProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
)
