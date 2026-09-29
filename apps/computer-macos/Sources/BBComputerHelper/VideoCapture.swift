import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit
import VideoToolbox

enum BitrateTier {
  case high
  case low

  var bitsPerSecond: Int32 {
    switch self {
    case .high: return 14_000_000
    case .low: return 2_500_000
    }
  }
}

final class VideoCapture: NSObject, SCStreamOutput, SCStreamDelegate {
  private let socketServer: VideoSocketServer
  private let encodeQueue = DispatchQueue(label: "app.getbb.computer.video-encode")
  private var stream: SCStream?
  private var compressionSession: VTCompressionSession?
  private var sentConfig = false
  private var currentTier: BitrateTier = .high
  private var pendingKeyframe = true
  private let captureStart = DispatchTime.now()
  private var restartAttempts = 0
  private let maxRestartAttempts = 3

  init(socketServer: VideoSocketServer) {
    self.socketServer = socketServer
  }

  func start() async throws {
    if let session = compressionSession {
      VTCompressionSessionInvalidate(session)
      compressionSession = nil
    }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else {
      throw VideoCaptureError.noDisplay
    }

    let scale = nativeScaleFactor(for: display.displayID)
    let pixelWidth = Int(Double(display.width) * scale)
    let pixelHeight = Int(Double(display.height) * scale)

    let filter = SCContentFilter(display: display, excludingWindows: [])
    let configuration = SCStreamConfiguration()
    configuration.width = pixelWidth
    configuration.height = pixelHeight
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    configuration.showsCursor = true
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 60)
    configuration.queueDepth = 5
    configuration.scalesToFit = false

    try makeCompressionSession(width: pixelWidth, height: pixelHeight)

    let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: encodeQueue)
    try await stream.startCapture()
    self.stream = stream
    restartAttempts = 0
    pendingKeyframe = true
    sentConfig = false
  }

  func stop() async {
    if let session = compressionSession {
      VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
      VTCompressionSessionInvalidate(session)
      compressionSession = nil
    }
    if let stream {
      try? await stream.stopCapture()
    }
    stream = nil
  }

  func requestKeyframe() {
    encodeQueue.async {
      self.pendingKeyframe = true
      self.sentConfig = false
    }
  }

  func setBitrateTier(_ tier: BitrateTier) {
    encodeQueue.async {
      guard let session = self.compressionSession, tier != self.currentTier else { return }
      self.currentTier = tier
      VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: NSNumber(value: tier.bitsPerSecond))
    }
  }

  private func nativeScaleFactor(for displayID: CGDirectDisplayID) -> Double {
    for screen in NSScreenList.current() {
      if screen.displayID == displayID { return screen.backingScaleFactor }
    }
    return 2.0
  }

  private func makeCompressionSession(width: Int, height: Int) throws {
    var session: VTCompressionSession?
    let status = VTCompressionSessionCreate(
      allocator: kCFAllocatorDefault,
      width: Int32(width),
      height: Int32(height),
      codecType: kCMVideoCodecType_H264,
      encoderSpecification: [kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: true] as CFDictionary,
      imageBufferAttributes: nil,
      compressedDataAllocator: nil,
      outputCallback: compressionOutputCallback,
      refcon: Unmanaged.passUnretained(self).toOpaque(),
      compressionSessionOut: &session
    )
    guard status == noErr, let session else { throw VideoCaptureError.encoderSetupFailed(status) }

    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_High_AutoLevel)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: NSNumber(value: currentTier.bitsPerSecond))
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_DataRateLimits, value: [NSNumber(value: currentTier.bitsPerSecond / 8 * 2), NSNumber(value: 2)] as CFArray)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: NSNumber(value: 120))
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, value: NSNumber(value: 2))
    VTCompressionSessionPrepareToEncodeFrames(session)
    compressionSession = session
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
    guard outputType == .screen, CMSampleBufferIsValid(sampleBuffer) else { return }
    guard socketServer.hasViewer else { return }
    guard let session = compressionSession, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    var frameProperties: CFDictionary?
    if pendingKeyframe {
      pendingKeyframe = false
      frameProperties = [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary
    }
    VTCompressionSessionEncodeFrame(
      session,
      imageBuffer: pixelBuffer,
      presentationTimeStamp: pts,
      duration: .invalid,
      frameProperties: frameProperties,
      sourceFrameRefcon: nil,
      infoFlagsOut: nil
    )
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    FileHandle.standardError.write("bb Computer: capture stream stopped: \(error)\n".data(using: .utf8)!)
    self.stream = nil
    restartAttempts += 1
    guard restartAttempts <= maxRestartAttempts else {
      FileHandle.standardError.write("bb Computer: capture stream exceeded restart attempts, exiting\n".data(using: .utf8)!)
      exit(1)
    }
    Task {
      do {
        try await self.start()
      } catch {
        FileHandle.standardError.write("bb Computer: capture restart failed: \(error)\n".data(using: .utf8)!)
        exit(1)
      }
    }
  }

  fileprivate func handleEncodedFrame(_ sampleBuffer: CMSampleBuffer) {
    guard socketServer.hasViewer else { return }
    guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }

    if !sentConfig, let avcC = extractAVCC(formatDescription) {
      let dims = CMVideoFormatDescriptionGetDimensions(formatDescription)
      let header = VideoFrameHeader(type: .config, keyframe: true, width: UInt32(dims.width), height: UInt32(dims.height), ptsMicros: 0, payloadLength: UInt32(avcC.count))
      socketServer.send(header: header, payload: avcC)
      sentConfig = true
    }

    guard let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
    var length = 0
    var dataPointer: UnsafeMutablePointer<Int8>?
    guard CMBlockBufferGetDataPointer(dataBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer) == noErr,
      let dataPointer
    else { return }
    let payload = Data(bytes: dataPointer, count: length)

    let isKeyframe = sampleIsKeyframe(sampleBuffer)
    let dims = CMVideoFormatDescriptionGetDimensions(formatDescription)
    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    let ptsMicros = Int64((pts.seconds - captureStart.uptimeSeconds) * 1_000_000)
    let header = VideoFrameHeader(type: .accessUnit, keyframe: isKeyframe, width: UInt32(dims.width), height: UInt32(dims.height), ptsMicros: ptsMicros, payloadLength: UInt32(length))
    socketServer.send(header: header, payload: payload)
  }

  private func sampleIsKeyframe(_ sampleBuffer: CMSampleBuffer) -> Bool {
    guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[CFString: Any]],
      let first = attachments.first
    else { return true }
    return (first[kCMSampleAttachmentKey_NotSync] as? Bool) != true
  }

  private func extractAVCC(_ formatDescription: CMFormatDescription) -> Data? {
    guard let atoms = CMFormatDescriptionGetExtension(formatDescription, extensionKey: kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms) as? [String: Any],
      let avcC = atoms["avcC"] as? Data
    else { return nil }
    return avcC
  }
}

private func compressionOutputCallback(
  outputCallbackRefCon: UnsafeMutableRawPointer?,
  sourceFrameRefCon: UnsafeMutableRawPointer?,
  status: OSStatus,
  infoFlags: VTEncodeInfoFlags,
  sampleBuffer: CMSampleBuffer?
) {
  guard status == noErr, let sampleBuffer, let outputCallbackRefCon else { return }
  let capture = Unmanaged<VideoCapture>.fromOpaque(outputCallbackRefCon).takeUnretainedValue()
  capture.handleEncodedFrame(sampleBuffer)
}

enum VideoCaptureError: Error {
  case noDisplay
  case encoderSetupFailed(OSStatus)
}

private extension DispatchTime {
  var uptimeSeconds: Double { Double(uptimeNanoseconds) / 1_000_000_000 }
}

private struct NSScreenList {
  let displayID: CGDirectDisplayID
  let backingScaleFactor: Double

  static func current() -> [NSScreenList] {
    #if canImport(AppKit)
      return NSScreen.screens.compactMap { screen in
        guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
        return NSScreenList(displayID: CGDirectDisplayID(number.uint32Value), backingScaleFactor: screen.backingScaleFactor)
      }
    #else
      return []
    #endif
  }
}

#if canImport(AppKit)
  import AppKit
#endif
