# 会议废话浓度检测器

开会时打开它，一个麦克风录整场：Azure 语音边说边转写并自动分人，词库和 AI 实时逐句打分；停止后 AI 读完整场会，给出最终得分、结论、待办、废话之王和毒舌点评，一键生成分享图。

线上地址：https://red-moss-05ed52e00.6.azurestaticapps.net

## 页面

| 路径 | 内容 |
|---|---|
| `/` | 首页：介绍、示例化验单、评级说明、常见问题 |
| `/app` | 检测台：录音/粘贴，「实时」和「最终」两块结果，逐句标注 |
| `/history` | 历史记录：趋势图、搜索、单场详情（只存在浏览器 localStorage） |

## 目录

```
public/                     静态前端，无需构建
  index.html app.html history.html 404.html
  assets/analyzer.js        词库打分 + 叠加 AI 逐句判断
  assets/app.js             检测台：录音、实时精读、最终结果、保存
  assets/history.js         历史记录
  assets/share.js           分享图（Canvas）和 Markdown 导出
  assets/store.js           localStorage 读写
  assets/site.js / site.css 顶栏、登录状态、公共样式
  vendor/speech-sdk-*.js    Azure 语音 SDK（MIT，内置，国内不依赖外网 CDN）
  staticwebapp.config.json  路由、404、响应头
api/                        Azure Functions（Node 20，v4 编程模型）
  src/functions/speechToken.js   GET  /api/speech-token  换 10 分钟语音令牌
  src/functions/aiJudge.js       POST /api/ai-judge      AI 逐句精读（每次最多 30 句）
  src/functions/aiReview.js      POST /api/ai-review     AI 最终点评
  src/functions/status.js        GET  /api/status        功能开关、登录用户、今日剩余额度
  src/lib/llm.js                 大模型调用（DeepSeek 等 OpenAI 兼容接口，或 Azure OpenAI）
  src/lib/guard.js               每日额度：未登录按 IP，登录后按账号
```

## 额度

网站公开，不登录也能用；用微软或 GitHub 账号登录（Static Web Apps 内置登录）后额度更高。北京时间每天 0 点重置。

| 项目 | 未登录（每个 IP） | 登录（每个账号） | 环境变量覆盖 |
|---|---|---|---|
| 录音 | 5 段（每段约 8 分钟） | 25 段 | `QUOTA_SPEECH_TOKEN_ANON` / `_USER` |
| AI 逐句精读 | 600 句 | 5000 句 | `QUOTA_AI_JUDGE_ANON` / `_USER` |
| 最终结果 | 3 次 | 30 次 | `QUOTA_AI_REVIEW_ANON` / `_USER` |

全站每日总上限可用 `SITE_DAILY_SPEECH_TOKEN`、`SITE_DAILY_AI_JUDGE`、`SITE_DAILY_AI_REVIEW` 调整。计数存在函数实例内存里，实例重启会清零，挡普通滥用够用；要精确计数可以换成 Azure Table Storage。

## 环境变量（静态 Web 应用 → 环境变量）

| 名称 | 说明 |
|---|---|
| `SPEECH_KEY` / `SPEECH_REGION` | Azure 语音服务密钥和区域（如 `eastasia`） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI 兼容的大模型，DeepSeek 填 `https://api.deepseek.com`、`deepseek-flash`（程序会自动关掉它的思考模式） |
| `LLM_EXTRA_BODY` | 可选，JSON 对象，原样并进请求体。比如想让 DeepSeek 开思考模式就填 `{"thinking":{"type":"enabled"}}`，但小心超过 45 秒时限 |
| `AOAI_ENDPOINT` / `AOAI_KEY` / `AOAI_DEPLOYMENT` | 可选，改用 Azure OpenAI（大陆个人订阅开不了） |

## 部署

推到 `main` 由 GitHub Actions 自动发布（`.github/workflows/azure-static-web-apps.yml`），需要仓库 Secret `AZURE_STATIC_WEB_APPS_API_TOKEN`。PR 会自动生成预览环境。

手动发布：

```bash
cd api && npm install && cd ..   # swa deploy 不会在云端装 API 依赖
swa deploy ./public --api-location ./api --api-language node --api-version 20 --deployment-token <令牌> --env production
```

## 本地调试

```bash
npm install -g @azure/static-web-apps-cli azure-functions-core-tools@4
cp api/local.settings.example.json api/local.settings.json   # 填上密钥
cd api && npm install && cd ..
swa start ./public --api-location ./api
```

打开 http://localhost:4280 。麦克风只能在 HTTPS 或 localhost 下用。
