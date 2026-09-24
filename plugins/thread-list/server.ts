import {
  cliCommand,
  defineCli,
  defineRpcContract,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  defaultPreferences,
  describePreference,
  getPreferenceDefault,
  isPreferenceKey,
  parsePreferenceValue,
  PREFERENCE_KEYS,
  PREFERENCES_CHANGED_CHANNEL,
  preferenceDefinitions,
  type PreferenceKey,
  type PreferenceValue,
  type PreferenceValues,
} from "./shared/preferences.js";
import {
  parseSnoozeUntil,
  SNOOZES_CHANGED_CHANNEL,
  snoozeListSchema,
  snoozeThreadIdSchema,
  type Snooze,
} from "./shared/snoozes.js";

const PREFERENCE_KV_PREFIX = "preference:";
const MIGRATION_KV_KEY = "migration:ui-preferences:v1";
const SNOOZES_KV_KEY = "snoozes";

const preferenceKeySchema = z.enum(
  PREFERENCE_KEYS as [PreferenceKey, ...PreferenceKey[]],
);

const preferenceValuesSchema = z.object(
  Object.fromEntries(
    PREFERENCE_KEYS.map((key) => [key, preferenceDefinitions[key].schema]),
  ) as { [Key in PreferenceKey]: (typeof preferenceDefinitions)[Key]["schema"] },
);

export const threadListRpcContract = defineRpcContract({
  listPreferences: {
    input: z.null(),
    output: z.object({ preferences: preferenceValuesSchema }).strict(),
  },
  setPreference: {
    input: z.object({ key: preferenceKeySchema, value: z.unknown() }).strict(),
    output: z
      .object({ key: preferenceKeySchema, value: z.unknown() })
      .strict(),
  },
  resetPreference: {
    input: z.object({ key: preferenceKeySchema }).strict(),
    output: z
      .object({ key: preferenceKeySchema, value: z.unknown() })
      .strict(),
  },
  listSnoozes: {
    input: z.null(),
    output: z.object({ snoozes: snoozeListSchema }).strict(),
  },
  snooze: {
    input: z
      .object({
        threadId: snoozeThreadIdSchema,
        until: z.number().int().positive(),
      })
      .strict(),
    output: z.object({ snoozes: snoozeListSchema }).strict(),
  },
  unsnooze: {
    input: z.object({ threadId: snoozeThreadIdSchema }).strict(),
    output: z.object({ snoozes: snoozeListSchema }).strict(),
  },
});

export class SnoozeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnoozeValidationError";
  }
}

export function createSnoozeStore(
  bb: BbPluginApi,
  now: () => number = Date.now,
) {
  let writes: Promise<unknown> = Promise.resolve();

  async function list(): Promise<Snooze[]> {
    const stored = await bb.storage.kv.get<unknown>(SNOOZES_KV_KEY);
    if (stored === undefined) return [];
    const parsed = snoozeListSchema.safeParse(stored);
    if (!parsed.success) {
      bb.log.warn("stored snoozes are invalid; ignoring them");
      return [];
    }
    const current = now();
    return parsed.data.filter((snooze) => snooze.until > current);
  }

  function update(change: (snoozes: Snooze[]) => Snooze[]): Promise<Snooze[]> {
    const next = writes.then(async () => {
      const snoozes = change(await list());
      await bb.storage.kv.set(SNOOZES_KV_KEY, snoozes);
      bb.realtime.publish(SNOOZES_CHANGED_CHANNEL, {});
      return snoozes;
    });
    writes = next.catch(() => undefined);
    return next;
  }

  function snooze(threadId: string, until: number): Promise<Snooze[]> {
    const at = now();
    if (until <= at) {
      return Promise.reject(
        new SnoozeValidationError("Choose a time in the future."),
      );
    }
    return update((snoozes) => [
      ...snoozes.filter((snooze) => snooze.threadId !== threadId),
      { threadId, until, at },
    ]);
  }

  function unsnooze(threadId: string): Promise<Snooze[]> {
    return update((snoozes) =>
      snoozes.filter((snooze) => snooze.threadId !== threadId),
    );
  }

  return { list, snooze, unsnooze };
}

function formatSnooze(snooze: Snooze): string {
  return `${snooze.threadId}\t${new Date(snooze.until).toISOString()}`;
}

function kvKey(key: PreferenceKey): string {
  return `${PREFERENCE_KV_PREFIX}${key}`;
}

export function createPreferenceStore(bb: BbPluginApi) {
  async function read<Key extends PreferenceKey>(
    key: Key,
  ): Promise<PreferenceValue<Key>> {
    const stored = await bb.storage.kv.get<unknown>(kvKey(key));
    if (stored === undefined) return getPreferenceDefault(key);
    const parsed = parsePreferenceValue(key, stored);
    if (parsed.success) return parsed.value;
    bb.log.warn(
      `stored preference ${key} is invalid (${parsed.message}); using the default`,
    );
    return getPreferenceDefault(key);
  }

  async function readAll(): Promise<PreferenceValues> {
    const values = defaultPreferences();
    await Promise.all(
      PREFERENCE_KEYS.map(async (key) => {
        (values as Record<PreferenceKey, unknown>)[key] = await read(key);
      }),
    );
    return values;
  }

  async function write<Key extends PreferenceKey>(
    key: Key,
    value: unknown,
  ): Promise<PreferenceValue<Key>> {
    const parsed = parsePreferenceValue(key, value);
    if (!parsed.success) {
      throw new PreferenceValidationError(key, parsed.message);
    }
    await bb.storage.kv.set(kvKey(key), parsed.value);
    bb.realtime.publish(PREFERENCES_CHANGED_CHANNEL, {
      key,
      value: parsed.value,
    });
    return parsed.value;
  }

  async function reset<Key extends PreferenceKey>(
    key: Key,
  ): Promise<PreferenceValue<Key>> {
    await bb.storage.kv.delete(kvKey(key));
    const value = getPreferenceDefault(key);
    bb.realtime.publish(PREFERENCES_CHANGED_CHANNEL, { key, value });
    return value;
  }

  return { read, readAll, write, reset };
}

export class PreferenceValidationError extends Error {
  constructor(
    readonly key: PreferenceKey,
    readonly detail: string,
  ) {
    super(`Invalid value for ${key}: ${detail}`);
    this.name = "PreferenceValidationError";
  }
}

export async function migrateFromUiPreferences(
  bb: BbPluginApi,
): Promise<{ migrated: PreferenceKey[] }> {
  const done = await bb.storage.kv.get<boolean>(MIGRATION_KV_KEY);
  if (done === true) return { migrated: [] };
  const migrated: PreferenceKey[] = [];
  let entries: Record<string, { value: unknown } | undefined>;
  try {
    const response = await bb.sdk.system.uiPreferences.list();
    entries = response.preferences as Record<
      string,
      { value: unknown } | undefined
    >;
  } catch (error) {
    bb.log.warn(
      `could not read bb's sidebar preferences to migrate them: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { migrated };
  }
  for (const key of PREFERENCE_KEYS) {
    const existing = await bb.storage.kv.get<unknown>(kvKey(key));
    if (existing !== undefined) continue;
    const legacyKey = preferenceDefinitions[key].legacyKey;
    if (legacyKey === null) continue;
    const legacy = entries[legacyKey];
    if (legacy === undefined) continue;
    const parsed = parsePreferenceValue(key, legacy.value);
    if (!parsed.success) continue;
    if (JSON.stringify(parsed.value) === JSON.stringify(getPreferenceDefault(key))) {
      continue;
    }
    await bb.storage.kv.set(kvKey(key), parsed.value);
    migrated.push(key);
  }
  await bb.storage.kv.set(MIGRATION_KV_KEY, true);
  return { migrated };
}

function parseCliValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function requireCliPreferenceKey(raw: string): PreferenceKey {
  if (isPreferenceKey(raw)) return raw;
  throw new PluginCliError(`Unknown preference: ${raw}`, {
    code: "unknown_preference",
    hint: `Known preferences: ${PREFERENCE_KEYS.join(", ")}.`,
  });
}

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

export default async function threadListPlugin(bb: BbPluginApi) {
  const store = createPreferenceStore(bb);
  const snoozes = createSnoozeStore(bb);
  bb.events.on("thread.archived", ({ thread }) => {
    void snoozes.unsnooze(thread.id);
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    void snoozes.unsnooze(thread.id);
  });

  bb.rpc.register(threadListRpcContract, {
    async listPreferences() {
      return { preferences: await store.readAll() };
    },
    async setPreference({ key, value }) {
      return { key, value: await store.write(key, value) };
    },
    async resetPreference({ key }) {
      return { key, value: await store.reset(key) };
    },
    async listSnoozes() {
      return { snoozes: await snoozes.list() };
    },
    async snooze({ threadId, until }) {
      return { snoozes: await snoozes.snooze(threadId, until) };
    },
    async unsnooze({ threadId }) {
      return { snoozes: await snoozes.unsnooze(threadId) };
    },
  });

  bb.cli.register(
    defineCli({
      name: "thread-list",
      summary:
        "Inspect and change the sidebar thread list's layout preferences and snoozes",
      description:
        "Organization mode, sort, section order, hidden groups, and collapsed groups for bb's sidebar thread list, plus snoozed threads. Preference values are JSON; a bare word is read as a string.",
      commands: {
        "snooze list": cliCommand({
          summary: "List snoozed threads and when they wake",
          options: { json: JSON_OPTION },
          async run(input) {
            const listed = await snoozes.list();
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ snoozes: listed })
                : listed.map(formatSnooze).join("\n"),
            };
          },
        }),
        "snooze set": cliCommand({
          summary: "Snooze a thread until a time",
          positionals: [
            { name: "threadId", description: "Thread id", required: true },
            {
              name: "until",
              description:
                "1h, 3h, tomorrow, week, a duration such as 45m or 2d, an ISO date, or epoch milliseconds",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const threadId = snoozeThreadIdSchema.safeParse(
              input.positionals.threadId,
            );
            if (!threadId.success) {
              throw new PluginCliError(
                `Invalid thread id: ${input.positionals.threadId}`,
                { code: "invalid_thread_id" },
              );
            }
            const until = parseSnoozeUntil(input.positionals.until, new Date());
            if (until === null) {
              throw new PluginCliError(
                `Could not read a wake time from: ${input.positionals.until}`,
                {
                  code: "invalid_snooze_time",
                  hint: "Use 1h, 3h, tomorrow, week, 45m, 2d, an ISO date, or epoch milliseconds.",
                },
              );
            }
            try {
              const listed = await snoozes.snooze(threadId.data, until);
              const snooze = listed.find(
                (candidate) => candidate.threadId === threadId.data,
              )!;
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(snooze)
                  : formatSnooze(snooze),
              };
            } catch (error) {
              if (error instanceof SnoozeValidationError) {
                throw new PluginCliError(error.message, {
                  code: "invalid_snooze_time",
                });
              }
              throw error;
            }
          },
        }),
        "snooze clear": cliCommand({
          summary: "Wake a snoozed thread now",
          positionals: [
            { name: "threadId", description: "Thread id", required: true },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const threadId = input.positionals.threadId;
            await snoozes.unsnooze(threadId);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ threadId, snoozed: false })
                : `${threadId} is awake`,
            };
          },
        }),
        "prefs list": cliCommand({
          summary: "List every preference and its current value",
          options: { json: JSON_OPTION },
          async run(input) {
            const values = await store.readAll();
            if (input.options.json) {
              return { exitCode: 0, stdout: JSON.stringify(values) };
            }
            return {
              exitCode: 0,
              stdout: PREFERENCE_KEYS.map(
                (key) =>
                  `${key}\t${JSON.stringify(values[key])}\t${describePreference(key)}`,
              ).join("\n"),
            };
          },
        }),
        "prefs get": cliCommand({
          summary: "Print one preference",
          positionals: [
            { name: "key", description: "Preference name", required: true },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const key = requireCliPreferenceKey(input.positionals.key);
            const value = await store.read(key);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ key, value })
                : JSON.stringify(value),
            };
          },
        }),
        "prefs set": cliCommand({
          summary: "Set one preference",
          positionals: [
            { name: "key", description: "Preference name", required: true },
            {
              name: "value",
              description: 'JSON value, e.g. \'"machine"\' or \'["pinned","threads"]\'',
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const key = requireCliPreferenceKey(input.positionals.key);
            try {
              const value = await store.write(
                key,
                parseCliValue(input.positionals.value),
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ key, value })
                  : `${key} = ${JSON.stringify(value)}`,
              };
            } catch (error) {
              if (error instanceof PreferenceValidationError) {
                throw new PluginCliError(error.message, {
                  code: "invalid_preference_value",
                  hint: describePreference(key),
                });
              }
              throw error;
            }
          },
        }),
        "prefs reset": cliCommand({
          summary: "Restore one preference to its default",
          positionals: [
            { name: "key", description: "Preference name", required: true },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const key = requireCliPreferenceKey(input.positionals.key);
            const value = await store.reset(key);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ key, value })
                : `${key} = ${JSON.stringify(value)}`,
            };
          },
        }),
      },
    }),
  );

  const { migrated } = await migrateFromUiPreferences(bb);
  if (migrated.length > 0) {
    bb.log.info(
      `migrated sidebar preferences from bb settings: ${migrated.join(", ")}`,
    );
  }
}
