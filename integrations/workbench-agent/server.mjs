import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
const origin=new URL(process.env.BXSH_URL||'https://workbench.example.com');
if(origin.protocol!=='https:' && !['localhost','127.0.0.1'].includes(origin.hostname)) throw Error('BXSH_URL 必须使用 HTTPS');
const token=process.env.BXSH_AGENT_TOKEN;
if(!token?.startsWith('bxsh_ro_')) throw Error('请在平台设置中创建只读令牌，并设置 BXSH_AGENT_TOKEN');
const schema=z.object({query:z.string().max(200).optional(),from:z.iso.date().optional(),to:z.iso.date().optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(50).default(20)});
async function query(tool,args){
 const response=await fetch(new URL('/api/agent/query',origin),{method:'POST',headers:{'authorization':`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({tool,...args}),redirect:'error',signal:AbortSignal.timeout(20000)});
 const data=await response.json();
 return {content:[{type:'text',text:JSON.stringify(data)}],...(response.ok?{}:{isError:true})};
}
serveStdio(()=>{
 const server=new McpServer({name:'笔下工单',version:'1.0.0'});
 server.registerTool('orders_search',{description:'模糊搜索本人权限内的工单。只读，不交付、不记收款、不结算。返回工单名称、状态和交期；金额还需令牌和账号同时有权限。',inputSchema:schema,annotations:{readOnlyHint:true,destructiveHint:false}},args=>query('orders_search',args));
 server.registerTool('income_rows',{description:'读取本人有权限的订单收入明细。应得与已结算分别返回，不代表已到账。不修改工资。需要令牌开放收入查询。',inputSchema:schema.extend({targetId:z.string().max(100).optional()}),annotations:{readOnlyHint:true,destructiveHint:false}},args=>query('income_rows',args));
 return server;
});
