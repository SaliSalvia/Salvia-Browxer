// File: app/src/main/java/com/salvia/browxer/security/BiometricHelper.kt
package com.salvia.browxer.security

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.Executor
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * BiometricHelper - Handles biometric authentication.
 * 
 * Features:
 * - Biometric availability checking
 * - Biometric authentication
 * - Biometric settings management
 */
class BiometricHelper(private val context: Context) {
    
    private val biometricManager: BiometricManager by lazy {
        BiometricManager.from(context)
    }
    
    private val executor: Executor by lazy {
        ContextCompat.getMainExecutor(context)
    }
    
    // Shared preferences for biometric settings
    private val sharedPrefs by lazy {
        context.getSharedPreferences("biometric_settings", Context.MODE_PRIVATE)
    }
    
    companion object {
        private const val KEY_BIOMETRIC_ENABLED = "biometric_enabled"
    }

    /**
     * Check if biometric authentication is available
     */
    fun isBiometricAvailable(): Boolean {
        return when (biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)) {
            BiometricManager.BIOMETRIC_SUCCESS -> true
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> false
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> false
            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> false
            else -> false
        }
    }

    /**
     * Check if biometric authentication is enabled
     */
    fun isBiometricEnabled(): Boolean {
        return sharedPrefs.getBoolean(KEY_BIOMETRIC_ENABLED, false)
    }

    /**
     * Enable biometric authentication
     */
    fun enableBiometric() {
        sharedPrefs.edit().putBoolean(KEY_BIOMETRIC_ENABLED, true).apply()
    }

    /**
     * Disable biometric authentication
     */
    fun disableBiometric() {
        sharedPrefs.edit().putBoolean(KEY_BIOMETRIC_ENABLED, false).apply()
    }

    /**
     * Toggle biometric authentication
     */
    fun toggleBiometric() {
        val current = isBiometricEnabled()
        sharedPrefs.edit().putBoolean(KEY_BIOMETRIC_ENABLED, !current).apply()
    }

    /**
     * Authenticate with biometrics
     */
    suspend fun authenticate(
        title: String,
        subtitle: String,
        onSuccess: () -> Unit = {},
        onError: (Exception) -> Unit = {}
    ): Boolean {
        return suspendCancellableCoroutine { continuation ->
            try {
                if (!isBiometricAvailable()) {
                    continuation.resume(false)
                    return@suspendCancellableCoroutine
                }

                val promptInfo = BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setNegativeButtonText("Cancel")
                    .build()

                val activity = context as? FragmentActivity
                if (activity == null) {
                    continuation.resume(false)
                    return@suspendCancellableCoroutine
                }

                val biometricPrompt = BiometricPrompt(
                    activity,
                    executor,
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                            super.onAuthenticationSucceeded(result)
                            continuation.resume(true)
                            onSuccess()
                        }

                        override fun onAuthenticationFailed() {
                            super.onAuthenticationFailed()
                            // Don't resume yet, user might retry
                        }

                        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                            super.onAuthenticationError(errorCode, errString)
                            continuation.resumeWithException(
                                Exception("Biometric authentication error: $errString")
                            )
                            onError(Exception("Biometric authentication error: $errString"))
                        }
                    }
                )

                biometricPrompt.authenticate(promptInfo)

            } catch (e: Exception) {
                continuation.resumeWithException(e)
                onError(e)
            }
        }
    }

    /**
     * Get biometric authentication status
     */
    fun getBiometricStatus(): BiometricStatus {
        return when {
            !isBiometricAvailable() -> BiometricStatus.NOT_AVAILABLE
            !isBiometricEnabled() -> BiometricStatus.AVAILABLE_BUT_DISABLED
            else -> BiometricStatus.ENABLED
        }
    }

    /**
     * Get available biometric types
     */
    fun getAvailableBiometricTypes(): List<BiometricType> {
        val availableTypes = mutableListOf<BiometricType>()
        
        when (biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)) {
            BiometricManager.BIOMETRIC_SUCCESS -> {
                availableTypes.add(BiometricType.FINGERPRINT)
                availableTypes.add(BiometricType.FACE)
                availableTypes.add(BiometricType.IRIS)
            }
            else -> {}
        }
        
        return availableTypes
    }

    /**
     * Check if device has fingerprint hardware
     */
    fun hasFingerprintHardware(): Boolean {
        return biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG or 
                BiometricManager.Authenticators.DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS
    }

    /**
     * Check if device has face authentication
     */
    fun hasFaceAuthentication(): Boolean {
        return biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == 
                BiometricManager.BIOMETRIC_SUCCESS
    }
}

/**
 * Biometric status enum
 */
enum class BiometricStatus {
    NOT_AVAILABLE,
    AVAILABLE_BUT_DISABLED,
    ENABLED
}

/**
 * Biometric type enum
 */
enum class BiometricType {
    FINGERPRINT,
    FACE,
    IRIS
}
