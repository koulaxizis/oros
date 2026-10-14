/* orOS — the few C library functions RNNoise needs, for a wasm32 build
 * without a C library (no Emscripten): a bump allocator, mem*, and the
 * maths (exp, log, log10, sin, cos). Written for orOS Montage; MIT
 * licence like orOS. Accuracy: about 1e-12 relative, plenty for the
 * tables RNNoise builds once and its band energies. */
#include <stddef.h>

extern unsigned char __heap_base;
static unsigned long heap_top = 0;

void *malloc(size_t n) {
  if (!heap_top) heap_top = (unsigned long)&__heap_base;
  unsigned long p = (heap_top + 15) & ~15UL;
  unsigned long end = p + 16 + n;
  unsigned long have = __builtin_wasm_memory_size(0) * 65536UL;
  if (end > have) {
    unsigned long pages = (end - have + 65535) / 65536;
    if (__builtin_wasm_memory_grow(0, pages) == (unsigned long)-1) return 0;
  }
  *(size_t *)p = n;                 /* size in front, for calloc */
  heap_top = end;
  return (void *)(p + 16);
}
void *memset(void *d, int c, size_t n) { unsigned char *q = d; while (n--) *q++ = (unsigned char)c; return d; }
void *memcpy(void *d, const void *s, size_t n) { unsigned char *q = d; const unsigned char *r = s; while (n--) *q++ = *r++; return d; }
void *memmove(void *d, const void *s, size_t n) {
  unsigned char *q = d; const unsigned char *r = s;
  if (q < r) { while (n--) *q++ = *r++; }
  else { q += n; r += n; while (n--) *--q = *--r; }
  return d;
}
void *calloc(size_t a, size_t b) { void *p = malloc(a * b); if (p) memset(p, 0, a * b); return p; }
/* Memory comes back when the module instance is dropped (one per job). */
void free(void *p) { (void)p; }

static const double LN2 = 0.69314718055994530942, LN10 = 2.30258509299404568402, PI = 3.14159265358979323846;

double exp(double x) {
  if (x > 709.0) return 1.0 / 0.0;
  if (x < -745.0) return 0.0;
  double k = __builtin_floor(x / LN2 + 0.5), r = x - k * LN2, term = 1.0, sum = 1.0;
  for (int i = 1; i < 20; i++) { term *= r / i; sum += term; }
  /* 2^k by halves so it never overflows on the way */
  int e = (int)k;
  while (e > 0) { int s = e > 60 ? 60 : e; sum *= (double)(1ULL << s); e -= s; }
  while (e < 0) { int s = -e > 60 ? 60 : -e; sum /= (double)(1ULL << s); e += s; }
  return sum;
}
double log(double x) {
  if (!(x > 0)) return x == 0 ? -1.0 / 0.0 : 0.0 / 0.0;
  int e = 0;
  while (x > 1.4142135623730951) { x *= 0.5; e++; }
  while (x < 0.7071067811865476) { x *= 2.0; e--; }
  double s = (x - 1.0) / (x + 1.0), s2 = s * s, term = s, sum = 0.0;
  for (int i = 1; i < 40; i += 2) { sum += term / i; term *= s2; }
  return 2.0 * sum + e * LN2;
}
double log10(double x) { return log(x) / LN10; }
static double reduce(double x) {          /* to [-pi, pi] */
  double k = __builtin_floor(x / (2 * PI) + 0.5);
  return x - k * 2 * PI;
}
double sin(double x) {
  x = reduce(x);
  double x2 = x * x, term = x, sum = x;
  for (int i = 1; i < 14; i++) { term *= -x2 / ((2 * i) * (2 * i + 1)); sum += term; }
  return sum;
}
double cos(double x) {
  x = reduce(x);
  double x2 = x * x, term = 1.0, sum = 1.0;
  for (int i = 1; i < 14; i++) { term *= -x2 / ((2 * i - 1) * (2 * i)); sum += term; }
  return sum;
}
