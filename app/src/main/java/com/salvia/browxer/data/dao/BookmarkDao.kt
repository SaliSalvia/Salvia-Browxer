// File: app/src/main/java/com/salvia/browxer/data/dao/BookmarkDao.kt
package com.salvia.browxer.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.salvia.browxer.data.entities.BookmarkEntity
import kotlinx.coroutines.flow.Flow

/**
 * BookmarkDao - Data Access Object for bookmarks.
 */
@Dao
interface BookmarkDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(bookmark: BookmarkEntity)
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(bookmarks: List<BookmarkEntity>)
    
    @Update
    suspend fun update(bookmark: BookmarkEntity)
    
    @Query("DELETE FROM bookmarks WHERE id = :id")
    suspend fun delete(id: String)
    
    @Query("DELETE FROM bookmarks")
    suspend fun deleteAll()
    
    @Query("SELECT * FROM bookmarks WHERE id = :id")
    suspend fun getById(id: String): BookmarkEntity?
    
    @Query("SELECT * FROM bookmarks ORDER BY position ASC")
    fun getAll(): Flow<List<BookmarkEntity>>
    
    @Query("SELECT * FROM bookmarks WHERE folder = :folder ORDER BY position ASC")
    fun getByFolder(folder: String): Flow<List<BookmarkEntity>>
    
    @Query("SELECT * FROM bookmarks WHERE url = :url")
    suspend fun getByUrl(url: String): BookmarkEntity?
    
    @Query("SELECT * FROM bookmarks WHERE title LIKE :query OR url LIKE :query ORDER BY position ASC")
    fun search(query: String): Flow<List<BookmarkEntity>>
    
    @Query("SELECT COUNT(*) FROM bookmarks")
    suspend fun getCount(): Int
    
    @Query("SELECT MAX(position) FROM bookmarks")
    suspend fun getMaxPosition(): Int?
    
    @Query("SELECT * FROM bookmarks WHERE isInToolbar = 1 ORDER BY position ASC")
    fun getToolbarBookmarks(): Flow<List<BookmarkEntity>>
    
    @Query("SELECT DISTINCT folder FROM bookmarks WHERE folder IS NOT NULL ORDER BY folder ASC")
    fun getAllFolders(): Flow<List<String>>
    
    @Query("UPDATE bookmarks SET position = :position WHERE id = :id")
    suspend fun updatePosition(id: String, position: Int)
    
    @Query("UPDATE bookmarks SET folder = :folder WHERE id = :id")
    suspend fun updateFolder(id: String, folder: String?)
    
    @Query("UPDATE bookmarks SET isInToolbar = :isInToolbar WHERE id = :id")
    suspend fun setInToolbar(id: String, isInToolbar: Boolean)
}
