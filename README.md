# 会议废话浓度检测器（Azure 版）

边开会边录音（一个麦克风录整场就行），Azure 语音服务实时转写成文字并自动分辨不同的发言人，规则引擎每句话实时打分；会后一键让 Azure OpenAI 读懂整场会，给出 AI 判定的废话浓度、有用结论、待办和毒舌点评。

```
public/                    前端（单页，无需构建）
  index.html
  vendor/speech-sdk-1.52.0.min.js   Azure 语音 SDK（MIT，已内置，国内不用连外网 CDN）
  staticwebapp.config.json
api/                       Azure Functions（Node 20，v4 编程模型）
  src/functions/speechToken.js      GET  /api/speech-token  用密钥换 10 分钟临时令牌
  src/functions/aiReview.js         POST /api/ai-review     调 Azure OpenAI 生成点评
.github/workflows/         推到 main 自动部署
```

密钥只存在后端的应用设置里，浏览器只拿到临时令牌。

## 一、在 Azure 门户准备三样东西

1. **语音服务**：创建资源「Speech（语音服务）」，定价层选 F0（免费，每月 5 小时转写）或 S0。记下「密钥 1」和「区域」（如 `eastasia`、`southeastasia`；世纪互联中国区如 `chinaeast2` 也支持）。
2. **AI 终审模型**（可以后配，二选一）：国内模型（DeepSeek、通义千问等，填下面的 `LLM_*`），或 **Azure OpenAI**（填 `AOAI_*`；注意大陆个人订阅开不了 Azure OpenAI，只有持营业执照的企业可以）：创建 Azure OpenAI 资源，在 Foundry 里部署 `gpt-5.4-mini`（部署类型选 Global Standard）。gpt-4o 系列已弃用，2027 年上半年下线，别再用。部署好后记下「终结点」「密钥」和你起的「部署名」。
3. **Static Web App**：创建「静态 Web 应用」，计划选 Free 即可。部署来源选 GitHub（推荐，见下）或「其他」（用 CLI 手动发）。

## 二、配置应用设置

静态 Web 应用 → 设置 → 环境变量（应用程序设置），添加：

| 名称 | 值 |
|---|---|
| `SPEECH_KEY` | 语音服务密钥 |
| `SPEECH_REGION` | 语音服务区域，如 `eastasia` |
| `LLM_BASE_URL` | AI 终审用国内模型时填：DeepSeek 填 `https://api.deepseek.com`，通义千问填 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_API_KEY` | 对应平台的 API Key |
| `LLM_MODEL` | 如 `deepseek-chat` 或 `qwen-plus` |
| `AOAI_ENDPOINT` | 如 `https://xxx.openai.azure.com` |
| `AOAI_KEY` | Azure OpenAI 密钥 |
| `AOAI_DEPLOYMENT` | 部署名，如 `gpt-5.4-mini` |
| `AOAI_REASONING_EFFORT` | 可选，默认 `low`，想点评更走心可改 `medium` |

## 三、部署

**方式 A：GitHub 自动部署（推荐）**
1. 把整个文件夹推到一个 GitHub 仓库的 `main` 分支。
2. 创建 Static Web App 时关联这个仓库，「应用位置」填 `public`，「API 位置」填 `api`，「输出位置」留空。Azure 会自动加好工作流和密钥。
   如果用本仓库自带的 `.github/workflows/azure-static-web-apps.yml`，就到静态 Web 应用「概述 → 管理部署令牌」复制令牌，存成仓库 Secret `AZURE_STATIC_WEB_APPS_API_TOKEN`。

**方式 B：命令行一次性发布**
```bash
npm install -g @azure/static-web-apps-cli
cd api && npm install && cd ..   # 必须先装，swa deploy 不会在云端装 API 依赖
swa deploy ./public --api-location ./api --api-language node --api-version 20 \
  --deployment-token <部署令牌> --env production
```

## 四、本地调试

```bash
npm install -g @azure/static-web-apps-cli azure-functions-core-tools@4
cd api && npm install && cd ..
# 在 api/ 下建 local.settings.json，Values 里填上面那几个变量
swa start ./public --api-location ./api
```
打开 http://localhost:4280 。麦克风只能在 HTTPS 或 localhost 下用。

## 注意

- `/api/speech-token` 和 `/api/ai-review` 默认任何人都能调，会消耗你的额度。只给自己团队用的话，在 `staticwebapp.config.json` 里给 `/api/*` 加 `"allowedRoles": ["authenticated"]`，并开启 Entra ID 登录。
- 语音按录音时长计费，AI 点评按调用次数计费；实时打分是纯前端规则，不花钱。
- 发言人分辨用的是 Azure「对话转写」（ConversationTranscriber）。离麦克风越近、说话人声音差别越大越准；刚开口的几秒可能还认不出是谁，会先接在上一位后面。
- 转写语言固定为 `zh-CN`，在 `index.html` 里搜 `speechRecognitionLanguage` 可改。
