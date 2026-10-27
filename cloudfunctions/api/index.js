/**
 * 云函数入口：小程序唯一后端。
 * 职责：拿到 openid → 调用业务引擎 → 引擎通过飞书多维表格读写数据。
 * 服务端判分、答案不下发前端，靠的就是这一层。
 */
var cloud = require('wx-server-sdk');
var https = require('https');

var createEngine = require('./lib/engine/index.js').createEngine;
var createFeishuStore = require('./lib/engine/store-feishu.js').createFeishuStore;
var config = require('./config.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

var tokenCache = { value: '', expireAt: 0 };

function feishuRequest(options) {
    var method = options.method || 'GET';
    var path = options.path;
    var body = options.body ? JSON.stringify(options.body) : null;
    var token = options.token || '';

    return new Promise(function (resolve, reject) {
        var headers = { 'Content-Type': 'application/json; charset=utf-8' };
        if (token) headers.Authorization = 'Bearer ' + token;
        if (body) headers['Content-Length'] = Buffer.byteLength(body);

        var req = https.request({
            hostname: 'open.feishu.cn',
            path: path,
            method: method,
            headers: headers,
            timeout: 12000
        }, function (res) {
            var chunks = '';
            res.on('data', function (chunk) { chunks += chunk; });
            res.on('end', function () {
                var parsed;
                try {
                    parsed = JSON.parse(chunks);
                } catch (e) {
                    reject(new Error('飞书接口返回异常（HTTP ' + res.statusCode + '）'));
                    return;
                }
                resolve(parsed);
            });
        });
        req.on('timeout', function () {
            req.destroy(new Error('请求飞书超时'));
        });
        req.on('error', function (err) {
            reject(err);
        });
        if (body) req.write(body);
        req.end();
    });
}

function tenantToken() {
    var now = Date.now();
    if (tokenCache.value && tokenCache.expireAt > now + 60000) {
        return Promise.resolve(tokenCache.value);
    }
    if (!config.appId || !config.appSecret) {
        return Promise.reject(new Error('云函数未配置飞书应用凭证'));
    }
    return feishuRequest({
        method: 'POST',
        path: '/open-apis/auth/v3/tenant_access_token/internal',
        body: { app_id: config.appId, app_secret: config.appSecret }
    }).then(function (res) {
        if (res.code !== 0 || !res.tenant_access_token) {
            throw new Error('获取飞书访问凭证失败：' + (res.msg || res.code));
        }
        tokenCache.value = res.tenant_access_token;
        tokenCache.expireAt = now + (res.expire || 7200) * 1000;
        return tokenCache.value;
    });
}

var store = createFeishuStore({
    request: function (options) {
        return feishuRequest(options);
    },
    token: tenantToken,
    appToken: config.appToken,
    tables: config.tables
});

exports.main = async function (event) {
    var wxContext = cloud.getWXContext();
    var openid = wxContext.OPENID || '';
    var action = event && event.action;
    var payload = (event && event.payload) || {};

    if (!action) return { code: 'BAD_REQUEST', msg: '缺少 action' };

    var engine = createEngine({ store: store, openid: openid, demo: false });
    try {
        var data = await engine.handle(action, payload);
        return { code: 0, data: data };
    } catch (err) {
        return {
            code: (err && err.code) || 'ERROR',
            msg: (err && err.message) || '服务开小差了，请稍后重试'
        };
    }
};
