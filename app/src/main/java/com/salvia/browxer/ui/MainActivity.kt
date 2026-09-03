// File: app/src/main/java/com/salvia/browxer/ui/MainActivity.kt
package com.salvia.browxer.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.salvia.browxer.ui.theme.SalviaBrowxerTheme

/**
 * MainActivity - Entry point of the application.
 * 
 * Features:
 * - Jetpack Compose UI
 * - Theme management
 * - Navigation host
 */
class MainActivity : ComponentActivity() {
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        setContent {
            SalviaBrowxerTheme {
                // A surface container using the 'background' color from the theme
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainScreen()
                }
            }
        }
    }
}

/**
 * MainScreen - Root composable for the application.
 */
@androidx.compose.runtime.Composable
fun MainScreen() {
    // This will be replaced with the actual navigation implementation
    BrowserScreen()
}

/**
 * BrowserScreen - Main browser screen.
 */
@androidx.compose.runtime.Composable
fun BrowserScreen() {
    // Placeholder for browser screen
    // In a real implementation, this would contain:
    // - Toolbar with omnibox
    // - WebView
    // - Bottom navigation
    // - Tab switcher
    androidx.compose.material3.Text(
        text = "Salvia Browxer - Coming Soon",
        style = MaterialTheme.typography.headlineMedium
    )
}
