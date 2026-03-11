package com.dashboardstock.collector.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface SignalQueueDao {
    @Insert
    suspend fun insert(entity: SignalQueueEntity)

    @Query("SELECT * FROM signal_queue ORDER BY createdAt ASC LIMIT 50")
    suspend fun getPending(): List<SignalQueueEntity>

    @Query("DELETE FROM signal_queue WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE signal_queue SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetry(id: Long)

    @Query("DELETE FROM signal_queue WHERE retryCount > 10")
    suspend fun deleteExpired()

    @Query("SELECT COUNT(*) FROM signal_queue")
    suspend fun count(): Int
}
