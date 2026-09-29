import Foundation

let bbComputerBundleId = "app.getbb.computer"

struct DriverProcessOptions {
  let driverExecutablePath: String
  let driverSocketPath: String
  let capabilityManifestPath: String?
  let permissionMode: String
}

final class DriverProcess {
  private let process = Process()
  private let options: DriverProcessOptions

  init(options: DriverProcessOptions) {
    self.options = options
  }

  /// Spawns `cua-driver serve --embedded` as a DIRECT child (Process/NSTask), never via
  /// `open`/NSWorkspace, so the daemon stays inside this app's TCC responsibility chain.
  /// See vendor doc: libs/cua-driver/rust/Skills/cua-driver/EMBEDDING.md ("Launching the
  /// daemon-backed host").
  func start() throws {
    var arguments = ["serve", "--embedded", "--socket", options.driverSocketPath, "--host-bundle-id", bbComputerBundleId]
    if options.permissionMode == "bounded", let manifestPath = options.capabilityManifestPath {
      arguments += ["--permission-mode", "bounded", "--capability-manifest", manifestPath, "--approve-capability-manifest"]
    } else {
      arguments += ["--permission-mode", options.permissionMode]
    }

    var environment = ProcessInfo.processInfo.environment
    environment["CUA_DRIVER_EMBEDDED"] = "1"
    environment["CUA_DRIVER_HOST_BUNDLE_ID"] = bbComputerBundleId

    process.executableURL = URL(fileURLWithPath: options.driverExecutablePath)
    process.arguments = arguments
    process.environment = environment
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
  }

  /// Blocks until the driver's socket file exists or the deadline passes.
  func waitForSocket(timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while !FileManager.default.fileExists(atPath: options.driverSocketPath) {
      if Date() >= deadline { return false }
      if !process.isRunning { return false }
      Thread.sleep(forTimeInterval: 0.05)
    }
    return true
  }

  var isRunning: Bool { process.isRunning }

  func stop() {
    guard process.isRunning else { return }
    process.terminate()
    process.waitUntilExit()
  }
}
