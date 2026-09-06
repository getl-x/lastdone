# 备份、升级与回滚

## 自动备份

服务端每天创建一份 PocketBase 备份，保留最近 7 份。已有数据目录使用不同版本的
LastDone 启动时，会在执行应用迁移之前创建升级前备份，并保留最近 3 份。

备份位于持久化卷中的：

```text
/pb/pb_data/backups
```

重要备份应再复制到 VPS 之外。Docker 卷在重建容器时不会消失，但无法防止 VPS 或
硬盘整体损坏。

## 手动备份

执行：

```bash
docker compose exec lastdone /usr/local/bin/lastdone backup
```

命令会输出备份文件名。可以通过 1Panel 的文件/备份功能或 `docker cp` 把文件下载
到其他位置。

## 升级

1. 确认 VPS 外部已有一份近期备份。
2. 把 `LASTDONE_IMAGE` 改成不可变版本标签，例如 `getl-x/lastdone:0.2.0`。
3. 拉取镜像并重新创建服务。
4. 检查容器健康状态和 `https://你的域名/api/lastdone/health`。
5. 打开 Web 应用确认同步正常，再决定是否清理旧的外部备份。

只要应用版本发生变化，启动流程就会在迁移前自动创建备份。

## 回滚

不要直接让旧镜像读取已经被新版本迁移过的数据库。

1. 停止 LastDone。
2. 先完整保存当前数据卷。
3. 通过 PocketBase 管理后台的备份页面恢复对应的
   `preupgrade_lastdone_*.zip`，或者把它恢复到新的数据卷。
4. 把 `LASTDONE_IMAGE` 改回上一个不可变版本标签。
5. 启动服务并检查健康状态和同步。

## 健康检查

容器内部健康检查命令：

```bash
/usr/local/bin/lastdone healthcheck
```

公开健康接口会返回应用版本和数据库版本：

```text
/api/lastdone/health
```
