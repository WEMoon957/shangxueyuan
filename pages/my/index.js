// 我的
var api = require('../../utils/api');
var env = require('../../config/env');

Page({
    data: {
        state: 'loading',
        error: '',
        demo: api.isDemo,
        version: env.version,
        user: {},
        stats: { courses: 0, finished: 0, learning: 0, minutes: 0 },
        certs: [],
        attempts: [],
        wrongCount: 0
    },

    onShow: function () {
        this.load();
    },

    load: function () {
        var that = this;
        this.setData({ state: this.data.user.name ? this.data.state : 'loading', error: '' });
        return api.login().then(function (data) {
            if (!data.bound) {
                wx.redirectTo({ url: '/pages/bind/index' });
                return null;
            }
            return Promise.all([
                api.call('course.list'),
                api.call('me.attempts'),
                api.call('me.certificates'),
                api.call('me.wrongbook')
            ]);
        }).then(function (res) {
            if (!res) return;
            that.setData({
                state: 'ready',
                user: res[0].user,
                stats: res[0].stats,
                attempts: res[1].items.slice(0, 5),
                certs: res[2].items,
                wrongCount: res[3].total
            });
        }).catch(function (err) {
            if (err.code === 'NEED_BIND') return;
            that.setData({ state: 'error', error: err.message || '加载失败，请重试' });
        });
    },

    openResult: function (e) {
        wx.navigateTo({ url: '/pages/result/index?id=' + e.currentTarget.dataset.id });
    },

    goWrongbook: function () {
        wx.navigateTo({ url: '/pages/wrongbook/index' });
    },

    goLearning: function () {
        wx.switchTab({ url: '/pages/index/index' });
    },

    goCerts: function () {
        if (!this.data.certs.length) {
            wx.showToast({ title: '通过结业考试后自动颁发', icon: 'none' });
            return;
        }
        wx.showToast({ title: '证书在下方列表中', icon: 'none' });
    },

    resetDemo: function () {
        var that = this;
        wx.showModal({
            title: '重置演示数据',
            content: '会清空本机的学习记录、考试成绩与错题，恢复到初始快照。确定吗？',
            confirmColor: '#2F5BFF',
            success: function (res) {
                if (!res.confirm) return;
                api.resetDemoData();
                that.setData({ state: 'loading', user: {}, certs: [], attempts: [], wrongCount: 0 });
                that.load();
                wx.showToast({ title: '已重置', icon: 'success' });
            }
        });
    }
});
