/**
 * 业务引擎：与存储实现无关，同一套逻辑跑在飞书模式（云函数）与演示模式（本地）。
 *
 * 约定：领域对象字段名与「门店商学院-数据底座」多维表格的字段名一致，
 * 因此飞书仓库几乎是直通，只有展示层在这里做视图模型转换。
 */
var util = require('./util');
var actions = require('./actions');

/**
 * @param {Object} options
 * @param {Object} options.store   数据仓库（store-memory / store-feishu）
 * @param {String} options.openid  当前学员微信 openid
 * @param {Boolean} options.demo   是否演示模式
 */
function createEngine(options) {
    var opts = options || {};
    var store = opts.store;
    var demo = !!opts.demo;

    var ctx = {
        store: store,
        demo: demo,
        now: opts.now || util.nowMs
    };

    function session(payload) {
        var openid = (payload && payload.__openid) || opts.openid || '';
        return { openid: openid, demo: demo };
    }

    function handle(action, payload) {
        var body = payload || {};
        var fn = actions[action];
        if (!fn) return Promise.reject(new util.EngineError('UNKNOWN_ACTION', '不支持的操作：' + action));
        var s = session(body);
        var safe = {};
        for (var k in body) {
            if (k !== '__openid') safe[k] = body[k];
        }
        return Promise.resolve().then(function () {
            return fn(safe, s, ctx);
        });
    }

    return {
        handle: handle,
        store: store
    };
}

module.exports = {
    createEngine: createEngine,
    util: util
};
