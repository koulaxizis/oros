# The page calls these through the JavaScript bridge (Bridge.java).
-keepclassmembers class net.glarolykoi.android.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
