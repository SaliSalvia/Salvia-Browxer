// File: app/src/main/java/com/salvia/browxer/security/VaultManager.kt
package com.salvia.browxer.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKeys
import com.salvia.browxer.util.FileUtils
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.IvParameterSpec

/**
 * VaultManager - Manages secure vault operations with AES-256-CTR encryption.
 * 
 * Features:
 * - AES-256-CTR encryption for files
 * - Android Keystore integration
 * - Biometric authentication support
 * - Secure file storage in app's internal directory
 */
class VaultManager private constructor(
    private val context: Context
) {
    
    companion object {
        private const val KEYSTORE_ALIAS = "salvia_vault_key"
        private const val VAULT_DIR = ".SalviaVault"
        private const val KEY_SIZE = 256
        private const val BLOCK_MODE = "CTR"
        private const val PADDING = "NoPadding"
        private const val TRANSFORMATION = "AES/$BLOCK_MODE/$PADDING"
        
        @Volatile
        private var instance: VaultManager? = null
        
        fun getInstance(context: Context): VaultManager {
            return instance ?: synchronized(this) {
                instance ?: VaultManager(context.applicationContext).also {
                    instance = it
                }
            }
        }
    }

    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance("AndroidKeyStore").apply {
            load(null)
        }
    }
    
    private var masterKey: SecretKey? = null
    private var cipher: Cipher? = null
    
    // Biometric authentication
    private var biometricHelper: BiometricHelper? = null
    
    init {
        // Initialize cipher
        cipher = Cipher.getInstance(TRANSFORMATION)
        
        // Initialize biometric helper
        biometricHelper = BiometricHelper(context)
    }

    /**
     * Initialize or retrieve the encryption key
     */
    private fun getOrCreateKey(): SecretKey {
        return masterKey ?: synchronized(this) {
            masterKey ?: run {
                // Check if key exists
                if (!keyStore.containsAlias(KEYSTORE_ALIAS)) {
                    createKey()
                }
                
                // Get existing key
                (keyStore.getEntry(KEYSTORE_ALIAS, null) as KeyStore.SecretKeyEntry).secretKey
            }.also { masterKey = it }
        }
    }

    /**
     * Create a new encryption key
     */
    private fun createKey() {
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        
        val keyGenParameterSpec = KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_CTR)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(KEY_SIZE)
            .setUserAuthenticationRequired(true) // Require biometric authentication
            .setUserAuthenticationValidityDurationSeconds(30) // 30 seconds
            .build()
        
        keyGenerator.init(keyGenParameterSpec)
        keyGenerator.generateKey()
    }

    /**
     * Encrypt a file and save to vault
     */
    suspend fun encryptToVault(
        sourceFile: File,
        fileName: String,
        onProgress: (Int) -> Unit = {},
        onComplete: (File) -> Unit,
        onError: (Exception) -> Unit
    ) {
        try {
            // Get encryption key
            val key = getOrCreateKey()
            
            // Check if biometric authentication is required
            if (biometricHelper?.isBiometricAvailable() == true && 
                biometricHelper?.isBiometricEnabled() == true) {
                
                // Authenticate with biometrics
                val authenticated = biometricHelper?.authenticate(
                    title = "Access Vault",
                    subtitle = "Authenticate to access secure vault"
                ) ?: false
                
                if (!authenticated) {
                    onError(Exception("Biometric authentication failed"))
                    return
                }
            }
            
            // Create vault directory
            val vaultDir = File(context.filesDir, VAULT_DIR)
            if (!vaultDir.exists()) {
                vaultDir.mkdirs()
            }
            
            // Create encrypted file
            val encryptedFile = File(vaultDir, fileName)
            
            // Use AndroidX Security Crypto for high-level API
            val masterKey = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
            val encryptedFileHelper = EncryptedFile.Builder(
                context,
                encryptedFile,
                masterKey,
                EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB
            ).build()
            
            // Read source file
            val inputStream = FileInputStream(sourceFile)
            val outputStream = encryptedFileHelper.openFileOutputStream()
            
            // Copy data
            val buffer = ByteArray(8192)
            var bytesRead: Int
            var totalBytes = 0L
            val fileSize = sourceFile.length()
            
            while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                outputStream.write(buffer, 0, bytesRead)
                totalBytes += bytesRead
                
                // Update progress
                val progress = ((totalBytes * 100) / fileSize).toInt()
                onProgress(progress)
            }
            
            outputStream.flush()
            outputStream.close()
            inputStream.close()
            
            // Cleanup source file
            sourceFile.delete()
            
            onComplete(encryptedFile)
            
        } catch (e: Exception) {
            onError(e)
        }
    }

    /**
     * Decrypt a file from vault
     */
    suspend fun decryptFromVault(
        encryptedFile: File,
        outputFile: File,
        onProgress: (Int) -> Unit = {},
        onComplete: (File) -> Unit,
        onError: (Exception) -> Unit
    ) {
        try {
            // Check if biometric authentication is required
            if (biometricHelper?.isBiometricAvailable() == true && 
                biometricHelper?.isBiometricEnabled() == true) {
                
                // Authenticate with biometrics
                val authenticated = biometricHelper?.authenticate(
                    title = "Access Vault",
                    subtitle = "Authenticate to access secure vault"
                ) ?: false
                
                if (!authenticated) {
                    onError(Exception("Biometric authentication failed"))
                    return
                }
            }
            
            // Use AndroidX Security Crypto
            val masterKey = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
            val encryptedFileHelper = EncryptedFile.Builder(
                context,
                encryptedFile,
                masterKey,
                EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB
            ).build()
            
            val inputStream = encryptedFileHelper.openFileInputStream()
            val outputStream = FileOutputStream(outputFile)
            
            // Copy data
            val buffer = ByteArray(8192)
            var bytesRead: Int
            var totalBytes = 0L
            val fileSize = encryptedFile.length()
            
            while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                outputStream.write(buffer, 0, bytesRead)
                totalBytes += bytesRead
                
                // Update progress
                val progress = ((totalBytes * 100) / fileSize).toInt()
                onProgress(progress)
            }
            
            outputStream.flush()
            outputStream.close()
            inputStream.close()
            
            onComplete(outputFile)
            
        } catch (e: Exception) {
            onError(e)
        }
    }

    /**
     * Encrypt data directly (stream-based)
     */
    fun encryptData(data: ByteArray): ByteArray {
        val key = getOrCreateKey()
        cipher?.init(Cipher.ENCRYPT_MODE, key)
        
        val iv = cipher?.iv ?: ByteArray(16)
        val encryptedData = cipher?.doFinal(data) ?: data
        
        // Combine IV and encrypted data
        return iv + encryptedData
    }

    /**
     * Decrypt data directly (stream-based)
     */
    fun decryptData(encryptedData: ByteArray): ByteArray {
        val key = getOrCreateKey()
        
        // Extract IV (first 16 bytes)
        val iv = encryptedData.copyOfRange(0, 16)
        val actualData = encryptedData.copyOfRange(16, encryptedData.size)
        
        cipher?.init(Cipher.DECRYPT_MODE, key, IvParameterSpec(iv))
        
        return cipher?.doFinal(actualData) ?: actualData
    }

    /**
     * Save encrypted data to vault
     */
    fun saveEncryptedToVault(
        data: ByteArray,
        fileName: String
    ): File? {
        return try {
            val encryptedData = encryptData(data)
            val vaultDir = File(context.filesDir, VAULT_DIR)
            if (!vaultDir.exists()) {
                vaultDir.mkdirs()
            }
            
            val file = File(vaultDir, fileName)
            file.writeBytes(encryptedData)
            file
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Load and decrypt data from vault
     */
    fun loadEncryptedFromVault(fileName: String): ByteArray? {
        return try {
            val vaultDir = File(context.filesDir, VAULT_DIR)
            val file = File(vaultDir, fileName)
            
            if (file.exists()) {
                val encryptedData = file.readBytes()
                decryptData(encryptedData)
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * List all files in vault
     */
    fun listVaultFiles(): List<File> {
        val vaultDir = File(context.filesDir, VAULT_DIR)
        return if (vaultDir.exists() && vaultDir.isDirectory) {
            vaultDir.listFiles()?.toList() ?: emptyList()
        } else {
            emptyList()
        }
    }

    /**
     * Delete file from vault
     */
    fun deleteFromVault(fileName: String): Boolean {
        return try {
            val vaultDir = File(context.filesDir, VAULT_DIR)
            val file = File(vaultDir, fileName)
            file.delete()
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Clear all files from vault
     */
    fun clearVault(): Boolean {
        return try {
            val vaultDir = File(context.filesDir, VAULT_DIR)
            if (vaultDir.exists() && vaultDir.isDirectory) {
                vaultDir.listFiles()?.forEach { file ->
                    file.delete()
                }
                vaultDir.delete()
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Check if vault is empty
     */
    fun isVaultEmpty(): Boolean {
        val vaultDir = File(context.filesDir, VAULT_DIR)
        return !vaultDir.exists() || vaultDir.listFiles().isNullOrEmpty()
    }

    /**
     * Get vault size
     */
    fun getVaultSize(): Long {
        val vaultDir = File(context.filesDir, VAULT_DIR)
        return if (vaultDir.exists() && vaultDir.isDirectory) {
            vaultDir.listFiles()?.sumOf { it.length() } ?: 0L
        } else {
            0L
        }
    }

    /**
     * Enable biometric authentication
     */
    fun enableBiometricAuthentication() {
        biometricHelper?.enableBiometric()
    }

    /**
     * Disable biometric authentication
     */
    fun disableBiometricAuthentication() {
        biometricHelper?.disableBiometric()
    }

    /**
     * Check if biometric authentication is enabled
     */
    fun isBiometricEnabled(): Boolean {
        return biometricHelper?.isBiometricEnabled() == true
    }

    /**
     * Check if biometric authentication is available
     */
    fun isBiometricAvailable(): Boolean {
        return biometricHelper?.isBiometricAvailable() == true
    }

    /**
     * Authenticate with biometrics
     */
    suspend fun authenticateWithBiometrics(
        title: String,
        subtitle: String,
        onSuccess: () -> Unit,
        onError: (Exception) -> Unit
    ) {
        biometricHelper?.authenticate(
            title = title,
            subtitle = subtitle,
            onSuccess = onSuccess,
            onError = onError
        )
    }

    /**
     * Cleanup resources
     */
    fun cleanup() {
        masterKey = null
        cipher = null
        biometricHelper = null
    }
}
