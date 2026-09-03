// File: app/src/main/java/com/salvia/browxer/ui/MainApplication.kt
package com.salvia.browxer.ui

import android.app.Application
import android.webkit.WebView
import com.salvia.browxer.data.AppDatabase

/**
 * MainApplication - Custom application class.
 * 
 * Features:
 * - WebView initialization
 * - Database initialization
 * - App-wide dependencies
 */
class MainApplication : Application() {
    
    companion object {
        @Volatile
        private var instance: MainApplication? = null
        
        fun getInstance(): MainApplication {
            return instance ?: throw IllegalStateException("Application not initialized")
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        
        // Initialize WebView
        WebView.setWebContentsDebuggingEnabled(true)
        
        // Initialize database
        AppDatabase.getDatabase(this)
    }

    override fun onTerminate() {
        super.onTerminate()
        instance = null
    }
}
