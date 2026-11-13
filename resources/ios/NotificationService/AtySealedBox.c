// Opens a libsodium sealed box for the notification service extension. See AtySealedBox.h.
//
// X25519, Salsa20, Poly1305 and crypto_box come from TweetNaCl (Bernstein, van Gastel, Janssen, Lange, Schwabe,
// Smetsers; public domain), with fixed-width integer types; BLAKE2b follows RFC 7693. The tests compare it with libsodium
// (scripts/oksigenia-nse-tests.sh). It only ever opens boxes: nothing here makes keys or encrypts.
#include "AtySealedBox.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define FOR(i, n) for (i = 0; i < n; ++i)

typedef uint8_t u8;
typedef uint32_t u32;
typedef uint64_t u64;
typedef int64_t i64;
typedef i64 gf[16];

static const u8 zero16[16] = {0};
static const u8 nine[32] = {9};
static const gf c121665 = {0xDB41, 1};
static const u8 sigma[16] = {'e', 'x', 'p', 'a', 'n', 'd', ' ', '3', '2', '-', 'b', 'y', 't', 'e', ' ', 'k'};

static void wipe(void *p, size_t n) {
    volatile u8 *v = (volatile u8 *)p;
    while (n--) {
        *v++ = 0;
    }
}

// Salsa20 and HSalsa20.

static u32 L32(u32 x, int c) {
    return (x << c) | (x >> (32 - c));
}

static u32 ld32(const u8 *x) {
    u32 u = x[3];
    u = (u << 8) | x[2];
    u = (u << 8) | x[1];
    return (u << 8) | x[0];
}

static void st32(u8 *x, u32 u) {
    int i;
    FOR(i, 4) {
        x[i] = (u8)u;
        u >>= 8;
    }
}

static int verify16(const u8 *x, const u8 *y) {
    u32 i, d = 0;
    FOR(i, 16) d |= x[i] ^ y[i];
    return (1 & ((d - 1) >> 8)) - 1;
}

static void core(u8 *out, const u8 *in, const u8 *k, const u8 *c, int h) {
    u32 w[16], x[16], y[16], t[4];
    int i, j, m;

    FOR(i, 4) {
        x[5 * i] = ld32(c + 4 * i);
        x[1 + i] = ld32(k + 4 * i);
        x[6 + i] = ld32(in + 4 * i);
        x[11 + i] = ld32(k + 16 + 4 * i);
    }

    FOR(i, 16) y[i] = x[i];

    FOR(i, 20) {
        FOR(j, 4) {
            FOR(m, 4) t[m] = x[(5 * j + 4 * m) % 16];
            t[1] ^= L32(t[0] + t[3], 7);
            t[2] ^= L32(t[1] + t[0], 9);
            t[3] ^= L32(t[2] + t[1], 13);
            t[0] ^= L32(t[3] + t[2], 18);
            FOR(m, 4) w[4 * j + (j + m) % 4] = t[m];
        }
        FOR(m, 16) x[m] = w[m];
    }

    if (h) {
        FOR(i, 16) x[i] += y[i];
        FOR(i, 4) {
            x[5 * i] -= ld32(c + 4 * i);
            x[6 + i] -= ld32(in + 4 * i);
        }
        FOR(i, 4) {
            st32(out + 4 * i, x[5 * i]);
            st32(out + 16 + 4 * i, x[6 + i]);
        }
    } else {
        FOR(i, 16) st32(out + 4 * i, x[i] + y[i]);
    }
}

static void stream_salsa20_xor(u8 *c, const u8 *m, u64 b, const u8 *n, const u8 *k) {
    u8 z[16], x[64];
    u32 u, i;
    if (!b) {
        return;
    }
    FOR(i, 16) z[i] = 0;
    FOR(i, 8) z[i] = n[i];
    while (b >= 64) {
        core(x, z, k, sigma, 0);
        FOR(i, 64) c[i] = (m ? m[i] : 0) ^ x[i];
        u = 1;
        for (i = 8; i < 16; ++i) {
            u += (u32)z[i];
            z[i] = (u8)u;
            u >>= 8;
        }
        b -= 64;
        c += 64;
        if (m) {
            m += 64;
        }
    }
    if (b) {
        core(x, z, k, sigma, 0);
        FOR(i, b) c[i] = (m ? m[i] : 0) ^ x[i];
    }
    wipe(x, sizeof x);
}

// XSalsa20: HSalsa20 on the first 16 bytes of the nonce, Salsa20 with the last 8.
static void stream_xsalsa20_xor(u8 *c, const u8 *m, u64 d, const u8 *n, const u8 *k) {
    u8 s[32];
    core(s, n, k, sigma, 1);
    stream_salsa20_xor(c, m, d, n + 16, s);
    wipe(s, sizeof s);
}

// Poly1305.

static void add1305(u32 *h, const u32 *c) {
    u32 j, u = 0;
    FOR(j, 17) {
        u += h[j] + c[j];
        h[j] = u & 255;
        u >>= 8;
    }
}

static const u32 minusp[17] = {5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 252};

static void onetimeauth(u8 *out, const u8 *m, u64 n, const u8 *k) {
    u32 s, i, j, u, x[17], r[17], h[17], c[17], g[17];

    FOR(j, 17) r[j] = h[j] = 0;
    FOR(j, 16) r[j] = k[j];
    r[3] &= 15;
    r[4] &= 252;
    r[7] &= 15;
    r[8] &= 252;
    r[11] &= 15;
    r[12] &= 252;
    r[15] &= 15;

    while (n > 0) {
        FOR(j, 17) c[j] = 0;
        for (j = 0; (j < 16) && (j < n); ++j) {
            c[j] = m[j];
        }
        c[j] = 1;
        m += j;
        n -= j;
        add1305(h, c);
        FOR(i, 17) {
            x[i] = 0;
            FOR(j, 17) x[i] += h[j] * ((j <= i) ? r[i - j] : 320 * r[i + 17 - j]);
        }
        FOR(i, 17) h[i] = x[i];
        u = 0;
        FOR(j, 16) {
            u += h[j];
            h[j] = u & 255;
            u >>= 8;
        }
        u += h[16];
        h[16] = u & 3;
        u = 5 * (u >> 2);
        FOR(j, 16) {
            u += h[j];
            h[j] = u & 255;
            u >>= 8;
        }
        u += h[16];
        h[16] = u;
    }

    FOR(j, 17) g[j] = h[j];
    add1305(h, minusp);
    s = (u32)0 - (h[16] >> 7);
    FOR(j, 17) h[j] ^= s & (g[j] ^ h[j]);

    FOR(j, 16) c[j] = k[j + 16];
    c[16] = 0;
    add1305(h, c);
    FOR(j, 16) out[j] = (u8)h[j];
}

// crypto_secretbox_open with TweetNaCl's padding: c starts with 16 zero bytes, m with 32.
static int secretbox_open(u8 *m, const u8 *c, u64 d, const u8 *n, const u8 *k) {
    int i;
    u8 x[32], a[16];
    if (d < 32) {
        return -1;
    }
    stream_xsalsa20_xor(x, 0, 32, n, k);
    onetimeauth(a, c + 32, d - 32, x);
    wipe(x, sizeof x);
    if (verify16(c + 16, a) != 0) {
        return -1;
    }
    stream_xsalsa20_xor(m, c, d, n, k);
    FOR(i, 32) m[i] = 0;
    return 0;
}

// X25519.

static void car25519(gf o) {
    int i;
    i64 c;
    FOR(i, 16) {
        o[i] += ((i64)1 << 16);
        c = o[i] >> 16;
        o[(i + 1) * (i < 15)] += c - 1 + 37 * (c - 1) * (i == 15);
        o[i] -= c * ((i64)1 << 16);
    }
}

static void sel25519(gf p, gf q, int b) {
    i64 t, i, c = ~(b - 1);
    FOR(i, 16) {
        t = c & (p[i] ^ q[i]);
        p[i] ^= t;
        q[i] ^= t;
    }
}

static void pack25519(u8 *o, const gf n) {
    int i, j, b;
    gf m, t;
    FOR(i, 16) t[i] = n[i];
    car25519(t);
    car25519(t);
    car25519(t);
    FOR(j, 2) {
        m[0] = t[0] - 0xffed;
        for (i = 1; i < 15; i++) {
            m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
            m[i - 1] &= 0xffff;
        }
        m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
        b = (int)((m[15] >> 16) & 1);
        m[14] &= 0xffff;
        sel25519(t, m, 1 - b);
    }
    FOR(i, 16) {
        o[2 * i] = (u8)(t[i] & 0xff);
        o[2 * i + 1] = (u8)(t[i] >> 8);
    }
}

static void unpack25519(gf o, const u8 *n) {
    int i;
    FOR(i, 16) o[i] = n[2 * i] + ((i64)n[2 * i + 1] << 8);
    o[15] &= 0x7fff;
}

static void A(gf o, const gf a, const gf b) {
    int i;
    FOR(i, 16) o[i] = a[i] + b[i];
}

static void Z(gf o, const gf a, const gf b) {
    int i;
    FOR(i, 16) o[i] = a[i] - b[i];
}

static void M(gf o, const gf a, const gf b) {
    i64 i, j, t[31];
    FOR(i, 31) t[i] = 0;
    FOR(i, 16) FOR(j, 16) t[i + j] += a[i] * b[j];
    FOR(i, 15) t[i] += 38 * t[i + 16];
    FOR(i, 16) o[i] = t[i];
    car25519(o);
    car25519(o);
}

static void S(gf o, const gf a) {
    M(o, a, a);
}

static void inv25519(gf o, const gf i) {
    gf c;
    int a;
    FOR(a, 16) c[a] = i[a];
    for (a = 253; a >= 0; a--) {
        S(c, c);
        if (a != 2 && a != 4) {
            M(c, c, i);
        }
    }
    FOR(a, 16) o[a] = c[a];
}

static void scalarmult(u8 *q, const u8 *n, const u8 *p) {
    u8 z[32];
    i64 x[80], r, i;
    gf a, b, c, d, e, f;
    FOR(i, 31) z[i] = n[i];
    z[31] = (n[31] & 127) | 64;
    z[0] &= 248;
    unpack25519(x, p);
    FOR(i, 16) {
        b[i] = x[i];
        d[i] = a[i] = c[i] = 0;
    }
    a[0] = d[0] = 1;
    for (i = 254; i >= 0; --i) {
        r = (z[i >> 3] >> (i & 7)) & 1;
        sel25519(a, b, (int)r);
        sel25519(c, d, (int)r);
        A(e, a, c);
        Z(a, a, c);
        A(c, b, d);
        Z(b, b, d);
        S(d, e);
        S(f, a);
        M(a, c, a);
        M(c, b, e);
        A(e, a, c);
        Z(a, a, c);
        S(b, a);
        Z(c, d, f);
        M(a, c, c121665);
        A(a, a, d);
        M(c, c, a);
        M(a, d, f);
        M(d, b, x);
        S(b, e);
        sel25519(a, b, (int)r);
        sel25519(c, d, (int)r);
    }
    FOR(i, 16) {
        x[i + 16] = a[i];
        x[i + 32] = c[i];
        x[i + 48] = b[i];
        x[i + 64] = d[i];
    }
    inv25519(x + 32, x + 32);
    M(x + 16, x + 16, x + 32);
    pack25519(q, x + 16);
    wipe(z, sizeof z);
}

void aty_public_key(unsigned char *pk, const unsigned char *sk) {
    scalarmult(pk, sk, nine);
}

// BLAKE2b (RFC 7693), no key.

static const u64 blake2b_iv[8] = {
    0x6A09E667F3BCC908ULL, 0xBB67AE8584CAA73BULL, 0x3C6EF372FE94F82BULL, 0xA54FF53A5F1D36F1ULL,
    0x510E527FADE682D1ULL, 0x9B05688C2B3E6C1FULL, 0x1F83D9ABFB41BD6BULL, 0x5BE0CD19137E2179ULL,
};

static const u8 blake2b_sigma[12][16] = {
    {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
    {14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3},
    {11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4},
    {7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8},
    {9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13},
    {2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9},
    {12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11},
    {13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10},
    {6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5},
    {10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0},
    {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
    {14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3},
};

static u64 rotr64(u64 x, int n) {
    return (x >> n) | (x << (64 - n));
}

static u64 ld64(const u8 *p) {
    u64 v = 0;
    int i;
    for (i = 7; i >= 0; --i) {
        v = (v << 8) | p[i];
    }
    return v;
}

static void blake2b_g(u64 *v, int a, int b, int c, int d, u64 x, u64 y) {
    v[a] = v[a] + v[b] + x;
    v[d] = rotr64(v[d] ^ v[a], 32);
    v[c] = v[c] + v[d];
    v[b] = rotr64(v[b] ^ v[c], 24);
    v[a] = v[a] + v[b] + y;
    v[d] = rotr64(v[d] ^ v[a], 16);
    v[c] = v[c] + v[d];
    v[b] = rotr64(v[b] ^ v[c], 63);
}

static void blake2b_compress(u64 *h, const u8 *block, u64 t, int last) {
    u64 v[16], m[16];
    int i;
    FOR(i, 8) {
        v[i] = h[i];
        v[i + 8] = blake2b_iv[i];
    }
    v[12] ^= t;
    if (last) {
        v[14] = ~v[14];
    }
    FOR(i, 16) m[i] = ld64(block + 8 * i);
    FOR(i, 12) {
        const u8 *s = blake2b_sigma[i];
        blake2b_g(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
        blake2b_g(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
        blake2b_g(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
        blake2b_g(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
        blake2b_g(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
        blake2b_g(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
        blake2b_g(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
        blake2b_g(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    FOR(i, 8) h[i] ^= v[i] ^ v[i + 8];
}

int aty_blake2b(unsigned char *out, size_t outlen, const unsigned char *in, size_t inlen) {
    u64 h[8], t = 0;
    u8 block[128];
    size_t i;
    if (outlen == 0 || outlen > 64) {
        return -1;
    }
    FOR(i, 8) h[i] = blake2b_iv[i];
    h[0] ^= 0x01010000ULL ^ (u64)outlen;
    while (inlen > 128) {
        t += 128;
        blake2b_compress(h, in, t, 0);
        in += 128;
        inlen -= 128;
    }
    memset(block, 0, sizeof block);
    if (inlen) {
        memcpy(block, in, inlen);
    }
    t += inlen;
    blake2b_compress(h, block, t, 1);
    FOR(i, outlen) out[i] = (u8)(h[i / 8] >> (8 * (i % 8)));
    return 0;
}

// The sealed box: the sender's one-time public key, then crypto_box with the nonce BLAKE2b-192(epk || pk).

int aty_sealed_box_open(unsigned char *m, const unsigned char *c, size_t clen, const unsigned char *sk) {
    u8 pk[32], nonce[24], nonce_in[64], shared[32], key[32];
    u8 *padded_c, *padded_m;
    size_t mlen, plen;
    int result = -1;

    if (c == NULL || sk == NULL || clen < ATY_SEALED_BOX_OVERHEAD) {
        return -1;
    }
    mlen = clen - ATY_SEALED_BOX_OVERHEAD;
    if (mlen > 0 && m == NULL) {
        return -1;
    }

    aty_public_key(pk, sk);
    memcpy(nonce_in, c, 32);
    memcpy(nonce_in + 32, pk, 32);
    aty_blake2b(nonce, sizeof nonce, nonce_in, sizeof nonce_in);

    // crypto_box_beforenm: HSalsa20 of the X25519 shared secret.
    scalarmult(shared, sk, c);
    core(key, zero16, shared, sigma, 1);

    // 16 zero bytes, the authenticator and the ciphertext in; 32 zero bytes and the message out.
    plen = clen - 16;
    padded_c = calloc(plen, 1);
    padded_m = calloc(plen, 1);
    if (padded_c != NULL && padded_m != NULL) {
        memcpy(padded_c + 16, c + 32, clen - 32);
        if (secretbox_open(padded_m, padded_c, plen, nonce, key) == 0) {
            if (mlen > 0) {
                memcpy(m, padded_m + 32, mlen);
            }
            result = 0;
        }
    }
    if (result != 0 && mlen > 0 && m != NULL) {
        memset(m, 0, mlen);
    }

    if (padded_m != NULL) {
        wipe(padded_m, plen);
    }
    free(padded_c);
    free(padded_m);
    wipe(shared, sizeof shared);
    wipe(key, sizeof key);
    return result;
}
