import { useEffect, useMemo, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Calendar } from "@bb/shared-ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { snoozePresets } from "../../shared/snoozes.js";
import { ActionMenuItem } from "../ui/action-menu-items.js";
import { formatWakeLabel } from "../rows/ThreadRowMeta.js";
import {
  useThreadSnoozeState,
  type ThreadSnoozeState,
} from "./snooze-state.js";

function formatPresetTime(until: number, showDay: boolean): string {
  return new Date(until).toLocaleString([], {
    ...(showDay ? { weekday: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

function SnoozeMenuItems({
  threadId,
  state,
}: {
  threadId: string;
  state: ThreadSnoozeState;
}) {
  const active = state.activeSnooze(threadId);
  if (active) {
    return (
      <DropdownMenuItem onSelect={() => state.unsnooze(threadId)}>
        <Icon name="Clock" />
        Unsnooze
      </DropdownMenuItem>
    );
  }
  if (!state.canSnooze(threadId)) {
    return (
      <DropdownMenuItem disabled>
        Can't snooze while it's working or asking
      </DropdownMenuItem>
    );
  }
  return (
    <>
      {snoozePresets(new Date(state.now)).map((preset) => (
        <DropdownMenuItem
          key={preset.id}
          className="gap-6"
          onSelect={() => state.snooze(threadId, preset.until)}
        >
          {preset.label}
          <DropdownMenuShortcut className="font-mono text-meta tracking-normal text-subtle-foreground">
            {formatPresetTime(preset.until, preset.showDay)}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => state.openCustom(threadId)}>
        Custom…
      </DropdownMenuItem>
    </>
  );
}

export function ThreadSnoozeQuickAction({
  threadId,
  className,
}: {
  threadId: string;
  className?: string;
}) {
  const state = useThreadSnoozeState();
  if (!state || !state.isSnoozeRoot(threadId)) return null;
  const active = state.activeSnooze(threadId);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("rounded-md p-0", className)}
              aria-label={active ? "Snoozed thread" : "Snooze thread"}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <Icon name="Clock" className={COARSE_POINTER_ICON_SIZE_CLASS} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {active ? "Unsnooze" : "Snooze"}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side="bottom">
        <SnoozeMenuItems threadId={threadId} state={state} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThreadSnoozeMenuItem({
  threadId,
  surface,
}: {
  threadId: string;
  surface: "dropdown" | "context";
}) {
  const state = useThreadSnoozeState();
  if (!state || !state.isSnoozeRoot(threadId)) return null;
  const active = state.activeSnooze(threadId);
  if (active) {
    return (
      <ActionMenuItem
        surface={surface}
        icon="Clock"
        onSelect={() => state.unsnooze(threadId)}
      >
        {`Unsnooze · wakes in ${formatWakeLabel(active.until, state.now)}`}
      </ActionMenuItem>
    );
  }
  if (!state.canSnooze(threadId)) return null;
  return (
    <ActionMenuItem
      surface={surface}
      icon="Clock"
      onSelect={() => {
        window.setTimeout(() => state.openCustom(threadId), 0);
      }}
    >
      Snooze…
    </ActionMenuItem>
  );
}

function combineDayAndTime(day: Date | undefined, time: string): number {
  if (!day || !/^\d{2}:\d{2}$/.test(time)) return Number.NaN;
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(day);
  next.setHours(hours!, minutes!, 0, 0);
  return next.getTime();
}

export function CustomSnoozeDialog({
  threadId,
  onClose,
  onSnooze,
}: {
  threadId: string | null;
  onClose: () => void;
  onSnooze: (threadId: string, until: number) => void;
}) {
  const [day, setDay] = useState<Date | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [time, setTime] = useState("09:00");
  useEffect(() => {
    if (!threadId) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDay(tomorrow);
    setTime("09:00");
  }, [threadId]);
  const until = useMemo(() => combineDayAndTime(day, time), [day, time]);
  const valid = Number.isFinite(until) && until > Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const submit = (value: number) => {
    if (!threadId) return;
    onSnooze(threadId, value);
    onClose();
  };
  return (
    <Dialog
      open={threadId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-auto max-w-fit">
        <DialogHeader>
          <DialogTitle>Snooze thread</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {snoozePresets(new Date()).map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => submit(preset.until)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) submit(until);
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="thread-snooze-date"
                className="text-sm font-medium"
              >
                Date
              </label>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    id="thread-snooze-date"
                    className="w-40 justify-between font-normal"
                  >
                    {day
                      ? day.toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "Select date"}
                    <Icon
                      name="ChevronDown"
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto overflow-hidden p-0"
                  align="start"
                >
                  <Calendar
                    mode="single"
                    selected={day}
                    captionLayout="dropdown"
                    defaultMonth={day}
                    disabled={{ before: today }}
                    startMonth={today}
                    endMonth={new Date(today.getFullYear() + 2, 11)}
                    onSelect={(next) => {
                      setDay(next);
                      setCalendarOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex w-32 flex-col gap-2">
              <label
                htmlFor="thread-snooze-time"
                className="text-sm font-medium"
              >
                Time
              </label>
              <Input
                id="thread-snooze-time"
                type="time"
                step={60}
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {Number.isFinite(until)
              ? valid
                ? new Date(until).toLocaleString([], {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "Pick a time in the future"
              : "Pick a day"}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Snooze
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
