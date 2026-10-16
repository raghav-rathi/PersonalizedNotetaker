const { BrowserWindow, globalShortcut, ipcMain, screen, Menu } = require('electron');
const path = require('node:path');
const storage = require('../storage');
const { startOptionTapMonitor, stopOptionTapMonitor } = require('./optionTapMonitor');
const { handleCodingCommand } = require('./gemini');
const {
    canRegisterGlobalShortcut,
    getDefaultToggleVisibility,
    mergeKeybinds,
    getOverlayRestoreMethod,
    shouldUseTransparentOverlay,
    getOverlayBackgroundColor,
    shouldShowWindowOnCreate,
} = require('./overlayVisibility');
const { clampBoundsToWorkArea, resizeBounds } = require('./windowBounds');

let mouseEventsIgnored = false;
let stealthHidden = false;
let lastVisibilityToggleAt = 0;
let windowIpcContext = null;
// The live overlay remembers its own size and place: 'live' for normal answers, 'coding' in coding mode,
// null while the full app window shows. Saved in preferences as overlayBounds.
let overlayMode = null;
let resizeStart = null;
let saveBoundsTimer = null;
let windowIpcRegistered = false;

function isOverlayShown(mainWindow) {
    return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !stealthHidden);
}

function setClickThrough(mainWindow, enabled) {
    mouseEventsIgnored = enabled;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (enabled) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
        mainWindow.setIgnoreMouseEvents(false);
    }
    mainWindow.webContents.send('click-through-toggled', enabled);
}

function hideOverlayWindow(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed() || stealthHidden) return;
    stealthHidden = true;
    setClickThrough(mainWindow, true);
    mainWindow.webContents.send('stealth-hidden-changed', true);
    mainWindow.hide();
}

function restoreOverlayWindow(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // A hidden Dock icon makes macOS ignore showInactive() on a normal window, and hiding
    // the Dock icon again immediately after show() takes the window back down.
    if (process.platform === 'darwin') {
        mainWindow.showInactive();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.setAlwaysOnTop(true, 'floating');
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        if (typeof mainWindow.moveTop === 'function') mainWindow.moveTop();
        return;
    }
    if (getOverlayRestoreMethod(process.platform) === 'show') {
        mainWindow.show();
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        if (typeof mainWindow.moveTop === 'function') {
            mainWindow.moveTop();
        }
        return;
    }
    mainWindow.showInactive();
}

function showOverlayWindow(mainWindow) {
    stealthHidden = false;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    setClickThrough(mainWindow, false);
    if (!mainWindow.isVisible()) {
        restoreOverlayWindow(mainWindow);
    }
    mainWindow.webContents.send('stealth-hidden-changed', false);
}

function setWindowFrame(mainWindow, width, height, x, y) {
    const wasResizable = mainWindow.isResizable();
    if (!wasResizable) {
        mainWindow.setResizable(true);
    }
    mainWindow.setSize(width, height);
    mainWindow.setPosition(x, y);
    if (!wasResizable) {
        mainWindow.setResizable(false);
    }
}

function getTopCenteredBounds(width, height) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea || { x: 0, y: 0, ...primaryDisplay.workAreaSize };
    return clampBoundsToWorkArea({
        x: workArea.x + Math.floor((workArea.width - width) / 2),
        y: workArea.y,
        width,
        height,
    }, workArea);
}

function keepWindowOnScreen(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
    const next = clampBoundsToWorkArea(bounds, display.workArea);
    if (Object.keys(next).some(key => next[key] !== bounds[key])) mainWindow.setBounds(next);
}

function toggleOverlayVisibility(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const now = Date.now();
    if (now - lastVisibilityToggleAt < 250) return;
    lastVisibilityToggleAt = now;
    if (isOverlayShown(mainWindow)) {
        hideOverlayWindow(mainWindow);
    } else {
        showOverlayWindow(mainWindow);
    }
}

function createWindow(sendToRenderer, geminiSessionRef) {
    const isWin = process.platform === 'win32';
    const windowWidth = 1100;
    const windowHeight = 800;
    const startBounds = getTopCenteredBounds(windowWidth, windowHeight);

    if (isWin) {
        try {
            Menu.setApplicationMenu(null);
        } catch (error) {
            console.warn('Could not remove application menu:', error.message);
        }
    }

    const mainWindow = new BrowserWindow({
        width: startBounds.width,
        height: startBounds.height,
        x: startBounds.x,
        y: startBounds.y,
        show: shouldShowWindowOnCreate(process.platform),
        frame: false,
        transparent: shouldUseTransparentOverlay(process.platform),
        hasShadow: false,
        alwaysOnTop: true,
        ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
        skipTaskbar: isWin,
        roundedCorners: !isWin,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // TODO: change to true
            backgroundThrottling: false,
            enableBlinkFeatures: 'GetDisplayMedia',
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        backgroundColor: getOverlayBackgroundColor(process.platform),
    });

    const { session, desktopCapturer } = require('electron');
    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
                callback({ video: sources[0], audio: 'loopback' });
            });
        },
        { useSystemPicker: true }
    );

    mainWindow.setResizable(false);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (process.platform === 'darwin') {
        try {
            mainWindow.setHiddenInMissionControl(true);
        } catch (error) {
            console.warn('Could not hide from Mission Control:', error.message);
        }
        mainWindow.setContentProtection(true);
    }

    if (isWin) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        mainWindow.setContentProtection(true);
        try {
            mainWindow.setSkipTaskbar(true);
        } catch (error) {
            console.warn('Could not hide from taskbar:', error.message);
        }
        if (!mainWindow.isVisible()) {
            mainWindow.show();
        }
        if (typeof mainWindow.moveTop === 'function') {
            mainWindow.moveTop();
        }
    }

    let hookStartedForWindow = false;
    const startHideShortcut = () => {
        if (hookStartedForWindow || mainWindow.isDestroyed()) return;
        hookStartedForWindow = true;
        const startMonitor = () => startOptionTapMonitor(() => toggleOverlayVisibility(mainWindow));
        if (startMonitor()) return;
        console.warn(
            isWin
                ? 'Alt tap hide is unavailable; Ctrl+\\ still toggles visibility.'
                : 'Option tap hide requires Accessibility on macOS; Cmd+\\ still toggles visibility.'
        );
        if (isWin) return;
        // The packaged app gets Accessibility only after launch (a terminal run borrows the
        // terminal's grant), so start the Option hook as soon as the user allows it.
        const retry = setInterval(() => {
            if (mainWindow.isDestroyed()) return clearInterval(retry);
            if (!startMonitor()) return;
            clearInterval(retry);
            console.log('Accessibility granted; Option tap hide is on');
        }, 2000);
    };

    if (isWin) {
        mainWindow.webContents.once('did-finish-load', startHideShortcut);
    } else {
        mainWindow.once('ready-to-show', () => {
            if (!mainWindow.isDestroyed()) {
                mainWindow.show();
            }
            startHideShortcut();
        });
        setTimeout(() => {
            if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                mainWindow.show();
            }
            startHideShortcut();
        }, 2000);
    }

    mainWindow.loadFile(path.join(__dirname, '../index.html'));

    const displayChanged = () => keepWindowOnScreen(mainWindow);
    screen.on('display-removed', displayChanged);
    screen.on('display-metrics-changed', displayChanged);
    mainWindow.once('closed', () => {
        screen.removeListener('display-removed', displayChanged);
        screen.removeListener('display-metrics-changed', displayChanged);
        stopOptionTapMonitor();
        globalShortcut.unregisterAll();
    });

    mainWindow.webContents.once('dom-ready', () => {
        startHideShortcut();
        setTimeout(() => {
            const defaultKeybinds = getDefaultKeybinds();
            const savedKeybinds = storage.getKeybinds();
            const keybinds = mergeKeybinds(defaultKeybinds, savedKeybinds, process.platform);
            if (process.platform === 'win32' && savedKeybinds && savedKeybinds.toggleVisibility === 'Ctrl+\\') {
                storage.setKeybinds(keybinds);
            }
            updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }, 150);
    });

    setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef);

    return mainWindow;
}

function getDefaultKeybinds() {
    const isMac = process.platform === 'darwin';
    return {
        moveUp: isMac ? 'Alt+Up' : 'Ctrl+Up',
        moveDown: isMac ? 'Alt+Down' : 'Ctrl+Down',
        moveLeft: isMac ? 'Alt+Left' : 'Ctrl+Left',
        moveRight: isMac ? 'Alt+Right' : 'Ctrl+Right',
        toggleVisibility: getDefaultToggleVisibility(process.platform),
        toggleClickThrough: isMac ? 'Cmd+M' : 'Ctrl+M',
        nextStep: isMac ? 'Cmd+Enter' : 'Ctrl+Enter',
        previousResponse: isMac ? 'Cmd+[' : 'Ctrl+[',
        nextResponse: isMac ? 'Cmd+]' : 'Ctrl+]',
        scrollUp: isMac ? 'Cmd+Shift+Up' : 'Ctrl+Shift+Up',
        scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down',
        emergencyErase: isMac ? 'Cmd+Shift+E' : 'Ctrl+Shift+E',
        // Answer screens and coding mode. Cmd+Option on Mac and Alt+Shift on Windows, because plain Cmd/Ctrl
        // with arrows or digits already belongs to editors and browsers (line start/end, tab switching).
        showMainAnswers: isMac ? 'Cmd+Alt+Left' : 'Alt+Shift+Left',
        showFollowUps: isMac ? 'Cmd+Alt+Right' : 'Alt+Shift+Right',
        codingNewProblem: isMac ? 'Cmd+Alt+1' : 'Alt+Shift+1',
        codingPartTwo: isMac ? 'Cmd+Alt+2' : 'Alt+Shift+2',
        codingStartCoding: isMac ? 'Cmd+Alt+3' : 'Alt+Shift+3',
        codingNextStep: isMac ? 'Cmd+Alt+4' : 'Alt+Shift+4',
        codingFullCode: isMac ? 'Cmd+Alt+5' : 'Alt+Shift+5',
        codingDryRun: isMac ? 'Cmd+Alt+6' : 'Alt+Shift+6',
        codingExit: isMac ? 'Cmd+Alt+9' : 'Alt+Shift+9',
    };
}

function updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef) {
    console.log('Updating global shortcuts with:', keybinds);

    // Unregister all existing shortcuts
    globalShortcut.unregisterAll();

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const moveIncrement = Math.floor(Math.min(width, height) * 0.1);

    // Register window movement shortcuts
    const movementActions = {
        moveUp: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX, currentY - moveIncrement);
        },
        moveDown: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX, currentY + moveIncrement);
        },
        moveLeft: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX - moveIncrement, currentY);
        },
        moveRight: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX + moveIncrement, currentY);
        },
    };

    // Register each movement shortcut
    Object.keys(movementActions).forEach(action => {
        const keybind = keybinds[action];
        if (keybind) {
            try {
                globalShortcut.register(keybind, movementActions[action]);
                console.log(`Registered ${action}: ${keybind}`);
            } catch (error) {
                console.error(`Failed to register ${action} (${keybind}):`, error);
            }
        }
    });

    // Register toggle visibility shortcut. Electron cannot register Alt by itself.
    if (canRegisterGlobalShortcut(keybinds.toggleVisibility)) {
        try {
            globalShortcut.register(keybinds.toggleVisibility, () => {
                toggleOverlayVisibility(mainWindow);
            });
            console.log(`Registered toggleVisibility: ${keybinds.toggleVisibility}`);
        } catch (error) {
            console.error(`Failed to register toggleVisibility (${keybinds.toggleVisibility}):`, error);
        }
    } else {
        console.log(`Skipping globalShortcut for toggleVisibility: ${keybinds.toggleVisibility} (handled by Alt tap)`);
    }

    // Alt/Option needs the key hook; keep a real shortcut so a hidden overlay can always come back.
    const fallbackToggle = { win32: 'Ctrl+\\', darwin: 'Cmd+\\' }[process.platform];
    if (fallbackToggle && keybinds.toggleVisibility === 'Alt') {
        try {
            globalShortcut.register(fallbackToggle, () => {
                toggleOverlayVisibility(mainWindow);
            });
            console.log(`Registered fallback toggleVisibility: ${fallbackToggle}`);
        } catch (error) {
            console.error(`Failed to register fallback toggleVisibility (${fallbackToggle}):`, error);
        }
    }

    // Register toggle click-through shortcut
    if (keybinds.toggleClickThrough) {
        try {
            globalShortcut.register(keybinds.toggleClickThrough, () => {
                setClickThrough(mainWindow, !mouseEventsIgnored);
                console.log(mouseEventsIgnored ? 'Mouse events ignored' : 'Mouse events enabled');
            });
            console.log(`Registered toggleClickThrough: ${keybinds.toggleClickThrough}`);
        } catch (error) {
            console.error(`Failed to register toggleClickThrough (${keybinds.toggleClickThrough}):`, error);
        }
    }

    // Register next step shortcut (either starts session or takes screenshot based on view)
    if (keybinds.nextStep) {
        try {
            globalShortcut.register(keybinds.nextStep, async () => {
                console.log('Next step shortcut triggered');
                try {
                    // Determine the shortcut key format
                    const isMac = process.platform === 'darwin';
                    const shortcutKey = isMac ? 'cmd+enter' : 'ctrl+enter';

                    // Use the new handleShortcut function
                    mainWindow.webContents.executeJavaScript(`
                        cheatingDaddy.handleShortcut('${shortcutKey}');
                    `);
                } catch (error) {
                    console.error('Error handling next step shortcut:', error);
                }
            });
            console.log(`Registered nextStep: ${keybinds.nextStep}`);
        } catch (error) {
            console.error(`Failed to register nextStep (${keybinds.nextStep}):`, error);
        }
    }

    // Register previous response shortcut
    if (keybinds.previousResponse) {
        try {
            globalShortcut.register(keybinds.previousResponse, () => {
                console.log('Previous response shortcut triggered');
                sendToRenderer('navigate-previous-response');
            });
            console.log(`Registered previousResponse: ${keybinds.previousResponse}`);
        } catch (error) {
            console.error(`Failed to register previousResponse (${keybinds.previousResponse}):`, error);
        }
    }

    // Register next response shortcut
    if (keybinds.nextResponse) {
        try {
            globalShortcut.register(keybinds.nextResponse, () => {
                console.log('Next response shortcut triggered');
                sendToRenderer('navigate-next-response');
            });
            console.log(`Registered nextResponse: ${keybinds.nextResponse}`);
        } catch (error) {
            console.error(`Failed to register nextResponse (${keybinds.nextResponse}):`, error);
        }
    }

    // Register scroll up shortcut
    if (keybinds.scrollUp) {
        try {
            globalShortcut.register(keybinds.scrollUp, () => {
                console.log('Scroll up shortcut triggered');
                sendToRenderer('scroll-response-up');
            });
            console.log(`Registered scrollUp: ${keybinds.scrollUp}`);
        } catch (error) {
            console.error(`Failed to register scrollUp (${keybinds.scrollUp}):`, error);
        }
    }

    // Register scroll down shortcut
    if (keybinds.scrollDown) {
        try {
            globalShortcut.register(keybinds.scrollDown, () => {
                console.log('Scroll down shortcut triggered');
                sendToRenderer('scroll-response-down');
            });
            console.log(`Registered scrollDown: ${keybinds.scrollDown}`);
        } catch (error) {
            console.error(`Failed to register scrollDown (${keybinds.scrollDown}):`, error);
        }
    }

    const runCodingCommand = name => {
        const result = handleCodingCommand(name);
        if (result.error) sendToRenderer('update-status', result.error);
    };
    const commandActions = {
        showMainAnswers: () => sendToRenderer('switch-answer-screen', 'main'),
        showFollowUps: () => sendToRenderer('switch-answer-screen', 'side'),
        codingNewProblem: () => runCodingCommand('new'),
        codingPartTwo: () => runCodingCommand('better'),
        codingStartCoding: () => runCodingCommand('code'),
        codingNextStep: () => runCodingCommand('next'),
        codingFullCode: () => runCodingCommand('full'),
        codingDryRun: () => runCodingCommand('dryrun'),
        codingExit: () => runCodingCommand('exit'),
    };
    for (const [action, run] of Object.entries(commandActions)) {
        const keybind = keybinds[action];
        if (!keybind) continue;
        try {
            // register() returns false when another app already owns the chord.
            if (globalShortcut.register(keybind, run)) console.log(`Registered ${action}: ${keybind}`);
            else console.warn(`Could not register ${action} (${keybind}): another app already uses it`);
        } catch (error) {
            console.error(`Failed to register ${action} (${keybind}):`, error);
        }
    }

    // Register emergency erase shortcut
    if (keybinds.emergencyErase) {
        try {
            globalShortcut.register(keybinds.emergencyErase, () => {
                console.log('Emergency Erase triggered!');
                if (mainWindow && !mainWindow.isDestroyed()) {
                    stopOptionTapMonitor();
                    mainWindow.hide();

                    if (geminiSessionRef.current) {
                        geminiSessionRef.current.close();
                        geminiSessionRef.current = null;
                    }

                    sendToRenderer('clear-sensitive-data');

                    setTimeout(() => {
                        const { app } = require('electron');
                        app.quit();
                    }, 300);
                }
            });
            console.log(`Registered emergencyErase: ${keybinds.emergencyErase}`);
        } catch (error) {
            console.error(`Failed to register emergencyErase (${keybinds.emergencyErase}):`, error);
        }
    }
}

/** @param {'live'|'coding'} mode */
function savedOverlayBounds(mode) {
    const saved = storage.getPreferences().overlayBounds?.[mode];
    return saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) ? saved : null;
}

function saveOverlayBounds(mainWindow) {
    if (!overlayMode) return;
    const overlayBounds = { ...(storage.getPreferences().overlayBounds || {}), [overlayMode]: mainWindow.getBounds() };
    storage.updatePreference('overlayBounds', overlayBounds);
}

/** Keeps the overlay on the display it is on, at least the minimum size. */
function applyOverlayBounds(mainWindow, bounds) {
    const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
    const next = clampBoundsToWorkArea(bounds, display.workArea);
    setWindowFrame(mainWindow, next.width, next.height, next.x, next.y);
}

function setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef) {
    windowIpcContext = { mainWindow, sendToRenderer, geminiSessionRef };

    // The overlay is resized from handles drawn on its edges, because a transparent frameless window has none.
    ipcMain.on('overlay-resize-start', () => {
        const { mainWindow } = windowIpcContext || {};
        if (mainWindow && !mainWindow.isDestroyed()) resizeStart = mainWindow.getBounds();
    });
    ipcMain.on('overlay-resize', (event, { edge, dx, dy } = {}) => {
        const { mainWindow } = windowIpcContext || {};
        if (!resizeStart || !mainWindow || mainWindow.isDestroyed()) return;
        applyOverlayBounds(mainWindow, resizeBounds(resizeStart, String(edge || ''), Number(dx) || 0, Number(dy) || 0));
    });
    ipcMain.on('overlay-resize-end', () => {
        const { mainWindow } = windowIpcContext || {};
        resizeStart = null;
        if (mainWindow && !mainWindow.isDestroyed()) saveOverlayBounds(mainWindow);
    });
    // Dragging the top bar or Option+arrows moves the overlay; remember where it ended up.
    mainWindow.on('moved', () => {
        clearTimeout(saveBoundsTimer);
        saveBoundsTimer = setTimeout(() => !mainWindow.isDestroyed() && saveOverlayBounds(mainWindow), 300);
    });
    if (windowIpcRegistered) return;
    windowIpcRegistered = true;
    ipcMain.on('coding-layout', (event, coding) => {
        const { mainWindow } = windowIpcContext || {};
        if (!mainWindow || mainWindow.isDestroyed()) return;
        overlayMode = coding ? 'coding' : 'live';
        const bounds = mainWindow.getBounds();
        const width = coding ? 1100 : 850;
        // With no saved size, grow or shrink around the current centre, so a window the user moved stays where it is.
        const next = savedOverlayBounds(overlayMode) || { ...bounds, x: bounds.x + Math.round((bounds.width - width) / 2), width };
        applyOverlayBounds(mainWindow, next);
    });

    ipcMain.on('view-changed', (event, view) => {
        const { mainWindow } = windowIpcContext || {};
        if (!mainWindow) return;
        if (!mainWindow.isDestroyed()) {
            if (view === 'assistant') {
                overlayMode = 'live';
                applyOverlayBounds(mainWindow, savedOverlayBounds('live') || getTopCenteredBounds(850, 400));
            } else {
                overlayMode = null;
                const full = getTopCenteredBounds(1100, 800);
                setWindowFrame(mainWindow, full.width, full.height, full.x, full.y);
                mainWindow.setIgnoreMouseEvents(false);
            }
        }
    });

    ipcMain.handle('window-minimize', () => {
        const { mainWindow } = windowIpcContext || {};
        if (!mainWindow) return;
        if (!mainWindow.isDestroyed()) {
            mainWindow.minimize();
        }
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        const { mainWindow, sendToRenderer, geminiSessionRef } = windowIpcContext || {};
        if (!mainWindow) return;
        if (!mainWindow.isDestroyed()) {
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }
    });

    ipcMain.handle('toggle-window-visibility', async event => {
        try {
            const { mainWindow } = windowIpcContext || {};
            if (!mainWindow) return { success: false, error: 'Window is unavailable' };
            if (mainWindow.isDestroyed()) {
                return { success: false, error: 'Window has been destroyed' };
            }

            toggleOverlayVisibility(mainWindow);
            return { success: true };
        } catch (error) {
            console.error('Error toggling window visibility:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-sizes', async event => {
        // With the sidebar layout, the window size is user-controlled.
        // This handler is kept for compatibility but is a no-op now.
        return { success: true };
    });
}

module.exports = {
    createWindow,
    getDefaultKeybinds,
    updateGlobalShortcuts,
    setupWindowIpcHandlers,
    toggleOverlayVisibility,
    hideOverlayWindow,
    showOverlayWindow,
    keepWindowOnScreen,
};
