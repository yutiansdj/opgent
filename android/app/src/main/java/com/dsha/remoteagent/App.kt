package com.dsha.remoteagent

import android.app.Application
import com.dsha.remoteagent.data.AppConfig
import com.dsha.remoteagent.data.LogStore

/**
 * 应用入口：持有全局配置与日志库单例，供 Service / UI 共用。
 */
class App : Application() {

    lateinit var config: AppConfig
        private set

    lateinit var logStore: LogStore
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        config = AppConfig(this)
        logStore = LogStore(this)
    }

    companion object {
        lateinit var instance: App
            private set
    }
}
