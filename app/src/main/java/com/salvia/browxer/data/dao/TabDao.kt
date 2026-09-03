// File: app/src/main/java/com/salvia/browxer/data/dao/TabDao.kt
package com.salvia.browxer.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.salvia.browxer.data.entities.TabEntity
import kotlinx.coroutines.flow.Flow

/**
 * TabDao - Data Access Object for browser tabs.
 */
@Dao
interface TabDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(tab: TabEntity)
    
    @Update
    suspend fun update(tab: TabEntity)
    
    @Query("DELETE FROM tabs WHERE id = :id")
    suspend fun delete(id: String)
    
    @Query("DELETE FROM tabs")
    suspend fun deleteAll()
    
    @Query("SELECT * FROM tabs WHERE id = :id")
    suspend fun getById(id: String): TabEntity?
    
    @Query("SELECT * FROM tabs ORDER BY position ASC")
    fun getAll(): Flow<List<TabEntity>>
    
    @Query("SELECT * FROM tabs WHERE isIncognito = 0 ORDER BY position ASC")
    fun getAllRegular(): Flow<List<TabEntity>>
    
    @Query("SELECT * FROM tabs WHERE isIncognito = 1 ORDER BY position ASC")
    fun getAllIncognito(): Flow<List<TabEntity>>
    
    @Query("SELECT * FROM tabs WHERE isActive = 1 ORDER BY position ASC")
    fun getActiveTabs(): Flow<List<TabEntity>>
    
    @Query("SELECT COUNT(*) FROM tabs")
    suspend fun getCount(): Int
    
    @Query("SELECT MAX(position) FROM tabs")
    suspend fun getMaxPosition(): Int?
    
    @Query("UPDATE tabs SET isActive = :isActive WHERE id = :id")
    suspend fun setActive(id: String, isActive: Boolean)
    
    @Query("UPDATE tabs SET url = :url, title = :title WHERE id = :id")
    suspend fun updateUrlAndTitle(id: String, url: String, title: String)
    
    @Query("UPDATE tabs SET position = :position WHERE id = :id")
    suspend fun updatePosition(id: String, position: Int)
}
