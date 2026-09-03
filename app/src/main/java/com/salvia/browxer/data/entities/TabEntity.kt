// File: app/src/main/java/com/salvia/browxer/data/entities/TabEntity.kt
package com.salvia.browxer.data.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.Date

/**
 * TabEntity - Represents a browser tab.
 */
@Entity(tableName = "tabs")
data class TabEntity(
    @PrimaryKey
    val id: String,
    val url: String = "",
    val title: String = "",
    val position: Int = 0,
    val isActive: Boolean = false,
    val isIncognito: Boolean = false,
    val userAgent: String = "",
    val createdAt: Date = Date(),
    val updatedAt: Date = Date()
)
