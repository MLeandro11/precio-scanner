import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import './index.css'
import App from './App'

// `basename` follows Vite's BASE_URL ('/precio-scanner/') so the SPA keeps
// working from its GitHub Pages path regardless of the router's URLs.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
      {/*
        The Toaster lives here, not in App: `App` returns early for BootScreen and
        ErrorScreen, so a Toaster in its final return would be missing exactly when
        feedback matters. It is themed entirely from CSS (see index.css §7c), so no
        `theme` prop: useTheme has no cross-instance sync and a second instance here
        would go stale when the user switches theme on the Perfil page.

        offset/mobileOffset clear the fixed bottom nav (AppLayout). The nav's padding and this
        value carry the same `env(safe-area-inset-bottom)`, so the gap between them stays
        constant on notched devices. Measured at a 390x720 mobile viewport: the nav pill's top
        edge sits 83px above the viewport bottom, so the earlier 5.5rem left ~5px and the toast
        sat against the nav. 6.5rem holds ~21px. sonner switches to `mobileOffset` below 600px
        wide. If the nav's height changes, re-measure this.
      */}
      <Toaster
        position="bottom-center"
        offset={{ bottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))' }}
        mobileOffset={{ bottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))' }}
        customAriaLabel="Notificaciones"
      />
    </BrowserRouter>
  </StrictMode>,
)
