import ReactDOM from 'react-dom/client'
import App from './App'
import { ChakraProvider, ColorModeScript } from '@chakra-ui/react'
import { theme } from './theme'
import { ApplicationProvider } from './contexts/applicationContext'
import { SettingsProvider } from './contexts/settingsContext'
import '@fontsource/montserrat/800.css'
import { attachConsole } from 'tauri-plugin-log'
import { installTauriMock } from './devMock'

// Browser preview without Tauri: `yarn dev`, then open http://localhost:1420/?mock
if (import.meta.env.DEV && window.location.search.includes('mock')) {
  installTauriMock()
}

// with LogTarget::Webview enabled, this function will print logs to the browser console
attachConsole()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ChakraProvider theme={theme}>
    <ColorModeScript initialColorMode={theme.config.initialColorMode} />
    <ApplicationProvider>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </ApplicationProvider>
  </ChakraProvider>
)
