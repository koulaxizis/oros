#ifndef OROS_MATH_H
#define OROS_MATH_H
#define M_PI 3.14159265358979323846
double exp(double x);
double log(double x);
double log10(double x);
double sin(double x);
double cos(double x);
#define sqrt(x) __builtin_sqrt(x)
#define sqrtf(x) __builtin_sqrtf(x)
#define floor(x) __builtin_floor(x)
#define floorf(x) __builtin_floorf(x)
#define fabs(x) __builtin_fabs(x)
#define fabsf(x) __builtin_fabsf(x)
#endif
