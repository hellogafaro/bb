// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "BBWebauthnHelper",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "BBWebauthnHelper",
      path: "Sources/BBWebauthnHelper"
    )
  ]
)
