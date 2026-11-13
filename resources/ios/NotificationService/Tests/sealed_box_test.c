// Checks AtySealedBox.c against libsodium: reads the lines of make-vectors.py on stdin.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "AtySealedBox.h"

#define MAX 8192

static size_t unhex(const char *hex, unsigned char *out) {
    size_t n = strlen(hex) / 2, i;
    for (i = 0; i < n; i++) {
        unsigned int byte;
        if (sscanf(hex + 2 * i, "%2x", &byte) != 1) {
            return 0;
        }
        out[i] = (unsigned char)byte;
    }
    return n;
}

int main(void) {
    static char kind[8], a[2 * MAX + 2], b[2 * MAX + 2], c[2 * MAX + 2];
    static unsigned char key[64], box[MAX], message[MAX], out[MAX];
    int passed = 0, failed = 0, line = 0;

    while (scanf("%7s", kind) == 1) {
        line++;
        if (strcmp(kind, "b2") == 0) {
            int outlen;
            size_t inlen;
            if (scanf("%d %16384s %16384s", &outlen, a, b) != 3) {
                return 2;
            }
            inlen = strcmp(a, "-") == 0 ? 0 : unhex(a, message);
            unhex(b, key);
            aty_blake2b(out, (size_t)outlen, message, inlen);
            if (memcmp(out, key, (size_t)outlen) == 0) {
                passed++;
            } else {
                failed++;
                printf("line %d: BLAKE2b differs\n", line);
            }
        } else if (strcmp(kind, "open") == 0 || strcmp(kind, "fail") == 0) {
            size_t boxlen, msglen = 0;
            int must_open = strcmp(kind, "open") == 0, result;
            if (scanf("%16384s %16384s", a, b) != 2 || (must_open && scanf("%16384s", c) != 1)) {
                return 2;
            }
            unhex(a, key);
            boxlen = unhex(b, box);
            if (must_open && strcmp(c, "=") != 0) {
                msglen = unhex(c, message);
            }
            result = aty_sealed_box_open(out, box, boxlen, key);
            if (must_open ? (result == 0 && msglen == boxlen - ATY_SEALED_BOX_OVERHEAD && memcmp(out, message, msglen) == 0)
                          : result == -1) {
                passed++;
            } else {
                failed++;
                printf("line %d: %s, result %d\n", line, must_open ? "does not open" : "opens", result);
            }
        } else {
            return 2;
        }
    }
    printf("sealed box and BLAKE2b: %d passed, %d failed\n", passed, failed);
    return failed != 0 || passed == 0;
}
