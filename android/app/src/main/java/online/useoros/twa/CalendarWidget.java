package online.useoros.twa;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** The "Calendar" home-screen widget (BR-PHONE v7); see AgendaWidgets. */
public class CalendarWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        Widgets.update(c);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle opts) {
        m.updateAppWidget(id, AgendaWidgets.calendar(c, opts));
    }

    @Override
    public void onEnabled(Context c) {
        // The first one: if orOS is open, it now sends the next events.
        OrosApp.bridge(c).permissionsChanged();
    }

    @Override
    public void onDisabled(Context c) {
        AgendaWidgets.clear(c, true);
        OrosApp.bridge(c).permissionsChanged();
    }
}
