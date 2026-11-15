package com.salvia.salviabrowxer.storage

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File

object MediaPublisher {
    fun publishToDevice(
        context: Context,
        sourceFile: File,
        displayName: String,
        mimeType: String
    ): String? {
        if (!sourceFile.exists() || sourceFile.length() == 0L) return null
        val safeName = sanitizeName(displayName)
        val normalizedMime = mimeType.substringBefore(';').trim().lowercase()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val (collection, relativePath) = when {
                normalizedMime.startsWith("video/") ->
                    MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to
                        "${Environment.DIRECTORY_MOVIES}/SalviaBrowxer"
                normalizedMime.startsWith("audio/") ->
                    MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to
                        "${Environment.DIRECTORY_MUSIC}/SalviaBrowxer"
                else ->
                    MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to
                        "${Environment.DIRECTORY_DOWNLOADS}/SalviaBrowxer"
            }
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                put(MediaStore.MediaColumns.MIME_TYPE, normalizedMime.ifEmpty { "application/octet-stream" })
                put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val itemUri: Uri = resolver.insert(collection, values) ?: return null
            return try {
                resolver.openOutputStream(itemUri)?.use { out ->
                    sourceFile.inputStream().use { input -> input.copyTo(out, 64 * 1024) }
                } ?: throw IllegalStateException("Cannot open MediaStore stream")
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(itemUri, values, null, null)
                itemUri.toString()
            } catch (_: Exception) {
                resolver.delete(itemUri, null, null)
                null
            }
        } else {
            @Suppress("DEPRECATION")
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val targetDir = File(downloadsDir, "SalviaBrowxer").apply { mkdirs() }
            val destFile = uniqueFile(targetDir, safeName)
            return try {
                sourceFile.copyTo(destFile, overwrite = false)
                MediaScannerConnection.scanFile(context, arrayOf(destFile.absolutePath), arrayOf(normalizedMime), null)
                FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", destFile).toString()
            } catch (_: Exception) {
                null
            }
        }
    }

    fun providerUriForInternalFile(context: Context, file: File): Uri {
        return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    }

    private fun uniqueFile(dir: File, name: String): File {
        var candidate = File(dir, name)
        if (!candidate.exists()) return candidate
        val dot = name.lastIndexOf('.')
        val stem = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var i = 1
        while (candidate.exists()) {
            candidate = File(dir, "$stem ($i)$ext")
            i++
        }
        return candidate
    }

    private fun sanitizeName(raw: String): String {
        val cleaned = raw.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        return cleaned.take(110).ifEmpty { "media.mp4" }
    }
}
