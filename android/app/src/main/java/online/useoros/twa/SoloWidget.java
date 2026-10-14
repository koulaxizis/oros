package online.useoros.twa;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

/**
 * Single apps (SOLO-1, wave 7b): the app's own home-screen widget. Its
 * icon opens the app and up to three buttons are the app's icon
 * shortcuts (solo.js APPS, written per flavour by android/tools/gen.js
 * as solo_widget_words / solo_widget_labels). A tap opens
 * /<id>/solo.html?do=<word>; the page does the rest. No data is kept
 * or drawn here. Declared only in the single-app flavours.
 */
public class SoloWidget extends AppWidgetProvider {
    private static final int[] BUTTONS = {R.id.w_solo0, R.id.w_solo1, R.id.w_solo2};

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, views(c));
    }

    static RemoteViews views(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_solo);
        String[] words = c.getResources().getStringArray(R.array.solo_widget_words);
        String[] labels = c.getResources().getStringArray(R.array.solo_widget_labels);
        v.setOnClickPendingIntent(R.id.w_solo_icon, open(c, null));
        for (int i = 0; i < BUTTONS.length; i++) {
            if (i < words.length && i < labels.length) {
                v.setViewVisibility(BUTTONS[i], View.VISIBLE);
                v.setTextViewText(BUTTONS[i], labels[i]);
                v.setOnClickPendingIntent(BUTTONS[i], open(c, words[i]));
            } else {
                v.setViewVisibility(BUTTONS[i], View.GONE);
            }
        }
        return v;
    }

    private static PendingIntent open(Context c, String word) {
        Uri.Builder b = Uri.parse(c.getString(R.string.launchUrl)).buildUpon();
        if (word != null) b.appendQueryParameter("do", word);
        Intent i = new Intent(c, LauncherActivity.class).setAction(Intent.ACTION_VIEW).setData(b.build())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, word == null ? 0 : word.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
