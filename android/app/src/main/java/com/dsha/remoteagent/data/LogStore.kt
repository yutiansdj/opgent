package com.dsha.remoteagent.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** 一条本地指令日志 */
data class LogEntry(
    val id: Long,
    val createdAt: Long,
    val cmd: String,
    val params: String,
    val status: String,
    val result: String,
    val durationMs: Long
)

/**
 * 本地日志存储：SQLiteOpenHelper 自建表，不引 Room。
 * 表结构：logs(_id, created_at, cmd, params, status, result, duration_ms)
 */
class LogStore(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE logs (
                _id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at INTEGER NOT NULL,
                cmd TEXT NOT NULL,
                params TEXT,
                status TEXT NOT NULL,
                result TEXT,
                duration_ms INTEGER NOT NULL DEFAULT 0
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX idx_logs_created ON logs(created_at DESC)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // v1 暂无升级逻辑
    }

    fun insert(
        cmd: String,
        params: String,
        status: String,
        result: String,
        durationMs: Long
    ): Long {
        val values = ContentValues().apply {
            put("created_at", System.currentTimeMillis())
            put("cmd", cmd)
            put("params", params)
            put("status", status)
            put("result", result.take(MAX_RESULT_LEN))
            put("duration_ms", durationMs)
        }
        return runCatching { writableDatabase.insert("logs", null, values) }.getOrDefault(-1L)
    }

    fun recent(limit: Int = 300): List<LogEntry> {
        val list = ArrayList<LogEntry>()
        runCatching {
            readableDatabase.query(
                "logs",
                arrayOf("_id", "created_at", "cmd", "params", "status", "result", "duration_ms"),
                null,
                null,
                null,
                null,
                "_id DESC",
                limit.toString()
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    list.add(
                        LogEntry(
                            id = cursor.getLong(0),
                            createdAt = cursor.getLong(1),
                            cmd = cursor.getString(2) ?: "",
                            params = cursor.getString(3) ?: "",
                            status = cursor.getString(4) ?: "",
                            result = cursor.getString(5) ?: "",
                            durationMs = cursor.getLong(6)
                        )
                    )
                }
            }
        }
        return list
    }

    fun clear() {
        runCatching { writableDatabase.delete("logs", null, null) }
    }

    companion object {
        private const val DB_NAME = "remote_agent.db"
        private const val DB_VERSION = 1
        private const val MAX_RESULT_LEN = 4000
    }
}
