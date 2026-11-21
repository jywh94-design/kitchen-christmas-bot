// 手动注册斜杠指令（机器人启动时也会自动注册，一般不需要手动跑）
require('dotenv').config();
const { registerCommands } = require('./register');

console.log('⏳ 正在注册斜杠指令...');
registerCommands()
  .then(() => console.log('✅ 所有斜杠指令注册成功！'))
  .catch((error) => {
    console.error('❌ 指令注册失败:', error);
    process.exit(1);
  });
