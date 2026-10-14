package online.useoros.twa;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A reminder came due (Reminders.ACTION_FIRE), or Android forgot the
 *  armed alarms (reboot, app update, clock or zone change, exact-alarm
 *  permission granted): ring it, or arm them all again. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent in) {
        String a = in.getAction();
        if (Reminders.ACTION_FIRE.equals(a)) {
            String id = in.getStringExtra("id");
            if (id != null && !id.isEmpty()) Reminders.fire(c, id);
            return;
        }
        Reminders.arm(c);
    }
}
