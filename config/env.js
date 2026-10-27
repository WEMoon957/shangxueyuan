/**
 * 运行配置：填上云开发环境 ID 即切换到飞书真实数据，留空则用内置演示数据。
 *
 * 云开发环境 ID 获取：微信开发者工具 → 云开发 → 设置 → 环境 ID（形如 prod-8gxxxxxx）。
 */
var CLOUD_ENV_ID = '';        // TODO 填入云开发环境 ID
var FORCE_DEMO = false;       // 本地调试想强制看演示数据时置 true

var demo = FORCE_DEMO || !CLOUD_ENV_ID;

module.exports = {
    cloudEnvId: CLOUD_ENV_ID,
    apiFunction: 'api',
    demo: demo,
    demoOpenid: 'demo_openid_store_001',
    version: '1.0.0'
};
