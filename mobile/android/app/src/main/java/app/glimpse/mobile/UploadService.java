package app.glimpse.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/** Keeps the app running while uploads are in progress, with a notification showing how far they've got. */
public class UploadService extends Service {
    private static final String CHANNEL = "uploads";
    private static final int ID = 4401;
    private static boolean running;

    /** Start, refresh or stop the service to match the uploads in progress. */
    static synchronized void update(Context ctx) {
        boolean any = !GlimpseUploadsPlugin.jobs.isEmpty();
        Context app = ctx.getApplicationContext();
        if (any && !running) {
            running = true;
            ContextCompat.startForegroundService(app, new Intent(app, UploadService.class));
        } else if (any) {
            NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(ID, build(app));
        } else if (running) {
            running = false;
            app.stopService(new Intent(app, UploadService.class));
        }
    }

    private static Notification build(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Uploads", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows clips uploading to your Glimpse server");
            nm.createNotificationChannel(ch);
        }
        long size = 0, done = 0;
        boolean waiting = false;
        int n = 0;
        for (GlimpseUploadsPlugin.Job j : GlimpseUploadsPlugin.jobs.values()) {
            size += j.size;
            done += j.at;
            waiting |= j.waiting;
            n++;
        }
        int pct = size > 0 ? (int) (done * 100 / size) : 0;
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent tap = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(n > 1 ? "Uploading " + n + " clips" : "Uploading your clip")
            .setContentText(waiting ? "Waiting for a connection…" : pct + "%")
            .setProgress(100, pct, size <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap)
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ServiceCompat.startForeground(this, ID, build(this), Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
        if (GlimpseUploadsPlugin.jobs.isEmpty()) {
            running = false;
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
