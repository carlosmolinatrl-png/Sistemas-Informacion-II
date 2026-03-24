const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

let mainWindow;

// Avoid startup issues in environments where Chromium cache paths are not writable.
const userDataPath = path.join(app.getPath('appData'), 'Modaveli');
const diskCachePath = path.join(os.tmpdir(), 'modaveli-cache');
const sessionDataPath = path.join(userDataPath, 'session-data');

fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(diskCachePath, { recursive: true });
fs.mkdirSync(sessionDataPath, { recursive: true });

app.setPath('userData', userDataPath);
app.setPath('sessionData', sessionDataPath);
app.commandLine.appendSwitch('disk-cache-dir', diskCachePath);
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.disableHardwareAcceleration();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // La app de escritorio es para trabajadores
  mainWindow.loadFile('pages/login.html');

  // Abrir herramientas de desarrollo (opcional, quítalo cuando entregues el trabajo)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// Escuchar eventos para cambiar de página
ipcMain.on('cambiar-pagina', (event, nombrePagina) => {
  mainWindow.loadFile(path.join(__dirname, 'pages', nombrePagina));
});

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});