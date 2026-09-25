import type { Context, Hono } from "hono";
import { providerGuardFixRequestSchema } from "@bb/server-contract";
import { ApiError } from "../errors.js";
import type { ProviderGuardService } from "../services/providers/provider-guard.js";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "invalid_request", errorText(error));
  }
}

function optionalQuery(context: Context, name: string): string | null {
  const value = context.req.query(name)?.trim();
  return value ? value : null;
}

export function registerProviderGuardRoutes(
  app: Hono,
  guard: ProviderGuardService,
): void {
  app.get("/providers/guard", async (context) =>
    context.json(
      await guarded(() =>
        guard.run({
          hostId: optionalQuery(context, "hostId"),
          projectPath: optionalQuery(context, "projectPath"),
          fix: false,
        }),
      ),
    ),
  );

  app.post("/providers/guard/fix", async (context) => {
    const parsed = providerGuardFixRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; "),
      );
    return context.json(
      await guarded(() => guard.run({ ...parsed.data, fix: true })),
    );
  });
}
