# Steam Inventory Viewer

一个基于 Steam Web API 的游戏库存展示网站，支持 CS2、Dota 2、TF2、Rust 等游戏道具的可视化展示。

## ✨ 功能

- **API Key 模式**：输入 Steam API Key + SteamID，支持查看玩家信息
- **公开库存模式**：直接输入 SteamID 查看公开库存，无需 API Key
- **快速选择游戏**：CS2、Dota 2、TF2、Rust 一键切换
- **筛选 & 搜索**：按名称搜索、按稀有度/类型筛选、多种排序
- **网格/列表视图**：双视图切换，自由浏览
- **物品详情弹窗**：点击道具查看详细信息、跳转 Steam 市场
- **分页加载**：大型库存分批展示，流畅不卡顿

## 🚀 在线访问

部署于 GitHub Pages：`https://claudwang.github.io/steam-inventory-viewer`

## 🔧 本地运行

无需构建，直接用浏览器打开 `index.html` 即可（需通过 HTTP 服务器，否则受 CORS 限制）。

```bash
# 用 Python 起简易服务器
python -m http.server 8080
# 访问 http://localhost:8080
```

## 📝 使用说明

1. 前往 [Steam API Key 申请页](https://steamcommunity.com/dev/apikey) 获取 API Key
2. 在 Steam 个人资料页找到你的 SteamID64（17位数字）
3. 输入 API Key 和 SteamID，选择游戏，点击"查看库存"

> ⚠️ 注意：如果使用公开库存模式，需要将你的 Steam 库存设置为"公开"

## 🛠 技术栈

- 纯静态页面：HTML5 + CSS3 + Vanilla JS
- Steam Community Inventory API（公开端点）
- Steam Web API（GetPlayerSummaries）
- CORS 代理：corsproxy.io / allorigins.win

## 📄 License

MIT
