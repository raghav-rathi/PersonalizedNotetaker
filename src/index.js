if (require('electron-squirrel-startup')) {
    process.exit(0);
}

const { app, BrowserWindow, shell, ipcMain, Tray, Menu } = require('electron');
const path = require('node:path');

// Electron 29.1+ ScreenCaptureKit thumbnails are empty on macOS. Disable that path
// so Analyze Screen can get a real JPEG. https://github.com/electron/electron/issues/44504
if (process.platform === 'darwin') {
    app.commandLine.appendSwitch(
        'disable-features',
        ['ThumbnailCapturerMac:capture_mode/sc_screenshot_manager', 'ScreenCaptureKitPickerScreen', 'ScreenCaptureKitStreamPickerSonoma'].join(',')
    );
}

if (process.platform === 'win32') {
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// A Finder-launched app has no terminal, so keep the main-process log in ~/Library/Logs/<app>/main.log.
if (app.isPackaged) {
    const util = require('node:util');
    const log = require('node:fs').createWriteStream(path.join(app.getPath('logs'), 'main.log'), { flags: 'w' });
    for (const level of ['log', 'info', 'warn', 'error']) {
        const original = console[level];
        console[level] = (...args) => {
            log.write(`${new Date().toISOString()} ${level} ${util.format(...args)}\n`);
            original(...args);
        };
    }
}

const { createWindow } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const storage = require('./storage');
const { startDiagnostics } = require('./utils/diagnostics');

// Electron's default for an uncaught error is a modal error box: a window that screen sharing shows and that
// blocks the app until it is dismissed. The error goes to the log and the status bar instead.
process.on('uncaughtException', error => {
    console.error('Uncaught error in the main process:', error);
    try {
        sendToRenderer('update-status', `Error: ${error.message}`);
    } catch {}
});

const geminiSessionRef = { current: null };
let mainWindow = null;
let tray = null;
let stopDiagnostics = null;
let rendererReady = false;
let recoveringRenderer = false;

function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop?.();
}

function createTray() {
    // On macOS a Tray icon sits in the menu bar next to Wi-Fi. The window is already
    // in the Dock, and Option-tap shows it again, so the logo there only gives the app away.
    if (process.platform === 'darwin') return;
    if (tray) return;
    const icon = path.join(__dirname, 'assets', process.platform === 'win32' ? 'logo.ico' : 'logo.png');
    tray = new Tray(icon);
    // The tooltip shows in a screen share when the pointer rests on the icon, so it carries the product name.
    tray.setToolTip(app.getName());
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: 'Show', click: showMainWindow },
            {
                label: 'Stop meeting',
                click: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('stop-meeting-requested'),
            },
            { type: 'separator' },
            { label: 'Quit', click: () => app.quit() },
        ])
    );
    tray.on('double-click', showMainWindow);
}

// A dialog would be a window of its own, which screen sharing shows, so the window reloads by itself. Until the
// reloaded page reports ready, another failure is left alone, so a page that can't load doesn't reload forever.
function recoverFromRendererFailure(reason) {
    if (recoveringRenderer) return;
    recoveringRenderer = true;
    stopMacOSAudioCapture();
    try {
        geminiSessionRef.current?.close?.();
    } catch (_) {}
    geminiSessionRef.current = null;
    console.error(`The meeting window stopped responding, so capture stopped and the window reloads. ${reason}`);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.webContents.isCrashed()) {
        mainWindow.webContents.send('stop-meeting-requested');
        mainWindow.webContents.forcefullyCrashRenderer();
    }
    // Right after forcefullyCrashRenderer, reload starts a new renderer process.
    mainWindow.reload();
}

function createMainWindow() {
    rendererReady = false;
    mainWindow = createWindow(sendToRenderer, geminiSessionRef);
    mainWindow.webContents.on('did-fail-load', (_event, code, description) => recoverFromRendererFailure(`Page load failed (${code}: ${description}).`));
    mainWindow.webContents.on('render-process-gone', (_event, details) => recoverFromRendererFailure(`Renderer exited: ${details.reason}.`));
    mainWindow.on('unresponsive', () => recoverFromRendererFailure('You can reload the interface and start capture again.'));
    mainWindow.once('closed', () => {
        mainWindow = null;
    });
    setTimeout(() => {
        if (!rendererReady && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            console.warn('Renderer-ready handshake timed out; keeping the recovery window visible');
        }
    }, 10000).unref?.();
    return mainWindow;
}

app.whenReady().then(async () => {
    // Initialize storage (checks version, resets if needed)
    storage.initializeStorage();

    // Trigger screen recording permission prompt on macOS if not already granted
    if (process.platform === 'darwin') {
        const { desktopCapturer } = require('electron');
        desktopCapturer.getSources({ types: ['screen'] }).catch(() => {});
    }

    createMainWindow();
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    createTray();
    stopDiagnostics = startDiagnostics({ app, BrowserWindow, directory: path.join(app.getPath('logs'), 'diagnostics') });
    setupGeminiIpcHandlers(geminiSessionRef);
    // The settings-folder prompts can link into ~/Downloads; read them now so any macOS access prompt shows at launch.
    const { loadCodingSkill, loadIncidentSkill } = require('./utils/codingSession');
    loadCodingSkill();
    loadIncidentSkill();
    setupStorageIpcHandlers();
    setupGeneralIpcHandlers();
});

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopDiagnostics?.();
    stopMacOSAudioCapture();
    try {
        require('./utils/optionTapMonitor').stopOptionTapMonitor();
    } catch (error) {
        // ignore
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

function setupStorageIpcHandlers() {
    // ============ CONFIG ============
    ipcMain.handle('storage:get-config', async () => {
        try {
            return { success: true, data: storage.getConfig() };
        } catch (error) {
            console.error('Error getting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-config', async (event, config) => {
        try {
            storage.setConfig(config);
            return { success: true };
        } catch (error) {
            console.error('Error setting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-config', async (event, key, value) => {
        try {
            storage.updateConfig(key, value);
            return { success: true };
        } catch (error) {
            console.error('Error updating config:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ CREDENTIALS ============
    ipcMain.handle('storage:get-credentials', async () => {
        try {
            return { success: true, data: storage.getCredentials() };
        } catch (error) {
            console.error('Error getting credentials:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-credentials', async (event, credentials) => {
        try {
            storage.setCredentials(credentials);
            return { success: true };
        } catch (error) {
            console.error('Error setting credentials:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-api-key', async () => {
        try {
            return { success: true, data: storage.getApiKey() };
        } catch (error) {
            console.error('Error getting API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-api-key', async (event, apiKey) => {
        try {
            storage.setApiKey(apiKey);
            return { success: true };
        } catch (error) {
            console.error('Error setting API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-groq-api-key', async () => {
        try {
            return { success: true, data: storage.getGroqApiKey() };
        } catch (error) {
            console.error('Error getting Groq API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-groq-api-key', async (event, groqApiKey) => {
        try {
            storage.setGroqApiKey(groqApiKey);
            return { success: true };
        } catch (error) {
            console.error('Error setting Groq API key:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ PREFERENCES ============
    ipcMain.handle('storage:get-preferences', async () => {
        try {
            return { success: true, data: storage.getPreferences() };
        } catch (error) {
            console.error('Error getting preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-preferences', async (event, preferences) => {
        try {
            storage.setPreferences(preferences);
            return { success: true };
        } catch (error) {
            console.error('Error setting preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-preference', async (event, key, value) => {
        try {
            storage.updatePreference(key, value);
            return { success: true };
        } catch (error) {
            console.error('Error updating preference:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ KEYBINDS ============
    ipcMain.handle('storage:get-keybinds', async () => {
        try {
            return { success: true, data: storage.getKeybinds() };
        } catch (error) {
            console.error('Error getting keybinds:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-keybinds', async (event, keybinds) => {
        try {
            storage.setKeybinds(keybinds);
            return { success: true };
        } catch (error) {
            console.error('Error setting keybinds:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ HISTORY ============
    ipcMain.handle('storage:get-all-sessions', async () => {
        try {
            return { success: true, data: await storage.getArchivedSessions() };
        } catch (error) {
            console.error('Error getting sessions:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-session', async (event, sessionId) => {
        try {
            return { success: true, data: await storage.getArchivedSession(sessionId) };
        } catch (error) {
            console.error('Error getting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-session-page', async (_event, sessionId, cursor, pageSize) => {
        try {
            return { success: true, data: await storage.getSessionPage(sessionId, { cursor, limit: pageSize }) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-session', async (event, sessionId) => {
        try {
            await storage.deleteArchivedSession(sessionId);
            return { success: true };
        } catch (error) {
            console.error('Error deleting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-all-sessions', async () => {
        try {
            await storage.deleteAllArchivedSessions();
            return { success: true };
        } catch (error) {
            console.error('Error deleting all sessions:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ LIMITS ============
    ipcMain.handle('storage:get-today-limits', async () => {
        try {
            return { success: true, data: storage.getTodayLimits() };
        } catch (error) {
            console.error('Error getting today limits:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ CLEAR ALL ============
    ipcMain.handle('storage:clear-all', async () => {
        try {
            storage.clearAllData();
            return { success: true };
        } catch (error) {
            console.error('Error clearing all data:', error);
            return { success: false, error: error.message };
        }
    });
}

function setupGeneralIpcHandlers() {
    ipcMain.on('renderer-ready', event => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return;
        rendererReady = true;
        recoveringRenderer = false;
    });
    ipcMain.handle('get-app-version', async () => {
        return app.getVersion();
    });

    ipcMain.handle('quit-application', async event => {
        try {
            stopMacOSAudioCapture();
            app.quit();
            return { success: true };
        } catch (error) {
            console.error('Error quitting application:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-external', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    // Debug logging from renderer
    ipcMain.on('log-message', (event, msg) => {
        console.log(msg);
    });
}
