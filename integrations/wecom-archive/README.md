# 企业微信会话与附件采集

后台独立进程，默认每轮结束后等 30 秒，再增量获取会话。消息按 `msgid` 去重；先保存密文及游标，再按公钥版本解密。文件、图片等媒体按官方 SDK 分片下载，支持断点续传、大小及 MD5 校验。下载期间不会执行附件，也不会向群里发消息。

需要 Python 3.12、cryptography，以及腾讯官方 Linux x86_64 SDK v3（OpenSSL 3）：

- [官方接入文档](https://developer.work.weixin.qq.com/document/path/91774)
- [官方 SDK 包](https://wwcdn.weixin.qq.com/node/wwcomm/sdk_x86_v3_20250205.tgz)

将包中的 `C_sdk/libWeWorkFinanceSdk_C.so` 放到 `vendor/`。SDK 二进制不入库。
参考 `config.example.json`，真实配置只放 `/opt/bxsh-workbench/private/wecom-archive/config.json`，权限 600；Secret 必须来自会话内容存档。私钥按版本保留，不能覆盖旧版本。数据目录权限 700，不放在公开附件目录。

```sh
python3 -m unittest -v test_archive.py
python3 archive.py --config /opt/bxsh-workbench/private/wecom-archive/config.json status
python3 archive.py --config /opt/bxsh-workbench/private/wecom-archive/config.json files --name 开题报告
systemctl status wecom-archive
```

systemd 使用本目录的 `wecom-archive.service`，启动前先创建配置中的数据目录。配置每轮重读，填好 Secret 后自动生效。缺少配置时服务保持等待，不会伪装成已同步；`lastPullSuccess` 和消息/文件计数可以确认实际采集结果。重启保留进度，失败消息与附件后续重试。

这一步仅落地真实会话与附件，暂不修改订单或生成售后交付物。订单绑定须结合群 ID、完整群名和订单主题，不能只凭可能重复的订单号。
