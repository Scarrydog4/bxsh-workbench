# 企业微信回调接收（第一阶段）

独立后端，接入现有 Caddy 的 `/api/wecom/callback`，不改订单平台页面或业务数据库。

- GET：校验签名、解密 echostr、核对企业 ID，原样返回验证文字。
- POST：验签、解密、核对企业 ID 后写入独立 SQLite，再回复 `success`；重复投递累计次数但不重复建事件。
- 收到 `msgaudit_notify` 时记为待拉取通知。当前尚未接入会话存档 SDK，也不会执行改稿或向群发送消息。
- GET `/api/wecom/health`：只返回服务存活状态。事件、正文和配置没有公开读取接口。
- 真实回调和 `integration_smoke_test` 自测事件分开统计。

运行环境 Node.js 22.13+。加解密使用 `@wecom/crypto` 1.0.1；XML 解析使用 fast-xml-parser 5.11.2，禁用实体展开并拒绝 DTD。

## 本地测试

```sh
npm ci --ignore-scripts
npm test
# 准备好 .env（见 .env.example），再启动：
node --env-file=.env server.mjs
node --env-file=.env smoke.mjs http://127.0.0.1:3106
node --env-file=.env status.mjs
```

## 服务器

目录 `/opt/bxsh-workbench/integrations/wecom-callback`。配置在 `/opt/bxsh-workbench/private/wecom-callback.env`（600），数据在 `private/wecom-callback-data`（700，UID 1000）。服务加入现有 `deploy_default` 网络，不新增对外监听端口。

```sh
docker compose -f compose.yml up -d --build
docker compose -f compose.yml exec -T wecom-callback node status.mjs
docker compose -f compose.yml exec -T wecom-callback node smoke.mjs https://workbench.example.com
```

Caddy 在现有站点的默认 reverse_proxy 之前增加：

```caddy
@wecomCallback path /api/wecom/callback /api/wecom/health
reverse_proxy @wecomCallback wecom-callback:3106
```

验证配置后用 Caddy reload 热加载。回退只需删掉这两行并 reload，再停止本独立服务；保留配置和事件数据。

企业微信后台 URL 应填写部署后的公网 HTTPS 地址，Token/EncodingAESKey 与服务配置一致。若该后台强制校验备案域名主体，需将符合要求的域名解析到此服务器；IP 地址可用于接口自测，不代表后台一定接受。

下一步是配置会话存档 Secret、RSA 密钥和获取范围，接 SDK 增量拉取正文及附件，再按群 ID 关联订单。此阶段回调收到通知不代表聊天记录已拉取。

协议参考：[企业微信加解密库](https://www.npmjs.com/package/@wecom/crypto)、[腾讯回调示例](https://github.com/sbzhu/weworkapi_php/blob/master/callback/Sample.php)。
