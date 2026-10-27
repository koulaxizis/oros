package online.useoros.twa;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/** The "To-Do" home-screen widget (BR-PHONE v7): the next tasks, each
 *  with a box that ticks it; see AgendaWidgets. */
public class TodoWidget extends AppWidgetProvider {
    @Override
    public void onReceive(Context c, Intent in) {
        if (AgendaWidgets.ACTION_TICK.equals(in.getAction())) {
            String[] t = AgendaWidgets.tickOf(in);
            if (t == null) return;
            AgendaWidgets.tick(c, t[0], t[1]);
            Widgets.update(c);
            OrosApp.bridge(c).sendTicks();   // at once when orOS is running
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
        m.updateAppWidget(id, AgendaWidgets.todo(c, opts));
    }

    @Override
    public void onEnabled(Context c) {
        OrosApp.bridge(c).permissionsChanged();
    }

    @Override
    public void onDisabled(Context c) {
        // The rows go; ticks not yet in orOS stay and still go to it.
        AgendaWidgets.clear(c, false);
        OrosApp.bridge(c).permissionsChanged();
    }
}
