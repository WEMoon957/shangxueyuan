/**
 * 演示模式用的内存数据仓库：接口与飞书仓库一致，数据来自飞书快照。
 * 可选持久化（小程序端存 Storage），未提供时纯内存运行（Node 自测）。
 */
var util = require('./util');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createMemoryStore(options) {
    var opts = options || {};
    var seed = opts.seed || {};
    var persist = opts.persist || null;
    var db = null;

    function load() {
        if (db) return db;
        var stored = null;
        if (persist && typeof persist.load === 'function') {
            try {
                stored = persist.load();
            } catch (e) {
                stored = null;
            }
        }
        db = stored && stored.courses ? stored : clone(seed);
        return db;
    }

    function save() {
        if (persist && typeof persist.save === 'function') {
            try {
                persist.save(db);
            } catch (e) {
                /* 存储失败不影响本次会话 */
            }
        }
    }

    function rows(table) {
        var data = load();
        if (!data[table]) data[table] = [];
        return data[table];
    }

    function find(table, where) {
        var list = rows(table);
        var out = [];
        for (var i = 0; i < list.length; i++) {
            if (util.matchWhere(list[i], where)) out.push(clone(list[i]));
        }
        return Promise.resolve(out);
    }

    function get(table, id) {
        var list = rows(table);
        for (var i = 0; i < list.length; i++) {
            if (list[i]._id === id) return Promise.resolve(clone(list[i]));
        }
        return Promise.resolve(null);
    }

    function create(table, fields) {
        var doc = clone(fields);
        if (!doc._id) doc._id = util.newId(table);
        doc._createdAt = util.nowMs();
        rows(table).push(doc);
        save();
        return Promise.resolve(doc._id);
    }

    /** 批量新增：对应飞书的 batch_create，避免逐条往返 */
    function createMany(table, list) {
        var ids = [];
        var target = rows(table);
        for (var i = 0; i < list.length; i++) {
            var doc = clone(list[i]);
            if (!doc._id) doc._id = util.newId(table);
            doc._createdAt = util.nowMs();
            target.push(doc);
            ids.push(doc._id);
        }
        save();
        return Promise.resolve(ids);
    }

    function update(table, id, fields) {
        var list = rows(table);
        for (var i = 0; i < list.length; i++) {
            if (list[i]._id === id) {
                for (var k in fields) {
                    if (k !== '_id') list[i][k] = fields[k];
                }
                list[i]._updatedAt = util.nowMs();
                save();
                return Promise.resolve(true);
            }
        }
        return Promise.resolve(false);
    }

    function remove(table, id) {
        var list = rows(table);
        for (var i = 0; i < list.length; i++) {
            if (list[i]._id === id) {
                list.splice(i, 1);
                save();
                return Promise.resolve(true);
            }
        }
        return Promise.resolve(false);
    }

    function reset() {
        db = clone(seed);
        save();
        return Promise.resolve(true);
    }

    return {
        find: find,
        get: get,
        create: create,
        createMany: createMany,
        update: update,
        remove: remove,
        reset: reset
    };
}

module.exports = { createMemoryStore: createMemoryStore };
