// File: app/src/main/java/com/salvia/browxer/browser/SessionManager.kt
package com.salvia.browxer.browser

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebView
import com.salvia.browxer.model.SessionInfo
import com.salvia.browxer.util.JavaScriptInjector
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * SessionManager - Manages browser sessions and header hijacking.
 * 
 * Features:
 * - Session state interception
 * - Header extraction (User-Agent, Referer, Origin, Cookies, Authorization)
 * - Session isolation for incognito mode
 * - Dynamic header injection
 */
class SessionManager private constructor(
    private val context: Context
) {
    
    companion object {
        @Volatile
        private var instance: SessionManager? = null
        
        fun getInstance(context: Context): SessionManager {
            return instance ?: synchronized(this) {
                instance ?: SessionManager(context.applicationContext).also {
                    instance = it
                }
            }
        }
    }

    private val cookieManager = CookieManager.getInstance()
    private val javaScriptInjector = JavaScriptInjector()
    
    // Current session
    private var currentSession: SessionInfo = SessionInfo()
    
    // Session history
    private val sessionHistory = mutableListOf<SessionInfo>()
    
    // Incognito sessions
    private val incognitoSessions = mutableMapOf<String, SessionInfo>()

    /**
     * Initialize session for a WebView
     */
    fun initializeSession(webView: WebView, isIncognito: Boolean = false) {
        if (isIncognito) {
            // Create new incognito session
            currentSession = SessionInfo(
                userAgent = webView.settings.userAgentString ?: "",
                isIncognito = true
            )
            
            // Store session
            incognitoSessions[currentSession.sessionId] = currentSession
            
            // Configure WebView for incognito
            configureIncognitoWebView(webView)
            
        } else {
            // Create or update regular session
            currentSession = SessionInfo(
                userAgent = webView.settings.userAgentString ?: "",
                isIncognito = false
            )
            
            // Store in history
            sessionHistory.add(currentSession)
        }
        
        // Inject session hijacking scripts
        injectSessionScripts(webView)
    }

    /**
     * Configure WebView for incognito mode
     */
    private fun configureIncognitoWebView(webView: WebView) {
        // Clear cookies for this WebView
        cookieManager.removeAllCookies { }
        
        // Disable caching
        webView.settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
        
        // Disable DOM storage
        webView.settings.domStorageEnabled = false
        
        // Disable database storage
        webView.settings.databaseEnabled = false
    }

    /**
     * Inject session hijacking scripts
     */
    private fun injectSessionScripts(webView: WebView) {
        // Inject script to capture headers and session state
        val sessionScript = """
            (function() {
                // Override fetch to capture headers
                if (window.fetch) {
                    const originalFetch = window.fetch;
                    window.fetch = async function(resource, init) {
                        const response = await originalFetch.call(this, resource, init);
                        
                        // Capture response headers
                        if (window.Android && window.Android.onSessionHeaders) {
                            const headers = {};
                            response.headers.forEach((name, value) => {
                                headers[name] = value;
                            });
                            window.Android.onSessionHeaders(resource, init ? init.headers : {}, headers);
                        }
                        
                        return response;
                    };
                }

                // Override XMLHttpRequest to capture headers
                if (window.XMLHttpRequest) {
                    const originalXHROpen = XMLHttpRequest.prototype.open;
                    const originalXHRSend = XMLHttpRequest.prototype.send;
                    
                    XMLHttpRequest.prototype.open = function(method, url) {
                        this._method = method;
                        this._url = url;
                        return originalXHROpen.apply(this, arguments);
                    };
                    
                    XMLHttpRequest.prototype.send = function(body) {
                        if (window.Android && window.Android.onSessionHeaders) {
                            const headers = {};
                            if (this._url) {
                                headers['URL'] = this._url;
                                headers['Method'] = this._method || 'GET';
                            }
                            window.Android.onSessionHeaders(this._url || '', headers, {});
                        }
                        return originalXHRSend.apply(this, arguments);
                    };
                }

                // Capture document.cookie
                if (window.Android && window.Android.onSessionCookies) {
                    try {
                        window.Android.onSessionCookies(document.cookie);
                    } catch (e) {
                        // Cookie access might be restricted
                    }
                }

                // Capture navigator.userAgent
                if (window.Android && window.Android.onSessionUserAgent) {
                    window.Android.onSessionUserAgent(navigator.userAgent);
                }

                // Capture document.referrer
                if (window.Android && window.Android.onSessionReferrer) {
                    window.Android.onSessionReferrer(document.referrer);
                }
            })();
        """.trimIndent()
        
        webView.evaluateJavascript(sessionScript) { result ->
            // Handle result if needed
        }
    }

    /**
     * Extract session information from WebView
     */
    suspend fun extractSessionInfo(webView: WebView): SessionInfo {
        return withContext(Dispatchers.IO) {
            val userAgent = webView.settings.userAgentString ?: ""
            val referer = getReferer(webView) ?: ""
            val origin = getOrigin(webView) ?: ""
            val cookies = getCookies(webView.url ?: "")
            val authorization = getAuthorization(webView)
            
            currentSession = currentSession.copy(
                userAgent = userAgent,
                referer = referer,
                origin = origin,
                cookies = cookies,
                authorization = authorization
            )
            
            currentSession
        }
    }

    /**
     * Get referer from WebView
     */
    private fun getReferer(webView: WebView): String? {
        return try {
            webView.evaluateJavascript("document.referrer") { result ->
                // This is async, so we need a different approach
            }
            null
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Get origin from WebView
     */
    private fun getOrigin(webView: WebView): String? {
        return try {
            val url = webView.url ?: return null
            val uri = android.net.Uri.parse(url)
            "${uri.scheme}://${uri.host}"
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Get cookies for URL
     */
    fun getCookies(url: String): Map<String, String> {
        val cookies = mutableMapOf<String, String>()
        
        try {
            val cookieString = cookieManager.getCookie(url) ?: return cookies
            
            cookieString.split(";").forEach { cookie ->
                val parts = cookie.trim().split("=")
                if (parts.size == 2) {
                    cookies[parts[0]] = parts[1]
                }
            }
        } catch (e: Exception) {
            // Ignore
        }
        
        return cookies
    }

    /**
     * Get authorization token
     */
    private fun getAuthorization(webView: WebView): String {
        // This would be extracted from JavaScript injection
        return ""
    }

    /**
     * Get current session
     */
    fun getCurrentSession(): SessionInfo {
        return currentSession
    }

    /**
     * Update current session
     */
    fun updateCurrentSession(sessionInfo: SessionInfo) {
        currentSession = sessionInfo
    }

    /**
     * Create incognito session
     */
    fun createIncognitoSession(): SessionInfo {
        val session = SessionInfo(
            userAgent = currentSession.userAgent,
            isIncognito = true
        )
        
        incognitoSessions[session.sessionId] = session
        currentSession = session
        
        return session
    }

    /**
     * Destroy incognito session
     */
    fun destroyIncognitoSession(sessionId: String) {
        incognitoSessions.remove(sessionId)
        
        if (currentSession.sessionId == sessionId) {
            currentSession = SessionInfo()
        }
    }

    /**
     * Clear all sessions
     */
    fun clearAllSessions() {
        sessionHistory.clear()
        incognitoSessions.clear()
        currentSession = SessionInfo()
    }

    /**
     * Get session headers for download
     */
    fun getSessionHeaders(): Map<String, String> {
        return currentSession.getAllHeaders()
    }

    /**
     * Set custom header
     */
    fun setCustomHeader(key: String, value: String) {
        currentSession = currentSession.copyWithCustomHeader(key, value)
    }

    /**
     * Remove custom header
     */
    fun removeCustomHeader(key: String) {
        val newHeaders = currentSession.customHeaders.toMutableMap()
        newHeaders.remove(key)
        currentSession = currentSession.copy(customHeaders = newHeaders)
    }

    /**
     * Set user agent
     */
    fun setUserAgent(userAgent: String) {
        currentSession = currentSession.copyWithUserAgent(userAgent)
    }

    /**
     * Set referer
     */
    fun setReferer(referer: String) {
        currentSession = currentSession.copyWithReferer(referer)
    }

    /**
     * Set origin
     */
    fun setOrigin(origin: String) {
        currentSession = currentSession.copyWithOrigin(origin)
    }

    /**
     * Set authorization
     */
    fun setAuthorization(authorization: String) {
        currentSession = currentSession.copyWithAuthorization(authorization)
    }

    /**
     * Set cookies
     */
    fun setCookies(cookies: Map<String, String>) {
        currentSession = currentSession.copyWithCookies(cookies)
        
        // Also set cookies in CookieManager
        val cookieString = cookies.entries.joinToString("; ") { (name, value) ->
            "$name=$value"
        }
        cookieManager.setCookie("", cookieString)
    }

    /**
     * Clear cookies
     */
    fun clearCookies() {
        cookieManager.removeAllCookies { }
        currentSession = currentSession.copy(cookies = emptyMap())
    }

    /**
     * Hijack session for download
     */
    fun hijackSessionForDownload(url: String): SessionInfo {
        val session = currentSession.copy(
            referer = url
        )
        
        return session
    }

    /**
     * Check if session has required headers for download
     */
    fun hasRequiredHeaders(): Boolean {
        return currentSession.userAgent.isNotEmpty() &&
               (currentSession.referer.isNotEmpty() || currentSession.origin.isNotEmpty())
    }

    /**
     * Get session state as string for debugging
     */
    fun getSessionState(): String {
        return """
            Session State:
            User-Agent: ${currentSession.userAgent}
            Referer: ${currentSession.referer}
            Origin: ${currentSession.origin}
            Cookies: ${currentSession.cookies.size}
            Authorization: ${if (currentSession.authorization.isNotEmpty()) "***" else "none"}
            Custom Headers: ${currentSession.customHeaders.size}
            Is Incognito: ${currentSession.isIncognito}
        """.trimIndent()
    }
}
