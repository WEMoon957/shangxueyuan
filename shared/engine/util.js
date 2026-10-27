/**
 * 通用工具：值归一化、时间、随机、错误
 * 同时运行在小程序（演示模式）与云函数（飞书模式）中，只用 ES2018 语法。
 */

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

function nowMs() {
    return Date.now();
}

function fmtDateTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
        ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 单选字段：接口可能返回字符串、单元素数组或对象 */
function sel(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.length ? sel(value[0]) : '';
    if (typeof value === 'object') return value.text || value.name || '';
    return String(value);
}

/** 多选字段：统一成字符串数组 */
function selList(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        var out = [];
        for (var i = 0; i < value.length; i++) {
            var v = sel(value[i]);
            if (v) out.push(v);
        }
        return out;
    }
    var one = sel(value);
    return one ? [one] : [];
}

/** 关联字段：接口可能返回 {link_record_ids} / {record_ids} / [{id}] / ['rec'] */
function linkIds(value) {
    if (!value) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) {
        var out = [];
        for (var i = 0; i < value.length; i++) {
            var item = value[i];
            if (!item) continue;
            if (typeof item === 'string') {
                out.push(item);
            } else if (item.record_ids) {
                out = out.concat(item.record_ids);
            } else {
                var id = item.id || item.record_id || '';
                if (id) out.push(id);
            }
        }
        return out;
    }
    if (value.link_record_ids) return value.link_record_ids.slice();
    if (value.record_ids) return value.record_ids.slice();
    if (value.id) return [value.id];
    return [];
}

function text(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
        var parts = [];
        for (var i = 0; i < value.length; i++) {
            var t = text(value[i]);
            if (t) parts.push(t);
        }
        return parts.join('');
    }
    if (typeof value === 'object') {
        if (value.text !== undefined) return text(value.text);
        if (value.name !== undefined) return text(value.name);
        if (value.value !== undefined) return text(value.value);
    }
    return String(value);
}

function num(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback === undefined ? 0 : fallback;
    var n = Number(value);
    return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
}

function bool(value) {
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return bool(value[0]);
    if (value === 'true') return true;
    if (value === 'false') return false;
    return !!value;
}

/** 日期字段：接口返回毫秒时间戳或 ISO 字符串 */
function dateMs(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (Array.isArray(value)) return dateMs(value[0]);
    if (typeof value === 'object') {
        if (value.value !== undefined) return dateMs(value.value);
        if (value.timestamp !== undefined) return dateMs(value.timestamp);
    }
    var t = Date.parse(String(value));
    return isNaN(t) ? 0 : t;
}

function normalizeKeys(keys) {
    var raw;
    if (Array.isArray(keys)) {
        raw = keys;
    } else if (keys === null || keys === undefined || keys === '') {
        raw = [];
    } else {
        raw = String(keys).split(/[、,，;；\s]+/);
    }
    var cleaned = [];
    function push(k) {
        if (k && cleaned.indexOf(k) === -1) cleaned.push(k);
    }
    for (var i = 0; i < raw.length; i++) {
        var s = String(raw[i] === null || raw[i] === undefined ? '' : raw[i]).trim().toUpperCase();
        if (!s) continue;
        // 兼容 "ABD" 这类连写的多选答案
        if (/^[A-Z]{2,6}$/.test(s)) {
            for (var j = 0; j < s.length; j++) push(s.charAt(j));
        } else {
            push(s);
        }
    }
    cleaned.sort();
    return cleaned;
}

function sameKeys(a, b) {
    var x = normalizeKeys(a);
    var y = normalizeKeys(b);
    return x.length === y.length && x.join('') === y.join('');
}

/** 随机洗牌（可选种子，便于同一试卷可复现） */
function shuffle(list, seed) {
    var arr = list.slice();
    var state = typeof seed === 'number' ? seed % 2147483647 : 0;
    function rand() {
        if (state) {
            state = (state * 16807) % 2147483647;
            return (state - 1) / 2147483646;
        }
        return Math.random();
    }
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1));
        var tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}

function newId(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
}

function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
}

function EngineError(code, message) {
    this.name = 'EngineError';
    this.code = code;
    this.message = message;
}
EngineError.prototype = Object.create(Error.prototype);
EngineError.prototype.constructor = EngineError;

function fail(code, message) {
    throw new EngineError(code, message);
}

/** 值比较：兼容单选（字符串/数组）、关联（字符串 vs 数组）等形态 */
function sameValue(a, b) {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        var left = Array.isArray(a) ? a : [a];
        var right = Array.isArray(b) ? b : [b];
        for (var i = 0; i < right.length; i++) {
            var hit = false;
            for (var j = 0; j < left.length; j++) {
                if (text(left[j]) === text(right[i])) hit = true;
            }
            if (!hit) return false;
        }
        return true;
    }
    if (typeof a === 'object') {
        if (a.link_record_ids || a.record_ids) return linkIds(a).indexOf(text(b)) >= 0;
        return sel(a) === text(b);
    }
    if (typeof b === 'object') {
        if (b.link_record_ids || b.record_ids) return linkIds(b).indexOf(text(a)) >= 0;
        return text(a) === sel(b);
    }
    return String(a) === String(b);
}

/** 简单等值过滤，字段名使用业务字段名 */
function matchWhere(record, where) {
    if (!where) return true;
    for (var k in where) {
        if (!sameValue(record[k], where[k])) return false;
    }
    return true;
}

/** 把飞书原始记录（字段名即业务名）整理成带 _id 的对象 */
function withId(record) {
    var out = {};
    for (var k in record) {
        if (k !== 'record_id' && k !== '_id') out[k] = record[k];
    }
    out._id = record.record_id || record._id || '';
    return out;
}

module.exports = {
    pad2: pad2,
    nowMs: nowMs,
    fmtDateTime: fmtDateTime,
    fmtDate: fmtDate,
    sel: sel,
    selList: selList,
    linkIds: linkIds,
    text: text,
    num: num,
    bool: bool,
    dateMs: dateMs,
    normalizeKeys: normalizeKeys,
    sameKeys: sameKeys,
    shuffle: shuffle,
    newId: newId,
    clamp: clamp,
    fail: fail,
    EngineError: EngineError,
    sameValue: sameValue,
    matchWhere: matchWhere,
    withId: withId
};
