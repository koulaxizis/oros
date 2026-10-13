# PhoneBridge reads the TWA session from TwaLauncher by reflection
# (android-browser-helper keeps it private): keep the field's name.
-keepclassmembers class com.google.androidbrowserhelper.trusted.TwaLauncher {
    androidx.browser.customtabs.CustomTabsSession mSession;
}
