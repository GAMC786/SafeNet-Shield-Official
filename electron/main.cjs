const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;
const DESKTOP_APP_ORIGIN = 'https://desktop.safenet.dns';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'default',
    show: false,
  });

  Menu.setApplicationMenu(null);

  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5000');
    mainWindow.webContents.openDevTools();
  } else {
    // Electron loads the packaged renderer from file://, which has an opaque
    // origin. Give API requests a stable origin that the backend can allow
    // explicitly instead of weakening CORS for null or file:// origins.
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['*://*/*'] },
      (details, callback) => {
        if (details.url.startsWith('http://') || details.url.startsWith('https://')) {
          details.requestHeaders.Origin = DESKTOP_APP_ORIGIN;
        }
        callback({ requestHeaders: details.requestHeaders });
      },
    );
    mainWindow.loadFile(path.join(__dirname, '../dist/public/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
