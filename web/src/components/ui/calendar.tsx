'use client'

import * as React from 'react'
import { DayPicker, type DayPickerProps } from 'react-day-picker'
import { zhCN } from 'react-day-picker/locale'
import { format } from 'date-fns'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { FORUM_COPY } from '@/shared/copy/forum'

const K = FORUM_COPY.calendar

/** YYYY-MM-DD ↔ 本地日期（不经过 UTC，避免差一天） */
export const toDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const fromDay = (d: Date) => format(d, 'yyyy-MM-dd')

/** 全站日历（react-day-picker）：周一开头，中文月份和星期，今天加粗。 */
export function Calendar({ className, classNames, components, ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={zhCN}
      weekStartsOn={1}
      showOutsideDays
      fixedWeeks
      formatters={{
        formatCaption: d => `${d.getFullYear()}年${d.getMonth() + 1}月`,
        formatWeekdayName: d => K.weekdays[(d.getDay() + 6) % 7],
        formatDay: d => String(d.getDate()),
      }}
      labels={{ labelPrevious: () => K.prevMonth, labelNext: () => K.nextMonth }}
      className={cn('text-sm', className)}
      classNames={{
        months: 'relative',
        month: 'space-y-2',
        month_caption: 'flex h-8 items-center justify-center',
        caption_label: 'text-sm font-medium',
        nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between',
        button_previous: 'grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30',
        button_next: 'grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'flex-1 py-1 text-center text-xs font-normal text-muted-foreground',
        week: 'flex w-full',
        day: 'flex-1 p-0 text-center text-xs',
        day_button: 'h-8 w-full rounded-md tabular-nums outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none',
        selected: '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary',
        today: '[&>button]:font-semibold [&>button]:text-primary',
        outside: 'text-muted-foreground/50',
        disabled: 'text-muted-foreground/30',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => orientation === 'left' ? <CaretLeft size={14} /> : <CaretRight size={14} />,
        ...components,
      }}
      {...props}
    />
  )
}
