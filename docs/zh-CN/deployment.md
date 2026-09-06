# Docker 与 1Panel 部署

## 准备条件

- 已安装 Docker 或 1Panel 容器管理功能的 Linux VPS
- 托管在 Cloudflare 或其他 DNS 服务商的域名
- 已为网站启用 HTTPS
- VPS 本机回环地址的 `8090` 端口可用

不需要邮件服务。LastDone 不开放注册，单用户模式下也不依赖邮件找回密码。

## 发布 Docker 镜像

先在目标 Docker Hub 命名空间下创建名为 `lastdone` 的仓库。如果希望 VPS 无需配置
Docker Hub 登录信息就能直接拉取镜像，应把仓库设为 Public。

在 Docker Hub 创建具有 Read & Write 权限的个人访问令牌。不要把 Docker Hub 账号
密码保存到 GitHub。进入 GitHub 仓库的 Settings，依次打开 Secrets and variables、
Actions，然后添加：

- Repository variable `DOCKERHUB_USERNAME`：Docker Hub 命名空间，例如 `getl-x`。
- Repository secret `DOCKERHUB_TOKEN`：刚创建的 Docker Hub 个人访问令牌。

手动运行 `Publish Docker image` 工作流并把 tag 填为 `latest`。工作流会先构建并健康
检查 amd64 镜像，通过后再把 amd64/arm64 多架构镜像发布到 Docker Hub。

## 1. 创建 Compose 应用

把 `compose.yml` 和 `deploy/lastdone.env.example` 复制到 VPS 的独立目录，将示例环境
文件改名为 `.env`，至少修改：

```dotenv
LASTDONE_IMAGE=getl-x/lastdone:latest
LASTDONE_VAPID_SUBJECT=https://lastdone.example.com
TZ=Asia/Shanghai
```

`LASTDONE_VAPID_SUBJECT` 用于标识这套部署。个人使用时直接填写公开的 HTTPS 域名
即可。

在 1Panel 中也可以直接新建 Compose 项目，填入同样的 Compose 内容和环境变量。
启动项目，等待容器健康状态变为正常。持久化命名卷为 `lastdone_data`。

## 2. 在 1Panel 中配置网站

为选定域名创建网站，在 1Panel 的反向代理界面把代理目标设置为：

```text
http://127.0.0.1:8090
```

然后启用 HTTPS。Compose 服务有意只监听本机地址，不直接暴露公网端口。本仓库不会
安装或修改 OpenResty 配置文件。

如果开启 Cloudflare 代理，建议不要缓存 `/api/*`、`/_/*` 和 `sw.js`。带哈希的静态
资源可以正常使用浏览器或 CDN 缓存。

## 3. 创建管理员和应用账号

在容器中创建 PocketBase 超级管理员：

```bash
docker compose exec lastdone /usr/local/bin/lastdone superuser create admin@example.com '请替换为足够长的密码'
```

这里填写管理员邮箱和独立的长密码，然后访问：

```text
https://lastdone.example.com/_/
```

打开 `users` 集合，创建一条包含用户名和密码的记录。LastDone 登录页使用这里的
用户名。不要给这个集合开放公开创建规则。

忘记应用密码时，直接进入 PocketBase 管理界面重置。这就是本项目替代邮件找回密码
的方式，所以 VPS 不需要开放 25 端口。

## 4. 安装客户端

- iPhone：用 Safari 打开网站，点击分享，再选择“添加到主屏幕”。
- 电脑：直接用支持的浏览器访问同一个 HTTPS 地址。
- Android：安装 GitHub Release 中的签名 APK。如果 APK 构建时没有固定服务器
  地址，首次启动时填写同一个 HTTPS 域名。

只有在 LastDone 设置页主动点击启用时，系统才会请求通知权限。

## 资源占用

Compose 默认设置 `GOMEMLIMIT=384MiB`，实际内存取决于数据量和访问情况。持久化
空间主要包括 PocketBase SQLite 数据库、Web Push 密钥，以及 `/pb/pb_data` 中保留
的备份压缩包。

默认保留 7 份每日备份和 3 份升级前备份。
