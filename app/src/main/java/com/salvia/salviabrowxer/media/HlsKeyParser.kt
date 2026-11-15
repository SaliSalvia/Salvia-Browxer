package com.salvia.salviabrowxer.media

import java.net.URI
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

data class HlsKeySpec(
    val method: String,
    val keyUri: String?,
    val explicitIv: ByteArray?
)

data class HlsSegmentEntry(
    val url: String,
    val sequenceNumber: Long,
    val keySpec: HlsKeySpec?,
    val isInitSegment: Boolean = false,
    val byteRangeOffset: Long? = null,
    val byteRangeLength: Long? = null
)

object HlsKeyParser {
    private val attrRegex = Regex("([A-Z0-9-]+)=(\"([^\"]*)\"|([^,]*))")

    private fun parseByteRange(spec: String, lastEndOffset: Long?): Pair<Long, Long>? {
        val parts = spec.trim().split('@', limit = 2)
        val length = parts.getOrNull(0)?.trim()?.toLongOrNull() ?: return null
        if (length <= 0L) return null
        val offset = parts.getOrNull(1)?.trim()?.toLongOrNull() ?: (lastEndOffset ?: 0L)
        return offset to length
    }

    fun parsePlaylistEntries(manifestText: String, baseUrl: String): List<HlsSegmentEntry> {
        val base = try {
            URI(baseUrl)
        } catch (_: Exception) {
            return emptyList()
        }

        val entries = ArrayList<HlsSegmentEntry>()
        var sequence = 0L
        var activeKey: HlsKeySpec? = null
        var pendingByteRange: Pair<Long, Long>? = null
        var lastByteRangeEnd: Long? = null

        for (raw in manifestText.lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty()) continue

            if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:", ignoreCase = true)) {
                sequence = line.substringAfter(':').trim().toLongOrNull() ?: 0L
                continue
            }

            if (line.startsWith("#EXT-X-KEY:", ignoreCase = true)) {
                val attrs = parseAttributes(line.substringAfter(':'))
                val method = attrs["METHOD"]?.uppercase() ?: "NONE"
                activeKey = if (method == "NONE") {
                    null
                } else {
                    val uri = attrs["URI"]?.let { rawUri ->
                        try {
                            base.resolve(rawUri).toString()
                        } catch (_: Exception) {
                            rawUri
                        }
                    }
                    val ivBytes = attrs["IV"]?.let { parseHexIv(it) }
                    HlsKeySpec(method = method, keyUri = uri, explicitIv = ivBytes)
                }
                continue
            }

            if (line.startsWith("#EXT-X-BYTERANGE:", ignoreCase = true)) {
                val parsed = parseByteRange(line.substringAfter(':'), lastByteRangeEnd)
                if (parsed != null) {
                    pendingByteRange = parsed
                    lastByteRangeEnd = parsed.first + parsed.second
                }
                continue
            }

            if (line.startsWith("#EXT-X-MAP:", ignoreCase = true)) {
                val attrs = parseAttributes(line.substringAfter(':'))
                val rawUri = attrs["URI"]
                val mapRange = attrs["BYTERANGE"]?.let { parseByteRange(it, null) }
                if (!rawUri.isNullOrBlank()) {
                    try {
                        entries.add(
                            HlsSegmentEntry(
                                url = base.resolve(rawUri).toString(),
                                sequenceNumber = sequence,
                                keySpec = activeKey,
                                isInitSegment = true,
                                byteRangeOffset = mapRange?.first,
                                byteRangeLength = mapRange?.second
                            )
                        )
                    } catch (_: Exception) {
                    }
                }
                continue
            }

            if (line.startsWith("#")) continue

            try {
                val br = pendingByteRange
                pendingByteRange = null
                entries.add(
                    HlsSegmentEntry(
                        url = base.resolve(line).toString(),
                        sequenceNumber = sequence,
                        keySpec = activeKey,
                        isInitSegment = false,
                        byteRangeOffset = br?.first,
                        byteRangeLength = br?.second
                    )
                )
                sequence++
            } catch (_: Exception) {
            }
        }
        return entries
    }

    fun sequenceIv(sequenceNumber: Long): ByteArray {
        val iv = ByteArray(16)
        var v = sequenceNumber
        for (i in 15 downTo 8) {
            iv[i] = (v and 0xFF).toByte()
            v = v ushr 8
        }
        return iv
    }

    fun parseHexIv(raw: String): ByteArray? {
        val clean = raw.trim().removePrefix("0x").removePrefix("0X")
        if (clean.isEmpty() || clean.length > 32) return null
        val padded = clean.padStart(32, '0')
        return try {
            ByteArray(16) { idx ->
                padded.substring(idx * 2, idx * 2 + 2).toInt(16).toByte()
            }
        } catch (_: Exception) {
            null
        }
    }

    fun decryptAes128Cbc(encrypted: ByteArray, keyBytes: ByteArray, ivBytes: ByteArray): ByteArray {
        if (keyBytes.size != 16 || ivBytes.size != 16) {
            throw IllegalArgumentException("AES-128 requires 16-byte key and IV")
        }
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(keyBytes, "AES"), IvParameterSpec(ivBytes))
        return cipher.doFinal(encrypted)
    }

    private fun parseAttributes(raw: String): Map<String, String> {
        val map = LinkedHashMap<String, String>()
        for (match in attrRegex.findAll(raw)) {
            val k = match.groupValues[1].uppercase()
            val v = match.groupValues[3].ifEmpty { match.groupValues[4] }
            map[k] = v
        }
        return map
    }
}
