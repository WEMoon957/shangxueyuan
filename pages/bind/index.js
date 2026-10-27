// 首次绑定
var api = require('../../utils/api');

Page({
    data: {
        positions: ['员工', '储备店长', '店长', '区域经理'],
        positionIndex: 0,
        form: {
            name: '',
            phone: '',
            storeName: '',
            position: '员工'
        },
        agreed: false,
        canSubmit: false,
        submitting: false,
        error: ''
    },

    onInput: function (e) {
        var key = e.currentTarget.dataset.key;
        var value = e.detail.value;
        var form = {};
        for (var k in this.data.form) form[k] = this.data.form[k];
        form[key] = key === 'phone' ? value.replace(/\D/g, '') : value;
        this.setData({ form: form, error: '', canSubmit: this.check(form, this.data.agreed) });
    },

    onPosition: function (e) {
        var index = Number(e.detail.value) || 0;
        var form = {};
        for (var k in this.data.form) form[k] = this.data.form[k];
        form.position = this.data.positions[index];
        this.setData({ positionIndex: index, form: form, canSubmit: this.check(form, this.data.agreed) });
    },

    toggleConsent: function () {
        var agreed = !this.data.agreed;
        this.setData({ agreed: agreed, error: '', canSubmit: this.check(this.data.form, agreed) });
    },

    check: function (form, agreed) {
        return !!form.name && /^1\d{10}$/.test(form.phone) && !!form.storeName && !!form.position && !!agreed;
    },

    showPrivacy: function () {
        wx.showModal({
            title: '学员信息使用说明',
            content: '1. 收集姓名、手机号、门店、岗位，用于建立学习档案、记录学习进度与考试成绩；\n2. 考试成绩可能用于门店绩效与晋升评估，考前会再次提示；\n3. 信息仅店长与培训管理员可见，不对外提供；\n4. 需要更正信息时联系门店管理员。',
            showCancel: false,
            confirmText: '我知道了'
        });
    },

    submit: function () {
        if (this.data.submitting) return;
        var form = this.data.form;
        if (!form.name) return this.warn('请填写姓名');
        if (!/^1\d{10}$/.test(form.phone)) return this.warn('请填写正确的手机号');
        if (!form.storeName) return this.warn('请填写所属门店');
        if (!this.data.agreed) return this.warn('请先同意学员信息使用说明');

        var that = this;
        this.setData({ submitting: true, error: '' });
        api.call('auth.bind', {
            name: form.name,
            phone: form.phone,
            storeName: form.storeName,
            position: form.position
        }).then(function (res) {
            api.resetLogin();
            getApp().setUser(res.user);
            wx.showToast({ title: '绑定成功', icon: 'success' });
            setTimeout(function () {
                wx.reLaunch({ url: '/pages/index/index' });
            }, 500);
        }).catch(function (err) {
            that.setData({ submitting: false, error: err.message || '绑定失败，请重试' });
        });
    },

    warn: function (message) {
        this.setData({ error: message });
        wx.showToast({ title: message, icon: 'none' });
    }
});
