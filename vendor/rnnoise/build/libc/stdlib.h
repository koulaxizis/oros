#ifndef OROS_STDLIB_H
#define OROS_STDLIB_H
#include <stddef.h>
void *malloc(size_t n);
void *calloc(size_t a, size_t b);
void free(void *p);
#define RAND_MAX 2147483647
int rand(void);
static inline int abs(int v) { return v < 0 ? -v : v; }
#endif
