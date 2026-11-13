// Tests of AtyNotice.swift with the notices of notices.json (make-notices.py): what the phone shows and what the app
// receives. Run by scripts/oksigenia-nse-tests.sh.
import Foundation

var failures = 0
var checks = 0

func check(_ ok: Bool, _ what: @autoclosure () -> String) {
    checks += 1
    if !ok {
        failures += 1
        print("FAIL: \(what())")
    }
}

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "notices.json"
guard let data = FileManager.default.contents(atPath: path),
      let fixture = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let keyText = fixture["phone"] as? String,
      let keyData = Data(base64Encoded: keyText),
      let cases = fixture["cases"] as? [[String: Any]] else {
    print("Cannot read \(path)")
    exit(2)
}
let key = [UInt8](keyData)

func anyHashable(_ dictionary: [String: Any]) -> [AnyHashable: Any] {
    var result: [AnyHashable: Any] = [:]
    for (name, value) in dictionary {
        result[name] = value
    }
    return result
}

for info in fixture["encrypted"] as? [[String: Any]] ?? [] {
    check(AtyNotice.isEncrypted(anyHashable(info)), "encrypted: \(info)")
}
for info in fixture["notEncrypted"] as? [[String: Any]] ?? [] {
    check(!AtyNotice.isEncrypted(anyHashable(info)), "not encrypted: \(info)")
}

for testCase in cases {
    let name = testCase["name"] as? String ?? "?"
    guard let userInfo = testCase["userInfo"] as? [String: Any] else {
        check(false, "\(name): no userInfo")
        continue
    }
    check(AtyNotice.isEncrypted(anyHashable(userInfo)), "\(name): seen as encrypted")
    let shown = AtyNotice.decrypt(anyHashable(userInfo), secretKey: key)

    guard let expect = testCase["expect"] as? [String: Any] else {
        check(shown == nil, "\(name): must keep the generic text, shows \(String(describing: shown?.body))")
        continue
    }
    guard let shown = shown else {
        check(false, "\(name): does not open")
        continue
    }
    check(shown.title == expect["title"] as? String, "\(name): title \(shown.title)")
    check(shown.body == expect["body"] as? String, "\(name): body \(shown.body)")

    let info = shown.userInfo
    let alert = (info["aps"] as? [AnyHashable: Any])?["alert"] as? [String: String]
    check(alert == ["title": shown.title, "body": shown.body], "\(name): the alert the plugin reads, \(String(describing: alert))")
    check((info["aps"] as? [AnyHashable: Any])?["sound"] as? String == "default", "\(name): the sound stays")
    let decrypted = AtyNotice.isTrueOrOne(info[AtyNotice.decryptedFlag])
    check(decrypted == (expect["decrypted"] as? Bool ?? false), "\(name): decrypted flag \(decrypted)")
    for (field, value) in expect["fields"] as? [String: Any] ?? [:] {
        check(String(describing: info[field] ?? "nil") == String(describing: value), "\(name): field \(field) is \(String(describing: info[field]))")
    }
    // Every field that opened is plain text now, and nothing else changed.
    for (field, value) in userInfo where field != "aps" && !AtyNotice.sealedFields.contains(field) {
        check(String(describing: info[field] ?? "nil") == String(describing: value), "\(name): \(field) unchanged")
    }
}

// Anything that is not a sealed box is left as it is.
check(AtyNotice.open("Hola", secretKey: key) == .plain("Hola"), "short text is plain")
check(AtyNotice.open("https://aula.example.org/?id=1", secretKey: key) == .plain("https://aula.example.org/?id=1"), "a link is plain")
check(AtyNotice.open("", secretKey: key) == .plain(""), "empty is plain")
check(AtyNotice.decrypt([:], secretKey: [1, 2, 3]) == nil, "a key of the wrong size opens nothing")

print("Notice tests: \(checks - failures) passed, \(failures) failed")
exit(failures == 0 && checks > 0 ? 0 : 1)
