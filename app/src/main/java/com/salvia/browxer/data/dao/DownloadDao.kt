// File: app/src/main/java/com/salvia/browxer/data/dao/DownloadDao.kt
package com.salvia.browxer.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.salvia.browxer.data.entities.DownloadEntity
import kotlinx.coroutines.flow.Flow
import java.util.Date

/**
 * DownloadDao - Data Access Object for downloads.
 */
@Dao
interface DownloadDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(download: DownloadEntity)
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(downloads: List<DownloadEntity>)
    
    @Update
    suspend fun update(download: DownloadEntity)
    
    @Query("DELETE FROM downloads WHERE id = :id")
    suspend fun delete(id: String)
    
    @Query("DELETE FROM downloads")
    suspend fun deleteAll()
    
    @Query("SELECT * FROM downloads WHERE id = :id")
    suspend fun getById(id: String): DownloadEntity?
    
    @Query("SELECT * FROM downloads ORDER BY createdAt DESC")
    fun getAll(): Flow<List<DownloadEntity>>
    
    @Query("SELECT * FROM downloads WHERE status = 'COMPLETED' ORDER BY completedAt DESC")
    fun getCompleted(): Flow<List<DownloadEntity>>
    
    @Query("SELECT * FROM downloads WHERE status IN ('DOWNLOADING', 'PAUSED', 'PENDING') ORDER BY createdAt DESC")
    fun getActive(): Flow<List<DownloadEntity>>
    
    @Query("SELECT * FROM downloads WHERE status = 'FAILED' ORDER BY createdAt DESC")
    fun getFailed(): Flow<List<DownloadEntity>>
    
    @Query("SELECT * FROM downloads WHERE filePath LIKE :query OR title LIKE :query ORDER BY createdAt DESC")
    fun search(query: String): Flow<List<DownloadEntity>>
    
    @Query("SELECT COUNT(*) FROM downloads")
    suspend fun getCount(): Int
    
    @Query("SELECT * FROM downloads ORDER BY createdAt DESC LIMIT :limit")
    fun getRecent(limit: Int): Flow<List<DownloadEntity>>
    
    @Query("SELECT * FROM downloads WHERE createdAt >= :startDate ORDER BY createdAt DESC")
    fun getSince(startDate: Date): Flow<List<DownloadEntity>>
    
    @Query("UPDATE downloads SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: String)
    
    @Query("UPDATE downloads SET progress = :progress WHERE id = :id")
    suspend fun updateProgress(id: String, progress: Int)
    
    @Query("UPDATE downloads SET downloadedBytes = :downloadedBytes WHERE id = :id")
    suspend fun updateDownloadedBytes(id: String, downloadedBytes: Long)
    
    @Query("UPDATE downloads SET filePath = :filePath WHERE id = :id")
    suspend fun updateFilePath(id: String, filePath: String)
    
    @Query("UPDATE downloads SET completedAt = :completedAt WHERE id = :id")
    suspend fun updateCompletedAt(id: String, completedAt: Date?)
}
