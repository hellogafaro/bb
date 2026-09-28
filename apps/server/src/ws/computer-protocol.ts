import { computerLiveClientMessageSchema } from "@bb/server-contract";
import type { ComputerLiveHub, ComputerLiveSocket } from "../services/computer/live.js";
import { parseSocketMessage } from "./decode-payload.js";

export function onComputerSocketMessage(
  live: ComputerLiveHub,
  args: { hostId: string; raw: unknown; socket: ComputerLiveSocket },
): void {
  const message = parseSocketMessage(args.socket, args.raw, computerLiveClientMessageSchema);
  if (message === null) return;
  void live.handleClientMessage(args.hostId, args.socket, message);
}
