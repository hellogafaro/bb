import AuthenticationServices
import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.first == "request" else {
  FileHandle.standardError.write("usage: bb-webauthn-helper request\n".data(using: .utf8)!)
  exit(64)
}

let inputData = FileHandle.standardInput.readDataToEndOfFile()
guard let request = try? JSONDecoder().decode(WebauthnRequest.self, from: inputData) else {
  writeFailure("UnknownError", "The request from BB could not be parsed")
}
guard let clientDataHash = base64UrlDecode(request.clientDataHash) else {
  writeFailure("UnknownError", "The request's clientDataHash was not valid base64url")
}

func userVerificationPreference(_ value: String?) -> ASAuthorizationPublicKeyCredentialUserVerificationPreference {
  switch value {
  case "required": return .required
  case "discouraged": return .discouraged
  default: return .preferred
  }
}

final class WebauthnDelegate: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  let mode: String
  init(mode: String) {
    self.mode = mode
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    ASPresentationAnchor()
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    if mode == "get" {
      guard let assertion = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
        writeFailure("UnknownError", "The system returned an unexpected credential type for a get() request")
      }
      writeResponse(
        WebauthnGetResponse(
          id: base64UrlEncode(assertion.credentialID),
          rawId: base64UrlEncode(assertion.credentialID),
          authenticatorData: base64UrlEncode(assertion.rawAuthenticatorData),
          signature: base64UrlEncode(assertion.signature),
          userHandle: assertion.userID.isEmpty ? nil : base64UrlEncode(assertion.userID),
          authenticatorAttachment: "platform"
        )
      )
    } else {
      guard let registration = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration else {
        writeFailure("UnknownError", "The system returned an unexpected credential type for a create() request")
      }
      guard let attestationObject = registration.rawAttestationObject else {
        writeFailure("UnknownError", "The system did not return an attestation object")
      }
      writeResponse(
        WebauthnCreateResponse(
          id: base64UrlEncode(registration.credentialID),
          rawId: base64UrlEncode(registration.credentialID),
          attestationObject: base64UrlEncode(attestationObject),
          transports: ["internal"],
          authenticatorAttachment: "platform"
        )
      )
    }
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    guard let authError = error as? ASAuthorizationError else {
      writeFailure("UnknownError", error.localizedDescription)
    }
    switch authError.code {
    case .canceled:
      writeFailure("NotAllowedError", "The user cancelled the passkey request")
    case .invalidResponse:
      writeFailure("InvalidStateError", authError.localizedDescription)
    case .notHandled, .failed:
      writeFailure("NotSupportedError", authError.localizedDescription)
    default:
      writeFailure("UnknownError", authError.localizedDescription)
    }
  }
}

let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: request.rpId)
let authRequest: ASAuthorizationRequest

if request.mode == "get" {
  let assertionRequest = provider.createCredentialAssertionRequest(challenge: clientDataHash)
  assertionRequest.userVerificationPreference = userVerificationPreference(request.userVerification)
  assertionRequest.allowedCredentials = (request.allowCredentials ?? []).compactMap { descriptor in
    base64UrlDecode(descriptor.id).map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
  }
  if #available(macOS 14.0, *) {
    assertionRequest.clientData = ASPublicKeyCredentialClientData(challenge: clientDataHash, origin: request.origin)
    assertionRequest.shouldShowHybridTransport = true
  }
  authRequest = assertionRequest
} else {
  guard
    let userId = request.userId.flatMap(base64UrlDecode),
    let userName = request.userName,
    let userDisplayName = request.userDisplayName
  else {
    writeFailure("UnknownError", "The create() request was missing required user fields")
  }
  let registrationRequest = provider.createCredentialRegistrationRequest(
    challenge: clientDataHash,
    name: userDisplayName.isEmpty ? userName : userDisplayName,
    userID: userId
  )
  registrationRequest.userVerificationPreference = userVerificationPreference(request.userVerification)
  registrationRequest.excludedCredentials = (request.excludeCredentials ?? []).compactMap { descriptor in
    base64UrlDecode(descriptor.id).map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
  }
  if #available(macOS 14.0, *) {
    registrationRequest.clientData = ASPublicKeyCredentialClientData(challenge: clientDataHash, origin: request.origin)
  }
  authRequest = registrationRequest
}

let delegate = WebauthnDelegate(mode: request.mode)
let controller = ASAuthorizationController(authorizationRequests: [authRequest])
controller.delegate = delegate
controller.presentationContextProvider = delegate
controller.performRequests()

RunLoop.main.run()
