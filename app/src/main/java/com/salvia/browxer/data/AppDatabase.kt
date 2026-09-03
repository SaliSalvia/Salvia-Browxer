// File: app/src/main/java/com/salvia/browxer/data/AppDatabase.kt
package com.salvia.browxer.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.salvia.browxer.data.dao.BookmarkDao
import com.salvia.browxer.data.dao.DownloadDao
import com.salvia.browxer.data.dao.HistoryDao
import com.salvia.browxer.data.dao.TabDao
import com.salvia.browxer.data.entities.BookmarkEntity
import com.salvia.browxer.data.entities.DownloadEntity
import com.salvia.browxer.data.entities.HistoryEntity
import com.salvia.browxer.data.entities.TabEntity

/**
 * AppDatabase - Room database for the application.
 * 
 * Features:
 * - Tabs management
 * - Browsing history
 * - Bookmarks
 * - Downloads tracking
 */
@Database(
    entities = [
        TabEntity::class,
        HistoryEntity::class,
        BookmarkEntity::class,
        DownloadEntity::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    
    abstract fun tabDao(): TabDao
    abstract fun historyDao(): HistoryDao
    abstract fun bookmarkDao(): BookmarkDao
    abstract fun downloadDao(): DownloadDao
    
    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null
        
        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "salvia_browxer_db"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                
                INSTANCE = instance
                instance
            }
        }
    }
}

/**
 * Converters for Room database
 */
class Converters {
    
    @androidx.room.TypeConverter
    fun fromTimestamp(value: Long?): java.util.Date? {
        return value?.let { java.util.Date(it) }
    }
    
    @androidx.room.TypeConverter
    fun dateToTimestamp(date: java.util.Date?): Long? {
        return date?.time
    }
    
    @androidx.room.TypeConverter
    fun fromStringList(value: String?): List<String>? {
        return value?.split(",")?.map { it.trim() }
    }
    
    @androidx.room.TypeConverter
    fun stringListToString(list: List<String>?): String? {
        return list?.joinToString(",")
    }
    
    @androidx.room.TypeConverter
    fun fromStringMap(value: String?): Map<String, String>? {
        if (value.isNullOrEmpty()) return null
        
        return value.split("|").associate { pair ->
            val (key, value) = pair.split("=")
            key to value
        }
    }
    
    @androidx.room.TypeConverter
    fun stringMapToString(map: Map<String, String>?): String? {
        return map?.entries?.joinToString("|") { (key, value) ->
            "$key=$value"
        }
    }
}
