# LastDone

[English](README.md)

LastDone 是一个私人使用、离线优先的重复事项记录工具，适合那些并非每天发生、
却很容易忘记的事情，例如更换滤芯、备份电脑、车辆保养和证件续期。

它主要回答三个问题：

1. 这件事上次是什么时候完成的？
2. 下次应该什么时候完成？
3. 哪些事情已经逾期或即将到期？

## 支持的客户端

- 通过 Safari 添加到 iPhone 主屏幕的 PWA
- 电脑浏览器直接使用的响应式 Web 应用
- 使用 Capacitor 打包并签名的 Android APK

所有客户端连接同一个自建服务器。首次成功登录和同步后，本地 IndexedDB 会保留
可离线使用的数据副本。Android 提醒完全在手机本地安排，不依赖 Firebase 或
Google Play 服务。

## 主要功能

- 按天、周、自然月、自然年计算的“完成后再过一段时间”计划
- 每月固定日期和每年固定日期计划
- 逾期、今天到期、即将到期、状态良好、暂停和归档状态
- 一键完成、撤销、历史记录、补记完成和跳过固定日期
- 分类、搜索、可校验恢复的 JSON 完整备份和 CSV 导出
- 离线操作队列、自动同步与可手动选择版本的冲突处理
- iPhone PWA 和电脑浏览器使用 Web Push
- Android 使用本地通知，支持安静时段和 12 小时补发窗口
- 内嵌 PocketBase，自动迁移并自动备份
- Docker 多架构镜像和签名 APK 发布工作流

## Docker 快速部署

复制 [compose.yml](compose.yml)，并在同一目录创建 `.env`：

```dotenv
LASTDONE_IMAGE=getl-x/lastdone:latest
LASTDONE_PORT=8090
TZ=Asia/Shanghai
LASTDONE_VAPID_SUBJECT=https://lastdone.example.com
GOMEMLIMIT=384MiB
```

启动服务：

```bash
docker compose up -d
```

容器只监听 `127.0.0.1:8090`。在 1Panel 中创建网站，把反向代理目标设置为
`http://127.0.0.1:8090`，然后为域名启用 HTTPS 即可。仓库不包含也不需要你手动
部署 OpenResty 配置文件。

随后创建 PocketBase 超级管理员，打开 `https://你的域名/_/`，在 `users` 集合中
创建唯一的应用账号。项目关闭了公开注册和邮件发送，因此不需要 SMTP，也不需要
VPS 开放 25 端口。

完整步骤见 [Docker 与 1Panel 部署说明](docs/zh-CN/deployment.md)。

## 仓库结构

```text
source/apps/web       React PWA 与 Capacitor Android 应用
source/packages/core 日期计划和状态规则
source/packages/storage 离线数据库与数据仓库
source/packages/sync 客户端同步引擎
source/server         内嵌 PocketBase 的 Go 服务端
docs/en               英文运维文档
docs/zh-CN            简体中文运维文档
```

产品行为说明见 [LASTDONE-DESIGN.zh-CN.md](LASTDONE-DESIGN.zh-CN.md)，开发命令见
[docs/zh-CN/development.md](docs/zh-CN/development.md)。

## 安全设计

- 不开放用户注册。
- 每条同步数据都限定为当前登录用户所有。
- Docker 容器使用 UID/GID `10001`，移除 Linux capabilities，并支持只读根文件系统。
- Android 签名密钥只从本地环境变量或 GitHub Actions Secrets 读取，不进入 Git。
- Android 服务器地址强制使用 HTTPS；PWA 安装和 Web Push 也应使用 HTTPS。

## 许可证

目前尚未选择开源许可证。在添加许可证文件之前，版权归仓库所有者保留。
