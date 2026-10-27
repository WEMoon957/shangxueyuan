// app.js
var api = require('./utils/api');
var env = require('./config/env');

App({
    globalData: {
        demo: api.isDemo,
        version: env.version,
        user: null
    },

    onLaunch: function () {
        // 演示模式不预先请求；云函数模式在首页 onShow 时统一登录
    },

    ensureLogin: function (force) {
        return api.login(force).then(function (data) {
            this.globalData.user = data && data.bound ? data.user : null;
            return data;
        }.bind(this));
    },

    setUser: function (user) {
        this.globalData.user = user || null;
    }
});
