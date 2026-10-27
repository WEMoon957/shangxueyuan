// 错题本
var api = require('../../utils/api');

Page({
    data: {
        state: 'loading',
        error: '',
        total: 0,
        groups: []
    },

    onShow: function () {
        this.load();
    },

    load: function () {
        var that = this;
        this.setData({ state: this.data.groups.length ? this.data.state : 'loading', error: '' });
        api.login().then(function (data) {
            if (!data.bound) {
                wx.redirectTo({ url: '/pages/bind/index' });
                return null;
            }
            return api.call('me.wrongbook');
        }).then(function (res) {
            if (!res) return;
            var groups = (res.groups || []).map(function (g) {
                var items = (g.items || []).map(function (q) {
                    var item = {};
                    for (var k in q) item[k] = q[k];
                    item.open = false;
                    return item;
                });
                return { knowledge: g.knowledge, items: items };
            });
            that.setData({ state: 'ready', total: res.total, groups: groups });
        }).catch(function (err) {
            if (err.code === 'NEED_BIND') return;
            that.setData({ state: 'error', error: err.message || '加载失败，请重试' });
        });
    },

    toggle: function (e) {
        var gi = Number(e.currentTarget.dataset.gi);
        var qi = Number(e.currentTarget.dataset.qi);
        var groups = this.data.groups;
        if (!groups[gi] || !groups[gi].items[qi]) return;
        groups[gi].items[qi].open = !groups[gi].items[qi].open;
        this.setData({ groups: groups });
    }
});
