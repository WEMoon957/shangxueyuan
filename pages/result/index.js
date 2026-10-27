// 成绩与解析
var api = require('../../utils/api');

Page({
    data: {
        state: 'loading',
        error: '',
        attemptId: '',
        attempt: {},
        exam: {},
        summary: { right: 0, wrong: 0, total: 0 },
        items: []
    },

    onLoad: function (query) {
        this.setData({ attemptId: (query && query.id) || '' });
        this.load();
    },

    load: function () {
        var that = this;
        if (!this.data.attemptId) {
            this.setData({ state: 'error', error: '缺少成绩参数' });
            return;
        }
        api.login().then(function (data) {
            if (!data.bound) {
                wx.redirectTo({ url: '/pages/bind/index' });
                return null;
            }
            return api.call('exam.result', { attemptId: that.data.attemptId });
        }).then(function (res) {
            if (!res) return;
            that.setData({
                state: 'ready',
                attempt: res.attempt,
                exam: res.exam,
                summary: res.summary,
                items: res.items
            });
        }).catch(function (err) {
            if (err.code === 'NEED_BIND') return;
            that.setData({ state: 'error', error: err.message || '加载失败，请重试' });
        });
    },

    goBack: function () {
        var pages = getCurrentPages();
        if (pages.length > 1) {
            wx.navigateBack();
        } else {
            wx.switchTab({ url: '/pages/index/index' });
        }
    },

    goWrongbook: function () {
        wx.navigateTo({ url: '/pages/wrongbook/index' });
    }
});
