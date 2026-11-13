// The phone's key for encrypted notices, as the push plugin keeps it in the keychain (Crypto.swift of
// @moodlehq/phonegap-plugin-push): a generic password under the account "<CFBundleName of the app>.privatekey", readable
// after the first unlock. The extension reaches it through the app's keychain access group, in both entitlements.
import Foundation
import Security

enum AtyKeychain {
    /// The account of the private key: the app's bundle name, as the plugin reads it, and ".privatekey".
    static func privateKeyAccount() -> String? {
        // The extension lives in <app>.app/PlugIns/NotificationService.appex.
        let appURL = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
        let name = Bundle(url: appURL)?.infoDictionary?["CFBundleName"] as? String
            ?? Bundle.main.infoDictionary?["AtyHostBundleName"] as? String
        return name.map { $0 + ".privatekey" }
    }

    /// The X25519 secret key (32 bytes), or nil with the keychain's status when it cannot be read.
    static func secretKey() -> (key: [UInt8]?, status: OSStatus) {
        guard let account = privateKeyAccount() else {
            return (nil, errSecParam)
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data, data.count == 32 else {
            return (nil, status)
        }
        return ([UInt8](data), status)
    }
}
