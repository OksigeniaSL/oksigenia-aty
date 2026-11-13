// Shows an encrypted Moodle notice with its real title and text, even when Aty is closed.
//
// The bridge (oksigenia-aty-push) sends an encrypted notice to an iPhone as a visible alert with mutable-content and a
// generic text in the phone's language (the app's Localizable.strings). iOS hands it here before showing it: with the key
// the push plugin keeps in the keychain, the extension opens the fields, shows the site and the text, and leaves the
// notice decrypted for the app, so that a tap opens what it is about. If anything fails, the generic text stays.
import Foundation
import UserNotifications
import os

final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var received: UNNotificationContent?
    private let log = Logger(subsystem: "com.oksigenia.aty.NotificationService", category: "notice")

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        received = request.content
        deliver(content(for: request.content))
    }

    override func serviceExtensionTimeWillExpire() {
        // Opening a notice takes milliseconds; if iOS runs out of time anyway, the notice goes as it came.
        if let received = received {
            deliver(received)
        }
    }

    private func deliver(_ content: UNNotificationContent) {
        guard let handler = contentHandler else {
            return
        }
        contentHandler = nil
        handler(content)
    }

    private func content(for received: UNNotificationContent) -> UNNotificationContent {
        guard AtyNotice.isEncrypted(received.userInfo) else {
            log.info("Not encrypted: shown as it came")
            return received
        }
        let keychain = AtyKeychain.secretKey()
        guard let key = keychain.key else {
            log.error("No key in the keychain (status \(keychain.status, privacy: .public)): the generic text stays")
            return received
        }
        guard let shown = AtyNotice.decrypt(received.userInfo, secretKey: key) else {
            log.error("The notice does not open with this key: the generic text stays")
            return received
        }

        // A new content rather than a copy: a copy keeps the generic text's localization key.
        let content = UNMutableNotificationContent()
        content.title = shown.title
        content.body = shown.body
        content.userInfo = shown.userInfo
        content.sound = received.sound
        content.badge = received.badge
        content.threadIdentifier = received.threadIdentifier
        content.categoryIdentifier = received.categoryIdentifier
        content.targetContentIdentifier = received.targetContentIdentifier
        content.interruptionLevel = received.interruptionLevel
        content.relevanceScore = received.relevanceScore
        log.info("Decrypted")
        return content
    }
}
