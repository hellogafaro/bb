import { useAtom } from "jotai";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import { PreferencesSync } from "../preferences/PreferencesSync.js";
import {
  sidebarOrganizationModeAtom,
  sidebarThreadLifecyclesAtom,
} from "../preferences/atoms.js";
import { SIDEBAR_ORGANIZE_OPTIONS } from "../list/SidebarViewItems.js";

const LIFECYCLE_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
] as const;

export function ThreadListSettings() {
  const [organization, setOrganization] = useAtom(sidebarOrganizationModeAtom);
  const [lifecycles, setLifecycles] = useAtom(sidebarThreadLifecyclesAtom);
  return (
    <div className="space-y-4">
      <PreferencesSync />
      <div>
        <h3 className="text-sm font-medium text-foreground">Organize</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          How the sidebar groups threads.
        </p>
        <RadioGroup
          className="mt-2 gap-1"
          value={organization}
          onValueChange={(value) => {
            const option = SIDEBAR_ORGANIZE_OPTIONS.find(
              (candidate) => candidate.mode === value,
            );
            if (option) setOrganization(option.mode);
          }}
        >
          {SIDEBAR_ORGANIZE_OPTIONS.map((option) => (
            <label
              key={option.mode}
              htmlFor={`thread-list-organize-${option.mode}`}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/50"
            >
              <RadioGroupItem
                id={`thread-list-organize-${option.mode}`}
                value={option.mode}
                aria-label={option.label}
              />
              <span className="text-sm">{option.label}</span>
            </label>
          ))}
        </RadioGroup>
      </div>
      <div className="border-t border-border/60 pt-4">
        <h3 className="text-sm font-medium text-foreground">Show</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Which threads appear. Keep at least one selected.
        </p>
        <div className="mt-2 space-y-1">
          {LIFECYCLE_OPTIONS.map((option) => {
            const checked = lifecycles.includes(option.value);
            const required = checked && lifecycles.length === 1;
            return (
              <label
                key={option.value}
                htmlFor={`thread-list-lifecycle-${option.value}`}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/50"
              >
                <Checkbox
                  id={`thread-list-lifecycle-${option.value}`}
                  checked={checked}
                  disabled={required}
                  onCheckedChange={(next) => {
                    setLifecycles(
                      next === true
                        ? [...lifecycles, option.value]
                        : lifecycles.filter((value) => value !== option.value),
                    );
                  }}
                />
                <span className="text-sm">{option.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
