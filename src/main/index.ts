import { app, BrowserWindow, shell, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { DatabaseService } from './services/database'
import { OllamaService } from './services/ollama'
import { IngestionService } from './services/ingestion'
import { startApiServer } from './api/server'

let mainWindow: BrowserWindow | null = null
let db: DatabaseService
let ollama: OllamaService
let ingestion: IngestionService

function createWindow(): void {
  nativeTheme.themeSource = 'dark'

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#080B14',
    vibrancy: 'under-window',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: join(__dirname, '../../resources/icon.png'),
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Window control IPC
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())
}

async function initialize(): Promise<void> {
  db = new DatabaseService()
  await db.initialize()

  ollama = new OllamaService()

  ingestion = registerIpcHandlers(db, ollama, () => mainWindow)
  startApiServer(db, 47821)
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('ai.contextfabric')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await initialize()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  ingestion?.stopAllWatchers()
})

export { mainWindow }
