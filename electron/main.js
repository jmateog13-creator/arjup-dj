// Arjup DJ com a app d'escriptori.
//
// La mesa es serveix per un esquema propi (arjup://) en comptes de file://:
// Chromium bloqueja els ES modules i els AudioWorklets carregats des de file://,
// que és exactament el motiu pel qual obrir index.html amb doble clic no funciona.
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const SCHEME = 'arjup';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    title: 'Arjup DJ',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  win.loadURL(`${SCHEME}://app/index.html`);
  // Enllaços externs al navegador del sistema, mai en una finestra d'Electron.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  return win;
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.join(ROOT, rel);
    // path traversal: només servim el que viu dins del bundle.
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });

  const win = createWindow();
  if (process.env.ARJUP_SMOKE) smoke(win);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

// Check runnable: `ARJUP_SMOKE=1 npm start`. Falla si el protocol propi deixa de
// servir la mesa (ES modules / worklets), que és tot el que aquest main aporta.
async function smoke(win) {
  await new Promise((done) => win.webContents.once('did-finish-load', done));
  await win.webContents.executeJavaScript("document.getElementById('start-btn').click()", true);
  await new Promise((done) => setTimeout(done, 3000));
  const r = await win.webContents.executeJavaScript(
    "({knobs: document.querySelectorAll('.mixer-knob').length,"
    + " tracks: document.querySelectorAll('.browser-table tbody tr').length,"
    + " origin: location.origin})"
  );
  const ok = r.knobs === 10 && r.tracks > 0;
  console.log(`SMOKE ${ok ? 'OK' : 'FAIL'} ${JSON.stringify(r)}`);
  app.exit(ok ? 0 : 1);
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
