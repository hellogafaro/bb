import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import claudeMark from "@/assets/agent-icons/claude.svg";
import codexMark from "@/assets/agent-icons/codex.svg";

const AGENT_PROVIDER_MARKS: Readonly<Record<string, string>> = {
  "claude-code": claudeMark,
  codex: codexMark,
};

export function ProviderMark({
  providerId,
  className,
}: {
  providerId: string;
  className?: string;
}) {
  const mark = AGENT_PROVIDER_MARKS[providerId];
  if (mark === undefined) {
    return (
      <Icon
        name="Robot"
        className={cn("shrink-0 text-muted-foreground", className)}
        aria-hidden="true"
      />
    );
  }
  return (
    <img
      src={mark}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("block shrink-0", className)}
    />
  );
}

export function providerMarkComponent(providerId: string) {
  return function ProviderMarkIcon({ className }: { className?: string }) {
    return <ProviderMark providerId={providerId} className={className} />;
  };
}
