/**
 * 飞书多维表格数据仓库（生产模式）。
 * 与内存仓库同接口：find / get / create / update / remove。
 *
 * - request：注入的 HTTP 实现，签名 ({method, path, body}) => Promise<{code, msg, data}>
 * - token：返回 tenant_access_token 的函数（由调用方缓存）
 * - tables：{ courses: 'tblxxx', ... }
 */
var util = require('./util');

var PAGE_SIZE = 500;
var CACHE_TTL = 15000;

// 飞书字段类型 -> 写入时的处理方式
var TYPE_SINGLE_SELECT = 3;
var TYPE_MULTI_SELECT = 4;
var TYPE_DATETIME = 5;
var TYPE_ATTACHMENT = 17;
var TYPE_LINK = 18;
var TYPE_LOOKUP = 19;
var TYPE_FORMULA = 20;
var TYPE_DUPLEX_LINK = 21;
var TYPE_AUTO_NUMBER = 1005;
var READONLY = [19, 20, 1001, 1002, 1003, 1004, 1005];

// 只有主数据做读缓存；学习进度、考试记录这类高频写入的表必须实时读
var CACHEABLE = { courses: 1, questions: 1, exams: 1 };

function createFeishuStore(options) {
    var opts = options || {};
    var request = opts.request;
    var getToken = opts.token;
    var appToken = opts.appToken;
    var tables = opts.tables || {};
    var cache = {};
    var schemas = {};
    var linkShape = 'object';

    function tableId(key) {
        var id = tables[key];
        if (!id) util.fail('TABLE_UNKNOWN', '未配置数据表：' + key);
        return id;
    }

    function api(method, path, body) {
        return Promise.resolve(getToken()).then(function (token) {
            return request({ method: method, path: path, body: body, token: token });
        }).then(function (res) {
            if (!res || (res.code !== 0 && res.code !== undefined)) {
                var err = new util.EngineError(
                    'FEISHU_' + ((res && res.code) || 'UNKNOWN'),
                    (res && res.msg) || '飞书接口调用失败'
                );
                throw err;
            }
            return res.data || {};
        });
    }

    function basePath(key) {
        return '/open-apis/bitable/v1/apps/' + appToken + '/tables/' + tableId(key);
    }

    function normalize(record) {
        var out = util.withId(record.fields || {});
        out._id = record.record_id || out._id;
        return out;
    }

    function listAll(key) {
        var cacheable = CACHEABLE[key] === 1;
        var hit = cacheable ? cache[key] : null;
        if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.list.slice());
        var collected = [];
        var pageToken = '';

        function step() {
            var body = { page_size: PAGE_SIZE };
            if (pageToken) body.page_token = pageToken;
            return api('POST', basePath(key) + '/records/search', body).then(function (data) {
                var items = data.items || [];
                for (var i = 0; i < items.length; i++) collected.push(normalize(items[i]));
                if (data.has_more && data.page_token) {
                    pageToken = data.page_token;
                    return step();
                }
                if (cacheable) cache[key] = { at: Date.now(), list: collected.slice() };
                return collected;
            });
        }
        return step();
    }

    function invalidate(key) {
        if (!key) {
            cache = {};
            return;
        }
        if (CACHEABLE[key] === 1) delete cache[key];
    }

    /** 字段类型表：决定写入时单选/多选/关联等字段的取值形态 */
    function ensureSchema(key) {
        if (schemas[key]) return Promise.resolve(schemas[key]);
        return api('GET', basePath(key) + '/fields?page_size=200').then(function (data) {
            var map = {};
            var items = data.items || [];
            for (var i = 0; i < items.length; i++) {
                map[items[i].field_name] = items[i].type;
            }
            schemas[key] = map;
            return map;
        }).catch(function () {
            schemas[key] = schemas[key] || {};
            return schemas[key];
        });
    }

    function find(key, where) {
        return listAll(key).then(function (list) {
            var out = [];
            for (var i = 0; i < list.length; i++) {
                if (util.matchWhere(list[i], where)) out.push(list[i]);
            }
            return out;
        });
    }

    function get(key, id) {
        if (!id) return Promise.resolve(null);
        return api('GET', basePath(key) + '/records/' + id).then(function (data) {
            return data.record ? normalize(data.record) : null;
        }).catch(function () {
            return null;
        });
    }

    function toApiFields(key, fields) {
        var schema = schemas[key] || {};
        var out = {};
        for (var k in fields) {
            if (k === '_id' || k === '_createdAt' || k === '_updatedAt') continue;
            var type = schema[k];
            if (READONLY.indexOf(type) >= 0) continue;
            var v = fields[k];
            if (type === TYPE_LINK || type === TYPE_DUPLEX_LINK) {
                var ids = [];
                if (Array.isArray(v)) {
                    for (var i = 0; i < v.length; i++) {
                        var item = v[i];
                        if (typeof item === 'string') ids.push(item);
                        else if (item && item.record_ids) ids = ids.concat(item.record_ids);
                        else if (item && item.id) ids.push(item.id);
                    }
                } else if (v) {
                    ids.push(v);
                }
                out[k] = linkShape === 'object'
                    ? ids.map(function (id) { return { record_ids: [id] }; })
                    : ids;
            } else if (type === TYPE_SINGLE_SELECT) {
                if (Array.isArray(v)) out[k] = v.length ? String(v[0]) : null;
                else out[k] = v === '' ? null : v;
            } else if (type === TYPE_MULTI_SELECT) {
                out[k] = Array.isArray(v) ? v : (v ? [v] : []);
            } else {
                out[k] = v;
            }
        }
        return out;
    }

    function writeOnce(key, method, rows, fieldsList) {
        var payload = { records: [] };
        for (var i = 0; i < fieldsList.length; i++) {
            var row = { fields: toApiFields(key, fieldsList[i]) };
            if (rows && rows[i]) row.record_id = rows[i];
            payload.records.push(row);
        }
        return api('POST', basePath(key) + '/' + method, payload);
    }

    function write(key, method, rows, fieldsList) {
        return ensureSchema(key).then(function () {
            return writeOnce(key, method, rows, fieldsList);
        }).catch(function (err) {
            if (/^FEISHU_(1254067|1254074)$/.test(err.code || '')) {
                linkShape = linkShape === 'object' ? 'flat' : 'object';
                return writeOnce(key, method, rows, fieldsList);
            }
            throw err;
        }).then(function (data) {
            invalidate(key);
            return data || {};
        });
    }

    function create(key, fields) {
        return write(key, 'batch_create', null, [fields]).then(function (data) {
            var rec = (data.records || [])[0] || {};
            return rec.record_id || '';
        });
    }

    /** 批量新增：单次最多 100 条，按批串行写入（飞书同表并发会写冲突） */
    function createMany(key, list) {
        if (!list || !list.length) return Promise.resolve([]);
        var batches = [];
        for (var i = 0; i < list.length; i += 100) {
            batches.push(list.slice(i, i + 100));
        }
        var ids = [];
        return batches.reduce(function (chain, batch) {
            return chain.then(function () {
                return write(key, 'batch_create', null, batch).then(function (data) {
                    var records = data.records || [];
                    for (var j = 0; j < records.length; j++) ids.push(records[j].record_id || '');
                });
            });
        }, Promise.resolve()).then(function () {
            return ids;
        });
    }

    function update(key, id, fields) {
        return write(key, 'batch_update', [id], [fields]).then(function () {
            return true;
        });
    }

    function remove(key, id) {
        return ensureSchema(key).then(function () {
            return api('POST', basePath(key) + '/records/batch_delete', { records: [id] });
        }).then(function () {
            invalidate(key);
            return true;
        });
    }

    return {
        find: find,
        get: get,
        create: create,
        createMany: createMany,
        update: update,
        remove: remove,
        invalidate: invalidate
    };
}

module.exports = { createFeishuStore: createFeishuStore };
