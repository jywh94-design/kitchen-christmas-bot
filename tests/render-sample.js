// 在自己电脑上预览排行榜图片（不需要 Discord、不需要数据库）
// 用法：npm install 之后运行  node tests/render-sample.js   会在当前文件夹生成 rank-sample.png
const fs = require('fs');
const { renderRankImage } = require('../src/rankImage');

const entries = [
  { name: '阿星厨师长', tickets: 15 },
  { name: 'Xingcheng', tickets: 14 },
  { name: '小美Mei', tickets: 12 },
  { name: 'Assumie', tickets: 11 },
  { name: '超级长的名字用来测试省略号显示效果', tickets: 10 },
  { name: 'Kevin_Lim', tickets: 9 },
  { name: '陈大厨🍳', tickets: 8 },
  // 故意只放 8 个人，看「虚位以待」的效果
];

renderRankImage(entries).then((buf) => {
  fs.writeFileSync('rank-sample.png', buf);
  console.log('✅ 已生成 rank-sample.png');
});
