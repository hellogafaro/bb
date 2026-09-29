import Foundation

func fail(_ message: String, code: Int32 = 1) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(code)
}

func argValue(_ args: [String], _ flag: String) -> String? {
  guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
  return args[index + 1]
}

func hasFlag(_ args: [String], _ flag: String) -> Bool {
  args.contains(flag)
}

let arguments = Array(CommandLine.arguments.dropFirst())

guard let command = arguments.first else {
  fail("usage: bb-computer-helper <serve|permissions> [...]", code: 64)
}

switch command {
case "permissions":
  exit(runPermissionsCommand(Array(arguments.dropFirst())))

case "serve":
  let rest = Array(arguments.dropFirst())
  guard let driverSocketPath = argValue(rest, "--socket") else {
    fail("serve requires --socket <path>", code: 64)
  }
  guard let videoSocketPath = argValue(rest, "--video-socket") else {
    fail("serve requires --video-socket <path>", code: 64)
  }
  let driverPath = argValue(rest, "--driver-path") ?? defaultDriverPath()
  let capabilityManifest = argValue(rest, "--capability-manifest")
  let permissionMode = hasFlag(rest, "--capability-manifest") ? "bounded" : "standard"

  guard FileManager.default.fileExists(atPath: driverPath) else {
    fail("cua-driver executable not found at \(driverPath)")
  }

  let driver = DriverProcess(
    options: DriverProcessOptions(
      driverExecutablePath: driverPath,
      driverSocketPath: driverSocketPath,
      capabilityManifestPath: capabilityManifest,
      permissionMode: permissionMode
    )
  )
  do {
    try driver.start()
  } catch {
    fail("failed to spawn embedded cua-driver: \(error)")
  }
  guard driver.waitForSocket(timeout: 10) else {
    fail("embedded cua-driver did not open its socket within 10s")
  }

  let socketServer = VideoSocketServer(path: videoSocketPath)
  let capture = VideoCapture(socketServer: socketServer)
  socketServer.onViewerConnected = { [weak capture] in capture?.requestKeyframe() }
  socketServer.onKeyframeRequested = { [weak capture] in capture?.requestKeyframe() }
  do {
    try socketServer.start()
  } catch {
    fail("failed to start video socket at \(videoSocketPath): \(error)")
  }

  let captureTask = Task {
    do {
      try await capture.start()
    } catch {
      FileHandle.standardError.write("bb Computer: video capture failed: \(error)\n".data(using: .utf8)!)
    }
  }
  _ = captureTask

  func shutdown() {
    driver.stop()
    socketServer.stop()
    exit(0)
  }
  var signalSources: [DispatchSourceSignal] = []
  for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { shutdown() }
    source.resume()
    signalSources.append(source)
  }

  let watchdog = DispatchQueue(label: "app.getbb.computer.watchdog")
  watchdog.asyncAfter(deadline: .now() + 1) {
    func poll() {
      if !driver.isRunning { shutdown() }
      watchdog.asyncAfter(deadline: .now() + 1, execute: poll)
    }
    poll()
  }

  RunLoop.main.run()

default:
  fail("unknown command: \(command)", code: 64)
}

func defaultDriverPath() -> String {
  let executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
  let macOSDir = executableURL.deletingLastPathComponent()
  return macOSDir.appendingPathComponent("cua-driver").path
}
