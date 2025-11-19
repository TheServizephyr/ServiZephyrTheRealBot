"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

const CalendarHeader = ({ selectedRange, onSave, onClose }) => {
  const formatDate = (date) => {
    if (!date) return '...';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const from = selectedRange?.from ? formatDate(selectedRange.from) : '...';
  const to = selectedRange?.to ? formatDate(selectedRange.to) : '...';

  return (
    <div className="bg-primary text-primary-foreground p-4 flex flex-col">
      <div className="flex justify-between items-center mb-2">
        <button onClick={onClose} className="p-2"><X size={24} /></button>
        <button onClick={onSave} className="font-bold text-sm px-4 py-2 rounded-md hover:bg-primary-foreground/10">SAVE</button>
      </div>
      <div className="ml-2">
        <p className="text-xs uppercase opacity-70">Selected Range</p>
        <p className="text-2xl font-bold">{from} – {to}</p>
      </div>
    </div>
  );
};


function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  onRangeSelect,
  selected,
  onClose,
  ...props
}) {
  const [range, setRange] = React.useState(selected);

  React.useEffect(() => {
    setRange(selected);
  }, [selected]);

  const handleSave = () => {
    if (onRangeSelect) {
      onRangeSelect(range);
    }
  };

  return (
    <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}>
        <CalendarHeader selectedRange={range} onSave={handleSave} onClose={onClose} />
        <DayPicker
          showOutsideDays={showOutsideDays}
          mode="range"
          selected={range}
          onSelect={setRange}
          className="p-3"
          classNames={{
            months: "flex flex-col sm:flex-row space-y-4 sm:space-y-0",
            month: "space-y-4",
            caption: "flex justify-center pt-1 relative items-center mb-4",
            caption_label: "text-lg font-medium",
            nav: "space-x-1 flex items-center",
            nav_button: cn(
              buttonVariants({ variant: "outline" }),
              "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
            ),
            nav_button_previous: "absolute left-1",
            nav_button_next: "absolute right-1",
            table: "w-full border-collapse space-y-1",
            head_row: "flex",
            head_cell:
              "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
            row: "flex w-full mt-2",
            cell: "text-center text-sm p-0 relative [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
            day: cn(
              buttonVariants({ variant: "ghost" }),
              "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
            ),
            day_selected:
              "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
            day_today: "bg-transparent border border-muted-foreground text-foreground",
            day_outside: "text-muted-foreground opacity-50",
            day_disabled: "text-muted-foreground opacity-50",
            day_range_middle:
              "aria-selected:bg-primary/10 aria-selected:text-primary-foreground",
            day_hidden: "invisible",
            ...classNames,
          }}
          components={{
            IconLeft: ({ ...props }) => <ChevronLeft className="h-4 w-4" />,
            IconRight: ({ ...props }) => <ChevronRight className="h-4 w-4" />,
          }}
          {...props} />
    </div>
  );
}
Calendar.displayName = "Calendar"

export { Calendar }
