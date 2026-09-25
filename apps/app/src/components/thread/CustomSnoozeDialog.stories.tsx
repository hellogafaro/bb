import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { CustomSnoozeDialog } from "../../../../../plugins/thread-list/app/snooze/SnoozeControls";

export default { title: "thread/Custom snooze" };

export function CustomDateAndTime() {
  const [open, setOpen] = useState(false);
  const [scheduled, setScheduled] = useState<number | null>(null);
  return (
    <div className="flex flex-col items-start gap-3 p-6">
      <Button onClick={() => setOpen(true)}>Snooze thread</Button>
      {scheduled !== null ? (
        <p className="text-sm" role="status">
          Snoozed until {new Date(scheduled).toLocaleString()}
        </p>
      ) : null}
      <CustomSnoozeDialog
        threadId={open ? "thr_snooze_preview" : null}
        onClose={() => setOpen(false)}
        onSnooze={(_, until) => setScheduled(until)}
      />
    </div>
  );
}
