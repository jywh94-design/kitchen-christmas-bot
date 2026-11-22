# 厨房机密处 · 圣诞活动 Discord Bot v2.4.1（圣诞排行榜版）

本包是在原版 v2.4.1 基础上，只更新**全服战报及排行榜图片模板**的版本。Discord 事件、数据库、幸运签规则、开奖及指令逻辑维持原样。

## 已改内容

- `assets/rank-template.png`：换成新的 1672 × 941 圣诞像素风排行榜底图。
- `src/rankImage.js`：前 3 名的头像、昵称、签数会显示在左侧奖台；第 4–9 名显示在右侧六行。
- `src/report.js` 不用修改；每日战报会自动使用新排行榜图片，原本总签数与入场人数文字照常发送。
- 原来的 `/ranking` 等使用 `getRanking` 的功能也会共用新图。

## 上传 GitHub

把这个 ZIP 解压，在你的 GitHub 仓库中上传**文件夹内部所有文件和目录**（`src/`、`assets/`、`tests/`、`web/`、`package.json` 等），覆盖旧项目同名文件。不要只上传 ZIP 而不解压。已连接 Railway 的仓库通常会在 push 后重新部署。

## Railway 配置

保留原先 Railway 的环境变量（参考 `.env.example`）。**不要上传真实 `.env` 或 Discord Bot Token。**

## 本地运行

需要 Node.js 18+ 和 PostgreSQL。

```bash
npm install
npm test
node tests/render-sample.js
npm start
```

`tests/render-sample.js` 会生成 `rank-sample.png`，用于离线预览（不需要连接 Discord）。

## 自定义排行榜

- 更换同布局图片：替换 `assets/rank-template.png`。
- 改头像、昵称、签数位置：编辑 `src/rankImage.js` 的 `PODIUM` 和 `ROW` 坐标。
- 修改战报文字：编辑 `src/report.js`。

**注意：** 底图上的活动标题、日期和底部木牌文字是静态印在图片上的；例如 `12.01 - 12.24` 不会自动跟随活动配置更新。
