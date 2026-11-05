import Combine
import Foundation
import WatchConnectivity
import WatchKit

final class WatchRemoteSession: NSObject, ObservableObject {
  @Published var snapshot = WatchRemoteSnapshot.empty
  @Published var reachable = false
  @Published var holdingKey: String?
  @Published var lockedKey: String?
  @Published var touchTargetKey: String?
  @Published var status = "Open Talktome on iPhone"

  private var awaitingConfirmKey: String?
  private var requestId: String?
  private var readyTimeout: DispatchWorkItem?
  private var lockTimeout: DispatchWorkItem?
  private var awaitingLock = false

  var holdingTarget: WatchRemoteTarget? {
    snapshot.targets.first(where: { $0.key == holdingKey })
  }

  func isLocked(_ target: WatchRemoteTarget) -> Bool {
    lockedKey == target.key || snapshot.lockedTargetKeys.contains(target.key)
  }

  override init() {
    super.init()
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  func beginTalk(_ target: WatchRemoteTarget) {
    if isLocked(target) { stopTalk(target); return }
    guard target.canTalk, reachable, holdingKey == nil else { return }
    holdingKey = target.key
    awaitingConfirmKey = target.key
    requestId = UUID().uuidString
    send(type: "talk-start", target: target, failClearsHold: true)
    let timeout = DispatchWorkItem { [weak self] in
      guard let self, self.awaitingConfirmKey == target.key else { return }
      self.stopTalk(target)
      self.status = "iPhone did not confirm readiness"
    }
    readyTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
  }

  func lockTalk(_ target: WatchRemoteTarget) {
    guard holdingKey == target.key, lockedKey == nil, reachable else { return }
    lockedKey = target.key
    awaitingLock = true
    // The first microphone start may take several seconds. Confirm readiness
    // before starting the separate lock acknowledgment deadline.
    if awaitingConfirmKey == nil { sendLock(target) }
  }

  private func sendLock(_ target: WatchRemoteTarget) {
    send(type: "talk-lock", target: target, failClearsHold: true)
    let timeout = DispatchWorkItem { [weak self] in
      guard let self, self.awaitingLock else { return }
      self.stopTalk(target)
      self.status = "Lock was not confirmed by iPhone"
    }
    lockTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
  }

  func endTalk(_ target: WatchRemoteTarget) {
    guard holdingKey == target.key, lockedKey != target.key else { return }
    stopTalk(target)
  }

  func stopTalk(_ target: WatchRemoteTarget) {
    guard holdingKey == target.key || isLocked(target) else { return }
    // Send the same request ID before clearing it, so a late release cannot
    // cancel another, newer press on the same target.
    send(type: "talk-stop", target: target, failClearsHold: false)
    clearHold()
    WKInterfaceDevice.current().play(.stop)
  }

  private func clearHold() {
    holdingKey = nil
    lockedKey = nil
    touchTargetKey = nil
    requestId = nil
    awaitingConfirmKey = nil
    awaitingLock = false
    readyTimeout?.cancel()
    readyTimeout = nil
    lockTimeout?.cancel()
    lockTimeout = nil
  }

  private func send(type: String, target: WatchRemoteTarget, failClearsHold: Bool) {
    var payload: [String: Any] = ["type": type, "key": target.key,
      "targetType": target.type, "targetId": target.targetId]
    if let requestId { payload["requestId"] = requestId }
    guard WCSession.default.activationState == .activated, WCSession.default.isReachable else {
      fail("iPhone not reachable", clearHold: failClearsHold)
      return
    }
    let sentRequestId = requestId
    WCSession.default.sendMessage(payload, replyHandler: { _ in }, errorHandler: { [weak self] _ in
      DispatchQueue.main.async {
        guard let self, !failClearsHold || self.requestId == sentRequestId else { return }
        if failClearsHold, let target = self.holdingTarget {
          self.send(type: "talk-stop", target: target, failClearsHold: false)
        }
        self.fail("Could not reach iPhone", clearHold: failClearsHold)
      }
    })
  }

  private func fail(_ message: String, clearHold: Bool) {
    WKInterfaceDevice.current().play(.failure)
    status = message
    if clearHold { self.clearHold() }
  }

  private func apply(_ message: [String: Any]) {
    if (message["type"] as? String) == "talk-confirmed" {
      confirmTalk(message)
      return
    }
    if (message["type"] as? String) == "talk-lock-confirmed" {
      guard matchesRequest(message), awaitingLock else { return }
      awaitingLock = false
      lockTimeout?.cancel()
      if !boolValue(message["locked"]) {
        if let target = holdingTarget { stopTalk(target) }
        fail("Could not lock this target", clearHold: true)
      }
      return
    }
    if let type = message["type"] as? String, type.hasPrefix("talk-") { return }
    let next = WatchRemoteSnapshot(message: message)
    if let held = holdingTarget,
       !next.connected || !next.targets.contains(where: { $0.key == held.key && $0.canTalk }) {
      stopTalk(held)
    }
    // Unlocking on iPhone also updates the Watch. A pending lock waits for its
    // explicit acknowledgment rather than an older, in-flight phone snapshot.
    if let lockedKey, !awaitingLock, !next.lockedTargetKeys.contains(lockedKey) { clearHold() }
    snapshot = next
    reachable = WCSession.default.isReachable
    if snapshot.connected {
      let place = snapshot.productionName.isEmpty ? "Talktome" : snapshot.productionName
      status = snapshot.username.isEmpty ? place : "\(snapshot.username) · \(place)"
    } else { status = "Sign in on iPhone" }
    // Only the ready acknowledgment chooses where to play the beep. A general
    // snapshot may arrive first and must not produce a second beep on Watch.
  }

  private func matchesRequest(_ message: [String: Any]) -> Bool {
    guard message["key"] as? String == holdingKey else { return false }
    let id = message["requestId"] as? String ?? ""
    return id.isEmpty || id == requestId
  }

  private func confirmTalk(_ message: [String: Any]) {
    guard matchesRequest(message), awaitingConfirmKey == holdingKey, holdingKey != nil else { return }
    awaitingConfirmKey = nil
    readyTimeout?.cancel()
    if boolValue(message["talking"]) {
      WatchTalkBeep.playConfirmed(soundOnWatch: !boolValue(message["readyCueOnPhone"]))
      if awaitingLock, let target = holdingTarget { sendLock(target) }
    } else {
      if let target = holdingTarget { stopTalk(target) }
      fail("Could not talk to this target", clearHold: true)
    }
  }

  private func boolValue(_ value: Any?) -> Bool {
    (value as? Bool) ?? (value as? NSNumber)?.boolValue ?? false
  }
}

extension WatchRemoteSession: WCSessionDelegate {
  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    DispatchQueue.main.async { [weak self] in
      self?.reachable = session.isReachable
      if !session.receivedApplicationContext.isEmpty { self?.apply(session.receivedApplicationContext) }
    }
  }
  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    DispatchQueue.main.async { [weak self] in self?.apply(applicationContext) }
  }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    DispatchQueue.main.async { [weak self] in self?.apply(message) }
  }
  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async { [weak self] in self?.reachable = session.isReachable }
  }
}
