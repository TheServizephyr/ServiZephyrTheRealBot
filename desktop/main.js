const { app, BrowserWindow, ipcMain, shell, session, Notification, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { createOfflineStore } = require('./offline-store');

let autoUpdater = null;
let autoUpdaterLoadError = null;

try {
  ({ autoUpdater } = require('electron-updater'));
} catch (error) {
  autoUpdaterLoadError = error;
}

const DEFAULT_PORT = Number(process.env.PORT || 3000);
const DEFAULT_HOST = process.env.HOSTNAME || 'localhost';
const isDev = process.env.ELECTRON_DEV === '1' || !(app && app.isPackaged);
const APP_USER_MODEL_ID = 'com.servizephyr.desktop';
const DEFAULT_UPDATER_CACHE_DIR_NAME = 'servizephyr-main-app-updater';

let mainWindow = null;
let nextServerProcess = null;
let offlineStore = null;
let cachedDesktopEnvFileValues = null;
let updaterInitialized = false;
let updaterPeriodicTimer = null;
let hasShownDownloadedUpdatePrompt = false;
let updaterState = {
  enabled: false,
  feedUrl: '',
  status: 'idle',
  downloadedVersion: '',
  downloadedFilePath: '',
  availableVersion: '',
  error: '',
  checkedAt: null,
  downloadedAt: null,
};

function getUpdaterStateFilePath() {
  return path.join(app.getPath('userData'), 'desktop-update-state.json');
}

function compareAppVersions(left, right) {
  const leftParts = String(left || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function extractVersionFromText(value) {
  const match = String(value || '').match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : '';
}

function getLocalAppDataPath() {
  if (process.env.LOCALAPPDATA) {
    return process.env.LOCALAPPDATA;
  }

  const roamingAppDataPath = app.getPath('appData');
  return path.join(path.dirname(roamingAppDataPath), 'Local');
}

function getAppUpdateConfigPath() {
  return path.join(process.resourcesPath || '', 'app-update.yml');
}

function getConfiguredUpdaterCacheDirName() {
  try {
    const configPath = getAppUpdateConfigPath();
    if (fs.existsSync(configPath)) {
      const rawConfig = fs.readFileSync(configPath, 'utf8');
      const match = rawConfig.match(/^\s*updaterCacheDirName:\s*(.+?)\s*$/m);
      if (match?.[1]) {
        return String(match[1]).trim();
      }
    }
  } catch (_) {
    // Ignore cache-dir parsing failures and fall back to the known default.
  }

  return DEFAULT_UPDATER_CACHE_DIR_NAME;
}

function getPendingUpdaterDirectoryPath() {
  return path.join(getLocalAppDataPath(), getConfiguredUpdaterCacheDirName(), 'pending');
}

function getPendingDownloadedInstallerInfo(expectedVersion = '') {
  const pendingDirectoryPath = getPendingUpdaterDirectoryPath();
  if (!fs.existsSync(pendingDirectoryPath)) return null;

  const updateInfoPath = path.join(pendingDirectoryPath, 'update-info.json');
  const updateInfo = readJsonFile(updateInfoPath) || {};

  let fileName = String(updateInfo.fileName || '').trim();
  let filePath = fileName ? path.join(pendingDirectoryPath, fileName) : '';

  if (!fileName || !fs.existsSync(filePath)) {
    try {
      const candidates = fs.readdirSync(pendingDirectoryPath)
        .filter((entry) => entry.toLowerCase().endsWith('.exe'))
        .sort((left, right) => right.localeCompare(left));
      const matchingEntry = candidates.find((entry) => {
        if (!expectedVersion) return true;
        return extractVersionFromText(entry) === expectedVersion;
      }) || candidates[0];

      if (matchingEntry) {
        fileName = matchingEntry;
        filePath = path.join(pendingDirectoryPath, matchingEntry);
      }
    } catch (_) {
      return null;
    }
  }

  if (!fileName || !filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const version = extractVersionFromText(updateInfo.version || fileName);
  if (expectedVersion && version && compareAppVersions(version, expectedVersion) !== 0) {
    return null;
  }

  return {
    version,
    fileName,
    filePath,
    updateInfoPath,
  };
}

process.on('uncaughtException', (error) => {
  logDesktopEvent('uncaught-exception', {
    message: error?.message || String(error),
    stack: error?.stack || null,
  });
});

process.on('unhandledRejection', (error) => {
  logDesktopEvent('unhandled-rejection', {
    message: error?.message || String(error),
    stack: error?.stack || null,
  });
});

if (app && process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

const hasSingleInstanceLock = app ? app.requestSingleInstanceLock() : true;
logDesktopEvent('startup-lock-check', {
  hasSingleInstanceLock,
  execPath: process.execPath,
  isPackaged: app ? app.isPackaged : false,
});

function getDesktopWindowIconPath() {
  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  const pngPath = path.join(__dirname, '..', 'public', 'logo.png');
  if (process.platform === 'win32' && fs.existsSync(icoPath)) {
    return icoPath;
  }
  return pngPath;
}

function getLogFilePath() {
  if (app && typeof app.isReady === 'function' && app.isReady()) {
    return path.join(app.getPath('userData'), 'desktop-debug.log');
  }
  return path.join(process.env.TEMP || process.cwd(), 'servizephyr-desktop-debug.log');
}

function logDesktopEvent(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map((part) => {
    if (typeof part === 'string') return part;
    try {
      return JSON.stringify(part);
    } catch {
      return String(part);
    }
  }).join(' ')}\n`;
  try {
    fs.appendFileSync(getLogFilePath(), line, 'utf8');
  } catch (_) {
    // Ignore logging failures.
  }
}

function stripWrappingQuotes(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function hasClosingQuote(value, quote) {
  const trimmed = String(value || '').trimEnd();
  return trimmed.length >= 2 && trimmed.endsWith(quote);
}

function parseEnvText(rawText = '') {
  const parsed = {};
  const lines = String(rawText || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1);
    if (!key) continue;

    const normalizedValue = String(value || '').trimStart();
    const quote = normalizedValue.startsWith('"') || normalizedValue.startsWith("'")
      ? normalizedValue.charAt(0)
      : '';

    if (quote && !hasClosingQuote(normalizedValue, quote)) {
      let buffer = normalizedValue;
      while (index + 1 < lines.length) {
        index += 1;
        buffer += `\n${lines[index]}`;
        if (hasClosingQuote(lines[index], quote)) {
          break;
        }
      }
      value = buffer;
    }

    parsed[key] = stripWrappingQuotes(value);
  }
  return parsed;
}

function getCandidateEnvFiles() {
  const candidates = new Set();
  const roots = [
    process.cwd(),
    app ? app.getAppPath() : '',
    process.execPath ? path.dirname(process.execPath) : '',
    app ? app.getPath('userData') : '',
  ].filter(Boolean);

  for (const root of roots) {
    let current = root;
    for (let i = 0; i < 6; i += 1) {
      candidates.add(path.join(current, '.env.local'));
      candidates.add(path.join(current, '.env'));
      const parent = path.dirname(current);
      if (!parent || parent === current) break;
      current = parent;
    }
  }

  if (app) {
    candidates.add(path.join(app.getPath('userData'), 'desktop.env'));
  }

  return Array.from(candidates);
}

function loadDesktopEnvFileValues() {
  if (cachedDesktopEnvFileValues) {
    return cachedDesktopEnvFileValues;
  }

  const mergedEnv = {};
  const loadedFiles = [];

  for (const filePath of getCandidateEnvFiles()) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = parseEnvText(fs.readFileSync(filePath, 'utf8'));
      Object.assign(mergedEnv, parsed);
      loadedFiles.push(filePath);
    } catch (error) {
      logDesktopEvent('env-load-failed', {
        filePath,
        message: error?.message || String(error),
      });
    }
  }

  if (loadedFiles.length > 0) {
    logDesktopEvent('env-files-loaded', {
      loadedFiles,
      hasServiceAccountJson: Boolean(mergedEnv.FIREBASE_SERVICE_ACCOUNT_JSON),
      hasServiceAccountBase64: Boolean(mergedEnv.FIREBASE_SERVICE_ACCOUNT_BASE64),
    });
  } else {
    logDesktopEvent('env-files-missing');
  }

  cachedDesktopEnvFileValues = mergedEnv;
  return mergedEnv;
}

function getDesktopServerEnv() {
  const fileEnv = loadDesktopEnvFileValues();
  return {
    ...process.env,
    ...fileEnv,
    PORT: String(DEFAULT_PORT),
    HOSTNAME: DEFAULT_HOST,
    NODE_ENV: 'production',
    NEXT_PUBLIC_IS_DESKTOP_APP: '1',
  };
}

function getConfiguredAutoUpdateUrl() {
  const fileEnv = loadDesktopEnvFileValues();
  const rawValue = (
    process.env.DESKTOP_AUTO_UPDATE_URL ||
    process.env.NEXT_PUBLIC_DESKTOP_AUTO_UPDATE_URL ||
    fileEnv.DESKTOP_AUTO_UPDATE_URL ||
    fileEnv.NEXT_PUBLIC_DESKTOP_AUTO_UPDATE_URL ||
    ''
  );
  const normalized = String(rawValue || '').trim().replace(/[\\/]+$/, '');
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function parseBooleanEnvValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function getConfiguredAutoUpdateSource() {
  const fileEnv = loadDesktopEnvFileValues();
  const configuredProvider = String(
    process.env.DESKTOP_AUTO_UPDATE_PROVIDER ||
    fileEnv.DESKTOP_AUTO_UPDATE_PROVIDER ||
    ''
  ).trim().toLowerCase();

  const githubOwner = String(
    process.env.DESKTOP_AUTO_UPDATE_GITHUB_OWNER ||
    fileEnv.DESKTOP_AUTO_UPDATE_GITHUB_OWNER ||
    ''
  ).trim();
  const githubRepo = String(
    process.env.DESKTOP_AUTO_UPDATE_GITHUB_REPO ||
    fileEnv.DESKTOP_AUTO_UPDATE_GITHUB_REPO ||
    ''
  ).trim();
  const githubHost = String(
    process.env.DESKTOP_AUTO_UPDATE_GITHUB_HOST ||
    fileEnv.DESKTOP_AUTO_UPDATE_GITHUB_HOST ||
    'github.com'
  ).trim() || 'github.com';
  const githubPrivate = parseBooleanEnvValue(
    process.env.DESKTOP_AUTO_UPDATE_GITHUB_PRIVATE ||
    fileEnv.DESKTOP_AUTO_UPDATE_GITHUB_PRIVATE ||
    ''
  );

  if (
    configuredProvider === 'github' ||
    (!configuredProvider && githubOwner && githubRepo)
  ) {
    if (!githubOwner || !githubRepo) {
      return null;
    }

    return {
      provider: 'github',
      feedLabel: `github:${githubOwner}/${githubRepo}`,
      feedConfig: {
        provider: 'github',
        owner: githubOwner,
        repo: githubRepo,
        host: githubHost,
        private: githubPrivate,
      },
    };
  }

  const genericUrl = getConfiguredAutoUpdateUrl();
  if (!genericUrl) {
    return null;
  }

  return {
    provider: 'generic',
    feedLabel: genericUrl,
    feedConfig: {
      provider: 'generic',
      url: genericUrl,
    },
  };
}

function updateUpdaterState(patch) {
  updaterState = {
    ...updaterState,
    ...patch,
  };
  logDesktopEvent('auto-updater-state', updaterState);
}

function notifyIfPossible(title, body) {
  try {
    if (Notification && Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (_) {
    // Ignore notification failures.
  }
}

function markDownloadedUpdateReady(info) {
  const pendingInstaller = getPendingDownloadedInstallerInfo(info?.version || '');
  const version = pendingInstaller?.version || info?.version || '';
  const downloadedAt = new Date().toISOString();
  savePersistedUpdaterState({
    version,
    downloadedAt,
    fileName: pendingInstaller?.fileName || '',
    filePath: pendingInstaller?.filePath || '',
  });
  updateUpdaterState({
    status: 'downloaded',
    downloadedVersion: version,
    downloadedFilePath: pendingInstaller?.filePath || '',
    downloadedAt,
    error: '',
  });
}

function hydratePersistedUpdaterState() {
  const persisted = readPersistedUpdaterState();
  const pendingInstaller = getPendingDownloadedInstallerInfo();
  const persistedVersion = String(persisted?.version || '').trim();
  const pendingVersion = String(pendingInstaller?.version || '').trim();
  const effectiveVersion = compareAppVersions(pendingVersion, persistedVersion) >= 0
    ? (pendingVersion || persistedVersion)
    : persistedVersion;

  if (!effectiveVersion) return;

  if (compareAppVersions(effectiveVersion, app.getVersion()) <= 0) {
    clearPersistedUpdaterState();
    updateUpdaterState({
      status: 'idle',
      downloadedVersion: '',
      downloadedFilePath: '',
      downloadedAt: null,
      availableVersion: '',
      error: '',
    });
    return;
  }

  const downloadedFilePath = pendingInstaller?.filePath || String(persisted?.filePath || '');
  if (
    !persisted
    || persisted.version !== effectiveVersion
    || String(persisted.filePath || '') !== downloadedFilePath
  ) {
    savePersistedUpdaterState({
      version: effectiveVersion,
      downloadedAt: persisted?.downloadedAt || null,
      fileName: pendingInstaller?.fileName || String(persisted?.fileName || ''),
      filePath: downloadedFilePath,
    });
  }

  updateUpdaterState({
    status: 'downloaded',
    downloadedVersion: effectiveVersion,
    downloadedFilePath,
    downloadedAt: persisted?.downloadedAt || null,
    error: '',
  });
}

async function installDownloadedUpdateNow() {
  if (!autoUpdater || updaterState.status !== 'downloaded') {
    return false;
  }

  if (compareAppVersions(updaterState.downloadedVersion, app.getVersion()) <= 0) {
    clearPersistedUpdaterState();
    updateUpdaterState({
      status: 'up-to-date',
      downloadedVersion: '',
      downloadedFilePath: '',
      downloadedAt: null,
      availableVersion: '',
      error: '',
    });
    return false;
  }

  const pendingInstaller = getPendingDownloadedInstallerInfo(updaterState.downloadedVersion);
  const installerFilePath = pendingInstaller?.filePath || String(updaterState.downloadedFilePath || '').trim();

  if (installerFilePath && fs.existsSync(installerFilePath)) {
    const openResult = await shell.openPath(installerFilePath);
    if (openResult) {
      updateUpdaterState({
        status: 'error',
        error: openResult,
      });
      return false;
    }

    clearPersistedUpdaterState();
    updateUpdaterState({
      status: 'installing',
      error: '',
    });
    setTimeout(() => {
      app.quit();
    }, 600);
    return true;
  }

  autoUpdater.quitAndInstall(false, true);
  return true;
}

async function promptToInstallDownloadedUpdate() {
  if (!autoUpdater) return;
  if (hasShownDownloadedUpdatePrompt) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (updaterState.status !== 'downloaded' || !updaterState.downloadedVersion) return;
  if (compareAppVersions(updaterState.downloadedVersion, app.getVersion()) <= 0) {
    clearPersistedUpdaterState();
    updateUpdaterState({
      status: 'up-to-date',
      downloadedVersion: '',
      downloadedFilePath: '',
      downloadedAt: null,
      availableVersion: '',
      error: '',
    });
    return;
  }

  hasShownDownloadedUpdatePrompt = true;

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['Install Now', 'Later'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'ServiZephyr Update Ready',
    message: `Version ${updaterState.downloadedVersion} is ready to install.`,
    detail: 'The update has already been downloaded. Install it now if the customer is free, or choose Later and keep working.',
  });

  if (result.response === 0) {
    await installDownloadedUpdateNow();
    return;
  }

  hasShownDownloadedUpdatePrompt = false;
}

function setupAutoUpdater() {
  if (updaterInitialized || isDev || !app.isPackaged) {
    return;
  }

  if (!autoUpdater) {
    updateUpdaterState({
      enabled: false,
      feedUrl: '',
      status: 'disabled',
      error: `electron-updater is unavailable: ${autoUpdaterLoadError?.message || 'module missing'}`,
    });
    logDesktopEvent('auto-updater-missing', {
      message: autoUpdaterLoadError?.message || 'module missing',
      stack: autoUpdaterLoadError?.stack || null,
    });
    return;
  }

  const updateSource = getConfiguredAutoUpdateSource();
  if (!updateSource) {
    updateUpdaterState({
      enabled: false,
      feedUrl: '',
      status: 'disabled',
      error: 'Auto-update is not configured. Set DESKTOP_AUTO_UPDATE_URL or GitHub updater env variables.',
    });
    return;
  }

  updaterInitialized = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableWebInstaller = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.fullChangelog = false;
  autoUpdater.setFeedURL(updateSource.feedConfig);

  const hasPersistedDownloadedUpdate = updaterState.status === 'downloaded' && !!updaterState.downloadedVersion;
  updateUpdaterState({
    enabled: true,
    feedUrl: updateSource.feedLabel,
    status: hasPersistedDownloadedUpdate ? 'downloaded' : 'configured',
    error: '',
  });

  autoUpdater.on('checking-for-update', () => {
    updateUpdaterState({
      status: 'checking',
      checkedAt: new Date().toISOString(),
      error: '',
    });
  });

  autoUpdater.on('update-available', (info) => {
    updateUpdaterState({
      status: 'downloading',
      availableVersion: info?.version || '',
      error: '',
    });
    notifyIfPossible('ServiZephyr update found', `Version ${info?.version || 'new'} is downloading in the background.`);
  });

  autoUpdater.on('update-not-available', () => {
    updateUpdaterState({
      status: 'up-to-date',
      error: '',
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    updateUpdaterState({
      status: 'downloading',
      error: '',
      progressPercent: Math.round(progress?.percent || 0),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    markDownloadedUpdateReady(info);
    notifyIfPossible(
      'ServiZephyr update ready',
      `Version ${info?.version || 'new'} downloaded. Install it later whenever you are free.`
    );
    setTimeout(() => {
      promptToInstallDownloadedUpdate().catch((error) => {
        logDesktopEvent('downloaded-update-prompt-failed', {
          message: error?.message || String(error),
        });
      });
    }, 1500);
  });

  autoUpdater.on('error', (error) => {
    updateUpdaterState({
      status: 'error',
      error: error?.message || String(error),
    });
  });

  const checkForUpdates = () => {
    autoUpdater.checkForUpdates().catch((error) => {
      updateUpdaterState({
        status: 'error',
        error: error?.message || String(error),
      });
    });
  };

  setTimeout(checkForUpdates, 12000);
  updaterPeriodicTimer = setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
}

function getBaseUrl() {
  const configured = String(process.env.ELECTRON_START_URL || '').trim();
  if (configured) return configured;
  return `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
}

function getStartupUrl() {
  const baseUrl = getBaseUrl();
  const configuredPath = String(process.env.ELECTRON_START_PATH || '/login').trim() || '/login';
  return new URL(configuredPath, `${baseUrl}/`).toString();
}

function isAllowedAuthWindow(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = String(url.hostname || '').toLowerCase();
    return (
      host === 'auth.servizephyr.com' ||
      host === 'accounts.google.com' ||
      host === 'apis.google.com' ||
      host.endsWith('.google.com') ||
      host.endsWith('.googleusercontent.com') ||
      host.endsWith('.gstatic.com')
    );
  } catch {
    return false;
  }
}

function getAuthWindowOptions() {
  return {
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    width: 520,
    height: 760,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
}

function attachNavigationGuards(contents) {
  if (!contents || contents.__servizephyrGuardsAttached) return;
  contents.__servizephyrGuardsAttached = true;

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAuthWindow(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: getAuthWindowOptions(),
      };
    }
    shell.openExternal(url).catch(() => null);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(getBaseUrl()) && !isAllowedAuthWindow(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => null);
    }
  });
}

function getPackagedServerEntry() {
  const candidates = [
    path.join(path.dirname(app.getAppPath()), 'app.asar.unpacked', '.next', 'standalone', 'server.js'),
    path.join(path.dirname(app.getAppPath()), 'app.asar.unpacked', 'server.js'),
    path.join(app.getAppPath(), 'server.js'),
    path.join(app.getAppPath(), '.next', 'standalone', 'server.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getPackagedNodeExecutable() {
  const candidates = [
    path.join(process.resourcesPath, 'node-runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
    path.join(path.dirname(process.execPath), 'node.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function isAsarBackedPath(filePath) {
  return filePath.includes(`${path.sep}app.asar${path.sep}`) || filePath.endsWith(`${path.sep}app.asar`);
}

function resolveStandaloneRoot(serverEntry) {
  const entryDir = path.dirname(serverEntry);
  if (isAsarBackedPath(serverEntry)) {
    return entryDir;
  }
  if (fs.existsSync(path.join(entryDir, '.next'))) {
    return entryDir;
  }
  if (path.basename(entryDir) === 'standalone') {
    return entryDir;
  }
  return entryDir;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function savePersistedUpdaterState(payload) {
  writeJsonFile(getUpdaterStateFilePath(), payload);
}

function readPersistedUpdaterState() {
  return readJsonFile(getUpdaterStateFilePath()) || null;
}

function clearPersistedUpdaterState() {
  fs.rmSync(getUpdaterStateFilePath(), { force: true });
}

function resolvePackagedAppRoot(serverEntry) {
  const nestedStandaloneToken = `${path.sep}.next${path.sep}standalone${path.sep}server.js`;
  const nestedStandaloneIndex = serverEntry.lastIndexOf(nestedStandaloneToken);
  if (nestedStandaloneIndex >= 0) {
    return serverEntry.slice(0, nestedStandaloneIndex);
  }
  return path.dirname(serverEntry);
}

function getRuntimeFingerprint(sourceRoot, serverEntry) {
  const relevantPaths = [
    sourceRoot,
    serverEntry,
    path.join(sourceRoot, '.next', 'standalone'),
    path.join(sourceRoot, '.next', 'static'),
    path.join(sourceRoot, 'public'),
    path.join(sourceRoot, '.env.local'),
  ];

  return relevantPaths.map((filePath) => {
    if (!fs.existsSync(filePath)) {
      return `${filePath}:missing`;
    }
    const stats = fs.statSync(filePath);
    return `${filePath}:${stats.size}:${stats.mtimeMs}`;
  }).join('|');
}

function copyDirContents(sourceDir, targetDir) {
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirContents(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function copyPathIfExists(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return;
  const stats = fs.statSync(sourcePath);
  if (stats.isDirectory()) {
    copyDirContents(sourcePath, targetPath);
    return;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function copyMinimalServerRuntime(sourceRoot, runtimeRoot) {
  const copyMap = [
    {
      source: path.join(sourceRoot, '.next', 'standalone'),
      target: path.join(runtimeRoot, '.next', 'standalone'),
    },
    {
      source: path.join(sourceRoot, '.next', 'static'),
      target: path.join(runtimeRoot, '.next', 'static'),
    },
    {
      source: path.join(sourceRoot, 'public'),
      target: path.join(runtimeRoot, 'public'),
    },
    {
      source: path.join(sourceRoot, '.env.local'),
      target: path.join(runtimeRoot, '.env.local'),
    },
  ];

  for (const entry of copyMap) {
    copyPathIfExists(entry.source, entry.target);
  }
}

function prepareWritableServerRuntime(serverEntry) {
  if (isAsarBackedPath(serverEntry)) {
    return {
      serverEntry,
      serverCwd: path.dirname(app.getAppPath()),
    };
  }

  const sourceRoot = resolvePackagedAppRoot(serverEntry);
  const relativeServerEntry = path.relative(sourceRoot, serverEntry);
  const runtimeBaseDir = path.join(app.getPath('userData'), 'desktop-runtime');
  const runtimeRoot = path.join(runtimeBaseDir, 'current');
  const runtimeMetaPath = path.join(runtimeBaseDir, 'runtime-meta.json');
  const fingerprint = getRuntimeFingerprint(sourceRoot, serverEntry);
  const existingMeta = readJsonFile(runtimeMetaPath);
  const runtimeServerEntry = path.join(runtimeRoot, relativeServerEntry);
  const needsRefresh = (
    !fs.existsSync(runtimeServerEntry) ||
    !existingMeta ||
    existingMeta.fingerprint !== fingerprint ||
    existingMeta.sourceRoot !== sourceRoot ||
    existingMeta.relativeServerEntry !== relativeServerEntry
  );

  if (needsRefresh) {
    const refreshStartedAt = Date.now();
    resetDir(runtimeRoot);
    copyMinimalServerRuntime(sourceRoot, runtimeRoot);
    writeJsonFile(runtimeMetaPath, {
      fingerprint,
      sourceRoot,
      relativeServerEntry,
      refreshedAt: new Date().toISOString(),
    });
    logDesktopEvent('desktop-runtime-refreshed', {
      sourceRoot,
      runtimeRoot,
      relativeServerEntry,
      durationMs: Date.now() - refreshStartedAt,
    });
  }

  return {
    serverEntry: runtimeServerEntry,
    serverCwd: resolveStandaloneRoot(runtimeServerEntry),
    runtimeRoot,
  };
}

function ensurePackagedStandaloneAssets(serverEntry) {
  if (isAsarBackedPath(serverEntry)) {
    return;
  }

  const standaloneDir = resolveStandaloneRoot(serverEntry);
  const targetStaticDir = path.join(standaloneDir, '.next', 'static');
  if (fs.existsSync(targetStaticDir)) return;

  const sourceCandidates = [
    path.join(path.dirname(path.dirname(standaloneDir)), '.next', 'static'),
    path.join(standaloneDir, '.next', 'static'),
  ];
  const sourceStaticDir = sourceCandidates.find((candidate) => (
    fs.existsSync(candidate) && path.resolve(candidate) !== path.resolve(targetStaticDir)
  ));

  if (!sourceStaticDir || !fs.existsSync(sourceStaticDir)) return;

  copyDirContents(sourceStaticDir, targetStaticDir);
}

async function waitForServer(targetUrl, timeoutMs = 30000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await fetch(targetUrl, { method: 'GET' });
      if (response.ok || response.status < 500) return true;
    } catch (_) {
      // Keep polling until the local app is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureNextServer() {
  if (isDev || nextServerProcess) return;

  const packagedServerEntry = getPackagedServerEntry();
  if (!packagedServerEntry) {
    throw new Error('Packaged Next server not found. Run `npm run build` before desktop:start.');
  }
  const nodeExecutable = getPackagedNodeExecutable();
  if (!nodeExecutable) {
    throw new Error('Bundled Node runtime not found for desktop server boot.');
  }

  const runtime = prepareWritableServerRuntime(packagedServerEntry);
  const serverEntry = runtime.serverEntry;
  ensurePackagedStandaloneAssets(serverEntry);
  const serverCwd = runtime.serverCwd;
  nextServerProcess = spawn(nodeExecutable, [serverEntry], {
    cwd: serverCwd,
    env: getDesktopServerEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  nextServerProcess.stdout?.on('data', (chunk) => {
    const message = String(chunk || '').trim();
    if (message) {
      logDesktopEvent('next-server-stdout', message);
    }
  });

  nextServerProcess.stderr?.on('data', (chunk) => {
    const message = String(chunk || '').trim();
    if (message) {
      logDesktopEvent('next-server-stderr', message);
    }
  });

  nextServerProcess.on('error', (error) => {
    logDesktopEvent('next-server-error', {
      message: error?.message || String(error),
      stack: error?.stack || null,
      serverEntry,
      serverCwd,
      nodeExecutable,
    });
  });

  nextServerProcess.on('exit', (code, signal) => {
    logDesktopEvent('next-server-exit', { code, signal, serverEntry, serverCwd, nodeExecutable });
    nextServerProcess = null;
    if (!app.isQuitting && code !== 0) {
      console.error(`[desktop] Next server exited unexpectedly with code ${code}`);
    }
  });

  const ready = await waitForServer(getBaseUrl(), 45000);
  if (!ready) {
    throw new Error('Timed out while waiting for the local desktop web server to boot.');
  }
  logDesktopEvent('next-server-ready', {
    serverEntry,
    serverCwd,
    nodeExecutable,
    baseUrl: getBaseUrl(),
    runtimeRoot: runtime.runtimeRoot || null,
  });
}

async function resolvePrinterDeviceName(contents, preferredPrinterName = '') {
  const printers = await contents.getPrintersAsync();
  if (!Array.isArray(printers) || printers.length === 0) return '';

  const preferredName = String(preferredPrinterName || '').trim();
  if (preferredName) {
    const exactMatch = printers.find((printer) => printer.name === preferredName);
    if (exactMatch?.name) return exactMatch.name;
  }

  const defaultPrinter = printers.find((printer) => printer.isDefault);
  return defaultPrinter?.name || printers[0]?.name || '';
}

async function silentPrintHtml({
  html = '',
  documentTitle = 'ServiZephyr Receipt',
  printerName = '',
} = {}) {
  const markup = String(html || '').trim();
  if (!markup) {
    throw new Error('Printable HTML is required.');
  }

  const printWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 640,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(markup)}`);
    const deviceName = await resolvePrinterDeviceName(printWindow.webContents, printerName);

    return await new Promise((resolve, reject) => {
      setTimeout(() => {
        printWindow.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: deviceName || undefined,
        }, (success, failureReason) => {
          if (!success) {
            reject(new Error(failureReason || 'Silent print failed.'));
            return;
          }

          resolve({
            ok: true,
            printerName: deviceName || '',
            documentTitle,
          });
        });
      }, 120);
    });
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

function registerIpcHandlers() {
  offlineStore = offlineStore || createOfflineStore({
    getUserDataPath: () => app.getPath('userData'),
  });

  ipcMain.handle('desktop:get-runtime-info', async () => ({
    isDesktopApp: true,
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    appVersion: app.getVersion(),
    baseUrl: getBaseUrl(),
    startupUrl: getStartupUrl(),
  }));
  ipcMain.handle('desktop:offline:get-namespace', async (_, payload) => offlineStore.getNamespace(payload || {}));
  ipcMain.handle('desktop:offline:get-namespaces', async (_, payload) => offlineStore.getNamespaces(payload || {}));
  ipcMain.handle('desktop:offline:set-namespace', async (_, payload) => offlineStore.setNamespace(payload || {}));
  ipcMain.handle('desktop:offline:patch-namespace', async (_, payload) => offlineStore.patchNamespace(payload || {}));
  ipcMain.handle('desktop:offline:upsert-collection-item', async (_, payload) => offlineStore.upsertCollectionItem(payload || {}));
  ipcMain.handle('desktop:offline:remove-collection-item', async (_, payload) => offlineStore.removeCollectionItem(payload || {}));
  ipcMain.handle('desktop:offline:append-queue-item', async (_, payload) => offlineStore.appendQueueItem(payload || {}));
  ipcMain.handle('desktop:offline:list-queue-items', async (_, payload) => offlineStore.listQueueItems(payload || {}));
  ipcMain.handle('desktop:offline:remove-queue-item', async (_, payload) => offlineStore.removeQueueItem(payload || {}));
  ipcMain.handle('desktop:offline:get-debug-info', async () => offlineStore.getDebugInfo());
  ipcMain.handle('desktop:print:silent-html', async (_, payload) => silentPrintHtml(payload || {}));
  ipcMain.handle('desktop:update:get-state', async () => updaterState);
  ipcMain.handle('desktop:update:check-now', async () => {
    if (!updaterInitialized) {
      setupAutoUpdater();
    }
    if (!updaterState.enabled || !autoUpdater) {
      return updaterState;
    }
    await autoUpdater.checkForUpdates();
    return updaterState;
  });
  ipcMain.handle('desktop:update:install-now', async () => {
    if (!autoUpdater || updaterState.status !== 'downloaded') {
      return updaterState;
    }
    if (compareAppVersions(updaterState.downloadedVersion, app.getVersion()) <= 0) {
      clearPersistedUpdaterState();
    updateUpdaterState({
      status: 'up-to-date',
      downloadedVersion: '',
      downloadedFilePath: '',
      downloadedAt: null,
      availableVersion: '',
      error: '',
    });
    return updaterState;
    }
    await installDownloadedUpdateNow();
    return updaterState;
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
      icon: getDesktopWindowIconPath(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    logDesktopEvent('ready-to-show');
    mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[desktop] did-finish-load:', mainWindow.webContents.getURL());
    logDesktopEvent('did-finish-load', mainWindow.webContents.getURL());
  });

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
    console.error('[desktop] did-fail-load:', { errorCode, errorDescription, validatedURL });
    logDesktopEvent('did-fail-load', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    console.log('[desktop][renderer]', { level, message, line, sourceId });
    logDesktopEvent('renderer-console', { level, message, line, sourceId });
  });

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    console.error('[desktop] render-process-gone:', details);
    logDesktopEvent('render-process-gone', details);
  });

  attachNavigationGuards(mainWindow.webContents);

  mainWindow.loadURL(getStartupUrl());
}

async function bootDesktopApp() {
  registerIpcHandlers();
  hydratePersistedUpdaterState();
  await ensureNextServer();
  try {
    await session.defaultSession.clearStorageData({
      storages: ['serviceworkers', 'cachestorage'],
    });
    logDesktopEvent('cleared-session-storage', { storages: ['serviceworkers', 'cachestorage'] });
  } catch (error) {
    logDesktopEvent('clear-session-storage-failed', { message: error?.message || String(error) });
  }
  createMainWindow();
  setupAutoUpdater();
  if (updaterState.status === 'downloaded') {
    setTimeout(() => {
      promptToInstallDownloadedUpdate().catch((error) => {
        logDesktopEvent('downloaded-update-prompt-failed', {
          message: error?.message || String(error),
        });
      });
    }, 3000);
  }
}

if (app && !hasSingleInstanceLock) {
  logDesktopEvent('startup-quit-no-lock');
  app.quit();
} else if (app) {
  app.whenReady().then(() => {
    logDesktopEvent('app-ready', { isPackaged: app.isPackaged, execPath: process.execPath });
    bootDesktopApp().catch((error) => {
      console.error('[desktop] Failed to boot desktop app:', error);
      logDesktopEvent('boot-failed', { message: error?.message || String(error), stack: error?.stack || null });
      app.quit();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('web-contents-created', (_, contents) => {
    attachNavigationGuards(contents);
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    if (updaterPeriodicTimer) {
      clearInterval(updaterPeriodicTimer);
      updaterPeriodicTimer = null;
    }
    if (nextServerProcess && typeof nextServerProcess.kill === 'function') {
      nextServerProcess.kill();
    }
    nextServerProcess = null;
  });
}
