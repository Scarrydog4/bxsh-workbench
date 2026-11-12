# 笔下工单

面向小团队的订单、交付跟进和工资结算工作台。网页版采用 Next.js、React、TypeScript、PostgreSQL 和 Drizzle，附带 Android、iOS 客户端工程及可选的企业微信集成。

本次公开快照来自正式站 `2026.11.12.12` 版本。数据库、客户资料、订单附件、工资记录、生产配置和安装包签名均不包含在仓库中。

## 功能

- 管理员、销售、写手角色与服务端数据权限。
- 订单录入、搜索筛选、列设置、交付、跟进、客户催单。
- 渠道管理、收款与对账单、分类 Excel 导出。
- 收入统计、写手工资与销售提成、结算明细。
- 出勤打卡、申请审批、报销、论坛反馈与审计记录。
- 独立意向单、外包合作方往来与明细导出、写手奖惩、暂停销售的代录。
- 按账号权限授权的只读 Agent 访问；附 Codex / Claude Desktop 的 MCP 适配器。
- 工具箱、素材管理，以及需要自行配置服务密钥的智能助手。
- Android 原生拍照、文件导出和应用内更新；iOS 工程需自行签名。

## 使用 Docker 部署

需要 Docker Compose，以及解析到服务器的域名。首次运行使用全新的数据库。

```sh
git clone https://github.com/Scarrydog4/bxsh-workbench.git
cd bxsh-workbench
cp deploy/.env.example deploy/.env
```

编辑 `deploy/.env`：把 `APP_HOST` 改为自己的域名，为 `DB_PASSWORD` 设置独立的强密码。AI、改写服务等配置可先留空；需要对应功能时再填写自己的密钥。

```sh
cd deploy
docker compose --profile tools build
docker compose up -d db
docker compose --profile tools run --rm tools db:migrate
docker compose --profile tools run --rm tools db:accounts
docker compose up -d app caddy
```

打开 `https://你的域名`。初始化会生成管理员、两位销售和一位写手的示例账号；随机临时密码只写入本地 `data/accounts-initial.txt`，首次登录需要修改密码。仓库不提供通用登录密码。

数据库和附件分别保存在 Docker 命名卷中。`deploy/backup.sh` 可备份数据库和附件，备份目录默认 `/opt/bxsh-workbench/backups`，部署到其他位置时先调整路径。更新前备份，勿使用会删除数据卷的命令。

## 源码目录

| 目录 | 内容 |
| --- | --- |
| `web/src/client` | 页面与共享界面组件 |
| `web/src/server` | 数据库、权限、业务操作与统计 |
| `web/src/shared` | 类型、规则与共用计算 |
| `web/src/app/api` | HTTP 接口 |
| `web/drizzle` | 数据库迁移 |
| `web/tests` | 自动化测试 |
| `deploy` | Docker Compose、反向代理、备份脚本 |
| `mobile` | Android / iOS 客户端工程 |
| `integrations` | 可选企业微信服务及只读 Agent MCP 适配器 |

本地开发说明见 [web/README.md](web/README.md)，移动端见 [mobile/README.md](mobile/README.md)。

## 公开版配置

应用业务源码保留本次正式版本的实现。生产访问地址和企业标识已替换成示例值；初始账号显示名已改为通用示例。移动端和更新下载地址中的 `workbench.example.com` 需要改成自己的站点。企业微信 SDK 二进制需按对应目录说明自行下载。

测试涉及清空并重建独立测试库，必须使用专用 `TEST_DATABASE_URL`；不要连接任何真实业务库。公开仓库不会同步或修改现有正式站的数据。

## 外部 Agent

在头像菜单的设置 → 常用资源 → 外部 Agent 中创建自己的只读令牌。令牌默认只可查询本人权限内的订单，收入查询需单独勾选，随时可以撤销。令牌只显示一次，请放入本机客户端环境变量，不要提交到 Git。

安装与连接见 [MCP 适配器说明](integrations/workbench-agent/README.md)。该适配器不提供录单、删单、结算等写工具。QQ 登录仍需自行申请 QQ 互联网站应用及回调域名，本版未接入。
