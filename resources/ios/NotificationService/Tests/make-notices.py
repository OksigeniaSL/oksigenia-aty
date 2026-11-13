# Writes notices.json: encrypted notices as the bridge hands them to an iPhone, sealed the way Moodle seals them (libsodium
# crypto_box_seal, base64), with what main.swift expects of each. The key is made here for these tests and opens nothing
# else. Usage: python3 make-notices.py > notices.json
import base64
import json

from nacl.public import PrivateKey, SealedBox

key = PrivateKey.generate()
other = PrivateKey.generate()


def seal(text, to=key):
    return base64.b64encode(SealedBox(to.public_key).encrypt(text.encode("utf-8"))).decode()


GENERIC = {"loc-key": "You have a new notification", "body": "You have a new notification"}


def notice(**fields):
    info = {
        "aps": {"alert": dict(GENERIC), "sound": "default", "mutable-content": 1},
        "encrypted": "1",
        "site": "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
        "notId": "4711",
        "notif": "1",
        "moodlecomponent": "mod_assign",
        "gcm.message_id": "1731500000000001",
    }
    info.update(fields)
    return info


cases = [
    {
        "name": "a typical notice opens: the site, the text and every field",
        "userInfo": notice(sitefullname=seal("Colegio de ejemplo"), smallmessage=seal("Tienes una nota nueva en Ciencias"),
                           subject=seal("Nota nueva"), userfromfullname=seal("Ana Pérez"), userfromid=seal("42"),
                           contexturl=seal("https://aula.example.org/mod/assign/view.php?id=7")),
        "expect": {"title": "Colegio de ejemplo", "body": "Tienes una nota nueva en Ciencias", "decrypted": True,
                   "fields": {"subject": "Nota nueva", "userfromfullname": "Ana Pérez", "userfromid": "42",
                              "contexturl": "https://aula.example.org/mod/assign/view.php?id=7",
                              "encrypted": "1", "notId": "4711", "site": "0f1e2d3c4b5a69788796a5b4c3d2e1f0"}},
    },
    {
        "name": "a field too long to encrypt comes as a language string and stays",
        "userInfo": notice(sitefullname=seal("Academia Norte"), smallmessage=seal("Mensaje de Luis"),
                           fullmessage="El mensaje es demasiado largo para cifrarlo."),
        "expect": {"title": "Academia Norte", "body": "Mensaje de Luis", "decrypted": True,
                   "fields": {"fullmessage": "El mensaje es demasiado largo para cifrarlo."}},
    },
    {
        "name": "accents, other scripts and emoji",
        "userInfo": notice(sitefullname=seal("Escola Àgora · 学校"), smallmessage=seal("Reunión mañana 🎒 ¿vienes?")),
        "expect": {"title": "Escola Àgora · 学校", "body": "Reunión mañana 🎒 ¿vienes?", "decrypted": True, "fields": {}},
    },
    {
        "name": "without the short message, the subject is the text",
        "userInfo": notice(sitefullname=seal("Centro Sur"), subject=seal("Recordatorio")),
        "expect": {"title": "Centro Sur", "body": "Recordatorio", "decrypted": True, "fields": {}},
    },
    {
        "name": "without the site, no title: iOS shows the app's name",
        "userInfo": notice(smallmessage=seal("Hay una tarea nueva")),
        "expect": {"title": "", "body": "Hay una tarea nueva", "decrypted": True, "fields": {}},
    },
    {
        "name": "sealed for another phone: the generic text stays",
        "userInfo": notice(sitefullname=seal("Colegio de ejemplo", other), smallmessage=seal("Texto", other)),
        "expect": None,
    },
    {
        "name": "a changed box: the generic text stays",
        "userInfo": notice(sitefullname=seal("Colegio de ejemplo"),
                           smallmessage=base64.b64encode(bytes([b ^ (1 if i == 60 else 0) for i, b in enumerate(
                               base64.b64decode(seal("Texto cambiado")))])).decode()),
        "expect": None,
    },
    {
        "name": "an empty text: the generic text stays",
        "userInfo": notice(sitefullname=seal("Colegio de ejemplo"), smallmessage=seal("")),
        "expect": None,
    },
    {
        "name": "one field left sealed: shown, and the plugin opens the rest when tapped",
        "userInfo": notice(sitefullname=seal("Colegio de ejemplo"), smallmessage=seal("Texto"),
                           contexturl=seal("https://aula.example.org/", other)),
        "expect": {"title": "Colegio de ejemplo", "body": "Texto", "decrypted": False, "fields": {}},
    },
    {
        "name": "encrypted as a number",
        "userInfo": dict(notice(sitefullname=seal("Colegio"), smallmessage=seal("Texto")), encrypted=1),
        "expect": {"title": "Colegio", "body": "Texto", "decrypted": True, "fields": {}},
    },
]

print(json.dumps({
    "note": "Made by make-notices.py with libsodium, for the tests only: this key opens nothing else.",
    "phone": base64.b64encode(bytes(key)).decode(),
    "notEncrypted": [{"encrypted": "0"}, {"encrypted": ""}, {}, {"encrypted": False}],
    "encrypted": [{"encrypted": "1"}, {"encrypted": "true"}, {"encrypted": True}, {"encrypted": 1}],
    "cases": cases,
}, ensure_ascii=False, indent=1))
