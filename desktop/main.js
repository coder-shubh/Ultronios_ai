const { app, BrowserWindow, shell, nativeImage } = require('electron');
const path = require('path');

/** Next dev server (see web/package.json) or production URL if you host the build. */
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3001';

/** Same artwork as the web UI logo; used for window/taskbar/dock. */
const ICON_PATH = path.join(__dirname, 'assets', 'app-icon.png');

function loadWindowIcon() {
  try {
    const img = nativeImage.createFromPath(ICON_PATH);
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
}

function applyDockIcon() {
  try {
    const icon = loadWindowIcon();
    if (!icon || process.platform !== 'darwin' || !app.dock) return;
    app.dock.setIcon(icon);
  } catch (e) {
    console.warn('[desktop] Dock icon:', e.message);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: loadWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.loadURL(APP_URL).catch((err) => {
    console.error('[desktop] Failed to load UI:', err.message);
    console.error('[desktop] Start the web app first: npm run web (from repo root)');
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  applyDockIcon();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
