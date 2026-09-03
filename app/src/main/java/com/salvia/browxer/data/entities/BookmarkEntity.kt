// File: app/src/main/java/com/salvia/browxer/data/entities/BookmarkEntity.kt
package com.salvia.browxer.data.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.Date

/**
 * BookmarkEntity - Represents a bookmark.
 */
@Entity(tableName = "bookmarks")
data class BookmarkEntity(
    @PrimaryKey
    val id: String,
    val url: String = "",
    val title: String = "",
    val folder: String? = null,
    val position: Int = 0,
    val isInToolbar: Boolean = false,
    val createdAt: Date = Date(),
    val updatedAt: Date = Date()
)
