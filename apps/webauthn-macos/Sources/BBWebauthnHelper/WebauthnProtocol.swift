import Foundation

struct CredentialDescriptor: Codable {
  let id: String
  let type: String
  let transports: [String]?
}

struct PubKeyCredParam: Codable {
  let type: String
  let alg: Int
}

struct WebauthnRequest: Codable {
  let mode: String
  let origin: String
  let rpId: String
  let clientDataHash: String
  let allowCredentials: [CredentialDescriptor]?
  let userVerification: String?
  let rpName: String?
  let userId: String?
  let userName: String?
  let userDisplayName: String?
  let pubKeyCredParams: [PubKeyCredParam]?
  let excludeCredentials: [CredentialDescriptor]?
  let attestation: String?
}

struct WebauthnGetResponse: Codable {
  let ok = true
  let mode = "get"
  let id: String
  let rawId: String
  let authenticatorData: String
  let signature: String
  let userHandle: String?
  let authenticatorAttachment: String?
}

struct WebauthnCreateResponse: Codable {
  let ok = true
  let mode = "create"
  let id: String
  let rawId: String
  let attestationObject: String
  let transports: [String]
  let authenticatorAttachment: String?
}

struct WebauthnFailureResponse: Codable {
  let ok = false
  let errorName: String
  let message: String
}

func base64UrlDecode(_ value: String) -> Data? {
  var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  while base64.count % 4 != 0 {
    base64.append("=")
  }
  return Data(base64Encoded: base64)
}

func base64UrlEncode(_ data: Data) -> String {
  data.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

func writeResponse<T: Encodable>(_ response: T) -> Never {
  let encoder = JSONEncoder()
  guard let data = try? encoder.encode(response) else {
    FileHandle.standardError.write("failed to encode response\n".data(using: .utf8)!)
    exit(1)
  }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  exit(0)
}

func writeFailure(_ errorName: String, _ message: String) -> Never {
  writeResponse(WebauthnFailureResponse(errorName: errorName, message: message))
}
