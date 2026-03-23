"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-4 bg-white rounded-xl shadow-sm border", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "space-y-4",
        caption: "flex justify-between items-center px-2 mb-2",
        caption_label: "text-sm font-semibold text-zinc-900",
        nav: "flex items-center gap-1",
        nav_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-8 w-8 p-0 opacity-70 hover:opacity-100 rounded-full"
        ),
      
        table: "w-full border-collapse",
      
        head_row: "grid grid-cols-7 mb-2",
        head_cell:
          "text-zinc-400 text-center text-xs font-medium uppercase",
      
        row: "grid grid-cols-7 mt-1",
      
        cell: "flex items-center justify-center",
      
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 rounded-full hover:bg-zinc-100"
        ),
      
        day_selected:
          "bg-primary text-white font-bold rounded-full",
      
        day_today: "bg-zinc-100 font-bold",
      
        day_outside: "text-zinc-300 opacity-50",
      
        day_disabled: "text-zinc-200 opacity-50 pointer-events-none",
      
        ...classNames,
      }}
      components={{
        IconLeft: ({ ...props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ...props }) => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
