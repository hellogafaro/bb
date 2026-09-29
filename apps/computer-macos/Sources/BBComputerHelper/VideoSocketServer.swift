import Foundation
import Network

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

final class VideoSocketServer {
  private let path: String
  private let queue = DispatchQueue(label: "app.getbb.computer.video-socket")
  private var listener: NWListener?
  private var connection: NWConnection?

  var onViewerConnected: (() -> Void)?
  var onKeyframeRequested: (() -> Void)?

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
    listener.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready:
        FileHandle.standardError.write("bb Computer: video socket listening at \(self.path)\n".data(using: .utf8)!)
      case .failed(let error):
        FileHandle.standardError.write("bb Computer: video socket failed to listen at \(self.path): \(error)\n".data(using: .utf8)!)
      case .cancelled:
        FileHandle.standardError.write("bb Computer: video socket listener cancelled\n".data(using: .utf8)!)
      default:
        break
      }
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
        FileHandle.standardError.write("bb Computer: video viewer connected\n".data(using: .utf8)!)
        self?.onViewerConnected?()
        self?.receiveCommand(on: connection)
      case .failed, .cancelled:
        if self?.connection === connection {
          self?.connection = nil
          FileHandle.standardError.write("bb Computer: video viewer disconnected\n".data(using: .utf8)!)
        }
      default:
        break
      }
    }
    connection.start(queue: queue)
  }

  private func receiveCommand(on connection: NWConnection) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self] data, _, isComplete, error in
      guard let self, self.connection === connection else { return }
      if data != nil {
        self.onKeyframeRequested?()
      }
      guard !isComplete, error == nil else { return }
      self.receiveCommand(on: connection)
    }
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
