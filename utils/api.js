/**
 * 统一数据层：页面只调用 call(action, payload)。
 * 演示模式直接用本地引擎跑内置快照；云函数模式走 wx.cloud.callFunction('api')。
 */
var env = require('../config/env');

var STORAGE_KEY = 'sxy_demo_db_v1';
var state = {
    engine: null,
    cloudReady: false,
    user: null,
    loginPromise: null
};

function makeError(code, message) {
    var err = new Error(message || '操作失败，请稍后重试');
    err.code = code || 'UNKNOWN';
    return err;
}

function demoEngine() {
    if (state.engine) return state.engine;
    var createEngine = require('../shared/engine/index.js').createEngine;
    var createMemoryStore = require('../shared/engine/store-memory.js').createMemoryStore;
    var seed = require('../shared/seed/data.js');
    var store = createMemoryStore({
        seed: seed,
        persist: {
            load: function () {
                try {
                    return wx.getStorageSync(STORAGE_KEY) || null;
                } catch (e) {
                    return null;
                }
            },
            save: function (db) {
                try {
                    wx.setStorageSync(STORAGE_KEY, db);
                } catch (e) {
                    /* 忽略写入失败 */
                }
            }
        }
    });
    state.engine = createEngine({ store: store, openid: env.demoOpenid, demo: true });
    return state.engine;
}

function ensureCloud() {
    if (state.cloudReady) return;
    if (!wx.cloud) throw makeError('NO_CLOUD', '当前基础库不支持云开发，请升级微信版本');
    wx.cloud.init({ env: env.cloudEnvId, traceUser: true });
    state.cloudReady = true;
}

function callCloud(action, payload) {
    ensureCloud();
    return new Promise(function (resolve, reject) {
        wx.cloud.callFunction({
            name: env.apiFunction,
            data: { action: action, payload: payload || {} },
            success: function (res) {
                var result = res && res.result;
                if (!result) {
                    reject(makeError('EMPTY_RESULT', '服务没有返回数据，请稍后重试'));
                    return;
                }
                if (result.code === 0) {
                    resolve(result.data);
                } else {
                    reject(makeError(String(result.code), result.msg));
                }
            },
            fail: function (err) {
                var msg = (err && (err.errMsg || err.message)) || '';
                if (msg.indexOf('FunctionName') >= 0 || msg.indexOf('not found') >= 0) {
                    reject(makeError('NO_FUNCTION', '云函数 api 尚未部署，请先上传部署'));
                    return;
                }
                reject(makeError('NETWORK', '网络不太稳定，请重试一次'));
            }
        });
    });
}

function call(action, payload) {
    if (env.demo) {
        return new Promise(function (resolve, reject) {
            demoEngine().handle(action, payload || {}).then(resolve, function (err) {
                reject(makeError(err && err.code, err && err.message));
            });
        });
    }
    return callCloud(action, payload);
}

/** 登录态：openid 由云函数从上下文取，这里只缓存绑定结果 */
function login(force) {
    if (!force && state.loginPromise) return state.loginPromise;
    state.loginPromise = call('auth.login').then(function (data) {
        state.user = data && data.bound ? data.user : null;
        return data;
    }).catch(function (err) {
        state.loginPromise = null;
        throw err;
    });
    return state.loginPromise;
}

function resetLogin() {
    state.loginPromise = null;
    state.user = null;
}

function currentUser() {
    return state.user;
}

/** 需要绑定才能进的页面统一走这里 */
function requireUser() {
    return login().then(function (data) {
        if (!data.bound) {
            wx.redirectTo({ url: '/pages/bind/index' });
            return Promise.reject(makeError('NEED_BIND', '需要先绑定学员信息'));
        }
        return data.user;
    });
}

function resetDemoData() {
    try {
        wx.removeStorageSync(STORAGE_KEY);
    } catch (e) {
        /* ignore */
    }
    state.engine = null;
    resetLogin();
}

module.exports = {
    call: call,
    login: login,
    resetLogin: resetLogin,
    currentUser: currentUser,
    requireUser: requireUser,
    resetDemoData: resetDemoData,
    isDemo: env.demo
};
