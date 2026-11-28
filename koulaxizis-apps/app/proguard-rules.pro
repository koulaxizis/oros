# The manifest names the entry points, which R8 keeps. The one reflective
# call: Shizuku API 13 keeps its process call private (Silent.start).
-keepclassmembers class rikka.shizuku.Shizuku {
    private static rikka.shizuku.ShizukuRemoteProcess newProcess(java.lang.String[], java.lang.String[], java.lang.String);
}
# Shizuku's binder hand-over (provider, AIDL, BinderContainer) is called by
# another app; keep the small library whole rather than guess.
-keep class rikka.shizuku.** { *; }
-keep class moe.shizuku.** { *; }
