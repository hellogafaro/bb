import Foundation
import Network

/// Frame wire format sent to the host daemon over a local Unix domain socket.
/// Little-endian fixed 24-byte header followed by `payloadLength` bytes.
///
///   type            UInt8   1 = avcC config, 2 = video access unit
///   flags           UInt8   bit0 = keyframe (type 2 only)
///   reserved        UInt16
///   width           UInt32  pixel width (Retina-native)
///   height          UInt32  pixel height
///   ptsMicros       Int64   presentation timestamp, capture-clock microseconds
///   payloadLength   UInt32  bytes following the header
enum VideoFrameType: UInt8 {
  case config = 1
  case accessUnit = 2
}

struct VideoFrameHeader {
  static let byteCount = 24

  var type: VideoFrameType
  var keyframe: Bool
  var width: UInt32
  var height: UInt32
  var ptsMicros: Int64
  var payloadLength: UInt32

  func encoded() -> Data {
    var data = Data(capacity: VideoFrameHeader.byteCount)
    data.append(type.rawValue)
    data.append(keyframe ? 1 : 0)
    data.append(contentsOf: [0, 0])
    data.append(contentsOf: littleEndianBytes(width))
    data.append(contentsOf: littleEndianBytes(height))
    data.append(contentsOf: littleEndianBytes(UInt64(bitPattern: ptsMicros)))
    data.append(contentsOf: littleEndianBytes(payloadLength))
    return data
  }
}

private func littleEndianBytes<T: FixedWidthInteger>(_ value: T) -> [UInt8] {
  withUnsafeBytes(of: value.littleEndian, Array.init)
}

enum VideoSocketError: Error {
  case listenFailed
}

/// Listens on a Unix domain socket at `path` and accepts a single active viewer
/// connection at a time (the host daemon). Frames sent while no viewer is
/// connected are dropped by the caller (see `hasViewer`); the capture pipeline
/// should skip encode work in that case instead of buffering, since the daemon
/// only dials in while a Computer tab viewer is active.
final class VideoSocketServer {
  private let path: String
  private let queue = DispatchQueue(label: "app.getbb.computer.video-socket")
  private var listener: NWListener?
  private var connection: NWConnection?

  /// Invoked on the socket queue whenever a new viewer connection becomes ready,
  /// so the encoder can force an IDR instead of making the joiner wait for the
  /// next scheduled keyframe.
  var onViewerConnected: (() -> Void)?

  init(path: String) {
    self.path = path
  }

  func start() throws {
    try? FileManager.default.removeItem(atPath: path)
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = NWEndpoint.unix(path: path)
    guard let listener = try? NWListener(using: params) else {
      throw VideoSocketError.listenFailed
    }
    listener.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    listener.start(queue: queue)
    self.listener = listener
  }

  private func accept(_ connection: NWConnection) {
    self.connection?.cancel()
    self.connection = connection
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        self?.onViewerConnected?()
      case .failed, .cancelled:
        if self?.connection === connection { self?.connection = nil }
      default:
        break
      }
    }
    connection.start(queue: queue)
  }

  var hasViewer: Bool {
    connection?.state == .ready
  }

  func send(header: VideoFrameHeader, payload: Data) {
    guard let connection, connection.state == .ready else { return }
    var frame = header.encoded()
    frame.append(payload)
    connection.send(content: frame, completion: .contentProcessed { _ in })
  }

  func stop() {
    connection?.cancel()
    listener?.cancel()
    try? FileManager.default.removeItem(atPath: path)
  }
}
