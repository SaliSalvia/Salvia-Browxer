// File: app/src/main/java/com/salvia/browxer/util/HttpClient.kt
package com.salvia.browxer.util

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * HttpClient - Wrapper for OkHttpClient with optimized settings.
 * 
 * Features:
 * - Connection pooling
 * - HTTP/2 support
 * - Custom headers support
 * - Timeout configuration
 */
class HttpClient {
    
    private val client: OkHttpClient by lazy {
        createOkHttpClient()
    }

    /**
     * Create OkHttpClient with optimized settings
     */
    private fun createOkHttpClient(): OkHttpClient {
        return OkHttpClient.Builder()
            .connectionPool(okhttp3.ConnectionPool(16, 5, TimeUnit.MINUTES))
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .callTimeout(300, TimeUnit.SECONDS) // 5 minutes for large downloads
            .followRedirects(true)
            .followSslRedirects(true)
            .retryOnConnectionFailure(true)
            .build()
    }

    /**
     * Get string content from URL
     */
    suspend fun getString(url: String, headers: Map<String, String> = emptyMap()): String {
        val request = Request.Builder()
            .url(url)
            .get()
            .apply {
                headers.forEach { (key, value) ->
                    addHeader(key, value)
                }
            }
            .build()
        
        val response = client.newCall(request).execute()
        
        if (!response.isSuccessful) {
            response.close()
            throw IOException("HTTP ${response.code}: ${response.message}")
        }
        
        val body = response.body
        val result = body?.string() ?: throw IOException("Empty response body")
        response.close()
        
        return result
    }

    /**
     * Get bytes from URL
     */
    suspend fun getBytes(url: String, headers: Map<String, String> = emptyMap()): ByteArray {
        val request = Request.Builder()
            .url(url)
            .get()
            .apply {
                headers.forEach { (key, value) ->
                    addHeader(key, value)
                }
            }
            .build()
        
        val response = client.newCall(request).execute()
        
        if (!response.isSuccessful) {
            response.close()
            throw IOException("HTTP ${response.code}: ${response.message}")
        }
        
        val body = response.body
        val result = body?.bytes() ?: throw IOException("Empty response body")
        response.close()
        
        return result
    }

    /**
     * Get content length from URL (HEAD request)
     */
    suspend fun getContentLength(url: String, headers: Map<String, String> = emptyMap()): Long {
        val request = Request.Builder()
            .url(url)
            .head()
            .apply {
                headers.forEach { (key, value) ->
                    addHeader(key, value)
                }
            }
            .build()
        
        val response = client.newCall(request).execute()
        
        if (!response.isSuccessful) {
            response.close()
            return 0L
        }
        
        val contentLength = response.header("Content-Length")?.toLongOrNull() ?: 0L
        response.close()
        
        return contentLength
    }

    /**
     * Download file with range support
     */
    suspend fun downloadWithRange(
        url: String,
        startByte: Long,
        endByte: Long,
        headers: Map<String, String> = emptyMap()
    ): ByteArray {
        val request = Request.Builder()
            .url(url)
            .addHeader("Range", "bytes=$startByte-$endByte")
            .apply {
                headers.forEach { (key, value) ->
                    addHeader(key, value)
                }
            }
            .build()
        
        val response = client.newCall(request).execute()
        
        if (!response.isSuccessful) {
            response.close()
            throw IOException("HTTP ${response.code}: ${response.message}")
        }
        
        val body = response.body
        val result = body?.bytes() ?: throw IOException("Empty response body")
        response.close()
        
        return result
    }

    /**
     * Check if URL exists and is accessible
     */
    suspend fun isUrlAccessible(url: String, headers: Map<String, String> = emptyMap()): Boolean {
        return try {
            val request = Request.Builder()
                .url(url)
                .head()
                .apply {
                    headers.forEach { (key, value) ->
                        addHeader(key, value)
                    }
                }
                .build()
            
            val response = client.newCall(request).execute()
            val isSuccessful = response.isSuccessful
            response.close()
            isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Get response headers
     */
    suspend fun getHeaders(url: String, headers: Map<String, String> = emptyMap()): Map<String, String> {
        val request = Request.Builder()
            .url(url)
            .head()
            .apply {
                headers.forEach { (key, value) ->
                    addHeader(key, value)
                }
            }
            .build()
        
        val response = client.newCall(request).execute()
        val result = response.headers.toMultimap().mapValues { (_, values) ->
            values.joinToString(", ")
        }
        response.close()
        
        return result
    }

    /**
     * Cleanup resources
     */
    fun cleanup() {
        client.connectionPool.evictAll()
        client.dispatcher.cancelAll()
    }
}
