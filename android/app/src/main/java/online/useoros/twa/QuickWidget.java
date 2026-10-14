package online.useoros.twa;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** The "Quick add" home-screen widget (BR-PHONE v4): a task, a glass
 *  of water, a note; each button opens orOS there. */
public class QuickWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, Widgets.quick(c));
    }
}
