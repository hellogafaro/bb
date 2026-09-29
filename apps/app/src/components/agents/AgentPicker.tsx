import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { Button } from "@bb/shared-ui/button";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { MenuHoverProvider } from "@bb/shared-ui/menu-item-hover";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  MenuRowButton,
  MenuSectionLabel,
  ModelSearchInput,
} from "@/components/pickers/ModelReasoningPicker";
import { searchPickerOptions } from "@/components/pickers/picker-search";
import { useResetPickerScroll } from "@/components/pickers/useResetPickerScroll";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { agentOptionDetail } from "./agent-display";
import { AgentModelLabel } from "./AgentModelLabel";
import { AgentMascot } from "./mascots/AgentMascot";

export interface ExecutionAgentConfig {
  agentId: string | null;
  active?: boolean;
  onChange?: (agentId: string) => void;
}

const AGENT_SEARCH_MIN_OPTIONS = 5;
export const AGENT_PICKER_TOOLTIP_DELAY_MS = 300;
const AGENT_PICKER_MENU_WIDTH_CLASS_NAME = "w-max min-w-64 max-w-80";

export const AgentPicker = memo(function AgentPicker({
  agentId,
  active = false,
  onChange,
  disabled,
}: ExecutionAgentConfig & { disabled?: boolean }) {
  const agentsQuery = useAgents();
  const providersQuery = useSystemProviders();
  const isCompactViewport = useIsCompactViewport();
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useResetPickerScroll<HTMLDivElement>(searchQuery);
  const navId = useId();
  const listboxId = `${navId}-listbox`;
  const optionDomId = (index: number) => `${navId}-opt-${index}`;
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const providers = providersQuery.data;
  const filteredAgents = useMemo(
    () =>
      searchPickerOptions({
        options: agents,
        query: searchQuery,
        getLabel: (entry) => entry.name,
        getAliases: (entry) => [
          entry.description,
          agentOptionDetail(entry, providers),
        ],
      }),
    [agents, providers, searchQuery],
  );
  const highlightedIndex =
    activeIndex >= 0 && activeIndex < filteredAgents.length ? activeIndex : -1;

  const resetBrowseState = useCallback(() => {
    setSearchQuery("");
    setActiveIndex(-1);
  }, []);
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) setTooltipOpen(false);
      if (!nextOpen && !isCompactViewport) resetBrowseState();
    },
    [isCompactViewport, resetBrowseState],
  );
  const handleMobileContentAnimationEnd = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) resetBrowseState();
    },
    [resetBrowseState],
  );
  const handleSelect = useCallback(
    (value: string) => {
      onChange?.(value);
      setOpen(false);
      if (!isCompactViewport) resetBrowseState();
    },
    [isCompactViewport, onChange, resetBrowseState],
  );
  const handleQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
    setActiveIndex(-1);
  }, []);
  const handleListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const total = filteredAgents.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (total === 0) return;
        const down = event.key === "ArrowDown";
        setActiveIndex((current) => {
          const from = current >= total ? -1 : current;
          if (down) return from >= total - 1 ? 0 : from + 1;
          return from <= 0 ? total - 1 : from - 1;
        });
        return;
      }
      if (event.key === "Enter" && highlightedIndex >= 0) {
        const entry = filteredAgents[highlightedIndex];
        if (!entry) return;
        event.preventDefault();
        handleSelect(entry.id);
      }
    },
    [filteredAgents, handleSelect, highlightedIndex],
  );

  useEffect(() => {
    if (highlightedIndex < 0) return;
    document
      .getElementById(`${navId}-opt-${highlightedIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, navId]);

  const agent = resolveThreadAgent(agents, agentId);
  if (agent === null) return null;
  const readOnly = onChange === undefined;
  const triggerDisabled = disabled || readOnly;
  const showSearchInput = agents.length > AGENT_SEARCH_MIN_OPTIONS;

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Agent: ${agent.name}`}
      disabled={triggerDisabled}
      className={cn(
        OPTION_BASE_CLASS_NAME,
        OPTION_INTERACTIVE_CLASS_NAME,
        LIST_HOVER_TRANSITION,
        OPTION_MUTED_CLASS_NAME,
        "font-normal",
        triggerDisabled &&
          "cursor-default disabled:pointer-events-auto disabled:opacity-100",
      )}
    >
      <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME}>
        <AgentMascot
          mascot={agent.mascot}
          color={agent.color}
          active={active}
          className="size-4"
        />
        <span className="min-w-0 truncate">{agent.name}</span>
      </span>
      {triggerDisabled ? null : (
        <Icon
          name="ChevronDown"
          className="size-3.5 shrink-0 text-subtle-foreground/75"
        />
      )}
    </Button>
  );

  const withTooltip = (child: ReactElement) =>
    isCompactViewport ? (
      child
    ) : (
      <TooltipProvider delayDuration={AGENT_PICKER_TOOLTIP_DELAY_MS}>
        <Tooltip open={tooltipOpen && !open} onOpenChange={setTooltipOpen}>
          <TooltipTrigger asChild onFocus={(event) => event.preventDefault()}>
            {child}
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            data-agent-picker-tooltip=""
            className="pointer-events-none"
          >
            <AgentModelLabel agent={agent} providers={providers} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

  if (triggerDisabled) return withTooltip(trigger);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {withTooltip(<PopoverTrigger asChild>{trigger}</PopoverTrigger>)}
      <PopoverContent
        align="start"
        mobileTitle="Agent"
        onKeyDown={handleListKeyDown}
        onMobileContentAnimationEnd={handleMobileContentAnimationEnd}
        autoFocusRef={showSearchInput ? searchInputRef : undefined}
        className={cn(
          "flex min-h-0 flex-col p-0",
          AGENT_PICKER_MENU_WIDTH_CLASS_NAME,
          isCompactViewport
            ? "overflow-y-hidden"
            : "max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] overflow-hidden",
        )}
      >
        {showSearchInput ? (
          <ModelSearchInput
            label="Search agents"
            inputRef={searchInputRef}
            query={searchQuery}
            onQueryChange={handleQueryChange}
            onKeyDown={() => {}}
            listboxId={listboxId}
            activeOptionId={
              highlightedIndex >= 0 ? optionDomId(highlightedIndex) : undefined
            }
          />
        ) : null}
        <MenuHoverProvider>
          <div
            ref={listRef}
            role="listbox"
            id={listboxId}
            aria-label="Agents"
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1 pt-0",
              !isCompactViewport && "max-h-72",
            )}
          >
            <MenuSectionLabel>Agent</MenuSectionLabel>
            {filteredAgents.map((entry, index) => (
              <MenuRowButton
                key={entry.id}
                id={optionDomId(index)}
                role="option"
                isActive={highlightedIndex === index}
                label={entry.name}
                leading={
                  <AgentMascot
                    mascot={entry.mascot}
                    color={entry.color}
                    active={active && entry.id === agent.id}
                    className="size-4"
                  />
                }
                description={
                  <span className="flex min-w-0 items-center gap-1 text-subtle-foreground">
                    <span aria-hidden className="shrink-0">
                      ·
                    </span>
                    <AgentModelLabel
                      agent={entry}
                      providers={providers}
                      className="min-w-0 flex-1"
                    />
                  </span>
                }
                selected={entry.id === agent.id}
                onClick={() => handleSelect(entry.id)}
              />
            ))}
            {filteredAgents.length === 0 ? (
              <div
                className={cn(
                  "px-2 text-xs text-muted-foreground",
                  isCompactViewport ? "py-2" : "py-[0.3125rem]",
                )}
              >
                No agents match your search
              </div>
            ) : null}
          </div>
        </MenuHoverProvider>
      </PopoverContent>
    </Popover>
  );
});
