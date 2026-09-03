// File: app/src/main/java/com/salvia/browxer/model/SessionInfo.kt
package com.salvia.browxer.model

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

/**
 * SessionInfo - Represents browser session information for header hijacking.
 * 
 * @param userAgent The user agent string
 * @param referer The referer URL
 * @param origin The origin URL
 * @param cookies Map of cookie name to value
 * @param authorization Bearer token for authorization
 * @param customHeaders Custom headers for the session
 * @param isIncognito Whether this is an incognito session
 * @param sessionId Unique session identifier
 * @param timestamp When the session was created
 */
@Parcelize
data class SessionInfo(
    val userAgent: String = "",
    val referer: String = "",
    val origin: String = "",
    val cookies: Map<String, String> = emptyMap(),
    val authorization: String = "",
    val customHeaders: Map<String, String> = emptyMap(),
    val isIncognito: Boolean = false,
    val sessionId: String = java.util.UUID.randomUUID().toString(),
    val timestamp: Long = System.currentTimeMillis()
) : Parcelable {
    
    /**
     * Get all headers as a single map
     */
    fun getAllHeaders(): Map<String, String> {
        val headers = mutableMapOf<String, String>()
        
        // Add standard headers
        if (userAgent.isNotEmpty()) {
            headers["User-Agent"] = userAgent
        }
        if (referer.isNotEmpty()) {
            headers["Referer"] = referer
        }
        if (origin.isNotEmpty()) {
            headers["Origin"] = origin
        }
        if (authorization.isNotEmpty()) {
            headers["Authorization"] = authorization
        }
        
        // Add cookies
        if (cookies.isNotEmpty()) {
            val cookieString = cookies.entries.joinToString("; ") { (name, value) ->
                "$name=$value"
            }
            headers["Cookie"] = cookieString
        }
        
        // Add custom headers
        headers.putAll(customHeaders)
        
        return headers
    }
    
    /**
     * Check if session has authorization
     */
    fun hasAuthorization(): Boolean {
        return authorization.isNotEmpty()
    }
    
    /**
     * Check if session has cookies
     */
    fun hasCookies(): Boolean {
        return cookies.isNotEmpty()
    }
    
    /**
     * Get cookie value by name
     */
    fun getCookie(name: String): String? {
        return cookies[name]
    }
    
    /**
     * Get a copy with updated user agent
     */
    fun copyWithUserAgent(newUserAgent: String): SessionInfo {
        return copy(userAgent = newUserAgent)
    }
    
    /**
     * Get a copy with updated referer
     */
    fun copyWithReferer(newReferer: String): SessionInfo {
        return copy(referer = newReferer)
    }
    
    /**
     * Get a copy with updated origin
     */
    fun copyWithOrigin(newOrigin: String): SessionInfo {
        return copy(origin = newOrigin)
    }
    
    /**
     * Get a copy with updated cookies
     */
    fun copyWithCookies(newCookies: Map<String, String>): SessionInfo {
        return copy(cookies = newCookies)
    }
    
    /**
     * Get a copy with updated authorization
     */
    fun copyWithAuthorization(newAuthorization: String): SessionInfo {
        return copy(authorization = newAuthorization)
    }
    
    /**
     * Get a copy with added custom header
     */
    fun copyWithCustomHeader(key: String, value: String): SessionInfo {
        val newCustomHeaders = customHeaders.toMutableMap()
        newCustomHeaders[key] = value
        return copy(customHeaders = newCustomHeaders)
    }
    
    /**
     * Clear session data (for incognito mode)
     */
    fun clearSessionData(): SessionInfo {
        return copy(
            cookies = emptyMap(),
            authorization = "",
            customHeaders = emptyMap()
        )
    }
    
    override fun toString(): String {
        return "SessionInfo(userAgent='$userAgent', referer='$referer', " +
                "origin='$origin', cookies=${cookies.size}, " +
                "authorization=${if (authorization.isNotEmpty()) "***" else "none"}, " +
                "isIncognito=$isIncognito)"
    }
}

/**
 * Extension function to create SessionInfo from WebView
 */
fun createSessionInfoFromWebView(
    userAgent: String = "",
    referer: String = "",
    origin: String = "",
    cookies: Map<String, String> = emptyMap(),
    authorization: String = "",
    isIncognito: Boolean = false
): SessionInfo {
    return SessionInfo(
        userAgent = userAgent,
        referer = referer,
        origin = origin,
        cookies = cookies,
        authorization = authorization,
        isIncognito = isIncognito
    )
}
