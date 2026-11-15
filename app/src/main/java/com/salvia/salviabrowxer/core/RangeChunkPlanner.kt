package com.salvia.salviabrowxer.core

import java.net.URI

data class ByteRange(
    val index: Int,
    val start: Long,
    val end: Long
)

object RangeChunkPlanner {
    private const val MIN_SPLIT_SIZE_BYTES = 262_144L

    fun computeRanges(totalBytes: Long, requestedConnections: Int): List<ByteRange> {
        if (totalBytes <= 0L) return emptyList()
        val count = if (totalBytes < MIN_SPLIT_SIZE_BYTES) {
            1
        } else {
            requestedConnections.coerceIn(1, 8)
        }
        if (count == 1) {
            return listOf(ByteRange(index = 0, start = 0L, end = totalBytes - 1L))
        }
        val chunkSize = totalBytes / count
        val ranges = ArrayList<ByteRange>(count)
        var start = 0L
        for (i in 0 until count) {
            val end = if (i == count - 1) totalBytes - 1L else (start + chunkSize - 1L)
            ranges.add(ByteRange(index = i, start = start, end = end))
            start = end + 1L
        }
        return ranges
    }

    fun extractHlsSegmentUrls(manifestText: String, baseUrl: String): List<String> {
        val base = try {
            URI(baseUrl)
        } catch (_: Exception) {
            return emptyList()
        }
        val urls = ArrayList<String>()
        for (raw in manifestText.lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            if (line.startsWith("#EXT-X-MAP:", ignoreCase = true)) {
                val match = Regex("URI=\"([^\"]+)\"").find(line)
                val mapUri = match?.groupValues?.getOrNull(1)
                if (!mapUri.isNullOrBlank()) {
                    try {
                        urls.add(base.resolve(mapUri).toString())
                    } catch (_: Exception) {
                    }
                }
                continue
            }
            if (line.startsWith("#")) continue
            try {
                urls.add(base.resolve(line).toString())
            } catch (_: Exception) {
            }
        }
        return urls
    }

    fun selectBestMasterVariantUrl(manifestText: String, baseUrl: String): String? {
        if (!manifestText.contains("#EXT-X-STREAM-INF", ignoreCase = true)) return null
        val base = try {
            URI(baseUrl)
        } catch (_: Exception) {
            return null
        }
        var bestUrl: String? = null
        var bestBandwidth = -1L
        var pendingBandwidth = 0L
        var expectingUri = false
        for (raw in manifestText.lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            if (line.startsWith("#EXT-X-STREAM-INF", ignoreCase = true)) {
                val bw = Regex("BANDWIDTH=(\\d+)").find(line)?.groupValues?.getOrNull(1)?.toLongOrNull() ?: 0L
                pendingBandwidth = bw
                expectingUri = true
            } else if (expectingUri && !line.startsWith("#")) {
                expectingUri = false
                try {
                    val resolved = base.resolve(line).toString()
                    if (pendingBandwidth >= bestBandwidth) {
                        bestBandwidth = pendingBandwidth
                        bestUrl = resolved
                    }
                } catch (_: Exception) {
                }
            }
        }
        return bestUrl
    }
}
