package com.betterdeepseek.app

import android.content.SharedPreferences

/**
 * Minimal working SharedPreferences for JVM unit tests — a plain Mockito mock
 * cannot provide read-after-write semantics. Shared by RemoteDataSyncTest and
 * WebViewBridgeDispatchTest.
 */
internal class InMemorySharedPreferences : SharedPreferences {

    private val map = HashMap<String, String>()

    fun set(key: String, value: String) {
        map[key] = value
    }

    fun get(key: String): String? = map[key]

    fun removeKey(key: String) {
        map.remove(key)
    }

    override fun getAll(): Map<String, *> = map.toMap()

    override fun getString(key: String?, defValue: String?): String? =
        if (key == null) defValue else map[key] ?: defValue

    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
        defValues

    override fun getInt(key: String?, defValue: Int): Int = defValue

    override fun getLong(key: String?, defValue: Long): Long = defValue

    override fun getFloat(key: String?, defValue: Float): Float = defValue

    override fun getBoolean(key: String?, defValue: Boolean): Boolean = defValue

    override fun contains(key: String?): Boolean = key != null && map.containsKey(key)

    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        override fun putString(key: String?, value: String?): SharedPreferences.Editor {
            if (key != null) map[key] = value ?: ""
            return this
        }

        override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor = this

        override fun putInt(key: String?, value: Int): SharedPreferences.Editor = this

        override fun putLong(key: String?, value: Long): SharedPreferences.Editor = this

        override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = this

        override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = this

        override fun remove(key: String?): SharedPreferences.Editor {
            if (key != null) map.remove(key)
            return this
        }

        override fun clear(): SharedPreferences.Editor {
            map.clear()
            return this
        }

        override fun commit(): Boolean = true

        override fun apply() {}
    }

    override fun registerOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener?,
    ) {
        // no-op in tests
    }

    override fun unregisterOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener?,
    ) {
        // no-op in tests
    }
}
