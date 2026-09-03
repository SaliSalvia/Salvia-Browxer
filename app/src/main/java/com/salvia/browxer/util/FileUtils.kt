// File: app/src/main/java/com/salvia/browxer/util/FileUtils.kt
package com.salvia.browxer.util

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * FileUtils - Utility class for file operations.
 * 
 * Features:
 * - Generate download file paths
 * - Public storage (MediaStore API)
 * - Private vault (hidden folder)
 * - File name sanitization
 */
object FileUtils {

    private const val DOWNLOAD_DIR = "SalviaBrowxer"
    private const val VAULT_DIR = ".SalviaVault"
    private const val TEMP_DIR = "temp"

    /**
     * Generate download file path
     */
    fun generateDownloadFilePath(context: Context, title: String, extension: String): String {
        val sanitizedTitle = sanitizeFileName(title)
        val fileName = if (sanitizedTitle.isNotEmpty()) {
            "$sanitizedTitle.$extension"
        } else {
            "video_${System.currentTimeMillis()}.$extension"
        }
        
        return getPublicDownloadDir(context) + File.separator + fileName
    }

    /**
     * Get public download directory
     */
    fun getPublicDownloadDir(context: Context): String {
        return Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            .toString() + File.separator + DOWNLOAD_DIR
    }

    /**
     * Get private vault directory
     */
    fun getPrivateVaultDir(context: Context): String {
        return context.filesDir.toString() + File.separator + VAULT_DIR
    }

    /**
     * Get temp directory
     */
    fun getTempDir(context: Context): String {
        return context.cacheDir.toString() + File.separator + TEMP_DIR
    }

    /**
     * Sanitize file name
     */
    fun sanitizeFileName(fileName: String): String {
        return fileName
            .replace("[<>:\\"/\\\\|?*\\u0000-\\u001F]".toRegex(), "_")
            .replace("\\s+".toRegex(), " ")
            .trim()
            .take(200) // Limit file name length
    }

    /**
     * Generate unique file name
     */
    fun generateUniqueFileName(baseName: String, extension: String): String {
        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        return "$baseName_$timestamp.$extension"
    }

    /**
     * Create directory if not exists
     */
    fun createDirectoryIfNotExists(path: String): Boolean {
        return try {
            val dir = File(path)
            if (!dir.exists()) {
                dir.mkdirs()
            }
            dir.exists() && dir.isDirectory
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Save file to public storage using MediaStore API
     */
    fun saveToPublicStorage(
        context: Context,
        sourceFile: File,
        displayName: String,
        mimeType: String
    ): Uri? {
        return try {
            val contentValues = android.content.ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
            
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
            
            uri?.let {
                resolver.openOutputStream(it)?.use { outputStream ->
                    sourceFile.inputStream().use { inputStream ->
                        inputStream.copyTo(outputStream)
                    }
                }
            }
            
            uri
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Save file to private vault
     */
    fun saveToPrivateVault(
        context: Context,
        sourceFile: File,
        fileName: String
    ): File? {
        return try {
            val vaultDir = File(getPrivateVaultDir(context))
            if (!vaultDir.exists()) {
                vaultDir.mkdirs()
            }
            
            val destFile = File(vaultDir, fileName)
            sourceFile.copyTo(destFile, overwrite = true)
            
            destFile
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Get file extension from URL
     */
    fun getFileExtensionFromUrl(url: String): String {
        return try {
            val uri = Uri.parse(url)
            val lastPathSegment = uri.lastPathSegment ?: return ""
            
            if (lastPathSegment.contains(".")) {
                lastPathSegment.substringAfterLast(".", "")
            } else {
                ""
            }
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * Get file name from URL
     */
    fun getFileNameFromUrl(url: String): String {
        return try {
            val uri = Uri.parse(url)
            val lastPathSegment = uri.lastPathSegment ?: return ""
            
            if (lastPathSegment.contains(".")) {
                lastPathSegment.substringBeforeLast(".")
            } else {
                lastPathSegment
            }
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * Check if file exists
     */
    fun fileExists(path: String): Boolean {
        return File(path).exists()
    }

    /**
     * Get file size
     */
    fun getFileSize(path: String): Long {
        return File(path).length()
    }

    /**
     * Delete file
     */
    fun deleteFile(path: String): Boolean {
        return File(path).delete()
    }

    /**
     * Clear directory
     */
    fun clearDirectory(path: String): Boolean {
        return try {
            val dir = File(path)
            if (dir.exists() && dir.isDirectory) {
                dir.listFiles()?.forEach { file ->
                    if (file.isFile) {
                        file.delete()
                    } else if (file.isDirectory) {
                        clearDirectory(file.absolutePath)
                    }
                }
                dir.delete()
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Get available storage space
     */
    fun getAvailableStorageSpace(): Long {
        return try {
            val stat = Environment.getDataDirectory().statFs
            stat.availableBytes
        } catch (e: Exception) {
            0L
        }
    }

    /**
     * Check if there's enough space for download
     */
    fun hasEnoughSpace(requiredBytes: Long): Boolean {
        val available = getAvailableStorageSpace()
        return available >= requiredBytes * 2 // Require 2x space for safety
    }

    /**
     * Create temp file
     */
    fun createTempFile(context: Context, prefix: String, suffix: String): File {
        val tempDir = File(getTempDir(context))
        if (!tempDir.exists()) {
            tempDir.mkdirs()
        }
        
        return File.createTempFile(prefix, suffix, tempDir)
    }

    /**
     * Move file
     */
    fun moveFile(source: File, destination: File): Boolean {
        return try {
            if (destination.exists()) {
                destination.delete()
            }
            source.renameTo(destination)
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Copy file
     */
    fun copyFile(source: File, destination: File): Boolean {
        return try {
            source.copyTo(destination, overwrite = true)
            true
        } catch (e: Exception) {
            false
        }
    }
}
