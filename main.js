'use strict';

const { app, BrowserWindow, ipcMain, dialog, nativeTheme } = require('electron');
const path = require('path');
const Store = require('./src/store');
const { SCHOOLS, DEFAULT_SCHOOL_CODE } = require('./src/schools');
const automation = require('./src/automation');

// Disable Chromium's auto dark mode that forcibly darkens web content
app.commandLine.appendSwitch('disable-features', 'WebContentsForceDark');

let mainWindow = null;
let store = null;
let webviewContents = null;

function createWindow() {
  const bounds = store.get('windowBounds', { width: 1280, height: 900 });

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 600,
    title: 'RongYou (融优学堂)',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    store.set('windowBounds', { width, height });
  });

  // Get reference to the webview's webContents once it's ready
  mainWindow.webContents.on('did-attach-webview', (event, wc) => {
    webviewContents = wc;

    // Fix: website doesn't set body background, Electron defaults to dark.
    // Inject white background on every page load (including navigations).
    wc.on('dom-ready', () => {
      wc.insertCSS('html, body { background-color: #fff !important; }');
    });
  });
}

function sendLog(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', message);
  }
}

function sendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-update', status);
  }
}

// Helper to get the webview tag object via the renderer
async function getWebview() {
  if (!webviewContents || webviewContents.isDestroyed()) {
    throw new Error('Webview is not available');
  }
  // We return a proxy that routes executeJavaScript to the webview's webContents
  return {
    executeJavaScript: (code) => webviewContents.executeJavaScript(code),
    capturePage: (rect) => webviewContents.capturePage(rect),
  };
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light';

  store = new Store(app);
  createWindow();

  // IPC: Load settings
  ipcMain.handle('load-settings', () => {
    return {
      schools: SCHOOLS,
      defaultSchoolCode: DEFAULT_SCHOOL_CODE,
      schoolCode: store.get('schoolCode', DEFAULT_SCHOOL_CODE),
      username: store.get('username', ''),
      password: store.get('password', ''),
    };
  });

  // IPC: Save settings
  ipcMain.on('save-settings', (event, settings) => {
    if (settings.schoolCode !== undefined) store.set('schoolCode', settings.schoolCode);
    if (settings.username !== undefined) store.set('username', settings.username);
    if (settings.password !== undefined) store.set('password', settings.password);
  });

  // IPC: Start login
  ipcMain.on('start-login', async (event, { username, password, schoolCode }) => {
    try {
      sendStatus('logging-in');
      sendLog('Starting login...');

      store.set('schoolCode', schoolCode);
      store.set('username', username);
      store.set('password', password);

      const webview = await getWebview();
      const success = await automation.loginAccount(
        webview,
        { username, password, schoolCode },
        sendLog
      );

      if (success) {
        sendStatus('logged-in');
        sendLog('Login successful');
      } else {
        sendStatus('error');
        sendLog('Login failed');
      }
    } catch (e) {
      sendStatus('error');
      sendLog(`Login error: ${e.message}`);
    }
  });

  // IPC: Stop login
  ipcMain.on('stop-login', () => {
    automation.stopLogin();
    sendLog('Stopping login...');
    sendStatus('idle');
  });

  // IPC: Start auto play
  ipcMain.on('start-autoplay', async () => {
    try {
      sendStatus('playing');
      const webview = await getWebview();
      await automation.startAutoPlay(webview, sendLog);
      sendStatus('idle');
    } catch (e) {
      sendStatus('error');
      sendLog(`Auto play error: ${e.message}`);
    }
  });

  // IPC: Stop auto play
  ipcMain.on('stop-autoplay', () => {
    automation.stopAutoPlay();
    sendLog('Stopping auto play...');
    sendStatus('idle');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
