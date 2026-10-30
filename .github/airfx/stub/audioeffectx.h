// Minimal stand-in for the VST2 SDK header, only for the null test: lets
// an Airwindows plugin compile on its own so its processDoubleReplacing can
// be compared with the JS translation (.github/airfx/null-test.js).
#ifndef __audioeffect__
#define __audioeffect__
#include <string.h>
#include <stdio.h>
#include <stdint.h>
typedef int32_t VstInt32;
typedef intptr_t VstIntPtr;
typedef void *audioMasterCallback;
enum { kVstMaxProgNameLen = 24, kVstMaxParamStrLen = 8, kVstMaxVendorStrLen = 64, kVstMaxProductStrLen = 64, kVstMaxEffectNameLen = 32 };
enum VstPlugCategory { kPlugCategUnknown, kPlugCategEffect, kPlugCategSynth, kPlugCategAnalysis, kPlugCategMastering, kPlugCategSpacializer, kPlugCategRoomFx, kPlugSurroundFx, kPlugCategRestoration, kPlugCategOfflineProcess, kPlugCategShell, kPlugCategGenerator };
struct VstSpeakerArrangement { int type; };
class AudioEffectX {
public:
  AudioEffectX(audioMasterCallback, VstInt32, VstInt32) {}
  virtual ~AudioEffectX() {}
  double sr = 44100.0;
  float getSampleRate() { return (float)sr; }
  void setNumInputs(VstInt32) {} void setNumOutputs(VstInt32) {} void setUniqueID(VstInt32) {}
  void canProcessReplacing() {} void canDoubleReplacing() {} void programsAreChunks(bool) {} void setInitialDelay(VstInt32) {}
  virtual void processReplacing(float **, float **, VstInt32) {}
  virtual void processDoubleReplacing(double **, double **, VstInt32) {}
  virtual void setParameter(VstInt32, float) {}
  virtual float getParameter(VstInt32) { return 0; }
  virtual VstInt32 getChunk(void **, bool) { return 0; }
  virtual VstInt32 setChunk(void *, VstInt32, bool) { return 0; }
  virtual void getParameterLabel(VstInt32, char *) {} virtual void getParameterDisplay(VstInt32, char *) {} virtual void getParameterName(VstInt32, char *) {}
  virtual void setProgramName(char *) {} virtual void getProgramName(char *) {}
  virtual bool getEffectName(char *) { return false; } virtual VstPlugCategory getPlugCategory() { return kPlugCategEffect; }
  virtual bool getProductString(char *) { return false; } virtual bool getVendorString(char *) { return false; }
  virtual VstInt32 getVendorVersion() { return 0; } virtual VstInt32 canDo(char *) { return 0; }
  virtual bool getSpeakerArrangement(VstSpeakerArrangement **, VstSpeakerArrangement **) { return false; }
  virtual bool parameterTextToValue(VstInt32, const char *, float &) { return false; }
  virtual bool canConvertParameterTextToValue(VstInt32) { return false; }
  virtual VstInt32 getNumMidiInputChannels() { return 0; }
  virtual VstInt32 getNumMidiOutputChannels() { return 0; }
};
typedef AudioEffectX AudioEffect;
static inline void vst_strncpy(char *d, const char *s, int n) { strncpy(d, s, n); d[n] = 0; }
static inline void float2string(float v, char *t, int n) { snprintf(t, n + 1, "%f", v); }
static inline void int2string(int v, char *t, int n) { snprintf(t, n + 1, "%d", v); }
static inline void dB2string(float v, char *t, int n) { snprintf(t, n + 1, "%f", v); }
static inline bool string2float(const char *s, float &v) { v = 0; return sscanf(s, "%f", &v) == 1; }
#endif
