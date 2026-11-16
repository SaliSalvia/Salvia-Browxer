package com.salvia.salviabrowxer

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentCallbacks2
import android.os.Build
import com.salvia.salviabrowxer.core.NativeProxyClient

class SalviaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        createDownloadChannel()
        Thread {
            try {
                NativeProxyClient.httpClient.connectionPool
            } catch (_: Exception) {
            }
        }.apply {
            name = "salvia-warmup"
            isDaemon = true
            start()
        }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ||
            level == ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN
        ) {
            try {
                NativeProxyClient.httpClient.connectionPool.evictAll()
            } catch (_: Exception) {
            }
        }
    }

    private fun createDownloadChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_DOWNLOADS,
                getString(R.string.channel_downloads_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.channel_downloads_desc)
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_DOWNLOADS = "salvia_downloads"
    }
}
