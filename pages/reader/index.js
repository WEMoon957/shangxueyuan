// 课件学习：本地计时 + 停留门槛，防止秒点完成
var api = require('../../utils/api');

var MIN_SECONDS = 60;     // 至少停留 60 秒才能标记完成
var TICK_MS = 1000;

function pad(n) {
    return n < 10 ? '0' + n : '' + n;
}

Page({
    data: {
        state: 'loading',
        error: '',
        courseId: '',
        course: {},
        wares: [],
        elapsed: 0,
        timeText: '00:00',
        progressPercent: 0,
        hint: '',
        canFinish: false,
        finishText: '继续学习中…',
        done: false
    },

    onLoad: function (query) {
        this.setData({ courseId: (query && query.id) || '' });
    },

    onShow: function () {
        if (!this.data.courseId) {
            this.setData({ state: 'error', error: '缺少课程参数' });
            return;
        }
        if (!this.data.done && this.data.state !== 'ready') {
            this.prepare();
        }
        this.startTimer();
    },

    onHide: function () {
        this.stopTimer(true);
    },

    onUnload: function () {
        this.stopTimer(true);
    },

    prepare: function () {
        var that = this;
        return api.login().then(function (data) {
            if (!data.bound) {
                wx.redirectTo({ url: '/pages/bind/index' });
                return null;
            }
            return Promise.all([
                api.call('course.detail', { courseId: that.data.courseId }),
                api.call('learning.open', { courseId: that.data.courseId })
            ]);
        }).then(function (res) {
            if (!res) return;
            var detail = res[0];
            var progress = detail.progress;
            var done = progress.status === '已完成';
            var elapsed = progress.minutes * 60;
            that.setData({
                state: 'ready',
                course: detail.course,
                wares: detail.wares,
                done: done,
                elapsed: elapsed
            }, function () {
                that.refreshTimerText();
            });
        }).catch(function (err) {
            if (err.code === 'NEED_BIND') return;
            that.setData({ state: 'error', error: err.message || '加载失败' });
        });
    },

    startTimer: function () {
        var that = this;
        this.stopTimer(false);
        this.timer = setInterval(function () {
            that.setData({ elapsed: that.data.elapsed + 1 }, function () {
                that.refreshTimerText();
            });
        }, TICK_MS);
    },

    stopTimer: function (report) {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (report) this.report();
    },

    /** 只上报整分钟，避免频繁写飞书 */
    report: function () {
        if (this.data.done) return;
        var minutes = Math.floor(this.data.elapsed / 60) - (this.reportedMinutes || 0);
        if (minutes < 1) return;
        this.reportedMinutes = (this.reportedMinutes || 0) + minutes;
        api.call('learning.tick', { courseId: this.data.courseId, minutes: minutes }).catch(function () {
            /* 心跳失败不打断学习 */
        });
    },

    refreshTimerText: function () {
        var elapsed = this.data.elapsed;
        var percent = Math.min(100, Math.round((elapsed / MIN_SECONDS) * 100));
        var left = Math.max(0, MIN_SECONDS - elapsed);
        var canFinish = this.data.done || left === 0;
        var hint = this.data.done
            ? '这门课已完成，可以随时回来复习'
            : (left > 0 ? '再停留 ' + left + ' 秒即可标记完成（防止秒点）' : '已达标，可以标记完成');
        this.setData({
            timeText: pad(Math.floor(elapsed / 60)) + ':' + pad(elapsed % 60),
            progressPercent: percent,
            canFinish: canFinish,
            hint: hint,
            finishText: this.data.done ? '已学完，返回课程' : (canFinish ? '标记为已学完' : '继续学习中…')
        });
    },

    finish: function () {
        var that = this;
        if (this.data.done) {
            wx.navigateBack();
            return;
        }
        if (!this.data.canFinish) {
            wx.showToast({ title: '再学习一会儿吧', icon: 'none' });
            return;
        }
        this.stopTimer(false);
        var totalMinutes = Math.ceil(this.data.elapsed / 60);
        var minutes = Math.max(0, totalMinutes - (this.reportedMinutes || 0));
        wx.showLoading({ title: '记录中', mask: true });
        api.call('learning.finish', { courseId: this.data.courseId, minutes: minutes }).then(function () {
            wx.hideLoading();
            that.setData({ done: true }, function () {
                that.refreshTimerText();
            });
            wx.showToast({ title: '已记录完成', icon: 'success' });
            setTimeout(function () {
                wx.navigateBack();
            }, 700);
        }).catch(function (err) {
            wx.hideLoading();
            that.startTimer();
            wx.showToast({ title: err.message || '记录失败，请重试', icon: 'none' });
        });
    },

    back: function () {
        wx.navigateBack();
    }
});
