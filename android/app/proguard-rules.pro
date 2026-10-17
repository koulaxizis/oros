# PhoneBridge reads the TWA session from TwaLauncher by reflection
# (android-browser-helper keeps it private): keep the field's name.
-keepclassmembers class com.google.androidbrowserhelper.trusted.TwaLauncher {
    androidx.browser.customtabs.CustomTabsSession mSession;
    java.lang.String mProviderPackage;
}

# orOS Drive (DRIVE-A): the gomobile bindings call into Java by name
# (Seq, the Folders/Secrets callbacks), so R8 must keep them as they are.
-keep class go.** { *; }
-keep class online.useoros.drive.** { *; }
