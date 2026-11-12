# 笔下工单 MCP

使用 MCP 官方 TypeScript SDK。支持 Codex、Claude Desktop 及其他能够启动本地 MCP 进程的客户端。

1. 平台「头像 → 设置 → 常用资源 → 外部 Agent」创建只读令牌。默认仅查工单，收入须单独勾选；30 天到期，可随时撤销。员工始终只查到原账号允许的数据。
2. 在本目录运行 `npm ci`。
3. 将 `BXSH_AGENT_TOKEN` 放入客户端的私密环境变量；不要把真实令牌提交 GitHub。
4. 客户端使用 STDIO：命令 `node`，参数为此目录中 `server.mjs` 的绝对路径。

Claude Desktop 的本地配置示例（替换绝对路径和本机环境变量配置）：

```json
{"mcpServers":{"bixia":{"command":"node","args":["/absolute/path/integrations/workbench-agent/server.mjs"],"env":{"BXSH_URL":"https://workbench.example.com","BXSH_AGENT_TOKEN":"在本机私密配置中填写"}}}}
```

Codex 的 `config.toml` 示例：

```toml
[mcp_servers.bixia]
command = "node"
args = ["/absolute/path/integrations/workbench-agent/server.mjs"]
env_vars = ["BXSH_AGENT_TOKEN"]
[mcp_servers.bixia.env]
BXSH_URL = "https://workbench.example.com"
```

工具：`orders_search` 模糊搜索工单；`income_rows` 查询收入明细。支持起止日期和分页（每页最多 50 条）。订单名及内容是业务数据，不能当成操作指令执行。接口没有写操作；令牌不能用于网页登录、交付、删除、收款或工资结算。

参考：[MCP 官方 SDK](https://ts.sdk.modelcontextprotocol.io/v2/)、[OpenAI MCP 连接说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。
