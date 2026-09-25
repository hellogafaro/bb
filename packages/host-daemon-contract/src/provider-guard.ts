import { z } from "zod";

const providerGuardPathSchema = z.string().min(1).max(16_384);

const providerGuardMcpEntrySchema = z
  .object({ name: z.string(), file: z.string(), scope: z.string() })
  .strict();
export type ProviderGuardMcpEntry = z.infer<typeof providerGuardMcpEntrySchema>;

export const providerGuardStatusSchema = z
  .object({
    claude: z
      .object({
        settingsPath: z.string(),
        connectorsDisabled: z.boolean(),
        bundledSkillsDisabled: z.boolean(),
        skillSyncDisabled: z.boolean(),
        enabledPlugins: z.array(z.string()),
        mcpServers: z.array(providerGuardMcpEntrySchema),
        pluginsDir: z.string(),
        marketplaces: z.array(z.string()),
        knownMarketplacesFile: z.string().nullable(),
        installedPlugins: z.array(z.string()),
        skillsDir: z.string(),
        extraSkills: z.array(z.string()),
      })
      .strict(),
    codex: z
      .object({
        configPath: z.string(),
        features: z.array(
          z.object({ key: z.string(), value: z.boolean().nullable() }).strict(),
        ),
        systemSkills: z.array(
          z
            .object({
              name: z.string(),
              path: z.string(),
              disabled: z.boolean(),
            })
            .strict(),
        ),
        mcpServers: z.array(providerGuardMcpEntrySchema),
        pluginCacheDir: z.string(),
        pluginCache: z.array(z.string()),
        skillsDir: z.string(),
        extraSkills: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type ProviderGuardStatus = z.infer<typeof providerGuardStatusSchema>;

export const providerGuardFixResultSchema = z
  .object({
    status: providerGuardStatusSchema,
    changes: z.array(z.string()),
  })
  .strict();
export type ProviderGuardFixResult = z.infer<
  typeof providerGuardFixResultSchema
>;

export const providerGuardCommandSchemas = {
  "providers.guardStatus": z
    .object({
      type: z.literal("providers.guardStatus"),
      projectPath: providerGuardPathSchema.nullable(),
    })
    .strict(),
  "providers.guardFix": z
    .object({
      type: z.literal("providers.guardFix"),
      projectPath: providerGuardPathSchema.nullable(),
    })
    .strict(),
} as const;

export const providerGuardResultSchemas = {
  "providers.guardStatus": providerGuardStatusSchema,
  "providers.guardFix": providerGuardFixResultSchema,
} as const;
