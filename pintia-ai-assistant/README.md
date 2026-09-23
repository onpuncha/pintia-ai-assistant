# Pintia 学习辅助 Edge 扩展

这是一个由 Edge 浏览器扩展和本地 Node.js 服务组成的辅助工具。它读取当前已经登录的 Pintia 页面，把题目发送给你配置的 AI API，并把结果显示在扩展中；写入页面前仍由你确认。

## 先看功能边界

### A 模式：适合逐题检查

1. 你打开 Pintia 题型页面。
2. 点击“读取当前题目”。
3. 扩展自动请求 AI 生成答案。
4. 你可以展开题目区域查看题面，也可以检查答案 JSON。
5. 点击“填入答案”，扩展才会把答案写入当前 Pintia 页面。

A 模式不会自动保存、提交或切换题型。

编程题在 A 模式中可以选择 C、C++ 或 Python，生成代码后显示在扩展里；点击“填入编辑器”才会写入 Pintia 编辑器。测试和提交需要你在 Pintia 页面完成。

### B 模式：目前是半自动版本

B 模式的目标流程是：

```text
开始 B 模式
→ 读取当前题型并生成答案
→ 你点击“填入、保存并切换”
→ 填入答案、尝试保存、切换下一题型
→ 自动读取并生成下一题型答案
→ 到达编程题后停止
```

坦白说，B 模式目前还不够完善，不能做到“一键自动完成所有题目、自动处理编程题并自动提交”。页面路由、保存状态、不同题型控件和 AI 答案格式都可能导致流程暂停或切换失败。因此请把 B 模式当作辅助批处理功能，检查每个题型的结果，不要假设它已经完成整份作业。

扩展不会保存 Pintia 账号密码、Cookie 或 API Key，也不会自动点击最终提交按钮。

## 项目文件说明

```text
pintia-ai-assistant/
├─ extension/       Edge 扩展源码，需要加载这个文件夹
├─ server/          本地 Node.js 服务
│  ├─ server.js
│  ├─ package.json
│  ├─ package-lock.json
│  └─ .env.example
├─ README.md
└─ .gitignore
```

## 第一次安装（电脑小白版）

### 第 1 步：安装 Node.js

1. 打开 [Node.js 官网](https://nodejs.org/)。
2. 下载 LTS 版本并按默认选项安装。
3. 安装完成后重新打开 PowerShell。
4. 输入下面两条命令检查是否安装成功：

```powershell
node --version
npm --version
```

能看到版本号即可。

### 第 2 步：配置自己的 API Key

API Key 放在这个文件中：

```text
C:\Users\你的用户名\Desktop\测试1\pintia-ai-assistant\server\.env
```

如果没有 `.env` 文件，先在 PowerShell 中执行：

```powershell
cd C:\Users\你的用户名\Desktop\测试1\pintia-ai-assistant\server
Copy-Item .env.example .env
notepad .env
```

在记事本里填写：

```env
PORT=8787
DEEPSEEK_API_KEY=在这里粘贴你自己的API_KEY
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

保存并关闭记事本。
### 第 3 步：安装并启动本地服务

在 PowerShell 中执行：

```powershell
cd C:\Users\你的用户名\Desktop\测试1\pintia-ai-assistant\server
npm install
node .\server.js
```

看到下面这句话，说明服务已经启动：

```text
Pintia local AI service listening on http://127.0.0.1:8787
```

这个 PowerShell 窗口要保持打开。关闭窗口就会停止服务。

如果出现 `EADDRINUSE`，说明服务已经运行，不要重复启动。可以在浏览器打开下面的地址检查：

```text
http://127.0.0.1:8787/health
```

看到 `"ok":true` 即可。

### 第 4 步：安装 Edge 扩展

1. 打开 Edge，在地址栏输入 `edge://extensions/`。
2. 打开右上角“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择：

```text
C:\Users\你的用户名\Desktop\测试1\pintia-ai-assistant\extension
```

注意：选择的是 `extension` 文件夹，不是 `server` 文件夹，也不是最外层项目文件夹。

### 第 5 步：使用 A 模式

1. 登录 Pintia。
2. 打开一个具体题型页面。
3. 点击扩展图标，打开侧栏。
4. 保持“模式 A”。
5. 点击“读取当前题目”。
6. 等待答案自动生成。
7. 检查答案后点击“填入答案”。

### 第 6 步：使用 B 模式

1. 先打开普通题型页面，不要从编程题开始。
2. 在扩展中选择“模式 B”。
3. 点击“开始 B 模式”。
4. 等待当前题型答案生成。
5. 检查答案后点击“填入、保存并切换”。
6. 页面切换后，扩展会再次读取并生成下一题型答案。
7. 到达编程题后流程停止。



## 常见问题

### `EADDRINUSE: 127.0.0.1:8787`

8787 端口已经被服务占用，通常说明服务已启动。不要重复执行 `node .\server.js`，直接访问：

```text
http://127.0.0.1:8787/health
```

### `TypeError: fetch failed`

通常是本地服务没有运行、扩展没有重新加载，或 Node.js 无法访问 DeepSeek。先确认 `/health` 正常，再重新加载扩展。

### 扩展能读取题目但不能填入

刷新 Pintia 页面，再重新加载扩展。不同作业的页面结构可能不同；可以使用“导出脱敏诊断 JSON”协助排查，但不要上传带个人信息的原始文件。

### AI 返回答案格式错误

点击“重新生成”，或在答案框中手动修正 JSON 后再点击“填入答案”。
