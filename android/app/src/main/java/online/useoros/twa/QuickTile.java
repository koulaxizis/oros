package online.useoros.twa;

import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick Settings tile "orOS Quick" (Quick window, QW): a tap opens
 *  orOS with the command bar ("#quick"), to add a task or search your
 *  data. Nothing is typed or sent; the tile keeps no data. */
public class QuickTile extends TileService {
    @Override
    public void onStartListening() {
        Tile t = getQsTile();
        if (t == null) return;
        t.setState(Tile.STATE_INACTIVE);
        t.updateTile();
    }

    @Override
    public void onClick() {
        if (isLocked()) unlockAndRun(this::open);
        else open();
    }

    @SuppressWarnings("deprecation")
    private void open() {
        if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(Widgets.quickOpen(this));
        else startActivityAndCollapse(Widgets.quickIntent(this));
    }
}
