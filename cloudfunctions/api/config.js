/**
 * 飞书数据底座配置。
 *
 * 凭证走云函数环境变量（云开发控制台 → 云函数 → api → 配置 → 环境变量）：
 *   FEISHU_APP_ID      飞书自建应用的 App ID
 *   FEISHU_APP_SECRET  飞书自建应用的 App Secret
 *
 * app_token / 表 id 不是密钥，随代码走。
 */
var TABLES = {
    courses: 'tbl0mrlQosowWWqX',    // 课程库
    students: 'tblMBM5ygK87fPi6',   // 学员档案
    progress: 'tblfIpxEAkN5u0Qz',   // 学习进度
    questions: 'tbl7tdWb2e7okTaF',  // 题库
    exams: 'tblkBS6poUqfhprI',      // 考试配置
    attempts: 'tblgFV9Jz4A3qXYd',   // 考试记录
    answers: 'tblojifWD7cEEz9f',    // 答题明细
    wrongbook: 'tblCq4vlOUcQebpa',  // 错题本
    certs: 'tbl00tNpsd6P4bkp'       // 证书颁发
};

module.exports = {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    appToken: 'AI1qb7KQvalW3OsRAkpcU9VOnqd',
    tables: TABLES
};
