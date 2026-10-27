package online.useoros.twa;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** The "Add or search" home-screen widget (Quick window, QW): one bar
 *  that opens orOS with the command bar ("#quick"). No data kept. */
public class QuickBarWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, Widgets.quickBar(c));
    }
}
