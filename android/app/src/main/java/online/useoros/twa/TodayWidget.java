package online.useoros.twa;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/** The "Today" home-screen widget (BR-PHONE v4); see Widgets. */
public class TodayWidget extends AppWidgetProvider {
    @Override
    public void onReceive(Context c, Intent in) {
        if (Widgets.ACTION_REFRESH.equals(in.getAction())) {
            Widgets.update(c);
            return;
        }
        super.onReceive(c, in);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        Widgets.update(c);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle opts) {
        m.updateAppWidget(id, Widgets.today(c, opts));
    }

    @Override
    public void onEnabled(Context c) {
        // The first one: if orOS is open, it now sends its summary.
        OrosApp.bridge(c).permissionsChanged();
    }

    @Override
    public void onDisabled(Context c) {
        Widgets.clear(c);
        OrosApp.bridge(c).permissionsChanged();
    }
}
