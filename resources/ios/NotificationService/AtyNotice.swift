// The real title and text of an encrypted Moodle notice, for the notification service extension.
//
// When a site encrypts its notifications, Moodle seals each text field of the notice for this phone (libsodium
// crypto_box_seal, in base64) with the public key the push plugin (@moodlehq/phonegap-plugin-push) registered. The plugin
// only opens the fields when iOS wakes the app; the extension opens them as the notice arrives, even with the app closed.
// Foundation only, so that the tests run it on a Mac as it is (scripts/oksigenia-nse-tests.sh).
import Foundation

enum AtyNotice {
    /// The fields the plugin decrypts on iOS (PushPlugin.m) and on Android (FCMService.kt).
    static let sealedFields = [
        "sitefullname", "smallmessage", "subject", "userfromfullname", "userfromid", "contexturl", "fullmessage",
        "fullmessagehtml", "title", "body", "message", "sender",
    ]

    /// Marks a notice as decrypted already, so that the plugin hands it to the app as it is (PushPlugin.m).
    static let decryptedFlag = "silentencryptedtriggeredbyplugin"

    /// What the phone shows, and the notice the app receives when it is tapped.
    struct Shown {
        let title: String
        let body: String
        let userInfo: [AnyHashable: Any]
    }

    enum Field: Equatable {
        /// Not a sealed box: Moodle puts a language string in place of a field too long to encrypt.
        case plain(String)
        case opened(String)
        /// A sealed box this key does not open.
        case sealed
    }

    static func isEncrypted(_ userInfo: [AnyHashable: Any]) -> Bool {
        return isTrueOrOne(userInfo["encrypted"])
    }

    static func isTrueOrOne(_ value: Any?) -> Bool {
        if let text = value as? String {
            return text == "1" || text.lowercased() == "true"
        }
        if let number = value as? NSNumber {
            return number.boolValue
        }
        if let flag = value as? Bool {
            return flag
        }
        return false
    }

    /// One field, opened with the X25519 secret key of the phone (32 bytes).
    static func open(_ text: String, secretKey: [UInt8]) -> Field {
        let overhead = Int(ATY_SEALED_BOX_OVERHEAD)
        guard secretKey.count == 32, let data = Data(base64Encoded: text), data.count >= overhead else {
            return .plain(text)
        }
        let sealed = [UInt8](data)
        // One byte more than the message, so that an empty message still has a buffer.
        var message = [UInt8](repeating: 0, count: sealed.count - overhead + 1)
        let result = sealed.withUnsafeBufferPointer { box in
            secretKey.withUnsafeBufferPointer { key in
                message.withUnsafeMutableBufferPointer { out in
                    aty_sealed_box_open(out.baseAddress, box.baseAddress, box.count, key.baseAddress)
                }
            }
        }
        guard result == 0, let opened = String(bytes: message.dropLast(), encoding: .utf8) else {
            return .sealed
        }
        return .opened(opened)
    }

    /// The notice with its fields opened, or nil to leave it as it came, with the generic text: when the text does not
    /// open with this key, or there is no text to show.
    static func decrypt(_ userInfo: [AnyHashable: Any], secretKey: [UInt8]) -> Shown? {
        guard secretKey.count == 32 else {
            return nil
        }
        var info = userInfo
        var texts: [String: String] = [:]
        var sealedLeft = false
        for key in sealedFields {
            guard let value = userInfo[key] as? String else {
                continue
            }
            switch open(value, secretKey: secretKey) {
            case .plain(let text), .opened(let text):
                texts[key] = text
                info[key] = text
            case .sealed:
                sealedLeft = true
            }
        }

        // The same title and text as an unencrypted notice (the bridge's alert): the site, and the short message.
        let body: String
        if userInfo["smallmessage"] != nil {
            guard let text = texts["smallmessage"], !text.isEmpty else {
                return nil
            }
            body = text
        } else if let subject = texts["subject"], !subject.isEmpty {
            body = subject
        } else {
            return nil
        }
        let title = [texts["title"], texts["sitefullname"]].compactMap { $0 }.first { !$0.isEmpty } ?? ""

        // The plugin takes the title and the text of the notice from the alert: the real ones, not the generic text.
        var aps = userInfo["aps"] as? [AnyHashable: Any] ?? [:]
        aps["alert"] = ["title": title, "body": body]
        info["aps"] = aps
        // A field left sealed is opened by the plugin when the notice is tapped; otherwise the plugin leaves it as it is.
        if !sealedLeft {
            info[decryptedFlag] = true
        }
        return Shown(title: title, body: body, userInfo: info)
    }
}
