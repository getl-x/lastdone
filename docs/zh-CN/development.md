# 开发说明

## 工具链

- Node.js 22.12 或更高版本
- 与 `source/server/go.mod` 一致的 Go 版本
- Android 开发需要 JDK 21 和 Android SDK 36
- 容器发布验证需要支持 Buildx 的 Docker

在 `source` 目录安装 JavaScript 依赖：

```bash
npm ci
```

## JavaScript 工作区

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

普通 Web 构建会生成 PWA manifest 和 service worker。Android 模式会关闭 service
worker，避免影响 Capacitor 原生桥接：

```bash
npm run build:android --workspace @lastdone/web
```

## Go 服务端

```bash
cd source/server
go test ./...
go run . serve --http=127.0.0.1:8090
```

本地开发时可以把 Web 构建结果放进服务端公开目录，也可以单独运行 Vite，再把 API
请求指向服务端。

## 跨语言规则

计划与状态测试向量位于 `source/packages/contracts`。TypeScript 领域包和 Go 服务端
共同遵循自然月日期截断、闰年、固定日期和状态排序等规则。

## 生成文件和私密文件

不要提交：

- `node_modules`、`dist`、覆盖率、测试结果和 Gradle 构建输出；
- `source/server/pb_data` 中的 PocketBase 运行数据；
- Capacitor 复制的 Web 资源；
- `.env`、JKS/keystore 和签名密码。

仓库中的 Android Gradle 工程属于源码。`cap sync` 复制到
`android/app/src/main/assets/public` 的内容是生成物，已被忽略。
