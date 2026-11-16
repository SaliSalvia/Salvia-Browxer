package com.salvia.salviabrowxer.media

import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.StringReader
import java.net.URI
import kotlin.math.ceil

data class DashSegmentPlan(
    val initUrl: String?,
    val segmentUrls: List<String>
)

data class DashRepresentation(
    val id: String,
    val mimeType: String,
    val bandwidth: Long,
    val width: Int?,
    val height: Int?,
    val plan: DashSegmentPlan
)

data class DashParseResult(
    val isDrmProtected: Boolean,
    val isDynamicLive: Boolean,
    val videoTracks: List<DashRepresentation>,
    val audioTracks: List<DashRepresentation>
)

object DashManifestParser {

    private data class SegmentTemplateSpec(
        val initialization: String? = null,
        val media: String? = null,
        val timescale: Long = 1L,
        val duration: Long = 0L,
        val startNumber: Long = 1L,
        val timeline: List<TimelineEntry> = emptyList()
    )

    private data class TimelineEntry(
        val startTime: Long?,
        val duration: Long,
        val repeatCount: Long
    )

    private val isoDurationRe =
        Regex("^P(?:(\\d+)D)?(?:T(?:(\\d+)H)?(?:(\\d+)M)?(?:([0-9.]+)S)?)?$", RegexOption.IGNORE_CASE)

    private val templateNumberFormatRe = Regex("\\\$Number%0(\\d+)d\\\$")

    fun parse(manifestXml: String, mpdUrl: String): DashParseResult {
        val cleanMpdUrl = mpdUrl.substringBefore('#')
        val factory = XmlPullParserFactory.newInstance().apply {
            isNamespaceAware = false
        }
        val parser = factory.newPullParser()
        parser.setInput(StringReader(manifestXml))

        var isDrmProtected = false
        var isDynamicLive = false
        var mpdDurationSec = 0.0
        var mpdBaseUrl = cleanMpdUrl

        var inPeriod = false
        var periodBaseUrl: String? = null
        var periodTemplate: SegmentTemplateSpec? = null

        var inAdaptationSet = false
        var adaptMime = ""
        var adaptBaseUrl: String? = null
        var adaptTemplate: SegmentTemplateSpec? = null
        var adaptWidth: Int? = null
        var adaptHeight: Int? = null

        var inRepresentation = false
        var repId = ""
        var repMime = ""
        var repBandwidth = 0L
        var repWidth: Int? = null
        var repHeight: Int? = null
        var repBaseUrl: String? = null
        var repTemplate: SegmentTemplateSpec? = null
        var repInitUrl: String? = null
        val repSegmentList = mutableListOf<String>()

        var timelineOwner = "" // "period" | "adapt" | "rep"
        var currentTimeline = mutableListOf<TimelineEntry>()
        var currentCursorTime = 0L

        val videoTracks = mutableListOf<DashRepresentation>()
        val audioTracks = mutableListOf<DashRepresentation>()

        fun effectiveBase(): String {
            var base = mpdBaseUrl
            periodBaseUrl?.let { base = resolveUri(base, it) }
            adaptBaseUrl?.let { base = resolveUri(base, it) }
            repBaseUrl?.let { base = resolveUri(base, it) }
            return base
        }

        fun mergeTemplate(parent: SegmentTemplateSpec?, child: SegmentTemplateSpec?): SegmentTemplateSpec? {
            if (parent == null) return child
            if (child == null) return parent
            return SegmentTemplateSpec(
                initialization = child.initialization ?: parent.initialization,
                media = child.media ?: parent.media,
                timescale = if (child.timescale > 0L && child.timescale != 1L) child.timescale else parent.timescale,
                duration = if (child.duration > 0L) child.duration else parent.duration,
                startNumber = if (child.startNumber > 0L) child.startNumber else parent.startNumber,
                timeline = if (child.timeline.isNotEmpty()) child.timeline else parent.timeline
            )
        }

        fun expandRepresentationPlan(
            base: String,
            tpl: SegmentTemplateSpec?,
            explicitInit: String?,
            explicitList: List<String>,
            id: String,
            bandwidth: Long
        ): DashSegmentPlan? {
            if (explicitList.isNotEmpty()) {
                val init = explicitInit?.let { resolveUri(base, it) }
                val segs = explicitList.map { resolveUri(base, it) }
                return DashSegmentPlan(initUrl = init, segmentUrls = segs)
            }
            if (tpl != null && !tpl.media.isNullOrBlank()) {
                val init = tpl.initialization?.let {
                    resolveUri(base, substituteVars(it, id, bandwidth, tpl.startNumber, 0L))
                }
                val segUrls = mutableListOf<String>()
                if (tpl.timeline.isNotEmpty()) {
                    var segNum = tpl.startNumber
                    var tCursor = 0L
                    for (entry in tpl.timeline) {
                        if (entry.startTime != null) {
                            tCursor = entry.startTime
                        }
                        val repeats = if (entry.repeatCount >= 0L) {
                            entry.repeatCount + 1L
                        } else if (mpdDurationSec > 0.0 && entry.duration > 0L && tpl.timescale > 0L) {
                            val totalUnits = (mpdDurationSec * tpl.timescale).toLong()
                            maxOf(1L, ((totalUnits - tCursor) + entry.duration - 1L) / entry.duration)
                        } else {
                            1L
                        }
                        val safeRepeats = repeats.coerceIn(1L, 12_000L)
                        for (r in 0L until safeRepeats) {
                            val rel = substituteVars(tpl.media, id, bandwidth, segNum, tCursor)
                            segUrls.add(resolveUri(base, rel))
                            segNum++
                            tCursor += entry.duration
                            if (segUrls.size >= 12_000) break
                        }
                        if (segUrls.size >= 12_000) break
                    }
                } else if (tpl.duration > 0L && mpdDurationSec > 0.0 && tpl.timescale > 0L) {
                    val segDurSec = tpl.duration.toDouble() / tpl.timescale.toDouble()
                    val count = ceil(mpdDurationSec / segDurSec).toInt().coerceIn(1, 12_000)
                    for (i in 0 until count) {
                        val segNum = tpl.startNumber + i
                        val segTime = i.toLong() * tpl.duration
                        val rel = substituteVars(tpl.media, id, bandwidth, segNum, segTime)
                        segUrls.add(resolveUri(base, rel))
                    }
                }
                if (segUrls.isNotEmpty()) {
                    return DashSegmentPlan(initUrl = init, segmentUrls = segUrls)
                }
            }
            // Fallback: direct BaseURL single media file
            if (repBaseUrl != null || adaptBaseUrl != null) {
                return DashSegmentPlan(initUrl = null, segmentUrls = listOf(base))
            }
            return null
        }

        var eventType = parser.eventType
        while (eventType != XmlPullParser.END_DOCUMENT) {
            when (eventType) {
                XmlPullParser.START_TAG -> {
                    val tag = parser.name?.lowercase().orEmpty()
                    when (tag) {
                        "mpd" -> {
                            val type = parser.getAttributeValue(null, "type")
                            if (type.equals("dynamic", ignoreCase = true)) {
                                isDynamicLive = true
                            }
                            mpdDurationSec = parseIsoDuration(
                                parser.getAttributeValue(null, "mediaPresentationDuration")
                            )
                        }
                        "contentprotection" -> {
                            isDrmProtected = true
                        }
                        "baseurl" -> {
                            val text = readTextSafe(parser).trim()
                            if (text.isNotEmpty()) {
                                when {
                                    inRepresentation -> repBaseUrl = text
                                    inAdaptationSet -> adaptBaseUrl = text
                                    inPeriod -> periodBaseUrl = text
                                    else -> mpdBaseUrl = resolveUri(cleanMpdUrl, text)
                                }
                            }
                        }
                        "period" -> {
                            inPeriod = true
                            periodBaseUrl = null
                            periodTemplate = null
                        }
                        "adaptationset" -> {
                            inAdaptationSet = true
                            adaptMime = parser.getAttributeValue(null, "mimeType")
                                ?: inferMimeFromContentType(parser.getAttributeValue(null, "contentType"))
                            adaptBaseUrl = null
                            adaptTemplate = null
                            adaptWidth = parser.getAttributeValue(null, "width")?.toIntOrNull()
                            adaptHeight = parser.getAttributeValue(null, "height")?.toIntOrNull()
                        }
                        "representation" -> {
                            inRepresentation = true
                            repId = parser.getAttributeValue(null, "id").orEmpty()
                            repMime = parser.getAttributeValue(null, "mimeType")
                                ?.takeIf { it.isNotBlank() }
                                ?: adaptMime
                            repBandwidth = parser.getAttributeValue(null, "bandwidth")?.toLongOrNull() ?: 0L
                            repWidth = parser.getAttributeValue(null, "width")?.toIntOrNull() ?: adaptWidth
                            repHeight = parser.getAttributeValue(null, "height")?.toIntOrNull() ?: adaptHeight
                            repBaseUrl = null
                            repTemplate = null
                            repInitUrl = null
                            repSegmentList.clear()
                        }
                        "segmenttemplate" -> {
                            val tpl = SegmentTemplateSpec(
                                initialization = parser.getAttributeValue(null, "initialization"),
                                media = parser.getAttributeValue(null, "media"),
                                timescale = parser.getAttributeValue(null, "timescale")?.toLongOrNull() ?: 1L,
                                duration = parser.getAttributeValue(null, "duration")?.toLongOrNull() ?: 0L,
                                startNumber = parser.getAttributeValue(null, "startNumber")?.toLongOrNull() ?: 1L
                            )
                            when {
                                inRepresentation -> {
                                    repTemplate = tpl
                                    timelineOwner = "rep"
                                }
                                inAdaptationSet -> {
                                    adaptTemplate = tpl
                                    timelineOwner = "adapt"
                                }
                                inPeriod -> {
                                    periodTemplate = tpl
                                    timelineOwner = "period"
                                }
                            }
                        }
                        "segmenttimeline" -> {
                            currentTimeline = mutableListOf()
                            currentCursorTime = 0L
                        }
                        "s" -> {
                            val tAttr = parser.getAttributeValue(null, "t")?.toLongOrNull()
                            if (tAttr != null) {
                                currentCursorTime = tAttr
                            }
                            val dAttr = parser.getAttributeValue(null, "d")?.toLongOrNull() ?: 0L
                            val rAttr = parser.getAttributeValue(null, "r")?.toLongOrNull() ?: 0L
                            if (dAttr > 0L) {
                                currentTimeline.add(TimelineEntry(tAttr, dAttr, rAttr))
                            }
                        }
                        "initialization" -> {
                            if (inRepresentation) {
                                repInitUrl = parser.getAttributeValue(null, "sourceURL")
                            }
                        }
                        "segmenturl" -> {
                            if (inRepresentation) {
                                parser.getAttributeValue(null, "media")?.takeIf { it.isNotBlank() }?.let {
                                    repSegmentList.add(it)
                                }
                            }
                        }
                    }
                }
                XmlPullParser.END_TAG -> {
                    when (parser.name?.lowercase().orEmpty()) {
                        "segmenttimeline" -> {
                            val listCopy = currentTimeline.toList()
                            when (timelineOwner) {
                                "rep" -> repTemplate = repTemplate?.copy(timeline = listCopy)
                                "adapt" -> adaptTemplate = adaptTemplate?.copy(timeline = listCopy)
                                "period" -> periodTemplate = periodTemplate?.copy(timeline = listCopy)
                            }
                        }
                        "representation" -> {
                            if (inRepresentation) {
                                val resolvedMime = repMime.lowercase()
                                val mergedTpl = mergeTemplate(
                                    mergeTemplate(periodTemplate, adaptTemplate),
                                    repTemplate
                                )
                                val base = effectiveBase()
                                val plan = expandRepresentationPlan(
                                    base = base,
                                    tpl = mergedTpl,
                                    explicitInit = repInitUrl,
                                    explicitList = repSegmentList,
                                    id = repId,
                                    bandwidth = repBandwidth
                                )
                                if (plan != null && plan.segmentUrls.isNotEmpty()) {
                                    val rep = DashRepresentation(
                                        id = repId.ifBlank { "${repHeight ?: 0}_${repBandwidth}" },
                                        mimeType = resolvedMime.ifBlank { "video/mp4" },
                                        bandwidth = repBandwidth,
                                        width = repWidth,
                                        height = repHeight,
                                        plan = plan
                                    )
                                    if (resolvedMime.startsWith("audio/")) {
                                        audioTracks.add(rep)
                                    } else if (resolvedMime.startsWith("video/") || resolvedMime.isBlank()) {
                                        videoTracks.add(rep)
                                    }
                                }
                                inRepresentation = false
                            }
                        }
                        "adaptationset" -> {
                            inAdaptationSet = false
                        }
                        "period" -> {
                            inPeriod = false
                        }
                    }
                }
            }
            eventType = parser.next()
        }

        val sortedVideo = videoTracks.sortedWith(
            compareByDescending<DashRepresentation> { it.height ?: 0 }
                .thenByDescending { it.bandwidth }
        )
        val sortedAudio = audioTracks.sortedByDescending { it.bandwidth }

        return DashParseResult(
            isDrmProtected = isDrmProtected,
            isDynamicLive = isDynamicLive,
            videoTracks = sortedVideo,
            audioTracks = sortedAudio
        )
    }

    private fun readTextSafe(parser: XmlPullParser): String {
        val sb = StringBuilder()
        var next = parser.next()
        while (next == XmlPullParser.TEXT || next == XmlPullParser.CDSECT) {
            sb.append(parser.text.orEmpty())
            next = parser.next()
        }
        return sb.toString()
    }

    private fun substituteVars(
        template: String,
        repId: String,
        bandwidth: Long,
        number: Long,
        time: Long
    ): String {
        var out = template
            .replace("\$RepresentationID\$", repId)
            .replace("\$Bandwidth\$", bandwidth.toString())
            .replace("\$Number\$", number.toString())
            .replace("\$Time\$", time.toString())
        out = templateNumberFormatRe.replace(out) { m ->
            val pad = m.groupValues.getOrNull(1)?.toIntOrNull()?.coerceIn(1, 12) ?: 1
            number.toString().padStart(pad, '0')
        }
        return out
    }

    private fun resolveUri(base: String, ref: String): String {
        return try {
            URI(base).resolve(ref).toString()
        } catch (_: Exception) {
            ref
        }
    }

    private fun inferMimeFromContentType(contentType: String?): String {
        return when (contentType?.trim()?.lowercase()) {
            "audio" -> "audio/mp4"
            "video" -> "video/mp4"
            else -> ""
        }
    }

    private fun parseIsoDuration(raw: String?): Double {
        if (raw.isNullOrBlank()) return 0.0
        val m = isoDurationRe.find(raw.trim()) ?: return 0.0
        val days = m.groupValues[1].toDoubleOrNull() ?: 0.0
        val hours = m.groupValues[2].toDoubleOrNull() ?: 0.0
        val mins = m.groupValues[3].toDoubleOrNull() ?: 0.0
        val secs = m.groupValues[4].toDoubleOrNull() ?: 0.0
        return days * 86400.0 + hours * 3600.0 + mins * 60.0 + secs
    }
}
