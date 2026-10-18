package online.useoros.twa;

import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick Settings tile "orOS Assistant" (quick access wave 4, AS-OUT):
 *  a tap opens orOS with the Assistant's small window. Nothing is
 *  typed or sent; the tile keeps no data. */
public class AskTile extends TileService {
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
        if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(Widgets.ask(this));
        else startActivityAndCollapse(Widgets.askIntent(this));
    }
}
