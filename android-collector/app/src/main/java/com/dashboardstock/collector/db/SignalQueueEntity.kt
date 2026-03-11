package com.dashboardstock.collector.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 오프라인 큐: API 전송 실패 시 로컬 저장
 */
@Entity(tableName = "signal_queue")
data class SignalQueueEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val payload: String,       // JSON 직렬화된 List<SignalInput>
    val createdAt: Long = System.currentTimeMillis(),
    val retryCount: Int = 0
)
