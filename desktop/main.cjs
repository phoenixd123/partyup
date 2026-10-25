// PartyUp desktop shell (Electron). Loads the built web app from disk; all data
// goes to the Supabase project baked into the build.
//
// Sign-in links (Google sign-in, email confirmation, password reset) come back as
// partyup://auth-callback?code=… — the app registers that scheme with the OS and
// hands the link to the page, which finishes sign-in with Supabase (PKCE).
const { app, BrowserWindow, shell, Menu, ipcMain, session, desktopCapturer } = require('electron');
const path = require('node:path');

const SCHEME = 'partyup';
const isExternal = (url) => /^https:\/\//i.test(url) || /^http:\/\//i.test(url);
const isAuthCallback = (url) => typeof url === 'string' && url.toLowerCase().startsWith(`${SCHEME}://`);

let mainWindow = null;
let pendingCallback = null;

// Register partyup:// (in development the executable needs the app path as an argument).
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(SCHEME);
}

function deliverCallback(url) {
  if (!isAuthCallback(url)) return;
  // Kept until the page collects it, in case the page isn't listening yet;
  // the page ignores a link it has already handled.
  pendingCallback = url;
  if (mainWindow && !mainWindow.webContents.isLoading()) mainWindow.webContents.send('partyup:auth-callback', url);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#111214',
    title: 'PartyUp',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Links to websites open in the user's browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (isExternal(url)) shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('partyup:open-external', (_event, url) => {
  if (!/^https:\/\//i.test(url)) throw new Error('Only https links can be opened.');
  return shell.openExternal(url);
});
ipcMain.handle('partyup:take-pending-callback', () => {
  const url = pendingCallback;
  pendingCallback = null;
  return url;
});

// Single instance: a second launch (e.g. Windows/Linux opening a partyup:// link)
// focuses the existing window and passes the link along.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(isAuthCallback);
    if (url) deliverCallback(url);
    else if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  // macOS delivers links through open-url (can fire before the app is ready).
  app.on('open-url', (event, url) => { event.preventDefault(); deliverCallback(url); });

  // Windows/Linux: the link is a command-line argument when it launched the app.
  const launchUrl = process.argv.find(isAuthCallback);
  if (launchUrl) pendingCallback = launchUrl;

  app.whenReady().then(() => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    // Calls: allow the microphone, camera and screen sharing for the app's own pages only.
    const ALLOWED = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
      cb(ALLOWED.has(permission) && String(details?.requestingUrl || wc.getURL()).startsWith('file://'));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => ALLOWED.has(permission) && (!origin || origin === 'file://' || origin.startsWith('file:')));
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'] })
        .then((sources) => callback(sources.length ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    }, { useSystemPicker: true });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
