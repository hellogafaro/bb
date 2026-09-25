import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";

interface HeaderDraft {
  key: number;
  name: string;
  value: string;
}

function draftsFrom(names: readonly string[]): HeaderDraft[] {
  return names.map((name, key) => ({ key, name, value: "" }));
}

function headerDraftError(drafts: readonly HeaderDraft[]): string | null {
  const names = drafts.map((draft) => draft.name.trim().toLowerCase());
  if (names.some((name) => name === "")) return "Every header needs a name.";
  if (drafts.some((draft) => draft.value === "")) {
    return "Every header needs a value.";
  }
  if (new Set(names).size !== names.length)
    return "Header names must be unique.";
  return null;
}

export function McpHeadersEditor({
  serverName,
  headerNames,
  pending,
  onSave,
}: {
  serverName: string;
  headerNames: readonly string[];
  pending: boolean;
  onSave: (headers: Record<string, string>) => Promise<unknown>;
}) {
  const [drafts, setDrafts] = useState<HeaderDraft[] | null>(null);
  const [nextKey, setNextKey] = useState(headerNames.length);

  if (drafts === null) {
    return (
      <div className="space-y-2">
        {headerNames.length === 0 ? (
          <p className="text-sm text-muted-foreground">No headers.</p>
        ) : (
          <ul className="space-y-1">
            {headerNames.map((name) => (
              <li
                key={name}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span className="min-w-0 truncate">{name}</span>
                <span className="shrink-0 text-muted-foreground">Hidden</span>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Edit headers for ${serverName}`}
          onClick={() => setDrafts(draftsFrom(headerNames))}
        >
          Edit headers
        </Button>
      </div>
    );
  }

  const error = headerDraftError(drafts);
  const update = (key: number, patch: Partial<HeaderDraft>) =>
    setDrafts(
      drafts.map((draft) =>
        draft.key === key ? { ...draft, ...patch } : draft,
      ),
    );
  const save = async () => {
    await onSave(
      Object.fromEntries(
        drafts.map((draft) => [draft.name.trim(), draft.value]),
      ),
    );
    setDrafts(null);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Saved values stay hidden. Saving replaces every header, so enter each
        value again.
      </p>
      {drafts.map((draft, index) => (
        <div key={draft.key} className="flex items-center gap-2">
          <Input
            value={draft.name}
            onChange={(event) =>
              update(draft.key, { name: event.target.value })
            }
            placeholder="Header"
            aria-label={`Header ${index + 1} name`}
            className="h-8 min-w-0 flex-1"
          />
          <Input
            type="password"
            autoComplete="off"
            value={draft.value}
            onChange={(event) =>
              update(draft.key, { value: event.target.value })
            }
            placeholder="Value"
            aria-label={`Header ${index + 1} value`}
            className="h-8 min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
            aria-label={`Remove header ${index + 1}`}
            onClick={() =>
              setDrafts(drafts.filter((item) => item.key !== draft.key))
            }
          >
            <Icon name="X" className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      {error ? <p className="text-xs text-muted-foreground">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setDrafts([...drafts, { key: nextKey, name: "", value: "" }]);
            setNextKey(nextKey + 1);
          }}
        >
          <Icon name="Plus" className="size-4" aria-hidden />
          Add header
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setDrafts(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || error !== null}
            onClick={() => void save().catch(() => undefined)}
          >
            Save headers
          </Button>
        </div>
      </div>
    </div>
  );
}
