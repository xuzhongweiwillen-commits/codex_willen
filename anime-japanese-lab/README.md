# Anime Japanese Lab

全栈 MVP：上传动漫/日剧视频 → Gemini 3.8 Flash 分析 → 日语逐句、时间戳、中文翻译、单词、语法、假名/50音 → 视频同步学习。

## Cloudflare 部署
1. `npm install`
2. `npx wrangler login`
3. `npx wrangler secret put GEMINI_API_KEY`
4. `npm run deploy`

前端与 Worker API 同域部署，API Key 不暴露给浏览器。

## 模型
默认 `gemini-3.8-flash`。Gemini 支持视频输入和时间戳理解；Developer API 当前有 Free Tier，但受免费额度/速率限制约束。

## 上传限制
当前 Cloudflare Free 入口限制为 100MB，因此前端限制视频不超过 100MB。