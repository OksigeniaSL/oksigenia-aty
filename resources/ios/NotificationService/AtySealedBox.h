// Opens a libsodium sealed box (crypto_box_seal: X25519, XSalsa20-Poly1305, nonce by BLAKE2b), the way Moodle encrypts
// the text of a notice for the phone. The notification service extension cannot link the app's Sodium pod, so it carries
// this small, self-contained copy of the few primitives it needs.
#ifndef ATY_SEALED_BOX_H
#define ATY_SEALED_BOX_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// Bytes a sealed box adds to its message: the sender's one-time public key and the authenticator.
#define ATY_SEALED_BOX_OVERHEAD 48

// Opens the sealed box c (clen bytes) with the recipient's X25519 secret key sk (32 bytes) into m, which must hold
// clen - ATY_SEALED_BOX_OVERHEAD bytes. Returns 0 when the box opens and is authentic, -1 otherwise (m is then zeroed).
int aty_sealed_box_open(unsigned char *m, const unsigned char *c, size_t clen, const unsigned char *sk);

// The X25519 public key (32 bytes) of the secret key sk.
void aty_public_key(unsigned char *pk, const unsigned char *sk);

// BLAKE2b with no key, of outlen bytes (1 to 64). Exposed for the tests.
int aty_blake2b(unsigned char *out, size_t outlen, const unsigned char *in, size_t inlen);

#ifdef __cplusplus
}
#endif

#endif
