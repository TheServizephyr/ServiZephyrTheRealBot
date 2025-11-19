"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, Edit } from "lucide-react"
import { DayPicker } from "react-day-picker"
import { format } from "date-fns"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { Button } from "@/components/ui/button"

const CalendarHeader = ({ selectedRange, onSave, onClear, onClose, onYearClick }) => {
  const formatDate = (date) => {
    if (!date) return '...';
    return format(date, 'EEE, MMM dd');
  };

  const from = selectedRange?.from ? formatDate(selectedRange.from) : '...';
  const to = selectedRange?.to ? formatDate(selectedRange.to) : '...';
  const year = selectedRange?.from ? format(selectedRange.from, 'yyyy') : new Date().getFullYear();

  return (
    <div className="bg-primary text-primary-foreground p-4 flex flex-col rounded-t-lg">
        <button onClick={onYearClick} className="text-xs uppercase opacity-70 mb-1 w-fit hover:opacity-100 transition-opacity">{year}</button>
        <div className="text-3xl font-bold">
            {from} {selectedRange?.to && from !== to ? ` – ${to}` : ''}
        </div>
        <div className="flex justify-end gap-2 mt-4">
             <Button variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/10" onClick={onClear}>Clear</Button>
             <Button variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/10" onClick={onClose}>Cancel</Button>
             <Button variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/10 font-bold" onClick={onSave}>Set</Button>
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
  onClear,
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

  const handleClear = () => {
      setRange(undefined);
      if(onClear) {
          onClear();
      }
  }

  const handleYearClick = () => {
    const yearSelect = document.querySelector('.rdp-caption_select[aria-label="Select year"]');
    if (yearSelect) {
      // For some reason, a direct click() doesn't always work on all browsers.
      // A more reliable way is to dispatch a mouse event.
      const event = new MouseEvent('mousedown', {
          view: window,
          bubbles: true,
          cancelable: true
      });
      yearSelect.dispatchEvent(event);
    }
  };

  return (
    <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm w-full max-w-sm", className)}>
        <CalendarHeader selectedRange={range} onSave={handleSave} onClear={handleClear} onClose={onClose} onYearClick={handleYearClick} />
        <DayPicker
          showOutsideDays={showOutsideDays}
          mode="range"
          selected={range}
          onSelect={setRange}
          fromYear={2024}
          toYear={new Date().getFullYear() + 5}
          captionLayout="dropdown-buttons"
          className="p-3"
          classNames={{
            months: "flex flex-col sm:flex-row space-y-4 sm:space-y-0",
            month: "space-y-4",
            caption: "flex justify-center pt-1 relative items-center mb-4",
            caption_dropdowns: "flex justify-center gap-1",
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
            day_today: "bg-accent/50 text-accent-foreground",
            day_outside: "text-muted-foreground opacity-50",
            day_disabled: "text-muted-foreground opacity-50",
            day_range_middle:
              "aria-selected:bg-primary/10",
            day_hidden: "invisible",
            vsc_captions: "hidden", // Hide the default caption
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
