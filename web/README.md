# 笔下工单 Web

Next.js App Router + React + PostgreSQL 16 + Drizzle。权限由服务端检查，按角色过滤订单、工资和附件等数据。

## 本地开发

准备 Node.js 22、pnpm 和一个独立 PostgreSQL 数据库，然后在本目录执行：

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
```

编辑 `.env.local`，为 `DATABASE_URL` 填写自己的开发库连接。AI 服务配置可以留空。

Next.js 开发服务会读取 `.env.local`；维护脚本需要显式加载环境，例如：

```sh
set -a
. ./.env.local
set +a
pnpm db:migrate
pnpm db:accounts
pnpm dev
```

访问 `http://localhost:3100`。随机初始密码保存在不会进入公开仓库的 `../data/accounts-initial.txt`。

## 检查与构建

```sh
pnpm typecheck
pnpm build
```

集成测试会重建测试库。先创建独立测试数据库，再指定其连接，禁止使用开发库或正式库：

```sh
TEST_DATABASE_URL=postgres://你的测试账号:密码@127.0.0.1:5433/workbench_test pnpm test
```

Docker 部署和项目结构见[根目录说明](../README.md)。
