// File: app/src/main/java/com/salvia/browxer/data/dao/HistoryDao.kt
package com.salvia.browxer.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.salvia.browxer.data.entities.HistoryEntity
import kotlinx.coroutines.flow.Flow
import java.util.Date

/**
 * HistoryDao - Data Access Object for browsing history.
 */
@Dao
interface HistoryDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(history: HistoryEntity)
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(histories: List<HistoryEntity>)
    
    @Update
    suspend fun update(history: HistoryEntity)
    
    @Query("DELETE FROM history WHERE id = :id")
    suspend fun delete(id: String)
    
    @Query("DELETE FROM history")
    suspend fun deleteAll()
    
    @Query("SELECT * FROM history WHERE id = :id")
    suspend fun getById(id: String): HistoryEntity?
    
    @Query("SELECT * FROM history ORDER BY visitedAt DESC")
    fun getAll(): Flow<List<HistoryEntity>>
    
    @Query("SELECT * FROM history WHERE url LIKE :query OR title LIKE :query ORDER BY visitedAt DESC")
    fun search(query: String): Flow<List<HistoryEntity>>
    
    @Query("SELECT * FROM history WHERE url = :url ORDER BY visitedAt DESC")
    suspend fun getByUrl(url: String): List<HistoryEntity>
    
    @Query("SELECT * FROM history WHERE visitedAt >= :startDate ORDER BY visitedAt DESC")
    fun getSince(startDate: Date): Flow<List<HistoryEntity>>
    
    @Query("SELECT COUNT(*) FROM history")
    suspend fun getCount(): Int
    
    @Query("SELECT * FROM history ORDER BY visitedAt DESC LIMIT :limit")
    fun getRecent(limit: Int): Flow<List<HistoryEntity>>
    
    @Query("SELECT * FROM history WHERE isBookmarked = 1 ORDER BY visitedAt DESC")
    fun getBookmarked(): Flow<List<HistoryEntity>>
    
    @Query("UPDATE history SET title = :title WHERE url = :url")
    suspend fun updateTitle(url: String, title: String)
    
    @Query("UPDATE history SET isBookmarked = :isBookmarked WHERE id = :id")
    suspend fun setBookmarked(id: String, isBookmarked: Boolean)
}
