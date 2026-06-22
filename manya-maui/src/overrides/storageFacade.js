/**
 * MANYA STORAGE FACADE — MAUI OVERRIDE
 * =====================================
 * This replaces manya-react/src/backend/storage/storageFacade.js
 * when building for MAUI.
 *
 * It maps the storage schemes directly to the new manyaBridge.js API:
 *   local:  → localStorage (MAUI WebView supports this natively)
 *   file:   → filesRead() / filesWrite()
 *   db:     → dbQuery() / dbUpsert() / dbDelete()
 */

import { errorMapper } from '@/backend/storage/errorMapper.js';
import { 
    dbQuery, 
    dbUpsert, 
    dbDelete, 
    filesRead, 
    filesWrite 
} from '@/backend/bridge/manyaBridge.js';

// ── URI Parser ────────────────────────────────────────────────────────────────
const parseUri = (uri) => {
    const match = uri.match(/^([a-z]+):(.*)$/i);
    if (!match) throw new Error(`Invalid Storage URI: ${uri}`);
    return { scheme: match[1], path: match[2] };
};

// ── LOCAL STORAGE ADAPTER ─────────────────────────────────────────────────────
// MAUI WebView fully supports standard localStorage, so we don't need a bridge
// for simple key-value pairs (except auth tokens, which are handled separately).
const localAdapter = {
    get(key) {
        const val = localStorage.getItem(key);
        try { return JSON.parse(val); } catch (e) { return val; }
    },
    put(key, val) {
        const str = typeof val === 'string' ? val : JSON.stringify(val);
        localStorage.setItem(key, str);
    },
    delete(key) {
        localStorage.removeItem(key);
    },
};

// ── FILE ADAPTER ──────────────────────────────────────────────────────────────
const fileAdapter = {
    async get(path) {
        // MAUI bridge returns JSON string directly
        const raw = await filesRead(path);
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    },
    async put(path, payload) {
        const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
        await filesWrite(path, str);
        return true;
    },
};

// ── DATABASE ADAPTER ──────────────────────────────────────────────────────────
const dbAdapter = {
    _parseQuery(path) {
        const url = new URL(path, 'http://manya.internal');
        const parts = url.pathname.split('/').filter(Boolean);
        const table = parts[0];
        const id = parts[1];

        const query = { table, filter: {}, options: {} };

        if (id && id !== 'undefined' && id !== 'null') {
            query.filter.id = id;
            query.single = true;
        } else {
            url.searchParams.forEach((value, key) => {
                if (key === 'limit') query.options.limit = parseInt(value);
                else if (key === 'order') {
                    const [col, dir] = value.split(':');
                    query.options.orderBy = col; 
                    query.options.orderDir = dir || 'asc';
                } else if (key === 'single') {
                    query.single = value === 'true' ? true : (value === 'maybe' ? 'maybe' : false);
                } else if (key === 'uid') {
                    query.filter['user_id'] = value;
                } else {
                    query.filter[key] = value;
                }
            });
        }
        
        // MAUI Bridge routes user data to 'user' db, curriculum to 'content' db
        // For simplicity, anything in storageFacade is generally user state
        query.db = 'user';
        return query;
    },

    async get(path) {
        const { db, table, filter, options, single } = this._parseQuery(path);
        
        const raw = await dbQuery(db, table, filter, options);
        let data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        
        if (single === true && (!data || data.length === 0)) {
            throw new Error(`Row not found in ${table}`);
        }
        
        if (single) {
            return data && data.length > 0 ? data[0] : null;
        }
        
        return data || [];
    },

    async upsert(path, payload) {
        const table = path.replace(/^\//, '').split('/')[0];
        const raw = await dbUpsert('user', table, payload);
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },

    async patch(path, patchObj) {
        // Bridge upsert acts as patch if ID is included
        const url = new URL(path, 'http://manya.internal');
        const parts = url.pathname.split('/').filter(Boolean);
        const table = parts[0];
        const id = parts[1];
        
        if (!id) throw new Error('DB PATCH requires an ID in the URI');
        
        // Ensure ID is in the payload
        const payload = { ...patchObj, id };
        const raw = await dbUpsert('user', table, payload);
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },

    async delete(path) {
        const parts = path.split('/').filter(Boolean);
        const table = parts[0];
        const id = parts[1];
        
        if (!id) throw new Error('DB DELETE requires an ID in the URI');
        
        await dbDelete('user', table, { id });
        return true;
    },
};

// ── STORAGE FACADE (Public API) ───────────────────────────────────────────────
export const storageFacade = {
    async get(uri, options = {}) {
        try {
            const { scheme, path } = parseUri(uri);
            switch (scheme) {
                case 'local': return localAdapter.get(path);
                case 'file': return await fileAdapter.get(path);
                case 'db': return await dbAdapter.get(path);
                default: throw new Error(`Unsupported storage scheme: ${scheme}`);
            }
        } catch (e) { throw errorMapper.map(e, `GET ${uri}`); }
    },

    async put(uri, payload, options = {}) {
        try {
            const { scheme, path } = parseUri(uri);
            switch (scheme) {
                case 'local': return localAdapter.put(path, payload);
                case 'file': return await fileAdapter.put(path, payload);
                case 'db': return await dbAdapter.upsert(path, payload);
                default: throw new Error(`Unsupported storage scheme: ${scheme}`);
            }
        } catch (e) { throw errorMapper.map(e, `PUT ${uri}`); }
    },

    async patch(uri, patchObj) {
        try {
            const { scheme, path } = parseUri(uri);
            if (scheme === 'db') return await dbAdapter.patch(path, patchObj);
            throw new Error(`PATCH not supported for ${scheme}`);
        } catch (e) { throw errorMapper.map(e, `PATCH ${uri}`); }
    },

    async delete(uri) {
        try {
            const { scheme, path } = parseUri(uri);
            switch (scheme) {
                case 'local': return localAdapter.delete(path);
                case 'db': return await dbAdapter.delete(path);
                default: throw new Error(`DELETE not supported for ${scheme}`);
            }
        } catch (e) { throw errorMapper.map(e, `DELETE ${uri}`); }
    },
};
