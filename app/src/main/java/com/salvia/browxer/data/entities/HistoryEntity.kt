// File: app/src/main/java/com/salvia/browxer/data/entities/HistoryEntity.kt
package com.salvia.browxer.data.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.Date

/**
 * HistoryEntity - Represents a browsing history entry.
 */
@Entity(tableName = "history")
data class HistoryEntity(
    @PrimaryKey
    val id: String,
    val url: String = "",
    val title: String = "",
    val visitedAt: Date = Date(),
    val isBookmarked: Boolean = false
)
