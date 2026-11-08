import type { Worksheet } from 'exceljs'
import { CHANNEL_PAYMENT_CATEGORIES, channelPaymentCategory } from '@/shared/channel-export'
import type { OrderView } from '@/shared/types'

/** 调用方先检查销售额权限；只染订单业务单元格，右侧图例不扩大筛选和冻结范围。 */
export function applyPaymentColors(
  ws: Worksheet,
  orders: readonly Pick<OrderView, 'status' | 'received' | 'sales' | 'unpaid'>[],
  { businessColumnCount, categoryColumn, headers }: { businessColumnCount: number; categoryColumn: number; headers: readonly (1 | 2)[] },
) {
  const argb=(hex:string)=>`FF${hex.slice(1)}`
  for (const [index,order] of orders.entries()) {
    const category=channelPaymentCategory(order), row=ws.getRow(headers.length+index+1)
    for (let column=1;column<=businessColumnCount;column++) row.getCell(column).fill={type:'pattern',pattern:'solid',fgColor:{argb:argb(category.background)}}
    row.getCell(categoryColumn).font={bold:true,color:{argb:argb(category.color)}}
  }
  const legendColumn=businessColumnCount+2
  ws.getColumn(legendColumn-1).width=3
  ws.getColumn(legendColumn).width=18
  ws.getColumn(legendColumn+1).width=54
  for (const [index,language] of headers.entries()) {
    const row=ws.getRow(index+1)
    row.getCell(legendColumn-1).fill={type:'pattern',pattern:'none'}
    for (const [offset,label] of (language===1 ? ['收款分类','说明'] : ['Payment Category','Description']).entries()) {
      const cell=row.getCell(legendColumn+offset)
      cell.value=label
      cell.font={bold:true,color:{argb:'FFFFFFFF'}}
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF475569'}}
    }
  }
  for (const [index,category] of CHANNEL_PAYMENT_CATEGORIES.entries()) {
    const row=ws.getRow(headers.length+index+1)
    for (const [offset,value] of [category.label,category.description].entries()) {
      const cell=row.getCell(legendColumn+offset)
      cell.value=value
      cell.font={bold:offset===0,color:{argb:argb(category.color)}}
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:argb(category.background)}}
      cell.alignment={vertical:'middle',wrapText:true}
    }
    row.height=Math.max(row.height??15,30)
  }
}
