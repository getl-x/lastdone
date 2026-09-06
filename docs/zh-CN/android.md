# Android 应用

Android 客户端是共享 React 应用外面的一层轻量 Capacitor 壳。Web 资源打包在 APK
内部，数据请求则连接公开的 HTTPS LastDone 服务器。

## 服务器地址

支持两种方式：

1. 构建时设置 `VITE_LASTDONE_SERVER_URL=https://lastdone.example.com`，APK 会固定连接
   这个地址。
2. 不设置变量。首次启动显示服务器设置页，检查 `/api/lastdone/health` 后，把地址保存
   到 Capacitor Preferences。以后可以在设置页重新配置。

地址必须是纯 HTTPS 域名，不能包含路径、用户名密码、查询参数或锚点。

## 本地通知

Android 不注册 Web Push，也不使用 FCM。应用从 IndexedDB 读取已同步事项和用户
设置，然后安排未来 90 天的原生本地通知。

以下情况会重新核对通知计划：

- 应用启动；
- 同步成功；
- 事项或提醒设置变化；
- 应用回到前台；
- 网络恢复；
- 修改通知偏好。

提醒使用 Android 非精确闹钟。Manifest 会明确移除本地通知插件附带的精确闹钟
权限。稳定通知 ID 和本地计划账本可以避免同一个到期事项被反复补发。

## 红米与 HyperOS

在 LastDone 中启用通知后：

1. 进入系统的 LastDone 应用设置，允许通知。
2. 把电池策略设置为“不限制”。
3. 如果手机重启后提醒消失，再允许自启动。

系统电池管理仍有可能推迟非精确提醒。LastDone 有意不申请紧急通知或精确闹钟权限。

## 本地构建条件

- Node.js 22.12 或更高版本
- JDK 21
- Android SDK Platform 36 及匹配的构建工具

生成 Web 包并复制到 Android 工程：

```bash
cd source
npm ci
npm run android:sync --workspace @lastdone/web
```

未签名 APK 可以直接进入 `source/apps/web/android` 使用 Gradle 构建。正式签名版本
需要设置：

```text
LASTDONE_KEYSTORE_PATH
LASTDONE_KEYSTORE_PASSWORD
LASTDONE_KEY_ALIAS
LASTDONE_KEY_PASSWORD
LASTDONE_VERSION_NAME
LASTDONE_VERSION_CODE
```

不要把 keystore 或密码放进仓库。

## GitHub Release 工作流

推送 `v*` 标签或手动运行时，`.github/workflows/android-release.yml` 会构建 APK，
并把 APK 和 SHA-256 文件上传到 GitHub Release。

需要配置以下仓库 Secrets：

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

`ANDROID_KEYSTORE_BASE64` 是完整 JKS 文件的 Base64 内容。还可以选择设置仓库变量
`LASTDONE_SERVER_URL`，将固定 HTTPS 域名写入 APK；不设置时保留首次启动配置页。
