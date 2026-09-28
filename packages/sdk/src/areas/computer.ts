import type {
  ComputerActInput,
  ComputerActionOutcome,
  ComputerActiveRunRequest,
  ComputerActiveRunResponse,
  ComputerControlRequest,
  ComputerControlStatusResponse,
  ComputerDoctorReport,
  ComputerHostRequest,
  ComputerMachinesRequest,
  ComputerMachinesResponse,
  ComputerObserveRequest,
  ComputerObservation,
  ComputerPreviewFrame,
  ComputerPreviewInput,
  ComputerReleaseControlResponse,
  ComputerRecordRequest,
  ComputerRecordResponse,
  ComputerRunRequest,
  ComputerRunStatus,
  ComputerScreenshotRequest,
  ComputerScreenshotResponse,
  ComputerStartInput,
  ComputerTakeControlResponse,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export type {
  ComputerActInput,
  ComputerActionOutcome,
  ComputerActiveRunRequest,
  ComputerActiveRunResponse,
  ComputerControlRequest,
  ComputerControlStatusResponse,
  ComputerDoctorReport,
  ComputerHostRequest,
  ComputerMachinesRequest,
  ComputerMachinesResponse,
  ComputerObserveRequest,
  ComputerObservation,
  ComputerPreviewFrame,
  ComputerPreviewInput,
  ComputerReleaseControlResponse,
  ComputerRecordRequest,
  ComputerRecordResponse,
  ComputerRunRequest,
  ComputerRunStatus,
  ComputerScreenshotRequest,
  ComputerScreenshotResponse,
  ComputerStartInput,
  ComputerTakeControlResponse,
} from "@bb/server-contract";

export interface ComputerArea {
  machines(input: ComputerMachinesRequest): Promise<ComputerMachinesResponse>;
  doctor(input: ComputerHostRequest): Promise<ComputerDoctorReport>;
  observe(input: ComputerObserveRequest): Promise<ComputerObservation>;
  act(input: ComputerActInput): Promise<ComputerActionOutcome>;
  screenshot(
    input: ComputerScreenshotRequest,
  ): Promise<ComputerScreenshotResponse>;
  record(input: ComputerRecordRequest): Promise<ComputerRecordResponse>;
  start(input: ComputerStartInput): Promise<ComputerRunStatus>;
  status(input: ComputerRunRequest): Promise<ComputerRunStatus>;
  cancel(input: ComputerRunRequest): Promise<ComputerRunStatus>;
  activeRun(
    input: ComputerActiveRunRequest,
  ): Promise<ComputerActiveRunResponse>;
  takeControl(
    input: ComputerControlRequest,
  ): Promise<ComputerTakeControlResponse>;
  releaseControl(
    input: ComputerControlRequest,
  ): Promise<ComputerReleaseControlResponse>;
  controlStatus(
    input: ComputerControlRequest,
  ): Promise<ComputerControlStatusResponse>;
  preview(input: ComputerPreviewInput): Promise<ComputerPreviewFrame>;
}

export function createComputerArea({ transport }: CreateSdkAreaArgs): ComputerArea {
  const api = () => transport.api.v1.computer;
  return {
    machines: (input) => transport.readJson(api().machines.$post({ json: input })),
    doctor: (input) => transport.readJson(api().doctor.$post({ json: input })),
    observe: (input) => transport.readJson(api().observe.$post({ json: input })),
    act: (input) => transport.readJson(api().act.$post({ json: input })),
    screenshot: (input) =>
      transport.readJson(api().screenshot.$post({ json: input })),
    record: (input) => transport.readJson(api().record.$post({ json: input })),
    start: (input) => transport.readJson(api().start.$post({ json: input })),
    status: (input) => transport.readJson(api().status.$post({ json: input })),
    cancel: (input) => transport.readJson(api().cancel.$post({ json: input })),
    activeRun: (input) =>
      transport.readJson(api()["active-run"].$post({ json: input })),
    takeControl: (input) =>
      transport.readJson(api()["take-control"].$post({ json: input })),
    releaseControl: (input) =>
      transport.readJson(api()["release-control"].$post({ json: input })),
    controlStatus: (input) =>
      transport.readJson(api()["control-status"].$post({ json: input })),
    preview: (input) => transport.readJson(api().preview.$post({ json: input })),
  };
}
