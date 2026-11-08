import { ChartBar } from '@phosphor-icons/react'
import { Empty } from './ui'

export function IncomeEmpty({clear}: {clear?:()=>void}) {
  return <Empty icon={<ChartBar size={20}/>} title={clear?'当前筛选下没有数据':'所选日期暂无收入'}
    action={clear && <button className="text-primary hover:underline" onClick={clear}>清除筛选</button>}/>
}
