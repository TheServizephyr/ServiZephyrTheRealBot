const fs = require('fs');
const path = require('path');

let Database = null;
try {
  Database = require('better-sqlite3');
} catch (_) {
  Database = null;
}

const LEGACY_STORE_FILE_NAME = 'servizephyr-offline-store.json';
const SQLITE_FILE_NAME = 'servizephyr-offline.db';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createDatabase(dbPath) {
  ensureDir(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS namespace_store (
      namespace TEXT NOT NULL,
      scope TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (namespace, scope)
    );

    CREATE TABLE IF NOT EXISTS action_queue (
      id TEXT PRIMARY KEY,
      queue_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_action_queue_name_created
    ON action_queue(queue_name, created_at);
  `);
  return db;
}

function readLegacyJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.error('[desktop][offline-store] Failed to read legacy json store:', error);
    return null;
  }
}

function writeJsonStore(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function createJsonFallbackStore({ userDataPath }) {
  const storePath = path.join(userDataPath, LEGACY_STORE_FILE_NAME);
  const initialState = readLegacyJson(storePath) || { namespaces: {}, queues: {} };
  const state = {
    namespaces: initialState?.namespaces && typeof initialState.namespaces === 'object' ? initialState.namespaces : {},
    queues: initialState?.queues && typeof initialState.queues === 'object' ? initialState.queues : {},
  };

  const persist = () => {
    writeJsonStore(storePath, state);
  };

  const getNamespace = ({ namespace, scope, fallback = null }) => {
    const namespaced = state.namespaces[String(namespace || '')] || {};
    if (!(String(scope || '') in namespaced)) return clone(fallback);
    return clone(namespaced[String(scope || '')]);
  };

  const getNamespaces = ({ items = [] } = {}) => {
    return (Array.isArray(items) ? items : []).reduce((accumulator, entry = {}) => {
      const key = String(entry?.key || `${entry?.namespace || ''}::${entry?.scope || ''}`);
      accumulator[key] = getNamespace(entry);
      return accumulator;
    }, {});
  };

  const setNamespace = ({ namespace, scope, value }) => {
    const namespaceKey = String(namespace || '');
    const scopeKey = String(scope || '');
    if (!state.namespaces[namespaceKey] || typeof state.namespaces[namespaceKey] !== 'object') {
      state.namespaces[namespaceKey] = {};
    }
    state.namespaces[namespaceKey][scopeKey] = clone(value);
    persist();
    return clone(value);
  };

  const patchNamespace = ({ namespace, scope, patch = {} }) => {
    const existing = getNamespace({ namespace, scope, fallback: {} });
    const next = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      ...clone(patch),
    };
    return setNamespace({ namespace, scope, value: next });
  };

  const upsertCollectionItem = ({ namespace, scope, item, idField = 'id' }) => {
    const current = getNamespace({ namespace, scope, fallback: [] });
    const list = Array.isArray(current) ? current : [];
    const targetId = String(item?.[idField] || '').trim();
    const next = list.filter((entry) => String(entry?.[idField] || '').trim() !== targetId);
    next.push(clone(item));
    return setNamespace({ namespace, scope, value: sortCollection(next) });
  };

  const removeCollectionItem = ({ namespace, scope, id, idField = 'id' }) => {
    const current = getNamespace({ namespace, scope, fallback: [] });
    const list = Array.isArray(current) ? current : [];
    const next = list.filter((entry) => String(entry?.[idField] || '').trim() !== String(id || '').trim());
    return setNamespace({ namespace, scope, value: sortCollection(next) });
  };

  const listQueueItems = ({ queueName }) => {
    const queue = state.queues[String(queueName || '')];
    return Array.isArray(queue) ? clone(queue) : [];
  };

  const appendQueueItem = ({ queueName, item }) => {
    const queueKey = String(queueName || '');
    const payload = {
      id: item?.id || `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: item?.createdAt || new Date().toISOString(),
      ...clone(item),
    };
    const queue = Array.isArray(state.queues[queueKey]) ? [...state.queues[queueKey]] : [];
    const next = queue.filter((entry) => String(entry?.id || '') !== payload.id);
    next.push(payload);
    next.sort((a, b) => String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')));
    state.queues[queueKey] = next;
    persist();
    return clone(next);
  };

  const removeQueueItem = ({ queueName, id }) => {
    const queueKey = String(queueName || '');
    const queue = Array.isArray(state.queues[queueKey]) ? state.queues[queueKey] : [];
    state.queues[queueKey] = queue.filter((entry) => String(entry?.id || '') !== String(id || ''));
    persist();
    return clone(state.queues[queueKey]);
  };

  const getDebugInfo = () => ({
    dbPath: storePath,
    namespaceCount: Object.values(state.namespaces).reduce((count, scopes) => (
      count + Object.keys(scopes || {}).length
    ), 0),
    queueCount: Object.values(state.queues).reduce((count, items) => (
      count + (Array.isArray(items) ? items.length : 0)
    ), 0),
    fallback: 'json',
  });

  return {
    getNamespace,
    getNamespaces,
    setNamespace,
    patchNamespace,
    upsertCollectionItem,
    removeCollectionItem,
    appendQueueItem,
    listQueueItems,
    removeQueueItem,
    getDebugInfo,
  };
}

function sortCollection(items = []) {
  return [...items].sort((a, b) => String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  }));
}

function migrateLegacyStore({ db, userDataPath }) {
  const legacyPath = path.join(userDataPath, LEGACY_STORE_FILE_NAME);
  const legacy = readLegacyJson(legacyPath);
  if (!legacy) return;

  const hasRows = db.prepare('SELECT COUNT(*) AS count FROM namespace_store').get();
  if (Number(hasRows?.count || 0) > 0) return;

  const insertNamespace = db.prepare(`
    INSERT OR REPLACE INTO namespace_store (namespace, scope, value_json, updated_at)
    VALUES (@namespace, @scope, @value_json, @updated_at)
  `);
  const insertQueue = db.prepare(`
    INSERT OR REPLACE INTO action_queue (id, queue_name, created_at, payload_json)
    VALUES (@id, @queue_name, @created_at, @payload_json)
  `);

  const transaction = db.transaction(() => {
    Object.entries(legacy?.namespaces || {}).forEach(([namespace, scopes]) => {
      Object.entries(scopes || {}).forEach(([scope, value]) => {
        insertNamespace.run({
          namespace,
          scope,
          value_json: JSON.stringify(value ?? null),
          updated_at: new Date().toISOString(),
        });
      });
    });

    Object.entries(legacy?.queues || {}).forEach(([queueName, items]) => {
      (Array.isArray(items) ? items : []).forEach((item) => {
        insertQueue.run({
          id: item?.id || `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          queue_name: queueName,
          created_at: item?.createdAt || new Date().toISOString(),
          payload_json: JSON.stringify(item ?? {}),
        });
      });
    });
  });

  transaction();
}

function createOfflineStore({ getUserDataPath }) {
  const userDataPath = getUserDataPath();
  if (!Database) {
    console.warn('[desktop][offline-store] better-sqlite3 not available, using JSON fallback store.');
    return createJsonFallbackStore({ userDataPath });
  }

  const dbPath = path.join(userDataPath, SQLITE_FILE_NAME);
  const db = createDatabase(dbPath);
  migrateLegacyStore({ db, userDataPath });

  const getNamespaceStmt = db.prepare(`
    SELECT value_json
    FROM namespace_store
    WHERE namespace = ? AND scope = ?
  `);
  const setNamespaceStmt = db.prepare(`
    INSERT INTO namespace_store (namespace, scope, value_json, updated_at)
    VALUES (@namespace, @scope, @value_json, @updated_at)
    ON CONFLICT(namespace, scope) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `);
  const listQueueStmt = db.prepare(`
    SELECT payload_json
    FROM action_queue
    WHERE queue_name = ?
    ORDER BY created_at ASC
  `);
  const appendQueueStmt = db.prepare(`
    INSERT OR REPLACE INTO action_queue (id, queue_name, created_at, payload_json)
    VALUES (@id, @queue_name, @created_at, @payload_json)
  `);
  const removeQueueStmt = db.prepare(`
    DELETE FROM action_queue
    WHERE queue_name = ? AND id = ?
  `);

  const getNamespace = ({ namespace, scope, fallback = null }) => {
    const row = getNamespaceStmt.get(String(namespace || ''), String(scope || ''));
    if (!row?.value_json) return clone(fallback);
    try {
      return JSON.parse(row.value_json);
    } catch {
      return clone(fallback);
    }
  };

  const getNamespaces = ({ items = [] } = {}) => {
    return (Array.isArray(items) ? items : []).reduce((accumulator, entry = {}) => {
      const key = String(entry?.key || `${entry?.namespace || ''}::${entry?.scope || ''}`);
      accumulator[key] = getNamespace(entry);
      return accumulator;
    }, {});
  };

  const setNamespace = ({ namespace, scope, value }) => {
    const payload = clone(value);
    setNamespaceStmt.run({
      namespace: String(namespace || ''),
      scope: String(scope || ''),
      value_json: JSON.stringify(payload ?? null),
      updated_at: new Date().toISOString(),
    });
    return payload;
  };

  const patchNamespace = ({ namespace, scope, patch = {} }) => {
    const existing = getNamespace({ namespace, scope, fallback: {} });
    const next = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      ...clone(patch),
    };
    return setNamespace({ namespace, scope, value: next });
  };

  const upsertCollectionItem = ({ namespace, scope, item, idField = 'id' }) => {
    const current = getNamespace({ namespace, scope, fallback: [] });
    const list = Array.isArray(current) ? current : [];
    const targetId = String(item?.[idField] || '').trim();
    const next = list.filter((entry) => String(entry?.[idField] || '').trim() !== targetId);
    next.push(clone(item));
    return setNamespace({ namespace, scope, value: sortCollection(next) });
  };

  const removeCollectionItem = ({ namespace, scope, id, idField = 'id' }) => {
    const current = getNamespace({ namespace, scope, fallback: [] });
    const list = Array.isArray(current) ? current : [];
    const next = list.filter((entry) => String(entry?.[idField] || '').trim() !== String(id || '').trim());
    return setNamespace({ namespace, scope, value: sortCollection(next) });
  };

  const appendQueueItem = ({ queueName, item }) => {
    const payload = {
      id: item?.id || `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: item?.createdAt || new Date().toISOString(),
      ...clone(item),
    };
    appendQueueStmt.run({
      id: payload.id,
      queue_name: String(queueName || ''),
      created_at: payload.createdAt,
      payload_json: JSON.stringify(payload),
    });
    return listQueueItems({ queueName });
  };

  const listQueueItems = ({ queueName }) => {
    return listQueueStmt.all(String(queueName || '')).map((row) => {
      try {
        return JSON.parse(row.payload_json);
      } catch {
        return null;
      }
    }).filter(Boolean);
  };

  const removeQueueItem = ({ queueName, id }) => {
    removeQueueStmt.run(String(queueName || ''), String(id || ''));
    return listQueueItems({ queueName });
  };

  const getDebugInfo = () => {
    const namespaces = db.prepare('SELECT COUNT(*) AS count FROM namespace_store').get();
    const queueItems = db.prepare('SELECT COUNT(*) AS count FROM action_queue').get();
    return {
      dbPath,
      namespaceCount: Number(namespaces?.count || 0),
      queueCount: Number(queueItems?.count || 0),
    };
  };

  return {
    getNamespace,
    getNamespaces,
    setNamespace,
    patchNamespace,
    upsertCollectionItem,
    removeCollectionItem,
    appendQueueItem,
    listQueueItems,
    removeQueueItem,
    getDebugInfo,
  };
}

module.exports = {
  createOfflineStore,
};
