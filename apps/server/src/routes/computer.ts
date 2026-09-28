import type { Hono } from "hono";
import {
  computerActRequestSchema,
  computerPreviewRequestSchema,
  computerStartRequestSchema,
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  act,
  activeRun,
  cancel,
  controlStatus,
  doctor,
  installDriver,
  listMachines,
  observe,
  preview,
  record,
  releaseControl,
  requestPermissions,
  screenshot,
  start,
  status,
  takeControl,
} from "../services/computer/computer.js";

export function registerComputerRoutes(app: Hono, deps: AppDeps) {
  const { post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) => new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.computer;

  post(routes.machines, async (c, input) =>
    c.json(await listMachines(deps, input.threadId)),
  );
  post(routes.doctor, async (c, input) => c.json(await doctor(deps, input.hostId)));
  post(routes.installDriver, async (c, input) =>
    c.json(await installDriver(deps, input.hostId)),
  );
  post(routes.requestPermissions, async (c, input) =>
    c.json(await requestPermissions(deps, input.hostId, input.permission)),
  );
  post(routes.observe, async (c, input) =>
    c.json(await observe(deps, input.hostId, input.appId)),
  );
  post(routes.act, async (c, input) => {
    const parsed = computerActRequestSchema.parse(input);
    const abortController = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });
    return c.json(
      await act(deps, parsed.hostId, parsed.action, abortController.signal),
    );
  });
  post(routes.screenshot, async (c, input) =>
    c.json(await screenshot(deps, input.hostId, input.threadId, input.appId)),
  );
  post(routes.record, async (c, input) =>
    c.json(
      await record(deps, input.hostId, input.threadId, input.action, input.runId),
    ),
  );
  post(routes.start, async (c, input) =>
    c.json(await start(deps, computerStartRequestSchema.parse(input))),
  );
  post(routes.status, async (c, input) => c.json(status(input.runId)));
  post(routes.cancel, async (c, input) => c.json(cancel(input.runId)));
  post(routes.activeRun, async (c, input) => c.json(activeRun(input.hostId)));
  post(routes.takeControl, async (c, input) => {
    const abortController = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });
    return c.json(
      await takeControl(
        deps,
        input.hostId,
        input.clientId,
        abortController.signal,
      ),
    );
  });
  post(routes.releaseControl, async (c, input) =>
    c.json(releaseControl(input.hostId, input.clientId)),
  );
  post(routes.controlStatus, async (c, input) =>
    c.json(controlStatus(input.hostId, input.clientId)),
  );
  post(routes.preview, async (c, input) => {
    c.header("Cache-Control", "no-store");
    const parsed = computerPreviewRequestSchema.parse(input);
    return c.json(
      await preview(
        deps,
        parsed.hostId,
        parsed.viewerId,
        parsed.size,
        parsed.afterSequence,
      ),
    );
  });
}
