// File: app/src/main/java/com/salvia/browxer/data/entities/DownloadEntity.kt
package com.salvia.browxer.data.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.Date

/**
 * DownloadEntity - Represents a download entry.
 */
@Entity(tableName = "downloads")
data class DownloadEntity(
    @PrimaryKey
    val id: String,
    val title: String = "",
    val url: String = "",
    val filePath: String = "",
    val status: String = "PENDING", // PENDING, DOWNLOADING, PAUSED, COMPLETED, FAILED
    val progress: Int = 0,
    val downloadedBytes: Long = 0,
    val totalBytes: Long = 0,
    val createdAt: Date = Date(),
    val completedAt: Date? = null,
    val errorMessage: String? = null
)
