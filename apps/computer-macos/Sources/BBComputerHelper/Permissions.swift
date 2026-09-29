import ApplicationServices
import CoreGraphics
import Foundation

enum PermissionState: String {
  case granted
  case denied
}

enum Permissions {
  static func accessibilityStatus() -> PermissionState {
    AXIsProcessTrusted() ? .granted : .denied
  }

  static func screenRecordingStatus() -> PermissionState {
    CGPreflightScreenCaptureAccess() ? .granted : .denied
  }

  static func requestAccessibility() -> PermissionState {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
    let granted = AXIsProcessTrustedWithOptions(options)
    return granted ? .granted : .denied
  }

  static func requestScreenRecording() -> PermissionState {
    let granted = CGRequestScreenCaptureAccess()
    return granted ? .granted : .denied
  }

  static func statusJSON() -> String {
    let payload: [String: String] = [
      "accessibility": accessibilityStatus().rawValue,
      "screenRecording": screenRecordingStatus().rawValue,
    ]
    return jsonString(payload)
  }

  private static func jsonString(_ payload: [String: String]) -> String {
    let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    return String(data: data, encoding: .utf8)!
  }
}

func runPermissionsCommand(_ args: [String]) -> Int32 {
  guard let sub = args.first else {
    FileHandle.standardError.write("usage: permissions <status|request> [--json] [accessibility|screen-recording]\n".data(using: .utf8)!)
    return 64
  }
  switch sub {
  case "status":
    print(Permissions.statusJSON())
    return 0
  case "request":
    let target = args.dropFirst().first(where: { !$0.hasPrefix("--") })
    switch target {
    case "accessibility":
      print(Permissions.requestAccessibility().rawValue)
      return 0
    case "screen-recording":
      print(Permissions.requestScreenRecording().rawValue)
      return 0
    case .none:
      let ax = Permissions.requestAccessibility()
      let sr = Permissions.requestScreenRecording()
      print(Permissions.statusJSON())
      return (ax == .granted && sr == .granted) ? 0 : 1
    default:
      FileHandle.standardError.write("unknown permission target: \(target ?? "")\n".data(using: .utf8)!)
      return 64
    }
  default:
    FileHandle.standardError.write("unknown permissions subcommand: \(sub)\n".data(using: .utf8)!)
    return 64
  }
}
