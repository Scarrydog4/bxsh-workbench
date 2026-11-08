import { useState, type InputHTMLAttributes } from 'react'
import { CalendarBlank } from '@phosphor-icons/react'
import { Calendar, fromDay, toDay } from '@/components/ui/calendar'
import { FORUM_COPY } from '@/shared/copy/forum'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { businessDate, deadlineFrom, shortDate } from '@/shared/format'
import { cn } from '@/lib/utils'
export function DatePicker({value,onChange,label='选择日期',disabled=false,className='',clearable=false,id,plain=false,placeholder}:{id?:string;value:string|null;onChange:(value:string)=>void;label?:string;disabled?:boolean;className?:string;clearable?:boolean;plain?:boolean;placeholder?:string}) {
  const [open,setOpen]=useState(false),[month,setMonth]=useState(()=>toDay(value||businessDate(new Date())))
  const select=(day:string)=>{onChange(day);setOpen(false)}
  return <Popover open={open} onOpenChange={o=>{if(o)setMonth(toDay(value||businessDate(new Date())));setOpen(o)}}><PopoverTrigger asChild>{plain?<button id={id} type="button" disabled={disabled} aria-label={label} className={cn('group -mx-2 flex h-8 w-[calc(100%+16px)] items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent data-[state=open]:bg-accent',className)}><span className={cn('num flex-1',!value&&!placeholder&&'text-muted-foreground')}>{value?shortDate(value):placeholder??'点击填写'}</span><CalendarBlank size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100"/></button>:<Button id={id} type="button" variant="outline" disabled={disabled} aria-label={label} className={cn('h-9 justify-between gap-2 font-normal',className)}>{value?shortDate(value):'选择日期'}<CalendarBlank size={16}/></Button>}</PopoverTrigger><PopoverContent align="start" className="w-72 p-3">
    <Calendar mode="single" required={false} month={month} onMonthChange={setMonth} selected={value?toDay(value):undefined} onSelect={d=>d&&select(fromDay(d))} today={toDay(businessDate(new Date()))}/>
    <div className="mt-2 flex justify-between border-t pt-2"><Button type="button" size="sm" variant="ghost" onClick={()=>select(businessDate(new Date()))}>{FORUM_COPY.calendar.today}</Button>{clearable&&<Button type="button" size="sm" variant="ghost" onClick={()=>select('')}>{FORUM_COPY.calendar.clear}</Button>}</div>
  </PopoverContent></Popover>
}
export function DateTimePicker({value,onChange,label='指定完成时间'}:{value:string;onChange:(value:string)=>void;label?:string}) {
  const [day,time]=value.split('T'),[hour='18',minute='00']=(time??'18:00').split(':')
  return <div className="flex flex-wrap gap-2"><DatePicker value={day||deadlineFrom(businessDate(new Date()),1)} label={label} onChange={d=>onChange(`${d}T${hour}:${minute}`)}/><Select value={hour} onValueChange={h=>onChange(`${day}T${h}:${minute}`)}><SelectTrigger aria-label="小时" className="w-20"><SelectValue/></SelectTrigger><SelectContent>{Array.from({length:24},(_,i)=>String(i).padStart(2,'0')).map(h=><SelectItem key={h} value={h}>{h} 时</SelectItem>)}</SelectContent></Select><Select value={minute} onValueChange={m=>onChange(`${day}T${hour}:${m}`)}><SelectTrigger aria-label="分钟" className="w-20"><SelectValue/></SelectTrigger><SelectContent>{[...new Set(['00','15','30','45',minute])].sort().map(m=><SelectItem key={m} value={m}>{m} 分</SelectItem>)}</SelectContent></Select></div>
}

export function DateField({value,onChange,id,className,disabled,...props}:InputHTMLAttributes<HTMLInputElement>) {
 return <DatePicker id={id} value={String(value??'')} label={props['aria-label']??'选择日期'} className={className} disabled={disabled} clearable={!props.required} onChange={value=>{const target={value} as HTMLInputElement;onChange?.({target,currentTarget:target} as React.ChangeEvent<HTMLInputElement>)}}/>
}
