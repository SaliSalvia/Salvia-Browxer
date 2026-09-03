// File: app/src/main/java/com/salvia/browxer/util/JavaScriptInjector.kt
package com.salvia.browxer.util

/**
 * JavaScriptInjector - Provides JavaScript injection scripts for WebView.
 * 
 * Features:
 * - JS monkey patching for fetch, XMLHttpRequest, HTMLMediaElement
 * - Invisible video hunting via Blob and MSE
 * - Recursive iframe injection
 * - DRM detection
 */
class JavaScriptInjector {

    /**
     * Get main extraction script for monkey patching
     */
    fun getExtractionScript(): String {
        return """
            (function() {
                // Monkey patch window.fetch
                if (window.fetch) {
                    const originalFetch = window.fetch;
                    window.fetch = function(resource, init) {
                        return originalFetch.call(this, resource, init)
                            .then(response => {
                                // Check if response is video
                                const contentType = response.headers.get('content-type') || '';
                                if (contentType.includes('video/')) {
                                    console.log('FETCH_VIDEO: ' + resource);
                                    // Send to native via JavaScript interface
                                    if (window.Android && window.Android.onVideoDetected) {
                                        window.Android.onVideoDetected(resource, contentType);
                                    }
                                }
                                return response;
                            });
                    };
                }

                // Monkey patch XMLHttpRequest
                if (window.XMLHttpRequest) {
                    const originalXHROpen = XMLHttpRequest.prototype.open;
                    XMLHttpRequest.prototype.open = function(method, url) {
                        if (url && (url.includes('.mp4') || url.includes('.webm') || 
                                    url.includes('.m3u8') || url.includes('.mpd') ||
                                    url.includes('.ts') || url.includes('.fmp4'))) {
                            console.log('XHR_VIDEO: ' + url);
                            if (window.Android && window.Android.onVideoDetected) {
                                window.Android.onVideoDetected(url, '');
                            }
                        }
                        return originalXHROpen.apply(this, arguments);
                    };
                }

                // Monkey patch HTMLMediaElement
                if (window.HTMLMediaElement) {
                    const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;
                    HTMLMediaElement.prototype.canPlayType = function(type) {
                        const result = originalCanPlayType.apply(this, arguments);
                        if (result && this.src && (this.src.includes('.mp4') || this.src.includes('.webm'))) {
                            console.log('MEDIA_VIDEO: ' + this.src);
                            if (window.Android && window.Android.onVideoDetected) {
                                window.Android.onVideoDetected(this.src, type);
                            }
                        }
                        return result;
                    };
                }
            })();
        """.trimIndent()
    }

    /**
     * Get MediaSource Extensions hook script
     */
    fun getMseHookScript(): String {
        return """
            (function() {
                if (window.MediaSource) {
                    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
                    MediaSource.prototype.addSourceBuffer = function(mimeType) {
                        const sourceBuffer = originalAddSourceBuffer.apply(this, arguments);
                        
                        if (window.Android && window.Android.onMseBuffer) {
                            window.Android.onMseBuffer(mimeType);
                        }
                        
                        // Hook appendBuffer
                        const originalAppendBuffer = sourceBuffer.appendBuffer;
                        sourceBuffer.appendBuffer = function(buffer) {
                            console.log('MSE_APPEND: ' + mimeType + ', size: ' + buffer.byteLength);
                            if (window.Android && window.Android.onMseData) {
                                // Convert buffer to base64 for transfer
                                const reader = new FileReader();
                                reader.onload = function() {
                                    window.Android.onMseData(mimeType, reader.result);
                                };
                                reader.readAsDataURL(new Blob([buffer]));
                            }
                            return originalAppendBuffer.apply(this, arguments);
                        };
                        
                        return sourceBuffer;
                    };
                }
            })();
        """.trimIndent()
    }

    /**
     * Get Blob URL hook script
     */
    fun getBlobUrlHookScript(): String {
        return """
            (function() {
                if (window.URL && window.URL.createObjectURL) {
                    const originalCreateObjectURL = window.URL.createObjectURL;
                    window.URL.createObjectURL = function(blob) {
                        const url = originalCreateObjectURL.apply(this, arguments);
                        
                        // Check if blob is video
                        if (blob.type && blob.type.startsWith('video/')) {
                            console.log('BLOB_VIDEO: ' + url + ', type: ' + blob.type);
                            if (window.Android && window.Android.onBlobVideo) {
                                window.Android.onBlobVideo(url, blob.type, blob.size);
                            }
                        }
                        
                        return url;
                    };
                }
            })();
        """.trimIndent()
    }

    /**
     * Get recursive iframe injection script
     */
    fun getIframeInjectionScript(): String {
        return """
            (function() {
                // Function to inject scripts into iframe
                function injectIntoIframe(iframe) {
                    try {
                        if (iframe.contentDocument) {
                            const doc = iframe.contentDocument;
                            
                            // Create script element for extraction
                            const script = doc.createElement('script');
                            script.textContent = `
                                ${getExtractionScript()}
                                ${getMseHookScript()}
                                ${getBlobUrlHookScript()}
                                ${getDrmDetectionScript()}
                            `;
                            doc.head.appendChild(script);
                        }
                    } catch (e) {
                        // Cross-origin access denied
                        console.log('Iframe injection failed: ' + e.message);
                    }
                }

                // Hook iframe onload
                const originalAddEventListener = EventTarget.prototype.addEventListener;
                EventTarget.prototype.addEventListener = function(type, listener, options) {
                    if (type === 'load' && this instanceof HTMLIFrameElement) {
                        const wrappedListener = function(event) {
                            listener.apply(this, arguments);
                            injectIntoIframe(this);
                        };
                        return originalAddEventListener.call(this, type, wrappedListener, options);
                    }
                    return originalAddEventListener.call(this, type, listener, options);
                };

                // Also inject into existing iframes
                const iframes = document.getElementsByTagName('iframe');
                for (let i = 0; i < iframes.length; i++) {
                    if (iframes[i].contentDocument) {
                        injectIntoIframe(iframes[i]);
                    }
                }
            })();
        """.trimIndent()
    }

    /**
     * Get DRM detection script
     */
    fun getDrmDetectionScript(): String {
        return """
            (function() {
                // Check for DRM support
                if (window.navigator && window.navigator.requestMediaKeySystemAccess) {
                    const drmCheck = async function() {
                        try {
                            // Try to request Widevine
                            const keySystemAccess = await window.navigator.requestMediaKeySystemAccess(
                                'com.widevine.alpha',
                                [{ initDataTypes: ['keyids', 'webm'] }]
                            );
                            
                            console.log('DRM_DETECTED: Widevine');
                            if (window.Android && window.Android.onDrmDetected) {
                                window.Android.onDrmDetected('Widevine');
                            }
                            
                            return true;
                        } catch (e) {
                            // No DRM or not supported
                            console.log('DRM_NOT_DETECTED: ' + e.message);
                            return false;
                        }
                    };
                    
                    // Run check in background
                    drmCheck();
                }

                // Also check for existing media keys
                if (window.navigator && window.navigator.mediaKeys) {
                    const mediaKeys = window.navigator.mediaKeys;
                    if (mediaKeys && mediaKeys.length > 0) {
                        console.log('DRM_EXISTING: ' + mediaKeys.length + ' keys');
                        if (window.Android && window.Android.onDrmDetected) {
                            window.Android.onDrmDetected('Existing');
                        }
                    }
                }
            })();
        """.trimIndent()
    }

    /**
     * Get script to detect video elements on page
     */
    fun getVideoElementDetectionScript(): String {
        return """
            (function() {
                // Find all video elements on page
                const videos = document.getElementsByTagName('video');
                for (let i = 0; i < videos.length; i++) {
                    const video = videos[i];
                    const src = video.src || '';
                    const currentSrc = video.currentSrc || '';
                    
                    if (src || currentSrc) {
                        console.log('VIDEO_ELEMENT: ' + (src || currentSrc));
                        if (window.Android && window.Android.onVideoDetected) {
                            window.Android.onVideoDetected(src || currentSrc, video.type || '');
                        }
                    }
                    
                    // Also listen for source changes
                    video.addEventListener('loadstart', function() {
                        const src = this.src || this.currentSrc || '';
                        if (src) {
                            console.log('VIDEO_LOADSTART: ' + src);
                            if (window.Android && window.Android.onVideoDetected) {
                                window.Android.onVideoDetected(src, this.type || '');
                            }
                        }
                    });
                }

                // Also check source elements
                const sources = document.getElementsByTagName('source');
                for (let i = 0; i < sources.length; i++) {
                    const source = sources[i];
                    const src = source.src || '';
                    if (src && (src.includes('.mp4') || src.includes('.webm') || 
                                src.includes('.m3u8') || src.includes('.mpd'))) {
                        console.log('SOURCE_ELEMENT: ' + src);
                        if (window.Android && window.Android.onVideoDetected) {
                            window.Android.onVideoDetected(src, source.type || '');
                        }
                    }
                }

                // Observe DOM changes for dynamically added videos
                const observer = new MutationObserver(function(mutations) {
                    mutations.forEach(function(mutation) {
                        mutation.addedNodes.forEach(function(node) {
                            if (node.nodeName === 'VIDEO') {
                                const src = node.src || node.currentSrc || '';
                                if (src) {
                                    console.log('DYNAMIC_VIDEO: ' + src);
                                    if (window.Android && window.Android.onVideoDetected) {
                                        window.Android.onVideoDetected(src, node.type || '');
                                    }
                                }
                            }
                            if (node.nodeName === 'SOURCE') {
                                const src = node.src || '';
                                if (src && (src.includes('.mp4') || src.includes('.webm') || 
                                            src.includes('.m3u8') || src.includes('.mpd'))) {
                                    console.log('DYNAMIC_SOURCE: ' + src);
                                    if (window.Android && window.Android.onVideoDetected) {
                                        window.Android.onVideoDetected(src, node.type || '');
                                    }
                                }
                            }
                        });
                    });
                });

                observer.observe(document.body, { childList: true, subtree: true });
            })();
        """.trimIndent()
    }

    /**
     * Get complete injection script (combines all scripts)
     */
    fun getCompleteInjectionScript(): String {
        return """
            ${getExtractionScript()}
            ${getMseHookScript()}
            ${getBlobUrlHookScript()}
            ${getIframeInjectionScript()}
            ${getDrmDetectionScript()}
            ${getVideoElementDetectionScript()}
        """.trimIndent()
    }
}
